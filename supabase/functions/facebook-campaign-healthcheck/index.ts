// Health-check de campanhas: tenta reativar campanhas em pending_review há mais
// de 30 min OU pausadas com motivo RECUPERÁVEL (rate limit / transient).
//
// NUNCA reativa pausa MANUAL do consultor (MANUAL_PAUSE:…). Isso era o bug:
// o cron varria status=paused e despausava sozinho.
//
// Pode ser invocado:
//   - via cron horário (sem body) → varre pending_review + recoverable
//     Auth OBRIGATÓRIA (fail-closed): x-service-secret | x-internal-secret | Bearer service_role
//   - via cliente com { campaign_id } → tenta UMA específica (botão "tentar reativar")
//     Auth: JWT do consultor (authConsultant)
import { adminClient, authConsultant, corsHeaders, fbFetch, loadCampaignConnection } from "../_shared/fb-graph.ts";
import { resolveCampaignEffectiveStatus, type MetaObjectState } from "../_shared/campaign-effective-status.ts";
import { isManualPause, isManualStop, isConsultantLocked, isRecoverableAutoPause } from "../_shared/campaign-pause.ts";
import { validateCampaignActivationBudget } from "../_shared/validate-campaign-activation.ts";
import { validateRodizioActivation } from "../_shared/validate-rodizio-activation.ts";

const cronCorsHeaders = {
  ...corsHeaders,
  "Access-Control-Allow-Headers":
    `${corsHeaders["Access-Control-Allow-Headers"] || "authorization, x-client-info, apikey, content-type"}, x-service-secret, x-internal-secret`,
};

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Auth do modo cron/varredura (sem campaign_id). Fail-closed (AUD-004).
 * Aceita o mesmo trio dos outros crons: service secret, embed/internal, service_role.
 * Sem grace — varredura pública com verify_jwt=false não pode passar.
 */
async function isCronCaller(req: Request, admin: ReturnType<typeof adminClient>): Promise<boolean> {
  const serviceSecret = (Deno.env.get("SERVICE_SHARED_SECRET") ?? "").trim();
  const headerService = (req.headers.get("x-service-secret") ?? "").trim();
  if (serviceSecret && headerService && timingSafeEqual(headerService, serviceSecret)) {
    return true;
  }

  let expectedInternal = (Deno.env.get("EMBED_INTERNAL_SECRET") ?? "").trim();
  if (!expectedInternal) {
    try {
      const { data } = await admin
        .from("settings")
        .select("value")
        .eq("key", "embed_internal_token")
        .maybeSingle();
      expectedInternal = String((data as { value?: string } | null)?.value || "")
        .replace(/^"|"$/g, "")
        .trim();
    } catch (_) {
      /* ignore */
    }
  }
  const headerInternal = (req.headers.get("x-internal-secret") ?? "").trim();
  if (expectedInternal && headerInternal && timingSafeEqual(headerInternal, expectedInternal)) {
    return true;
  }

  const serviceRoleKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
  const authHeader = req.headers.get("authorization") ?? "";
  const bearer = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  if (serviceRoleKey && bearer && timingSafeEqual(bearer, serviceRoleKey)) {
    return true;
  }

  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cronCorsHeaders });
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

    // Cron mode -> exige secret/service_role/internal (AUD-004). Sem isso qualquer
    // caller público com verify_jwt=false poderia varrer e reativar campanhas.
    if (!(await isCronCaller(req, admin))) {
      return j({ error: "Unauthorized" }, 401);
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
    .select("fb_campaign_id, fb_adset_ids, fb_ad_ids, status, rejection_reason, consultant_id, daily_budget_cents, duration_days, end_time_utc")
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

  const remainingDays = c.end_time_utc
    ? Math.max(1, Math.ceil((new Date(c.end_time_utc).getTime() - Date.now()) / 86400_000))
    : null;
  const activationBudget = await validateCampaignActivationBudget(admin, {
    consultantId: c.consultant_id,
    dailyBudgetCents: Number(c.daily_budget_cents),
    durationDays: remainingDays,
  });
  if (!activationBudget.ok) {
    return { activated: false, reason: activationBudget.error || "insufficient_wallet" };
  }

  const rodizio = await validateRodizioActivation(admin, campaignDbId, c.consultant_id);
  if (!rodizio.ok) {
    return { activated: false, reason: rodizio.error || "invalid_rodizio" };
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

    const adsetIds = (c.fb_adset_ids || []) as string[];
    const adIds = (c.fb_ad_ids || []) as string[];
    const [campaignState, ...children] = await Promise.all([
      fbFetch(`/${c.fb_campaign_id}?fields=effective_status,configured_status,issues_info&access_token=${encodeURIComponent(token)}`),
      ...adsetIds.map((id) => fbFetch(`/${id}?fields=effective_status,configured_status,issues_info&access_token=${encodeURIComponent(token)}`)),
      ...adIds.map((id) => fbFetch(`/${id}?fields=effective_status,configured_status,issues_info&access_token=${encodeURIComponent(token)}`)),
    ]) as MetaObjectState[];
    const resolved = resolveCampaignEffectiveStatus(
      campaignState,
      children.slice(0, adsetIds.length),
      children.slice(adsetIds.length),
    );

    // IN_PROCESS / PENDING_REVIEW é normal após ativar — Meta ainda analisa o criativo.
    // Não tratar como erro: marca pending_review e deixa o cron/healthcheck promover a active.
    if (resolved.localStatus === "pending_review") {
      await admin.from("facebook_campaigns").update({
        status: "pending_review",
        rejection_reason: null,
        updated_at: new Date().toISOString(),
      }).eq("id", campaignDbId);
      return {
        activated: false,
        pending_review: true,
        effective_statuses: resolved.objectStatuses,
        reason: "Ativação enviada. A Meta ainda analisa os anúncios (IN_PROCESS) — isso é normal e costuma liberar em minutos.",
      };
    }

    if (resolved.localStatus === "rejected") {
      const reason = resolved.issues.length
        ? resolved.issues.join(" • ")
        : `Meta rejeitou: ${resolved.objectStatuses.join(", ")}`;
      await admin.from("facebook_campaigns").update({
        status: "rejected",
        rejection_reason: reason,
        updated_at: new Date().toISOString(),
      }).eq("id", campaignDbId);
      return { activated: false, reason };
    }

    if (resolved.localStatus !== "active") {
      await admin.from("facebook_campaigns").update({
        status: "pending_review",
        rejection_reason: null,
        updated_at: new Date().toISOString(),
      }).eq("id", campaignDbId);
      return {
        activated: false,
        pending_review: true,
        effective_statuses: resolved.objectStatuses,
        reason: `Ativação enviada. Status atual na Meta: ${resolved.objectStatuses.join(", ")}.`,
      };
    }

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
  return new Response(JSON.stringify(body), { status, headers: { ...cronCorsHeaders, "Content-Type": "application/json" } });
}
