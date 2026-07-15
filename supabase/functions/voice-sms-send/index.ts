// voice-sms-send — envio de SMS via Velip MakeSMS
// https://vox.velip.com.br/api/v2/MakeSMS
// Autenticado por JWT do consultor. Isolado do discador.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildCors } from "../_shared/cors.ts";
import { resolveCaller } from "../_shared/caller-auth.ts";
import { makeSMS, toCtid, toVelipBRDest, velipConfigured } from "../_shared/voice-dialer/velip.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface RecipientIn {
  phone: string;
  name?: string | null;
}

interface Body {
  phones?: string[];
  recipients?: RecipientIn[];
  message?: string;
  consultant_id?: string;
}

function firstName(name: string | null | undefined): string {
  const n = String(name || "").trim();
  if (!n) return "";
  return n.split(/\s+/)[0] || "";
}

/** Substitui {{nome}} / {nome}. Sem nome, limpa o placeholder sem ficar "Oi ,". */
function renderSms(message: string, name: string | null | undefined): string {
  const nome = firstName(name);
  let out = message
    .replace(/\{\{\s*nome\s*\}\}/gi, nome)
    .replace(/\{\s*nome\s*\}/gi, nome);
  if (!nome) {
    out = out
      .replace(/\bOi\s*,/gi, "Oi")
      .replace(/\bOlá\s*,/gi, "Olá")
      .replace(/,\s+,/g, ",")
      .replace(/\s{2,}/g, " ")
      .trim();
  }
  return out.replace(/\s{2,}/g, " ").trim();
}

Deno.serve(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  if (!velipConfigured()) {
    return json(503, {
      error: "velip_not_configured",
      message: "Configure VELIP_API_TOKEN nos secrets.",
    });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const caller = await resolveCaller(req, admin);
  if (caller instanceof Response) return caller;
  if (caller.mode !== "jwt") return json(403, { error: "forbidden" });
  const consultantId = caller.consultantId;

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_json" });
  }

  const template = (body.message || "").trim();
  if (!template) return json(400, { error: "missing_message", message: "Escreva a mensagem do SMS." });

  const recipients: RecipientIn[] = [];
  const seen = new Set<string>();

  const push = (phoneRaw: string, name?: string | null) => {
    const dest = toVelipBRDest(phoneRaw);
    if (!dest || seen.has(dest)) return;
    seen.add(dest);
    recipients.push({ phone: dest, name: name ?? null });
  };

  if (Array.isArray(body.recipients)) {
    for (const r of body.recipients) {
      if (r?.phone) push(r.phone, r.name);
    }
  }
  if (Array.isArray(body.phones)) {
    for (const p of body.phones) {
      if (p) push(p);
    }
  }

  if (recipients.length === 0) {
    return json(400, { error: "no_phones", message: "Adicione ao menos 1 telefone válido." });
  }
  if (recipients.length > 200) {
    return json(400, { error: "too_many_phones", message: "Máximo 200 SMS por lote." });
  }

  const { data: dncRows } = await admin
    .from("voice_dnc_list")
    .select("phone")
    .eq("consultant_id", consultantId);
  const blocked = new Set(
    (dncRows ?? []).map((r: { phone: string }) => String(r.phone || "").replace(/\D/g, "")).filter(Boolean),
  );

  const { data: dncCust } = await admin
    .from("customers")
    .select("phone_whatsapp")
    .eq("consultant_id", consultantId)
    .eq("do_not_contact", true)
    .limit(5000);
  for (const row of dncCust || []) {
    const d = String((row as { phone_whatsapp?: string }).phone_whatsapp || "").replace(/\D/g, "");
    if (d) blocked.add(d);
  }

  let sent = 0;
  let failed = 0;
  const results: unknown[] = [];

  for (const rec of recipients) {
    const destDigits = rec.phone.replace(/\D/g, "");
    if ([...blocked].some((b) => b === destDigits || destDigits.endsWith(b) || b.endsWith(destDigits))) {
      failed++;
      results.push({ dest: rec.phone, ok: false, error: "dnc_blocked" });
      continue;
    }

    const message = renderSms(template, rec.name);
    if (!message) {
      failed++;
      results.push({ dest: rec.phone, ok: false, error: "empty_message_after_render" });
      continue;
    }

    const ctid = toCtid(`sms_${consultantId.slice(0, 6)}_${Date.now().toString(36)}`);
    const r = await makeSMS({
      to: rec.phone,
      message,
      ctid,
      httpdup: 0, // envio manual: não bloquear reenvio em 10s
    });

    const insert = await admin.from("voice_sms_log").insert({
      consultant_id: consultantId,
      phone: rec.phone,
      message,
      velip_sms_id: r.cdls_id ?? null,
      velip_ctid: ctid,
      status: r.ok ? "sent" : "failed",
      error: r.ok ? null : (r.error ?? "velip_error"),
    });

    if (insert.error) {
      console.error("[voice-sms-send] log insert failed:", insert.error.message);
    }

    if (r.ok) sent++;
    else failed++;
    results.push({
      dest: rec.phone,
      ok: r.ok,
      id: r.cdls_id ?? null,
      error: r.ok ? null : (r.error ?? "velip_error"),
      message,
    });
  }

  return json(200, {
    ok: failed === 0,
    sent,
    failed,
    total: recipients.length,
    results,
    message: failed === 0
      ? `SMS enviado: ${sent}`
      : `Enviados ${sent}, falha ${failed}`,
  });
});
