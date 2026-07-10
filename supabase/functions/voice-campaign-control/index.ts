// voice-campaign-control
// Pausar / retomar / cancelar campanha Velip em lote (modo batch).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildCors } from "../_shared/cors.ts";
import { resolveCaller } from "../_shared/caller-auth.ts";
import { changeCampaign, velipConfigured } from "../_shared/voice-dialer/velip.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status, headers: { ...cors, "Content-Type": "application/json" },
    });

  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  if (!velipConfigured()) return json(422, { error: "velip_not_configured" });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const caller = await resolveCaller(req, admin);
  if (caller instanceof Response) return caller;
  if (caller.mode !== "jwt") return json(403, { error: "forbidden" });

  let body: { campaign_id?: string; action?: string };
  try { body = await req.json(); } catch { return json(400, { error: "invalid_json" }); }

  const campaignId = String(body.campaign_id || "");
  const action = String(body.action || "");
  if (!campaignId) return json(400, { error: "missing_campaign_id" });
  if (!["pause", "resume", "cancel"].includes(action)) return json(400, { error: "invalid_action" });

  const { data: camp } = await admin
    .from("voice_campaigns")
    .select("id, consultant_id, velip_campaign_id, velip_mode, status")
    .eq("id", campaignId)
    .maybeSingle();
  if (!camp) return json(404, { error: "campaign_not_found" });
  if (camp.consultant_id !== caller.consultantId) return json(403, { error: "not_owner" });
  if (!camp.velip_campaign_id) return json(422, { error: "campaign_not_batch_velip" });

  const r = await changeCampaign(camp.velip_campaign_id, action as "pause" | "resume" | "cancel");
  if (!r.ok) return json(502, { error: r.error || "velip_change_failed", raw: r.raw });

  const nextStatus = action === "cancel"
    ? "finished"
    : action === "pause"
    ? "paused"
    : "running";
  await admin
    .from("voice_campaigns")
    .update({ status: nextStatus, ...(action === "cancel" ? { finished_at: new Date().toISOString() } : {}) })
    .eq("id", campaignId);

  return json(200, { ok: true, action, campaign_id: campaignId, status: nextStatus });
});
