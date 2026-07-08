// Pausa ou reativa uma campanha no Meta (campanha + adsets + ads) e atualiza o DB.
// Body: { campaign_id: uuid, action: "pause" | "activate" }
import { adminClient, authConsultant, corsHeaders, FB_GRAPH, loadCampaignConnection } from "../_shared/fb-graph.ts";
import { notifyRodizioOnCampaignPaused } from "../_shared/rodizio-pause-notify.ts";


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = await authConsultant(req);
    if (!auth) return j({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const campaignId = String(body?.campaign_id || "");
    const action = String(body?.action || "");
    if (!campaignId) return j({ error: "campaign_id obrigatório" }, 400);
    if (action !== "pause" && action !== "activate") return j({ error: "action deve ser pause|activate" }, 400);

    const admin = adminClient();
    const { data: c, error: rowErr } = await admin
      .from("facebook_campaigns")
      .select("id, consultant_id, fb_campaign_id, fb_adset_ids, fb_ad_ids, status")
      .eq("id", campaignId)
      .maybeSingle();
    if (rowErr) return j({ error: rowErr.message }, 500);
    if (!c) return j({ error: "campanha não encontrada" }, 404);

    const { data: isSuper } = await admin.rpc("is_super_admin", { _user_id: auth.id });
    if (c.consultant_id !== auth.id && !isSuper) return j({ error: "forbidden" }, 403);

    const target = action === "pause" ? "PAUSED" : "ACTIVE";
    const dbStatus = action === "pause" ? "paused" : "active";

    let metaError: string | null = null;
    if (c.fb_campaign_id) {
      const conn = await loadCampaignConnection(c.consultant_id);
      if (!conn?.token) {
        metaError = "Sem token Meta válido — só atualizei o status local.";
      } else {
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
          for (const adId of (c.fb_ad_ids || []) as string[]) await setStatus(adId);
          for (const adsetId of (c.fb_adset_ids || []) as string[]) await setStatus(adsetId);
          await setStatus(c.fb_campaign_id);
        } catch (e) {
          metaError = (e as Error).message;
        }
      }
    }

    const updatePayload: Record<string, unknown> = { status: dbStatus };
    if (action === "activate" && !metaError) updatePayload.rejection_reason = null;
    const { error: updErr } = await admin.from("facebook_campaigns").update(updatePayload).eq("id", c.id);
    if (updErr) return j({ error: updErr.message, meta_error: metaError }, 500);

    // Rodízio: aviso 1× ao pausar; reset dos flags ao reativar.
    if (action === "pause" && !metaError) {
      try {
        await notifyRodizioOnCampaignPaused(admin, c.id, "manual");
      } catch (e) {
        console.error("[fb-toggle] rodizio notify falhou:", (e as Error).message);
      }
    }
    if (action === "activate") {
      try {
        await admin
          .from("rodizio_pools")
          .update({ paused_notified_at: null, last_pause_reason: null })
          .eq("campaign_id", c.id);
      } catch (e) {
        console.error("[fb-toggle] reset paused_notified_at falhou:", (e as Error).message);
      }
    }

    return j({ ok: !metaError, status: dbStatus, meta_error: metaError });

  } catch (e) {
    console.error("[fb-toggle]", e);
    return j({ error: (e as Error).message }, 500);
  }
});

function j(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
