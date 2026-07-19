// Estende prazo e/ou ajusta orçamento diário de uma campanha existente.
// Body: {
//   campaign_id: uuid,
//   add_days?: number,
//   continuous?: boolean,   // sem data fim + daily_budget
//   new_daily_budget_cents?: number,
//   reactivate?: boolean
// }
import { adminClient, authConsultant, corsHeaders, FB_GRAPH, loadCampaignConnection } from "../_shared/fb-graph.ts";
import { META_MIN_DAILY_BUDGET_CENTS } from "../_shared/campaign-budget.ts";
import { resolveCampaignEffectiveStatus, type MetaObjectState } from "../_shared/campaign-effective-status.ts";
import { validateCampaignActivationBudget } from "../_shared/validate-campaign-activation.ts";
import { validateRodizioActivation } from "../_shared/validate-rodizio-activation.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = await authConsultant(req);
    if (!auth) return j({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const campaignId = String(body?.campaign_id || "");
    const continuous = body?.continuous === true;
    const addDays = continuous ? 0 : Math.max(0, Math.min(60, Number(body?.add_days ?? 0)));
    const newDailyBudgetCents = body?.new_daily_budget_cents != null
      ? Math.max(META_MIN_DAILY_BUDGET_CENTS, Math.floor(Number(body.new_daily_budget_cents)))
      : null;
    const reactivate = body?.reactivate === true;

    if (!campaignId) return j({ error: "campaign_id obrigatório" }, 400);
    if (!continuous && addDays === 0 && newDailyBudgetCents == null) {
      return j({ error: "Informe continuous, add_days ou new_daily_budget_cents" }, 400);
    }

    const admin = adminClient();
    const { data: c, error: rowErr } = await admin
      .from("facebook_campaigns")
      .select("id, consultant_id, fb_campaign_id, fb_adset_ids, fb_ad_ids, status, daily_budget_cents, duration_days, started_at, ended_at, end_time_utc")
      .eq("id", campaignId)
      .maybeSingle();
    if (rowErr) return j({ error: rowErr.message }, 500);
    if (!c) return j({ error: "campanha não encontrada" }, 404);

    const { data: isSuper } = await admin.rpc("is_super_admin", { _user_id: auth.id });
    if (c.consultant_id !== auth.id && !isSuper) return j({ error: "forbidden" }, 403);

    const nextDailyBudgetCents = newDailyBudgetCents ?? Math.max(META_MIN_DAILY_BUDGET_CENTS, Number(c.daily_budget_cents) || META_MIN_DAILY_BUDGET_CENTS);

    if (reactivate) {
      const activationBudget = await validateCampaignActivationBudget(admin, {
        consultantId: c.consultant_id,
        dailyBudgetCents: nextDailyBudgetCents,
        durationDays: continuous ? null : (addDays > 0 ? addDays : null),
      });
      if (!activationBudget.ok) return j({ error: activationBudget.error, status: c.status }, 402);
      const rodizio = await validateRodizioActivation(admin, c.id, c.consultant_id);
      if (!rodizio.ok) return j({ error: rodizio.error, status: c.status }, 409);
    }

    const now = Date.now();
    const storedEnd = c.end_time_utc || c.ended_at;
    const currentEnd = storedEnd ? new Date(storedEnd).getTime() : now;
    const base = Math.max(Number.isFinite(currentEnd) ? currentEnd : now, now);
    const newEndMs = addDays > 0 ? base + addDays * 86400_000 : currentEnd;
    const newEndISO = new Date(newEndMs).toISOString();
    const nextDurationDays = continuous
      ? null
      : Math.max(1, Number(c.duration_days || 0) + addDays);
    const nextLifetimeBudgetCents = continuous
      ? null
      : nextDailyBudgetCents * (nextDurationDays || 1);
    const fixedDuration = !continuous && (Number(c.duration_days || 0) > 0 || addDays > 0);

    if (!c.fb_campaign_id) {
      return j({ error: "Campanha sem ID da Meta. Nada foi alterado localmente." }, 409);
    }
    const conn = await loadCampaignConnection(c.consultant_id);
    if (!conn?.token) {
      return j({ error: "Sem token Meta válido. Nada foi alterado localmente." }, 502);
    }

    const token = conn.token;
    const adsetIds = (c.fb_adset_ids || []) as string[];
    const adIds = (c.fb_ad_ids || []) as string[];
    try {
      if (continuous) {
        // Troca lifetime → daily e remove fim de prazo nos adsets.
        await postMeta(c.fb_campaign_id, {
          daily_budget: String(nextDailyBudgetCents),
          lifetime_budget: "0",
        }, token, "campaign continuous budget");
        for (const adsetId of adsetIds) {
          // end_time=0 = remove data fim (campanha contínua)
          await postMeta(adsetId, { end_time: "0" }, token, "adset clear end_time");
        }
      } else if (fixedDuration) {
        await postMeta(c.fb_campaign_id, {
          lifetime_budget: String(nextLifetimeBudgetCents),
        }, token, "campaign budget");
      } else if (newDailyBudgetCents != null) {
        await postMeta(c.fb_campaign_id, {
          daily_budget: String(newDailyBudgetCents),
        }, token, "campaign budget");
      }

      if (!continuous && addDays > 0) {
        for (const adsetId of adsetIds) {
          await postMeta(adsetId, { end_time: newEndISO }, token, "adset end_time");
        }
      }

      if (reactivate) {
        for (const adsetId of adsetIds) await postMeta(adsetId, { status: "ACTIVE" }, token, "activate adset");
        for (const adId of adIds) await postMeta(adId, { status: "ACTIVE" }, token, "activate ad");
        await postMeta(c.fb_campaign_id, { status: "ACTIVE" }, token, "activate campaign");

        const [campaignState, ...children] = await Promise.all([
          getMetaState(c.fb_campaign_id, token),
          ...adsetIds.map((id) => getMetaState(id, token)),
          ...adIds.map((id) => getMetaState(id, token)),
        ]);
        const resolved = resolveCampaignEffectiveStatus(
          campaignState,
          children.slice(0, adsetIds.length),
          children.slice(adsetIds.length),
        );
        if (resolved.localStatus !== "active") {
          throw new Error(`A Meta não confirmou a ativação completa (${resolved.objectStatuses.join(", ")}).`);
        }
      }
    } catch (e) {
      return j({
        error: "A Meta não confirmou a extensão/reativação. O banco local não foi alterado.",
        meta_error: (e as Error).message,
        status: c.status,
      }, 502);
    }

    const updatePayload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      daily_budget_cents: nextDailyBudgetCents,
    };
    if (continuous) {
      updatePayload.duration_days = null;
      updatePayload.end_time_utc = null;
      updatePayload.ended_at = null;
      updatePayload.lifetime_cap_cents = null;
    } else {
      if (addDays > 0) {
        updatePayload.duration_days = nextDurationDays;
        updatePayload.end_time_utc = newEndISO;
        updatePayload.ended_at = null;
      }
      if (fixedDuration) updatePayload.lifetime_cap_cents = nextLifetimeBudgetCents;
    }
    if (reactivate) {
      updatePayload.status = "active";
      updatePayload.rejection_reason = null;
      try {
        await admin
          .from("rodizio_pools")
          .update({ paused_notified_at: null, last_pause_reason: null })
          .eq("campaign_id", c.id);
      } catch (e) {
        console.error("[fb-extend] reset paused_notified_at falhou:", (e as Error).message);
      }
    }

    const { error: updErr } = await admin.from("facebook_campaigns").update(updatePayload).eq("id", c.id);
    if (updErr) return j({ error: updErr.message, meta_applied: true }, 500);

    return j({
      ok: true,
      status: updatePayload.status || c.status,
      continuous,
      ended_at: continuous ? null : (addDays > 0 ? newEndISO : c.end_time_utc),
      end_time_utc: continuous ? null : (addDays > 0 ? newEndISO : c.end_time_utc),
      duration_days: continuous ? null : nextDurationDays,
      daily_budget_cents: nextDailyBudgetCents,
      lifetime_budget_cents: fixedDuration ? nextLifetimeBudgetCents : null,
      meta_error: null,
    });
  } catch (e) {
    console.error("[fb-extend]", e);
    return j({ error: (e as Error).message }, 500);
  }
});

async function postMeta(
  id: string,
  params: Record<string, string>,
  token: string,
  label: string,
) {
  const response = await fetch(`${FB_GRAPH}/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...params, access_token: token }),
  });
  if (!response.ok) {
    throw new Error(`Meta ${label} ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
}

async function getMetaState(id: string, token: string): Promise<MetaObjectState> {
  const response = await fetch(
    `${FB_GRAPH}/${id}?fields=effective_status,configured_status,issues_info&access_token=${encodeURIComponent(token)}`,
  );
  if (!response.ok) {
    throw new Error(`Meta status ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  return response.json();
}

function j(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
