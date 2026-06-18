// OTP intercept handler.
// If a customer in awaiting_otp/portal_submitting sends a numeric code,
// we capture it, persist, notify the worker and reply — bypassing the bot flow.
// Extracted verbatim from index.ts.

import { fetchWithTimeout } from "../../_shared/utils.ts";
import { resolveWorker } from "../../_shared/portal-worker.ts";
import type { SupabaseClient, EvolutionSender } from "./types.ts";

export interface OtpInterceptArgs {
  supabase: SupabaseClient;
  sender: EvolutionSender;
  consultantId: string;
  phone: string;
  remoteJid: string;
  messageText: string | null;
}

export interface OtpInterceptResult {
  intercepted: boolean;
  customerId?: string;
  otp?: string;
}

export async function tryInterceptOtp(args: OtpInterceptArgs): Promise<OtpInterceptResult> {
  const { supabase, sender, consultantId, phone, remoteJid, messageText } = args;
  if (!messageText) return { intercepted: false };

  const otpDigits = messageText.replace(/\D/g, "");
  const otpPatterns = [
    /(?:c[oó]digo|code|otp|token|verifica[cç][aã]o)[^\d]*(\d{4,8})/i,
    /^(\d{4,8})$/,
  ];
  let extractedOtp: string | null = null;
  for (const pat of otpPatterns) {
    const m = messageText.match(pat);
    if (m) {
      extractedOtp = m[1] || m[0];
      break;
    }
  }
  if (!extractedOtp && /^\d{4,8}$/.test(otpDigits)) {
    extractedOtp = otpDigits;
  }
  if (!extractedOtp) return { intercepted: false };

  const { data: otpCustomer } = await supabase
    .from("customers")
    .select("id, name, status")
    .eq("phone_whatsapp", phone)
    .eq("consultant_id", consultantId)
    .in("status", ["awaiting_otp", "portal_submitting"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!otpCustomer) return { intercepted: false };

  console.log(`🔑 OTP capturado via WhatsApp: ${extractedOtp} para ${otpCustomer.name} (${otpCustomer.id})`);

  await supabase
    .from("customers")
    .update({
      otp_code: extractedOtp,
      otp_received_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", otpCustomer.id);

  // Roteia o OTP pelo worker do portal_kind do consultor (Portal 2 = autoconexao).
  // Fallback defensivo para os envs do Portal 1 se a resolução falhar.
  const resolvedOtpWorker = await resolveWorker(supabase, otpCustomer.id).catch(() => null);
  const workerUrl = resolvedOtpWorker?.url || Deno.env.get("WORKER_PORTAL_URL") || Deno.env.get("PORTAL_WORKER_URL");
  const workerSecret = resolvedOtpWorker?.secret || Deno.env.get("WORKER_SECRET");
  if (workerUrl) {
    try {
      await fetchWithTimeout(`${workerUrl}/confirm-otp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${workerSecret || ""}`,
        },
        body: JSON.stringify({
          customer_id: otpCustomer.id,
          otp_code: extractedOtp,
        }),
        timeout: 5000,
      });
      console.log(`✅ OTP enviado ao Worker VPS`);
    } catch (e: any) {
      console.warn(`⚠️ Falha ao notificar Worker: ${e.message}`);
    }
  }

  await sender.sendText(remoteJid, `✅ Código recebido! Processando...`);

  await supabase.from("conversations").insert({
    customer_id: otpCustomer.id,
    message_direction: "inbound",
    message_text: messageText,
    message_type: "text",
    conversation_step: "otp_received",
  });

  return { intercepted: true, customerId: otpCustomer.id, otp: extractedOtp };
}
