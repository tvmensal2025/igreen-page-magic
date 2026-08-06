/**
 * Lote automático do Cérebro: medir → decidir → registrar, sem painel aberto.
 *
 * Só orquestra o que já existe (`brain-measure` → `brain-decide` →
 * `brain-decision-store`). Não importa nenhum cliente da Meta, e é por isso que
 * o teste consegue provar que rodar o lote não escreve em campanha nenhuma:
 * não existe caminho daqui até a Graph API.
 *
 * Isolamento é requisito, não detalhe: uma campanha que estoura exceção não
 * pode derrubar as outras do consultor, e um consultor com configuração
 * quebrada não pode parar o lote inteiro.
 */
import { measureConsultantCampaigns } from "./brain-measure.ts";
import { type BrainDecision, decideCampaign } from "./brain-decide.ts";
import {
  type DecisionForOutcome,
  loadDecisionsNeedingOutcome,
  loadUsedSnapshotVersions,
  recordInboxRecommendation,
  recordOutcomeForWindow,
  recordRecommendation,
} from "./brain-decision-store.ts";
import {
  evaluateOutcome,
  outcomeLabel,
  type OutcomeWindow,
  pendingOutcomeWindow,
  sampleFromMeasured,
  sampleFromSnapshot,
  WINDOW_HOURS,
} from "./brain-outcome.ts";
import { supportLabel } from "./brain-campaign-support.ts";

type MinimalClient = { from: (table: string) => any };

const ACTIVE_STATUSES = ["active", "pending_review"];

export type BatchCampaignResult = {
  campaignId: string;
  campaignName: string;
  action: string;
  support: string;
  reason: string;
  persisted: boolean;
  duplicate: boolean;
  inboxCreated: boolean;
  error: string | null;
};

export type BatchConsultantResult = {
  consultantId: string;
  campaignsEvaluated: number;
  decisionsPersisted: number;
  duplicatesSkipped: number;
  holds: number;
  inboxCreated: number;
  failures: number;
  dataQualityState: string;
  error: string | null;
  campaigns: BatchCampaignResult[];
};

export type ScheduledShadowResult = {
  correlationId: string;
  startedAtIso: string;
  finishedAtIso: string;
  consultantsProcessed: number;
  campaignsEvaluated: number;
  decisionsPersisted: number;
  duplicatesSkipped: number;
  holds: number;
  inboxCreated: number;
  failures: number;
  /** `true` quando a migration do histórico ainda não foi aplicada. */
  storageMissing: boolean;
  calledMeta: false;
  changedCampaign: false;
  consultants: BatchConsultantResult[];
};

export function newCorrelationId(nowMs: number): string {
  const stamp = new Date(nowMs).toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `shadow-${stamp}-${crypto.randomUUID().slice(0, 8)}`;
}

/** Consultores com campanha viva — quem não tem campanha não gera trabalho. */
export async function listEligibleConsultants(
  admin: MinimalClient,
): Promise<string[]> {
  const { data } = await admin
    .from("facebook_campaigns")
    .select("consultant_id")
    .in("status", ACTIVE_STATUSES);
  const ids = new Set<string>();
  for (const row of (data ?? []) as Array<{ consultant_id?: string | null }>) {
    if (row?.consultant_id) ids.add(String(row.consultant_id));
  }
  return [...ids];
}

function severityForAction(
  action: string,
): "info" | "success" | "warning" | "critical" {
  if (action === "pause_waste") return "critical";
  if (action === "reduce_budget") return "warning";
  if (action === "increase_budget") return "success";
  return "info";
}

function inboxTypeForAction(action: string): string {
  return `brain_${action}`;
}

/**
 * Persiste uma decisão.
 *
 * `ads_brain_decisions` recebe TODAS as decisões, inclusive `hold`: a chave de
 * idempotência embute a versão do snapshot, então um `hold` repetido com os
 * mesmos números não cria linha nova — a tabela só cresce quando a realidade
 * muda. Já a caixa de entrada do consultor recebe apenas o que pede ação.
 */
async function persistDecision(
  admin: MinimalClient,
  decision: BrainDecision,
  campaignName: string,
  correlationId: string,
): Promise<BatchCampaignResult> {
  const base: BatchCampaignResult = {
    campaignId: decision.campaignId,
    campaignName,
    action: decision.action,
    support: decision.support.support,
    reason: decision.reason,
    persisted: false,
    duplicate: false,
    inboxCreated: false,
    error: null,
  };

  const stored = await recordRecommendation(admin, decision, correlationId);
  if (!stored.ok) {
    return { ...base, error: stored.error ?? "falha_ao_registrar" };
  }
  base.persisted = !stored.data?.duplicate;
  base.duplicate = Boolean(stored.data?.duplicate);

  // Caixa de entrada só para o que pede ação humana, e só uma vez por amostra.
  if (decision.action !== "hold" && decision.canRecommend && !base.duplicate) {
    const inbox = await recordInboxRecommendation(admin, {
      consultantId: decision.consultantId,
      type: inboxTypeForAction(decision.action),
      title: `${campaignName || "Campanha"}: ${decision.reason}`.slice(0, 120),
      message: [
        decision.reason,
        `Capacidade de atribuição: ${supportLabel(decision.support.support)}.`,
        decision.blockers.length
          ? `Bloqueios: ${decision.blockers.map((b) => b.message).join("; ")}.`
          : "Sem bloqueios.",
        "O Cérebro não executou nada: esta é uma recomendação para revisão humana.",
      ].join(" "),
      severity: severityForAction(decision.action),
      actionLabel: "Revisar campanha",
      actionPayload: {
        kind: "review_campaign",
        campaign_id: decision.campaignId,
        brain_action: decision.action,
        snapshot_version: decision.snapshotVersion,
        correlation_id: correlationId,
      },
      dedupKey: `brain:${decision.campaignId}:${decision.action}:${decision.snapshotVersion}`,
    });
    if (inbox.ok) base.inboxCreated = Boolean(inbox.data?.inserted);
    else base.error = inbox.error ?? null;
  }

  return base;
}

async function runForConsultant(
  admin: MinimalClient,
  consultantId: string,
  input: { nowMs: number; windowDays: number; correlationId: string },
): Promise<BatchConsultantResult> {
  const result: BatchConsultantResult = {
    consultantId,
    campaignsEvaluated: 0,
    decisionsPersisted: 0,
    duplicatesSkipped: 0,
    holds: 0,
    inboxCreated: 0,
    failures: 0,
    dataQualityState: "unknown",
    error: null,
    campaigns: [],
  };

  let measured;
  try {
    measured = await measureConsultantCampaigns(admin, {
      consultantId,
      nowMs: input.nowMs,
      windowDays: input.windowDays,
    });
  } catch (e) {
    result.error = (e as Error).message;
    result.failures++;
    return result;
  }
  result.dataQualityState = measured.dataQuality.state;

  for (const snapshot of measured.snapshots) {
    try {
      const used = await loadUsedSnapshotVersions(admin, snapshot.campaign.id);
      const decision = decideCampaign({
        snapshot,
        policy: measured.policy,
        brainConfig: measured.brainConfig,
        nowMs: input.nowMs,
        secondWindow: measured.secondWindowByCampaign.get(snapshot.campaign.id),
        usedSnapshotVersions: used,
      });
      const persisted = await persistDecision(
        admin,
        decision,
        snapshot.campaign.name,
        input.correlationId,
      );
      result.campaigns.push(persisted);
      result.campaignsEvaluated++;
      if (decision.action === "hold") result.holds++;
      if (persisted.persisted) result.decisionsPersisted++;
      if (persisted.duplicate) result.duplicatesSkipped++;
      if (persisted.inboxCreated) result.inboxCreated++;
      if (persisted.error) result.failures++;
    } catch (e) {
      // Campanha isolada: o lote continua.
      result.failures++;
      result.campaigns.push({
        campaignId: snapshot.campaign.id,
        campaignName: snapshot.campaign.name,
        action: "erro",
        support: "desconhecido",
        reason: "falha ao decidir esta campanha",
        persisted: false,
        duplicate: false,
        inboxCreated: false,
        error: (e as Error).message,
      });
    }
  }

  return result;
}

export async function runScheduledShadow(
  admin: MinimalClient,
  input: {
    nowMs?: number;
    windowDays?: number;
    consultantIds?: readonly string[];
    correlationId?: string;
  } = {},
): Promise<ScheduledShadowResult> {
  const nowMs = input.nowMs ?? Date.now();
  const windowDays = Math.max(1, Math.min(30, input.windowDays ?? 2));
  const correlationId = input.correlationId ?? newCorrelationId(nowMs);
  const startedAtIso = new Date(nowMs).toISOString();

  const consultants = input.consultantIds?.length
    ? [...input.consultantIds]
    : await listEligibleConsultants(admin);

  const out: ScheduledShadowResult = {
    correlationId,
    startedAtIso,
    finishedAtIso: startedAtIso,
    consultantsProcessed: 0,
    campaignsEvaluated: 0,
    decisionsPersisted: 0,
    duplicatesSkipped: 0,
    holds: 0,
    inboxCreated: 0,
    failures: 0,
    storageMissing: false,
    calledMeta: false,
    changedCampaign: false,
    consultants: [],
  };

  for (const consultantId of consultants) {
    const r = await runForConsultant(admin, consultantId, {
      nowMs,
      windowDays,
      correlationId,
    });
    out.consultants.push(r);
    out.consultantsProcessed++;
    out.campaignsEvaluated += r.campaignsEvaluated;
    out.decisionsPersisted += r.decisionsPersisted;
    out.duplicatesSkipped += r.duplicatesSkipped;
    out.holds += r.holds;
    out.inboxCreated += r.inboxCreated;
    out.failures += r.failures;
    if (r.campaigns.some((c) => c.error === "tabela_ausente")) {
      // Sem a migration o Cérebro continua decidindo, mas o histórico se perde.
      // Fica visível em vez de falhar em silêncio.
      out.storageMissing = true;
    }
  }

  out.finishedAtIso = new Date(Date.now()).toISOString();
  return out;
}

// ───────────────────────── Desfechos 24h / 72h / 7d ─────────────────────────

export type OutcomeRunItem = {
  decisionId: string;
  campaignId: string;
  window: OutcomeWindow;
  state: string;
  reason: string;
  recorded: boolean;
  error: string | null;
};

export type OutcomeRunResult = {
  correlationId: string;
  candidates: number;
  evaluated: number;
  recorded: number;
  skipped: number;
  failures: number;
  storageMissing: boolean;
  calledMeta: false;
  changedCampaign: false;
  items: OutcomeRunItem[];
};

/**
 * Avalia desfechos vencidos.
 *
 * A janela "depois" é medida com o relógio parado no fim dela
 * (`decidedAt + 24h`, por exemplo), e não com o relógio de agora: o que
 * interessa é o que aconteceu naquele intervalo, não o acumulado até hoje.
 */
export async function runOutcomeEvaluation(
  admin: MinimalClient,
  input: {
    nowMs?: number;
    limit?: number;
    consultantId?: string;
    correlationId?: string;
  } = {},
): Promise<OutcomeRunResult> {
  const nowMs = input.nowMs ?? Date.now();
  const correlationId = input.correlationId ?? `outcome-${crypto.randomUUID().slice(0, 8)}`;

  const out: OutcomeRunResult = {
    correlationId,
    candidates: 0,
    evaluated: 0,
    recorded: 0,
    skipped: 0,
    failures: 0,
    storageMissing: false,
    calledMeta: false,
    changedCampaign: false,
    items: [],
  };

  const pending = await loadDecisionsNeedingOutcome(admin, {
    nowMs,
    limit: input.limit,
    consultantId: input.consultantId,
  });
  if (!pending.ok) {
    out.storageMissing = pending.error === "tabela_ausente";
    out.failures++;
    return out;
  }

  const rows = pending.data ?? [];
  out.candidates = rows.length;

  for (const row of rows) {
    const window = pendingOutcomeWindow({
      decidedAtIso: row.decided_at,
      nowMs,
      existing: row.outcome_metrics,
    });
    if (!window) {
      out.skipped++;
      continue;
    }
    try {
      const item = await evaluateOne(admin, row, window, nowMs);
      out.items.push(item);
      out.evaluated++;
      if (item.recorded) out.recorded++;
      else if (item.error) out.failures++;
      else out.skipped++;
    } catch (e) {
      out.failures++;
      out.items.push({
        decisionId: row.id,
        campaignId: row.campaign_id,
        window,
        state: "erro",
        reason: "falha ao avaliar desfecho",
        recorded: false,
        error: (e as Error).message,
      });
    }
  }

  return out;
}

async function evaluateOne(
  admin: MinimalClient,
  row: DecisionForOutcome,
  window: OutcomeWindow,
  nowMs: number,
): Promise<OutcomeRunItem> {
  const decidedMs = Date.parse(row.decided_at);
  const windowEndMs = decidedMs + WINDOW_HOURS[window] * 3_600_000;
  const windowDays = Math.max(1, Math.round(WINDOW_HOURS[window] / 24));

  const after = await measureConsultantCampaigns(admin, {
    consultantId: row.consultant_id,
    nowMs: windowEndMs,
    windowDays,
    campaignIds: [row.campaign_id],
    includeInactive: true,
  });

  const snapshot = after.snapshots.find((s) => s.campaign.id === row.campaign_id);
  const evaluation = evaluateOutcome({
    window,
    before: sampleFromMeasured(row.measured),
    after: snapshot
      ? sampleFromSnapshot(snapshot)
      : { spendCents: 0, conversations: 0, cplCents: null, leadsTrusted: 0, approvedTrusted: 0 },
    nowMs,
  });

  const saved = await recordOutcomeForWindow(admin, row, evaluation);
  return {
    decisionId: row.id,
    campaignId: row.campaign_id,
    window,
    state: `${evaluation.state} (${outcomeLabel(evaluation.state)})`,
    reason: evaluation.reason,
    recorded: Boolean(saved.data?.recorded),
    error: saved.ok ? null : saved.error ?? "falha_ao_gravar_desfecho",
  };
}
