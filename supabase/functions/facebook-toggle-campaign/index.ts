// Pausa, encerra (stop) ou reativa uma campanha no Meta (campanha + adsets + ads)
// e atualiza o DB.
// Body: { campaign_id: uuid, action: "pause" | "activate" | "stop" }
//
// Regra de ouro: NÃO atualiza status local se a Meta falhar — evita UI "pausada"
// com anúncio ainda ACTIVE gastando.
//
// Pausa MANUAL marca rejection_reason=MANUAL_PAUSE para que cron/healthcheck/
// recarga de carteira NUNCA despausem sozinhos.
// Stop marca status=completed + MANUAL_STOP e avisa o rodízio com "ended".
// Activate em completed é bloqueado — reativar só via facebook-extend-campaign.
import { adminClient, authConsultant, corsHeaders, FB_GRAPH, loadCampaignConnection } from "../_shared/fb-graph.ts";
import { resolveCampaignEffectiveStatus, type MetaObjectState } from "../_shared/campaign-effective-status.ts";
import { notifyRodizioOnCampaignPaused } from "../_shared/rodizio-pause-notify.ts";
import { MANUAL_PAUSE_REASON, MANUAL_STOP_REASON } from "../_shared/campaign-pause.ts";
import { validateCampaignActivationBudget } from "../_shared/validate-campaign-activation.ts";


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = await authConsultant(req);
    if (!auth) return j({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const campaignId = String(body?.campaign_id || "");
    const action = String(body?.action || "");
    if (!campaignId) return j({ error: "campaign_id obrigatório" }, 400);
    if (action !== "pause" && action !== "activate" && action !== "stop") {
      return j({ error: "action deve ser pause|activate|stop" }, 400);
    }

    const admin = adminClient();
    const { data: c, error: rowErr } = await admin
      .from("facebook_campaigns")
      .select("id, consultant_id, fb_campaign_id, fb_adset_ids, fb_ad_ids, status, ended_at, end_time_utc, daily_budget_cents, duration_days")
      .eq("id", campaignId)
      .maybeSingle();
    if (rowErr) return j({ error: rowErr.message }, 500);
    if (!c) return j({ error: "campanha não encontrada" }, 404);

    const { data: isSuper } = await admin.rpc("is_super_admin", { _user_id: auth.id });
    if (c.consultant_id !== auth.id && !isSuper) return j({ error: "forbidden" }, 403);

    if (action === "activate" && c.status === "completed") {
      return j({
        error: "Campanha encerrada (Stop). Use Estender para voltar a rodar — Play não reativa.",
        status: c.status,
      }, 400);
    }

    // Se existe rodízio configurado, só permite chamar a Meta quando a pool
    // pertence ao mesmo consultor e tem ao menos um participante ativo válido.
    if (action === "activate") {
      const remainingDays = c.end_time_utc
        ? Math.max(1, Math.ceil((new Date(c.end_time_utc).getTime() - Date.now()) / 86400_000))
        : null;
      const activationBudget = await validateCampaignActivationBudget(admin, {
        consultantId: c.consultant_id,
        dailyBudgetCents: Number(c.daily_budget_cents),
        durationDays: remainingDays,
      });
      if (!activationBudget.ok) return j({ error: activationBudget.error, status: c.status }, 402);

      const { data: pool, error: poolError } = await admin
        .from("rodizio_pools")
        .select("id, consultant_id, is_enabled")
        .eq("campaign_id", c.id)
        .maybeSingle();
      if (poolError) return j({ error: "Não foi possível validar o rodízio antes da ativação." }, 500);
      if ((pool as any)?.is_enabled === true) {
        if ((pool as any).consultant_id !== c.consultant_id) {
          return j({ error: "Rodízio pertence a outro consultor. Ativação bloqueada." }, 409);
        }
        const { data: members, error: memberError } = await admin
          .from("rodizio_pool_members")
          .select("partner_id, referral_partners!inner(consultant_id, is_active)")
          .eq("pool_id", (pool as any).id);
        if (memberError) return j({ error: "Não foi possível validar os participantes do rodízio." }, 500);
        const eligible = ((members as any[]) || []).filter((member) =>
          member.referral_partners?.consultant_id === c.consultant_id &&
          member.referral_partners?.is_active === true
        );
        if (eligible.length < 1 || eligible.length !== ((members as any[]) || []).length) {
          return j({
            error: "O rodízio está vazio ou possui participante inválido/inativo. Corrija antes de ativar.",
            status: c.status,
          }, 409);
        }
      }
    }
    if (action === "stop" && c.status === "completed") {
      return j({ ok: true, status: "completed", meta_error: null, already: true });
    }

    const target = action === "activate" ? "ACTIVE" : "PAUSED";
    const dbStatus = action === "pause" ? "paused" : action === "stop" ? "completed" : "active";

    const buildUpdatePayload = (
      resolvedStatus = dbStatus,
      resolvedIssues: string[] = [],
    ): Record<string, unknown> => {
      const updatePayload: Record<string, unknown> = { status: resolvedStatus };
      if (action === "pause") updatePayload.rejection_reason = MANUAL_PAUSE_REASON;
      if (action === "stop") {
        updatePayload.rejection_reason = MANUAL_STOP_REASON;
        const endedMs = c.ended_at ? new Date(c.ended_at).getTime() : NaN;
        if (!Number.isFinite(endedMs) || endedMs > Date.now()) {
          updatePayload.ended_at = new Date().toISOString();
        }
      }
      if (action === "activate" && (resolvedStatus === "active" || resolvedStatus === "pending_review")) {
        updatePayload.rejection_reason = null;
      } else if (action === "activate" && resolvedStatus === "rejected") {
        updatePayload.rejection_reason = resolvedIssues.join(" • ") || "A Meta sinalizou problema ao reativar a campanha.";
      }
      return updatePayload;
    };

    // Sem fb_campaign_id não existe campanha externa para confirmar. Nunca
    // marca como ativa apenas no banco.
    if (!c.fb_campaign_id) {
      if (action === "activate") {
        return j({
          error: "Campanha sem ID da Meta. Ativação local bloqueada para evitar status falso.",
          status: c.status,
        }, 409);
      }
      const { error: updErr } = await admin.from("facebook_campaigns").update(buildUpdatePayload()).eq("id", c.id);
      if (updErr) return j({ error: updErr.message }, 500);
      if (action === "stop") {
        try { await notifyRodizioOnCampaignPaused(admin, c.id, "ended"); } catch (e) {
          console.error("[fb-toggle] rodizio notify (stop local) falhou:", (e as Error).message);
        }
      }
      return j({ ok: true, status: dbStatus, meta_error: null });
    }

    const conn = await loadCampaignConnection(c.consultant_id);
    if (!conn?.token) {
      return j({
        error: "Sem token Meta válido — status local NÃO foi alterado. Reconecte a conta da plataforma.",
        status: c.status,
        meta_error: "missing_platform_token",
      }, 502);
    }

    const token = conn.token;
    const setStatus = async (id: string) => {
      const r = await fetch(`${FB_GRAPH}/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ status: target, access_token: token }),
      });
      if (!r.ok) {
        const t = await r.text();
        throw new Error(`Meta ${r.status}: ${t.slice(0, 300)}`);
      }
    };

    try {
      // Campanha primeiro (para a entrega parar mesmo se ad/adset falhar depois),
      // depois adsets e ads para manter o Ads Manager consistente.
      await setStatus(c.fb_campaign_id);
      for (const adsetId of (c.fb_adset_ids || []) as string[]) await setStatus(adsetId);
      for (const adId of (c.fb_ad_ids || []) as string[]) await setStatus(adId);
    } catch (e) {
      const metaError = (e as Error).message;
      console.error("[fb-toggle] Meta falhou — DB intacto:", metaError);
      const verb = action === "pause" ? "pausar" : action === "stop" ? "encerrar" : "ativar";
      return j({
        error: `Falha ao ${verb} na Meta. Status local NÃO foi alterado.`,
        status: c.status,
        meta_error: metaError,
      }, 502);
    }

    let resolvedStatus = dbStatus;
    let effectiveStatus = target;
    let resolvedIssues: string[] = [];
    if (action === "activate") {
      try {
        const [campaignState, ...children] = await Promise.all([
          fetch(`${FB_GRAPH}/${c.fb_campaign_id}?fields=effective_status,configured_status,issues_info&access_token=${encodeURIComponent(token)}`).then(async (r) => {
            if (!r.ok) throw new Error(`Meta ${r.status}: ${(await r.text()).slice(0, 300)}`);
            return r.json();
          }),
          ...((c.fb_adset_ids || []) as string[]).map((id) =>
            fetch(`${FB_GRAPH}/${id}?fields=effective_status,configured_status,issues_info&access_token=${encodeURIComponent(token)}`).then((r) => r.ok ? r.json() : null)
          ),
          ...((c.fb_ad_ids || []) as string[]).map((id) =>
            fetch(`${FB_GRAPH}/${id}?fields=effective_status,configured_status,issues_info&access_token=${encodeURIComponent(token)}`).then((r) => r.ok ? r.json() : null)
          ),
        ]) as Array<MetaObjectState | null>;
        const adsetCount = ((c.fb_adset_ids || []) as string[]).length;
        const resolved = resolveCampaignEffectiveStatus(
          campaignState,
          children.slice(0, adsetCount).map((item) => item || { effective_status: "UNKNOWN" }) as MetaObjectState[],
          children.slice(adsetCount).map((item) => item || { effective_status: "UNKNOWN" }) as MetaObjectState[],
        );
        resolvedIssues = resolved.issues;
        resolvedStatus = resolved.localStatus === "active" ? "active"
          : resolved.localStatus === "rejected" ? "rejected"
            : "pending_review";
        effectiveStatus = resolved.campaignEffectiveStatus;
      } catch (e) {
        console.warn("[fb-toggle] não confirmou effective_status:", (e as Error).message);
        resolvedStatus = "pending_review";
        effectiveStatus = "UNKNOWN";
      }
    }

    const { error: updErr } = await admin.from("facebook_campaigns").update(buildUpdatePayload(resolvedStatus, resolvedIssues)).eq("id", c.id);
    if (updErr) {
      // Compensação fail-closed: se a Meta foi ativada, mas o estado local não
      // pôde ser confirmado, pausa novamente campanha, conjuntos e anúncios.
      if (action === "activate") {
        const pauseIds = [
          ...((c.fb_ad_ids || []) as string[]),
          ...((c.fb_adset_ids || []) as string[]),
          c.fb_campaign_id,
        ].filter(Boolean);
        const compensationErrors: string[] = [];
        for (const id of pauseIds) {
          try {
            const response = await fetch(`${FB_GRAPH}/${id}`, {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({ status: "PAUSED", access_token: token }),
            });
            if (!response.ok) compensationErrors.push(`${id}:Meta ${response.status}`);
          } catch (e) {
            compensationErrors.push(`${id}:${(e as Error).message}`);
          }
        }
        console.error(
          "[fb-toggle] update local falhou; compensação PAUSED executada:",
          updErr.message,
          compensationErrors,
        );
        return j({
          error: compensationErrors.length
            ? "A Meta ativou, o banco falhou e a pausa compensatória ficou incompleta. Revisão manual urgente."
            : "A Meta ativou, mas o banco falhou. A campanha foi pausada novamente por segurança.",
          status: c.status,
          meta_error: updErr.message,
          compensated_to_paused: compensationErrors.length === 0,
          compensation_errors: compensationErrors,
        }, 500);
      }
      return j({ error: updErr.message }, 500);
    }

    // Rodízio: aviso 1× ao pausar/encerrar; reset dos flags ao reativar.
    if (action === "pause") {
      try {
        await notifyRodizioOnCampaignPaused(admin, c.id, "manual");
      } catch (e) {
        console.error("[fb-toggle] rodizio notify falhou:", (e as Error).message);
      }
    }
    if (action === "stop") {
      try {
        await notifyRodizioOnCampaignPaused(admin, c.id, "ended");
      } catch (e) {
        console.error("[fb-toggle] rodizio notify (stop) falhou:", (e as Error).message);
      }
    }
    // Só libera novamente os avisos do rodízio após ativação realmente confirmada.
    if (action === "activate" && resolvedStatus === "active") {
      try {
        await admin
          .from("rodizio_pools")
          .update({ paused_notified_at: null, last_pause_reason: null })
          .eq("campaign_id", c.id)
          .eq("is_enabled", true);
      } catch (e) {
        console.error("[fb-toggle] reset paused_notified_at falhou:", (e as Error).message);
      }
    }

    return j({
      ok: true,
      status: resolvedStatus,
      effective_status: effectiveStatus,
      activation_confirmed: action !== "activate" || resolvedStatus === "active",
      meta_error: null,
    });

  } catch (e) {
    console.error("[fb-toggle]", e);
    return j({ error: (e as Error).message }, 500);
  }
});

function j(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
