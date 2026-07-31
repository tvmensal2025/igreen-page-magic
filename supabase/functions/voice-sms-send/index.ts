// voice-sms-send — envio de SMS via Velip MakeSMS
// https://vox.velip.com.br/api/v2/MakeSMS
// Autenticado por JWT do consultor. Isolado do discador.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildCors } from "../_shared/cors.ts";
import { resolveCaller } from "../_shared/caller-auth.ts";
import { makeSMS, toCtid, toVelipSmsDest, velipConfigured } from "../_shared/voice-dialer/velip.ts";
import { debitSmsSent } from "../_shared/voice-sms-billing.ts";
import { assertCanContact } from "../_shared/contact-suppression.ts";
import { resolveConsultantConnectedWaPhone, buildConsultantSmsWaLink, normalizeWaPhoneDigits } from "../_shared/consultant-wa-phone.ts";
import { safeFirstNameForAddress } from "../_shared/customer-display-name.ts";

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

function renderSms(
  message: string,
  name: string | null | undefined,
  consultorPhone: string,
  nameSource?: string | null,
): string {
  const nome = safeFirstNameForAddress(name, nameSource ?? "manual");
  const phone = normalizeWaPhoneDigits(consultorPhone);
  const linkWa = buildConsultantSmsWaLink(phone);
  let out = String(message || "").trim();
  if (
    out &&
    !/wa\.me\//i.test(out) &&
    !/\{\{\s*consultor_phone\s*\}\}/i.test(out) &&
    !/\{\{\s*link_wa\s*\}\}/i.test(out)
  ) {
    out = `${out} https://wa.me/{{consultor_phone}}`;
  }
  out = out
    .replace(/\{\{\s*nome\s*\}\}/gi, nome)
    .replace(/\{\s*nome\s*\}/gi, nome)
    .replace(/\{\{\s*link_wa\s*\}\}/gi, linkWa)
    .replace(/\{\{\s*consultor_phone\s*\}\}/gi, phone)
    .replace(/\{\{\s*consultor\s*\}\}/gi, "");
  // Protocolo obrigatório no SMS — senão o celular não abre o link.
  out = out.replace(/(?:https?:\/\/)?wa\.me\/(?=[\d+]|\{\{)/gi, "https://wa.me/");
  if (!nome) {
    out = out
      .replace(/\bOi\s*,/gi, "Oi")
      .replace(/\bOlá\s*,/gi, "Olá")
      .replace(/,\s+,/g, ",")
      .replace(/\s{2,}/g, " ")
      .trim();
  }
  return out
    .replace(/(?:https?:\/\/)?wa\.me\/(?![\d+])/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
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

  // Link wa.me = WhatsApp CONECTADO (chip), nunca notification_phone (alerta humano).
  // Sem chip conectado NÃO bloqueia o envio: usa o telefone cadastrado do consultor
  // e, na pior hipótese, manda o SMS sem link (regra: quem tem saldo, envia).
  let consultantPhone = await resolveConsultantConnectedWaPhone(admin, consultantId);
  if (!consultantPhone) {
    const { data: c } = await admin
      .from("consultants")
      .select("phone, notification_phone")
      .eq("id", consultantId)
      .maybeSingle();
    const row = (c ?? {}) as { phone?: string; notification_phone?: string };
    consultantPhone = normalizeWaPhoneDigits(row.phone || row.notification_phone);

    if (!consultantPhone) {
      console.warn("[voice-sms-send] consultor sem telefone — SMS sem link wa.me", consultantId);
    }
  }


  const recipients: RecipientIn[] = [];
  const seen = new Set<string>();

  const push = (phoneRaw: string, name?: string | null) => {
    const dest = toVelipSmsDest(phoneRaw);
    if (!dest || dest.length !== 13 || seen.has(dest)) return;
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

  const { data: dncRows, error: dncListErr } = await admin
    .from("voice_dnc_list")
    .select("phone")
    .eq("consultant_id", consultantId);
  if (dncListErr) {
    console.error("[voice-sms-send] falha ao ler voice_dnc_list", dncListErr);
    return json(503, { error: "dnc_check_failed", message: "Não foi possível validar a lista de bloqueio. Tente novamente." });
  }
  const blocked = new Set(
    (dncRows ?? []).map((r: { phone: string }) => String(r.phone || "").replace(/\D/g, "")).filter(Boolean),
  );


  // DNC de clientes: consulta apenas os telefones DESTE lote (≤200),
  // em vez de baixar 5000 linhas e correr o risco de truncar a lista.
  const batchDigits = Array.from(
    new Set(recipients.map((r) => String(r.phone || "").replace(/\D/g, "")).filter(Boolean)),
  );
  for (let i = 0; i < batchDigits.length; i += 100) {
    const slice = batchDigits.slice(i, i + 100);
    const { data: dncCust, error: dncErr } = await admin
      .from("customers")
      .select("phone_whatsapp")
      .eq("consultant_id", consultantId)
      .eq("do_not_contact", true)
      .in("phone_whatsapp", slice);
    if (dncErr) {
      // Fail-closed: sem confirmação de DNC não enviamos o lote.
      console.error("[voice-sms-send] falha ao ler DNC de customers", dncErr);
      return json(503, { error: "dnc_check_failed", message: "Não foi possível validar a lista de bloqueio. Tente novamente." });
    }
    for (const row of dncCust || []) {
      const d = String((row as { phone_whatsapp?: string }).phone_whatsapp || "").replace(/\D/g, "");
      if (d) blocked.add(d);
    }
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

    const gate = await assertCanContact(admin, {
      phone: rec.phone,
      consultantId,
      channel: "sms",
    });
    if (!gate.allowed) {
      failed++;
      results.push({ dest: rec.phone, ok: false, error: gate.reason || "suppressed" });
      continue;
    }

    const message = renderSms(template, rec.name, consultantPhone);
    if (!message) {
      failed++;
      results.push({ dest: rec.phone, ok: false, error: "empty_message_after_render" });
      continue;
    }

    const dayKey = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const msgHashBuf = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(message),
    );
    const msgHash = Array.from(new Uint8Array(msgHashBuf))
      .slice(0, 4)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    // ctid estável (consultor+fone+texto+dia) — double-click / retry não duplica no Velip.
    const ctid = toCtid(`sms_${consultantId.slice(0, 8)}_${destDigits.slice(-11)}_${msgHash}_${dayKey}`);
    const r = await makeSMS({
      to: rec.phone,
      message,
      ctid,
      httpdup: 1,
    });

    const insert = await admin.from("voice_sms_log").insert({
      consultant_id: consultantId,
      phone: rec.phone,
      message,
      velip_sms_id: r.cdls_id ?? null,
      velip_ctid: ctid,
      status: r.ok ? "sent" : "failed",
      error: r.ok ? null : (r.error ?? "velip_error"),
    }).select("id").maybeSingle();

    if (insert.error) {
      console.error("[voice-sms-send] log insert failed:", insert.error.message);
    }

    if (r.ok) {
      sent++;
      const smsRef = r.cdls_id != null
        ? String(r.cdls_id)
        : (insert.data as { id?: string } | null)?.id ?? `manual_sms_${consultantId}_${Date.now()}`;
      void debitSmsSent(admin, {
        consultantId,
        providerRef: smsRef,
        metadata: { source: "voice_sms_send" },
      });
    } else {
      failed++;
    }    results.push({
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
