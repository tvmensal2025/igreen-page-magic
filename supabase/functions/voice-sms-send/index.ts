// voice-sms-send — dispara SMS individual ou em lote via Velip MakeSMS.
// JWT do consultor. Registra em voice_sms_log.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildCors } from "../_shared/cors.ts";
import { resolveCaller } from "../_shared/caller-auth.ts";
import { makeSMS, toCtid, toVelipBRDest, velipConfigured } from "../_shared/voice-dialer/velip.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface Recipient { phone: string; name?: string | null; vars?: Record<string, string> }

interface Body {
  message: string;
  recipients: Recipient[];
  scheduled_at?: string | null;
  campaign_name?: string;
}

function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => vars[k] ?? "");
}

Deno.serve(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (s: number, b: unknown) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  if (!velipConfigured()) return json(422, { error: "velip_not_configured" });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const caller = await resolveCaller(req, admin);
  if (caller instanceof Response) return caller;
  if (caller.mode !== "jwt") return json(403, { error: "forbidden" });
  const consultantId = caller.consultantId;

  let body: Body;
  try { body = await req.json(); } catch { return json(400, { error: "invalid_json" }); }
  if (!body.message?.trim()) return json(400, { error: "missing_message" });
  if (!Array.isArray(body.recipients) || body.recipients.length === 0) {
    return json(400, { error: "missing_recipients" });
  }
  if (body.recipients.length > 2000) return json(400, { error: "too_many", max: 2000 });

  const results: Array<{ phone: string; ok: boolean; velip_sms_id?: string; error?: string }> = [];
  const seen = new Set<string>();

  for (const r of body.recipients) {
    const dest = toVelipBRDest(r.phone);
    if (!dest || seen.has(dest)) continue;
    seen.add(dest);

    const vars = { nome: r.name || "", ...(r.vars || {}) } as Record<string, string>;
    const msg = renderTemplate(body.message, vars).slice(0, 480);

    const { data: log } = await admin.from("voice_sms_log").insert({
      consultant_id: consultantId,
      phone: dest,
      message: msg,
      status: "queued",
    }).select("id").single();

    const logId = (log as { id?: string } | null)?.id;
    const ctid = logId ? toCtid(logId) : toCtid(dest);

    const res = await makeSMS({
      to: dest,
      message: msg,
      ctid,
      scheduledAt: body.scheduled_at ?? undefined,
    });

    if (logId) {
      await admin.from("voice_sms_log").update({
        velip_sms_id: res.cdls_id ?? null,
        velip_ctid: ctid,
        status: res.ok ? "sent" : "failed",
        error: res.ok ? null : (res.error || "unknown"),
      }).eq("id", logId);
    }

    results.push({ phone: dest, ok: res.ok, velip_sms_id: res.cdls_id, error: res.error });
  }

  const ok = results.filter((r) => r.ok).length;
  return json(200, { ok: true, total: results.length, sent: ok, failed: results.length - ok, results });
});
