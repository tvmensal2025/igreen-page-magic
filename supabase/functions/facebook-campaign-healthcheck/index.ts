// Health-check de campanhas: tenta reativar campanhas em pending_review há mais
// de 30 min OU pausadas com motivo RECUPERÁVEL (rate limit / transient).
//
// NUNCA reativa pausa MANUAL do consultor (MANUAL_PAUSE:…). Isso era o bug:
// o cron varria status=paused e despausava sozinho.
//
// Pode ser invocado:
//   - via cron horário (sem body) → varre pending_review + recoverable
//   - via cliente com { campaign_id } → tenta UMA específica (botão "tentar reativar")
import { adminClient, authConsultant, corsHeaders, fbFetch, loadCampaignConnection } from "../_shared/fb-graph.ts";
import { isManualPause, isManualStop, isConsultantLocked, isRecoverableAutoPause } from "../_shared/campaign-pause.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const targetCampaignId = body?.campaign_id as string | undefined;
    const admin = adminClient();

    // Cliente -> precisa estar autenticado (clique explícito "Tentar reativar")
    if (targetCampaignId) {
      const auth = await authConsultant(req);
      if (!auth) return j({ error: "Unauthorized" }, 401);
      const result = await reactivateOne(admin, targetCampaignId, auth.id, { allowManual: true });
      return j(result);
    }

    // Cron mode -> NÃO inclui paused genérico. Só pending_review + paused com
    // motivo recuperável (nunca MANUAL_PAUSE).
    const cutoff = new Date(Date.now() - 30 * 60_000).toISOString();
    const { data: stuck } = await admin
      .from("facebook_campaigns")
      .select("id, consultant_id, fb_campaign_id, fb_adset_ids, fb_ad_ids, status, created_at, rejection_reason")
      .in("status", ["pending_review", "paused"])
      .lte("created_at", cutoff)
      .limit(50);

    const results: any[] = [];
    for (const c of stuck || []) {
      // Pausa/stop manual do consultor: cron NUNCA mexe.
      if (c.status === "paused" && isConsultantLocked(c.rejection_reason)) {
        results.push({ id: c.id, activated: false, reason: "skipped_manual_pause" });
        continue;
      }
      // Paused sem motivo recuperável (ex.: saldo, teto, ou pause limpa): não reativa.
      if (c.status === "paused" && !isRecoverableAutoPause(c.rejection_reason)) {
        results.push({ id: c.id, activated: false, reason: "skipped_non_recoverable_pause" });
        continue;
      }
      const r = await reactivateOne(admin, c.id, c.consultant_id, { allowManual: false });
      results.push({ id: c.id, ...r });
    }
    return j({ scanned: results.length, results });
  } catch (e) {
    console.error("[healthcheck]", e);
    return j({ error: (e as Error).message }, 500);
  }
});

async function reactivateOne(
  admin: any,
  campaignDbId: string,
  consultantId: string,
  opts: { allowManual: boolean },
): Promise<{ activated: boolean; reason?: string }> {
  const { data: c } = await admin
    .from("facebook_campaigns")
    .select("fb_campaign_id, fb_adset_ids, fb_ad_ids, status, rejection_reason")
    .eq("id", campaignDbId)
    .maybeSingle();
  if (!c?.fb_campaign_id) return { activated: false, reason: "Campanha sem ID Meta" };
  if (c.status === "active") return { activated: true };
  // Stop (completed): nunca reativa via healthcheck — só via Estender.
  if (c.status === "completed" || isManualStop(c.rejection_reason)) {
    return { activated: false, reason: "skipped_manual_stop" };
  }

  // Mesmo no clique manual, se for MANUAL_PAUSE e allowManual=true, o consultor
  // pediu reativar — ok. No cron, allowManual=false e já filtramos acima.
  if (!opts.allowManual && isManualPause(c.rejection_reason)) {
    return { activated: false, reason: "skipped_manual_pause" };
  }

  // Campanhas usam SEMPRE o token da plataforma (conta-mãe), não o token pessoal do consultor.
  const conn = await loadCampaignConnection(consultantId);
  if (!conn?.token) return { activated: false, reason: "Sem token Meta (plataforma desconectada)" };
  const token = conn.token;

  try {
    for (const adsetId of (c.fb_adset_ids || []) as string[]) {
      await fbFetch(`/${adsetId}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ status: "ACTIVE", access_token: token }),
      });
    }
    for (const adId of (c.fb_ad_ids || []) as string[]) {
      await fbFetch(`/${adId}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ status: "ACTIVE", access_token: token }),
      });
    }
    await fbFetch(`/${c.fb_campaign_id}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ status: "ACTIVE", access_token: token }),
    });
    await admin.from("facebook_campaigns").update({ status: "active", rejection_reason: null }).eq("id", campaignDbId);
    return { activated: true };
  } catch (e) {
    const raw = (e as Error).message || "";
    const lower = raw.toLowerCase();
    let reason = raw;
    if (
      lower.includes("session has been invalidated") ||
      lower.includes("session for security reasons") ||
      lower.includes("subcode\":460") ||
      lower.includes("error_subcode=460") ||
      lower.includes("code\":190") ||
      (lower.includes("oauth") && lower.includes("token"))
    ) {
      reason = "SESSION_INVALIDATED: O token do Facebook foi invalidado (senha alterada ou sessão encerrada por segurança). Reconecte a conta Facebook no painel. | " + raw;
    }
    // Não sobrescreve MANUAL_PAUSE/STOP com erro de token — preserva a intenção do consultor.
    if (!isConsultantLocked(c.rejection_reason)) {
      await admin.from("facebook_campaigns").update({ rejection_reason: reason }).eq("id", campaignDbId);
    }
    return { activated: false, reason };
  }
}

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
