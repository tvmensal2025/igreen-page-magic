// OTP intercept handler.
// If a customer in awaiting_otp/portal_submitting sends a numeric code,
// we capture it, persist, notify the worker and reply — bypassing the bot flow.
//
// CONTRATO DO WORKER (worker-portal-2 /confirm-otp):
//   POST { idconsultor, idcliente, code, customer_id }
// — sem isso o worker devolve 400 e o OTP nunca chega ao Portal 2.

import { fetchWithTimeout } from "../../_shared/utils.ts";
import { resolveWorker } from "../../_shared/portal-worker.ts";
import { dispatchPortalWorker } from "../../_shared/portal-worker.ts";
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
    .select(`
      id, name, status, portal2_idcliente, portal_idconsultor_override,
      consultants:consultant_id(igreen_id),
      referral_partners:referral_partner_id(cli, partner_igreen_id)
    `)
    .eq("phone_whatsapp", phone)
    .eq("consultant_id", consultantId)
    .in("status", ["awaiting_otp", "portal_submitting", "validating_otp"])
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

  // Resolve idconsultor (mesma prioridade do buildPortal2Payload)
  const c: any = otpCustomer;
  const overrideRaw = Number(c.portal_idconsultor_override || 0);
  const overrideId = Number.isFinite(overrideRaw) && overrideRaw > 0 ? overrideRaw : 0;
  const donoIgreenId = c.consultants?.igreen_id ? Number(c.consultants.igreen_id) : null;
  const partnerIgreenId = c.referral_partners?.partner_igreen_id
    ? Number(c.referral_partners.partner_igreen_id) : 0;
  const partnerCli = c.referral_partners?.cli ? Number(c.referral_partners.cli) : 0;
  const partnerAsConsultant =
    (Number.isFinite(partnerIgreenId) && partnerIgreenId > 0)
      ? partnerIgreenId
      : (Number.isFinite(partnerCli) && partnerCli > 0 ? partnerCli : 0);
  const idconsultor = overrideId > 0
    ? overrideId
    : (partnerAsConsultant > 0 ? partnerAsConsultant : donoIgreenId);
  const idcliente = c.portal2_idcliente ? Number(c.portal2_idcliente) : null;

  await sender.sendText(remoteJid, `✅ Código recebido! Estou finalizando seu cadastro, aguarde alguns segundos...`);

  // Se ainda não temos idcliente, o cadastro nunca chegou ao portal — dispara
  // agora e deixa o watchdog reenviar o OTP em <1 min com idcliente já em mãos.
  if (!idcliente) {
    console.warn(`⚠️ OTP recebido mas portal2_idcliente ausente — disparando cadastro antes (customer=${otpCustomer.id})`);
    await supabase.from("customers").update({
      last_otp_dispatch_error: "missing_portal2_idcliente_will_retry",
      last_otp_dispatch_at: new Date().toISOString(),
    }).eq("id", otpCustomer.id);
    dispatchPortalWorker(supabase, otpCustomer.id).catch((e) =>
      console.warn(`[otp-intercept] dispatchPortalWorker pré-OTP falhou: ${e?.message || e}`)
    );
    await supabase.from("conversations").insert({
      customer_id: otpCustomer.id,
      message_direction: "inbound",
      message_text: messageText,
      message_type: "text",
      conversation_step: "otp_received",
    });
    return { intercepted: true, customerId: otpCustomer.id, otp: extractedOtp };
  }

  if (!idconsultor) {
    console.error(`❌ OTP customer=${otpCustomer.id} sem igreen_id do consultor — watchdog tentará novamente`);
    await supabase.from("customers").update({
      last_otp_dispatch_error: "missing_idconsultor",
      last_otp_dispatch_at: new Date().toISOString(),
    }).eq("id", otpCustomer.id);
    return { intercepted: true, customerId: otpCustomer.id, otp: extractedOtp };
  }

  const resolvedOtpWorker = await resolveWorker(supabase, otpCustomer.id).catch(() => null);
  const workerUrl = resolvedOtpWorker?.url || Deno.env.get("PORTAL2_WORKER_URL");
  const workerSecret = resolvedOtpWorker?.secret || Deno.env.get("PORTAL2_WORKER_SECRET") || Deno.env.get("WORKER_SECRET");
  if (workerUrl) {
    try {
      const r = await fetchWithTimeout(`${workerUrl}/confirm-otp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${workerSecret || ""}`,
        },
        body: JSON.stringify({
          idconsultor,
          idcliente,
          code: extractedOtp,
          customer_id: otpCustomer.id,
        }),
        timeout: 35_000,
      });
      const respBody = await r.text().catch(() => "");
      if (r.ok) {
        console.log(`✅ OTP enviado ao Worker Portal 2 (status=${r.status})`);
        await supabase.from("customers").update({
          status: "validating_otp",
          conversation_step: "aguardando_facial",
          last_otp_dispatch_at: new Date().toISOString(),
          last_otp_dispatch_error: null,
          portal_retry_count: 0,
        }).eq("id", otpCustomer.id);
      } else {
        console.warn(`⚠️ Worker /confirm-otp HTTP ${r.status}: ${respBody.slice(0, 200)}`);
        await supabase.from("customers").update({
          last_otp_dispatch_at: new Date().toISOString(),
          last_otp_dispatch_error: `HTTP ${r.status}: ${respBody.slice(0, 200)}`,
        }).eq("id", otpCustomer.id);
      }
    } catch (e: any) {
      console.warn(`⚠️ Falha ao notificar Worker: ${e?.message || e}`);
      await supabase.from("customers").update({
        last_otp_dispatch_at: new Date().toISOString(),
        last_otp_dispatch_error: (e?.message || String(e)).slice(0, 200),
      }).eq("id", otpCustomer.id);
    }
  }

  await supabase.from("conversations").insert({
    customer_id: otpCustomer.id,
    message_direction: "inbound",
    message_text: messageText,
    message_type: "text",
    conversation_step: "otp_received",
  });

  return { intercepted: true, customerId: otpCustomer.id, otp: extractedOtp };
}
