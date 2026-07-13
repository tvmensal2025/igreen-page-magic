// Estende prazo e/ou ajusta orçamento diário de uma campanha existente.
// Body: { campaign_id: uuid, add_days?: number, new_daily_budget_cents?: number, reactivate?: boolean }
import { adminClient, authConsultant, corsHeaders, FB_GRAPH, loadCampaignConnection } from "../_shared/fb-graph.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = await authConsultant(req);
    if (!auth) return j({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const campaignId = String(body?.campaign_id || "");
    const addDays = Math.max(0, Math.min(60, Number(body?.add_days ?? 0)));
    const newDailyBudgetCents = body?.new_daily_budget_cents != null
      ? Math.max(500, Math.floor(Number(body.new_daily_budget_cents)))
      : null;
    const reactivate = body?.reactivate !== false; // default true

    if (!campaignId) return j({ error: "campaign_id obrigatório" }, 400);
    if (addDays === 0 && newDailyBudgetCents == null) {
      return j({ error: "Informe add_days ou new_daily_budget_cents" }, 400);
    }

    const admin = adminClient();
    const { data: c, error: rowErr } = await admin
      .from("facebook_campaigns")
      .select("id, consultant_id, fb_campaign_id, fb_adset_ids, status, daily_budget_cents, duration_days, started_at, ended_at")
      .eq("id", campaignId)
      .maybeSingle();
    if (rowErr) return j({ error: rowErr.message }, 500);
    if (!c) return j({ error: "campanha não encontrada" }, 404);

    const { data: isSuper } = await admin.rpc("is_super_admin", { _user_id: auth.id });
    if (c.consultant_id !== auth.id && !isSuper) return j({ error: "forbidden" }, 403);

    // Calcula novo end_time
    const now = Date.now();
    const currentEnd = c.ended_at ? new Date(c.ended_at).getTime() : now;
    const base = Math.max(currentEnd, now);
    const newEndMs = addDays > 0 ? base + addDays * 86400_000 : currentEnd;
    const newEndISO = new Date(newEndMs).toISOString();

    let metaError: string | null = null;
    if (c.fb_campaign_id) {
      const conn = await loadCampaignConnection(c.consultant_id);
      if (!conn?.token) {
        metaError = "Sem token Meta válido — só atualizei valores locais.";
      } else {
        const token = conn.token;
        const adsetIds = (c.fb_adset_ids || []) as string[];

        try {
          // 1) Atualiza end_time e/ou daily_budget em cada adset
          for (const adsetId of adsetIds) {
            const params = new URLSearchParams({ access_token: token });
            if (addDays > 0) params.set("end_time", newEndISO);
            if (newDailyBudgetCents != null) params.set("daily_budget", String(newDailyBudgetCents));
            const r = await fetch(`${FB_GRAPH}/${adsetId}`, {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: params,
            });
            if (!r.ok) {
              const t = await r.text();
              throw new Error(`Meta adset ${r.status}: ${t.slice(0, 300)}`);
            }
          }

          // 2) Reativa, se solicitado
          if (reactivate) {
            const setActive = async (id: string) => {
              const r = await fetch(`${FB_GRAPH}/${id}`, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({ status: "ACTIVE", access_token: token }),
              });
              if (!r.ok) {
                const t = await r.text();
                throw new Error(`Meta activate ${r.status}: ${t.slice(0, 300)}`);
              }
            };
            for (const adsetId of adsetIds) await setActive(adsetId);
            await setActive(c.fb_campaign_id);
          }
        } catch (e) {
          metaError = (e as Error).message;
        }
      }
    }

    const updatePayload: Record<string, unknown> = {};
    if (addDays > 0) {
      updatePayload.duration_days = (c.duration_days || 0) + addDays;
      updatePayload.ended_at = newEndISO;
    }
    if (newDailyBudgetCents != null) updatePayload.daily_budget_cents = newDailyBudgetCents;
    if (reactivate && !metaError) {
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
    if (Object.keys(updatePayload).length > 0) {
      const { error: updErr } = await admin.from("facebook_campaigns").update(updatePayload).eq("id", c.id);
      if (updErr) return j({ error: updErr.message, meta_error: metaError }, 500);
    }

    return j({
      ok: !metaError,
      status: updatePayload.status || c.status,
      ended_at: addDays > 0 ? newEndISO : c.ended_at,
      daily_budget_cents: newDailyBudgetCents ?? c.daily_budget_cents,
      meta_error: metaError,
    });
  } catch (e) {
    console.error("[fb-extend]", e);
    return j({ error: (e as Error).message }, 500);
  }
});

function j(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
