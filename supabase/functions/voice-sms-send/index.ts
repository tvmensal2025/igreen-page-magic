// voice-sms-send — envio de SMS via Velip (MakeSMS)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildCors } from "../_shared/cors.ts";
import { resolveCaller } from "../_shared/caller-auth.ts";
import { makeSMS, toVelipBRDest, velipConfigured } from "../_shared/voice-dialer/velip.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (!velipConfigured()) return json(503, { error: "velip_not_configured" });

  const caller = await resolveCaller(req);
  if (!caller?.consultantId) return json(401, { error: "unauthorized" });

  let body: { phones?: string[]; message?: string; consultant_id?: string };
  try { body = await req.json(); } catch { return json(400, { error: "invalid_json" }); }

  const message = (body.message || "").trim();
  if (!message) return json(400, { error: "missing_message" });
  const phones = Array.isArray(body.phones) ? body.phones : [];
  if (phones.length === 0) return json(400, { error: "no_phones" });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  let sent = 0, failed = 0;
  const results: unknown[] = [];

  for (const raw of phones) {
    const dest = toVelipBRDest(raw);
    if (!dest) { failed++; continue; }
    const r = await makeSMS({ to: dest, text: message });
    const row = {
      consultant_id: caller.consultantId,
      phone: dest,
      message,
      velip_sms_id: r.cdls_id ?? null,
      velip_ctid: r.ctid ?? null,
      status: r.ok ? "sent" : "failed",
      error: r.ok ? null : (r.error ?? "velip_error"),
      raw: r.raw ?? {},
      sent_at: r.ok ? new Date().toISOString() : null,
    };
    await admin.from("voice_sms_log").insert(row);
    if (r.ok) sent++; else failed++;
    results.push({ dest, ok: r.ok, id: r.cdls_id });
  }

  return json(200, { ok: true, sent, failed, total: phones.length, results });
});
