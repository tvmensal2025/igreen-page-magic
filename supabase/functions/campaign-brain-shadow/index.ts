/**
 * Cérebro de Campanhas — análise, modo sombra e backtest.
 *
 * Esta função NUNCA chama a Meta. Ela existe justamente para ser o lugar onde o
 * novo Cérebro roda por completo (medir → decidir) sem risco: é o que permite
 * comparar o que ele recomendaria com o que o motor atual fez, antes de alguém
 * cogitar ligar execução.
 *
 * Auth: service_role OU consultor (só as próprias campanhas).
 *
 * Body:
 *   {
 *     consultant_id?: string,
 *     mode?: "analyze" | "shadow" | "backtest",   // default "analyze"
 *     window_days?: number,                        // default 2
 *     campaign_ids?: string[],
 *     backtest_points?: number,                    // default 7 (dias para trás)
 *     backtest_step_hours?: number                 // default 24
 *   }
 *
 * Modos:
 *   analyze  — mede e decide. Zero escrita.
 *   shadow   — mede, decide e REGISTRA a recomendação em `ads_brain_decisions`.
 *              Nenhuma chamada à Meta, nenhum orçamento alterado.
 *   backtest — reprocessa janelas terminando em pontos passados. Zero escrita.
 */
import { adminClient, authConsultant } from "../_shared/fb-graph.ts";
import { buildCors } from "../_shared/cors.ts";
import { isServiceRoleAuth } from "../_shared/service-role-auth.ts";
import { measureConsultantCampaigns } from "../_shared/brain-measure.ts";
import { type BrainDecision, decideCampaign } from "../_shared/brain-decide.ts";
import { describeDataQuality } from "../_shared/brain-data-quality.ts";
import { healthLabel } from "../_shared/brain-health.ts";
import {
  confidenceLabel,
  sampleQualityLabel,
} from "../_shared/brain-sample.ts";
import {
  loadBrainActivity,
  loadUsedSnapshotVersions,
  recordRecommendation,
} from "../_shared/brain-decision-store.ts";
import {
  runOutcomeEvaluation,
  runScheduledShadow,
} from "../_shared/brain-batch.ts";
import { supportLabel } from "../_shared/brain-campaign-support.ts";

type Mode = "analyze" | "shadow" | "backtest" | "scheduled" | "outcomes";

const MODES: readonly string[] = [
  "analyze",
  "shadow",
  "backtest",
  "scheduled",
  "outcomes",
];

function j(req: Request, body: unknown, status = 200) {
  const cors = buildCors(req, "x-service-secret");
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

/** Linha do painel: o porquê antes do quê. */
function presentDecision(d: BrainDecision, campaignName: string) {
  return {
    campaign_id: d.campaignId,
    campaign_name: campaignName,
    saude_dados: healthLabel(d.health.data.level),
    saude_meta: healthLabel(d.health.meta.level),
    saude_comercial: healthLabel(d.health.commercial.level),
    conversas: d.measured.conversations,
    leads_identificados: d.measured.leadsTrusted,
    cadastros: d.measured.registrationsTrusted,
    clientes_aprovados: d.measured.approvedTrusted,
    amostra: sampleQualityLabel(d.sample.quality),
    confianca: confidenceLabel(d.confidence),
    atribuicao: d.support.support,
    atribuicao_descricao: supportLabel(d.support.support),
    atribuicao_motivo: d.support.reason,
    decisao: d.action,
    motivo: d.reason,
    orcamento_atual_cents: d.currentBudgetCents,
    orcamento_proposto_cents: d.proposedBudgetCents,
    degrau_pct: d.stepPct,
    bloqueios: d.blockers.map((b) => `${b.code}: ${b.message}`),
    proxima_avaliacao: d.nextEvaluation,
    execucao_automatica: d.canExecute ? "liberada" : "desligada",
    runway_dias: d.measured.runwayDays,
    snapshot_version: d.snapshotVersion,
  };
}

Deno.serve(async (req) => {
  const cors = buildCors(req, "x-service-secret");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const body = await req.json().catch(() => ({}));
    let consultantId = typeof body?.consultant_id === "string"
      ? body.consultant_id
      : "";
    const mode = (MODES.includes(String(body?.mode))
      ? String(body.mode)
      : "analyze") as Mode;
    // Lote e desfechos varrem todos os consultores: é trabalho de cron, não de
    // tela. Um consultor logado só alcança as próprias campanhas.
    const isBatchMode = mode === "scheduled" || mode === "outcomes";
    const serviceRole = isServiceRoleAuth(req);

    if (serviceRole) {
      if (!consultantId && !isBatchMode) {
        return j(req, { error: "consultant_id obrigatório" }, 400);
      }
    } else {
      if (isBatchMode) {
        return j(req, { error: "modo restrito ao agendador" }, 403);
      }
      const auth = await authConsultant(req);
      if (!auth) return j(req, { error: "Unauthorized" }, 401);
      consultantId = auth.id;
    }

    const admin = adminClient();
    const windowDays = Math.max(1, Math.min(30, Number(body?.window_days) || 2));
    const campaignIds = Array.isArray(body?.campaign_ids)
      ? body.campaign_ids.map(String)
      : undefined;

    // ──────────────────── LOTE AGENDADO (cron) ────────────────────
    // Roda sem painel aberto. Mede, decide e registra. Nenhuma chamada à Meta:
    // este caminho não importa cliente Graph nenhum.
    if (mode === "scheduled") {
      const started = Date.now();
      const result = await runScheduledShadow(admin, {
        windowDays,
        consultantIds: consultantId ? [consultantId] : undefined,
      });
      console.log(
        `[brain-shadow] scheduled ${result.correlationId} consultores=${result.consultantsProcessed} campanhas=${result.campaignsEvaluated} persistidas=${result.decisionsPersisted} duplicadas=${result.duplicatesSkipped} holds=${result.holds} caixa=${result.inboxCreated} falhas=${result.failures} historico_ausente=${result.storageMissing} ms=${Date.now() - started}`,
      );
      return j(req, { ok: true, mode, ...result });
    }

    // ─────────────────── DESFECHOS 24h / 72h / 7d ───────────────────
    if (mode === "outcomes") {
      const started = Date.now();
      const result = await runOutcomeEvaluation(admin, {
        limit: Number(body?.limit) || undefined,
        consultantId: consultantId || undefined,
      });
      console.log(
        `[brain-shadow] outcomes ${result.correlationId} candidatas=${result.candidates} avaliadas=${result.evaluated} gravadas=${result.recorded} puladas=${result.skipped} falhas=${result.failures} historico_ausente=${result.storageMissing} ms=${Date.now() - started}`,
      );
      return j(req, { ok: true, mode, ...result });
    }

    // ───────────────────────── BACKTEST ─────────────────────────
    // Reprocessa a mesma medição com o relógio deslocado para trás. Nenhuma
    // escrita: nem decisão registrada, nem campanha tocada.
    if (mode === "backtest") {
      const points = Math.max(1, Math.min(30, Number(body?.backtest_points) || 7));
      const stepHours = Math.max(
        1,
        Math.min(168, Number(body?.backtest_step_hours) || 24),
      );
      const nowMs = Date.now();

      const runs: unknown[] = [];
      const tally = {
        total: 0,
        hold: 0,
        increase_budget: 0,
        reduce_budget: 0,
        pause_waste: 0,
        recommend_creative_review: 0,
        bloqueadas: 0,
        por_dados_ruins: 0,
        por_amostra_insuficiente: 0,
        por_carteira: 0,
        executaveis: 0,
      };

      for (let i = points; i >= 1; i--) {
        const asOfMs = nowMs - i * stepHours * 3_600_000;
        const measured = await measureConsultantCampaigns(admin, {
          consultantId,
          nowMs: asOfMs,
          windowDays,
          campaignIds,
          includeInactive: true,
        });
        const decisions = measured.snapshots.map((snapshot) =>
          decideCampaign({
            snapshot,
            policy: measured.policy,
            brainConfig: measured.brainConfig,
            nowMs: asOfMs,
            secondWindow: measured.secondWindowByCampaign.get(
              snapshot.campaign.id,
            ),
            // Sem histórico gravado no passado; a trava de reuso de snapshot é
            // avaliada no modo shadow, onde há registro real.
            usedSnapshotVersions: [],
          })
        );
        for (const d of decisions) {
          tally.total++;
          tally[d.action]++;
          if (d.blockers.length > 0) tally.bloqueadas++;
          if (d.blockers.some((b) => b.code.startsWith("dados_"))) {
            tally.por_dados_ruins++;
          }
          if (d.blockers.some((b) => b.code === "amostra_insuficiente")) {
            tally.por_amostra_insuficiente++;
          }
          if (d.blockers.some((b) => b.code === "carteira_insuficiente")) {
            tally.por_carteira++;
          }
          if (d.canExecute) tally.executaveis++;
        }
        runs.push({
          as_of: new Date(asOfMs).toISOString(),
          qualidade_dados: describeDataQuality(measured.dataQuality),
          decisoes: decisions.map((d) =>
            presentDecision(
              d,
              measured.snapshots.find((s) => s.campaign.id === d.campaignId)
                ?.campaign.name ?? "",
            )
          ),
        });
      }

      // O que o motor ATUAL fez no mesmo período, para comparação.
      const sinceIso = new Date(nowMs - points * stepHours * 3_600_000)
        .toISOString();
      const [{ data: recsAtuais }, { data: escalasAtuais }] = await Promise.all([
        admin.from("ad_recommendations")
          .select("id, type, title, created_at")
          .eq("consultant_id", consultantId)
          .gte("created_at", sinceIso),
        admin.from("facebook_campaigns")
          .select("id, name, brain_scale_last_at")
          .eq("consultant_id", consultantId)
          .gte("brain_scale_last_at", sinceIso),
      ]);

      return j(req, {
        ok: true,
        mode,
        escreveu_no_banco: false,
        chamou_meta: false,
        janela_dias: windowDays,
        pontos: points,
        resumo: tally,
        cerebro_atual: {
          recomendacoes: recsAtuais ?? [],
          escalas_executadas: escalasAtuais ?? [],
        },
        execucoes: runs,
      });
    }

    // ───────────────────── ANALYZE / SHADOW ─────────────────────
    const nowMs = Date.now();
    const measured = await measureConsultantCampaigns(admin, {
      consultantId,
      nowMs,
      windowDays,
      campaignIds,
    });

    const decisions: BrainDecision[] = [];
    for (const snapshot of measured.snapshots) {
      const used = await loadUsedSnapshotVersions(admin, snapshot.campaign.id);
      decisions.push(
        decideCampaign({
          snapshot,
          policy: measured.policy,
          brainConfig: measured.brainConfig,
          nowMs,
          secondWindow: measured.secondWindowByCampaign.get(snapshot.campaign.id),
          usedSnapshotVersions: used,
        }),
      );
    }

    const atividade = await loadBrainActivity(admin, consultantId, nowMs);

    let registradas = 0;
    const falhasRegistro: string[] = [];
    if (mode === "shadow") {
      for (const d of decisions) {
        // Só o que virou recomendação de verdade entra no histórico; `hold`
        // repetido a cada tick só encheria a tabela.
        if (d.action === "hold" || !d.canRecommend) continue;
        const r = await recordRecommendation(admin, d);
        if (r.ok) registradas++;
        else if (r.error) falhasRegistro.push(`${d.campaignId}: ${r.error}`);
      }
    }

    return j(req, {
      ok: true,
      mode,
      chamou_meta: false,
      escreveu_no_banco: mode === "shadow",
      alterou_campanha: false,
      janela: {
        inicio: measured.windowStart,
        fim: measured.windowEnd,
        dias: windowDays,
      },
      qualidade_dados: {
        estado: measured.dataQuality.state,
        descricao: describeDataQuality(measured.dataQuality),
        ultima_sincronizacao: measured.dataQuality.lastMetaSyncAtIso,
        completude_pct: measured.dataQuality.completenessPct,
        campanhas: measured.dataQuality.campaignsFound,
        duplicatas_ignoradas: measured.dataQuality.duplicatesIgnored,
        lacunas: measured.dataQuality.gapsDetected,
        libera_acao_financeira: measured.dataQuality.allowsFinancialAction,
        // Contadores crus: a completude ignora dia sem entrega, então estes
        // são a única forma de investigar perda real de linhas.
        houve_entrega: measured.dataQuality.hasDelivery,
        linhas_metrica: measured.dataQuality.metricRowsFound,
        linhas_esperadas: measured.dataQuality.expectedMetricRows,
      },
      politica: measured.policy,
      atividade: {
        ultima_decisao: atividade.lastDecisionAtIso,
        ultimo_lote_automatico: atividade.lastBatchAtIso,
        ultimo_lote_correlation_id: atividade.lastBatchCorrelationId,
        decisoes_7d: atividade.decisionsLast7d,
        desfecho_24h: atividade.lastOutcomeByWindow["24h"],
        desfecho_72h: atividade.lastOutcomeByWindow["72h"],
        desfecho_7d: atividade.lastOutcomeByWindow["7d"],
        desfechos_pendentes: atividade.pendingOutcomes,
        historico_indisponivel: atividade.storageMissing,
      },
      recomendacoes_registradas: registradas,
      falhas_registro: falhasRegistro,
      decisoes: decisions.map((d) =>
        presentDecision(
          d,
          measured.snapshots.find((s) => s.campaign.id === d.campaignId)
            ?.campaign.name ?? "",
        )
      ),
    });
  } catch (e) {
    return j(req, { error: (e as Error).message }, 500);
  }
});
