// Envio dos 2 balões de abertura ao lead: saudação institucional +
// protocolo + pergunta do nome. Usado pelo botão "Iniciar atendimento"
// (edge `start-customer-attendance`).
//
// - Idempotente: se customers.welcome_sent_at já existe, retorna sem enviar.
// - Nunca troca de canal: usa o resolveChannelForCustomer (respeita
//   origin_channel/instance).
// - Grava as 2 mensagens em `conversations` como outbound normal.

import {
  assignProtocolToCustomer,
  buildWelcomeHeaderGreeting,
  buildWelcomeHeaderProtocol,
} from "./protocol.ts";
import {
  resolveChannelForCustomer,
  isUnavailable,
  type ChannelEnv,
} from "./channel-sender.ts";
import { registerSend, checkSendQuota } from "./anti-ban.ts";

export interface SendWelcomeResult {
  ok: boolean;
  skipped?: "already_sent" | "no_phone";
  code?: string;
  detail?: string;
  protocol?: string;
  channel?: "evolution" | "whapi";
  instance?: string;
}

const NAME_ASK_TEXT = "Para começarmos, me conta seu *nome completo*? 🙂";

// deno-lint-ignore no-explicit-any
type SB = any;

export async function sendWelcomeHeader(
  supabase: SB,
  args: {
    customerId: string;
    env: ChannelEnv;
    consultantId?: string;
  },
): Promise<SendWelcomeResult> {
  const { customerId, env } = args;

  const { data: customer } = await supabase
    .from("customers")
    .select(
      "id, name, phone_whatsapp, consultant_id, welcome_sent_at, tracking_protocol, referral_partner_id",
    )
    .eq("id", customerId)
    .maybeSingle();

  if (!customer) return { ok: false, code: "customer_not_found" };
  if (customer.welcome_sent_at) {
    return { ok: true, skipped: "already_sent", protocol: customer.tracking_protocol || undefined };
  }
  const digits = String(customer.phone_whatsapp || "").replace(/\D/g, "");
  if (!digits) return { ok: false, code: "no_phone", skipped: "no_phone" };

  // Garante protocolo antes de montar o balão 2.
  let partnerName: string | null = null;
  if (customer.referral_partner_id) {
    const { data: p } = await supabase
      .from("referral_partners")
      .select("nome")
      .eq("id", customer.referral_partner_id)
      .maybeSingle();
    partnerName = (p as { nome?: string } | null)?.nome ?? null;
  }
  let consultantName: string | null = null;
  if (!partnerName && customer.consultant_id) {
    const { data: c } = await supabase
      .from("consultants")
      .select("name")
      .eq("id", customer.consultant_id)
      .maybeSingle();
    consultantName = (c as { name?: string } | null)?.name ?? null;
  }
  const protoRes = await assignProtocolToCustomer(supabase, customerId, {
    partnerId: customer.referral_partner_id || null,
    partnerName,
    consultantName,
  });
  const protocol = protoRes?.protocol || customer.tracking_protocol || "";

  let channel = await resolveChannelForCustomer(supabase, customerId, env);
  if (isUnavailable(channel)) {
    // Fallback: lead sem origem gravada (ex: captação manual). Usa a instância
    // padrão do consultor e grava origin_* para próximas mensagens.
    if (channel.reason === "no_origin_recorded" && customer.consultant_id) {
      const fallback = await (await import("./channel-sender.ts"))
        .resolveChannel(supabase, customer.consultant_id, env);
      if (fallback) {
        await supabase.from("customers").update({
          origin_channel: fallback.kind,
          origin_instance_name: fallback.instanceName,
        }).eq("id", customerId).then(() => {}, () => {});
        channel = fallback;
      } else {
        return { ok: false, code: "channel_unavailable", detail: "no_instance_for_consultant" };
      }
    } else {
      return { ok: false, code: "channel_unavailable", detail: channel.reason };
    }
  }

  // Quota — libera whapi compartilhado.
  const quota = await checkSendQuota(supabase, channel.instanceName);
  const bypassQuota = channel.kind === "whapi" ||
    quota.reason === "instance_not_found" ||
    quota.reason === "rpc_error" ||
    quota.reason === "exception";
  if (!quota.allowed && !bypassQuota) {
    return { ok: false, code: "rate_limited", detail: quota.reason };
  }

  const jid = `${digits}@s.whatsapp.net`;
  const greeting = buildWelcomeHeaderGreeting();
  const protoBlock = protocol
    ? `${buildWelcomeHeaderProtocol(protocol)}\n\n${NAME_ASK_TEXT}`
    : NAME_ASK_TEXT;

  const sendCtx = {
    customerId,
    consultantId: args.consultantId || customer.consultant_id || "",
    stepId: "manual:start_attendance",
    idempotencyKey: `welcome:${customerId}:${Date.now()}`,
    supabase,
  };

  // Balão 1
  const r1 = await channel.adapter.sendText(jid, greeting, sendCtx as never);
  if (!r1.ok) {
    return { ok: false, code: "send_failed_greeting", detail: (r1 as { detail?: string }).detail };
  }
  await registerSend(supabase, channel.instanceName).catch(() => {});
  await supabase.from("conversations").insert({
    customer_id: customerId,
    message_direction: "outbound",
    message_text: greeting,
    message_type: "text",
    conversation_step: "welcome",
  }).then(() => {}, () => {});

  // Pequeno atraso pra chegar em ordem (2 balões).
  await new Promise((r) => setTimeout(r, 900));

  // Balão 2
  const r2 = await channel.adapter.sendText(jid, protoBlock, sendCtx as never);
  if (!r2.ok) {
    return { ok: false, code: "send_failed_protocol", detail: (r2 as { detail?: string }).detail };
  }
  await registerSend(supabase, channel.instanceName).catch(() => {});
  await supabase.from("conversations").insert({
    customer_id: customerId,
    message_direction: "outbound",
    message_text: protoBlock,
    message_type: "text",
    conversation_step: "ask_name",
  }).then(() => {}, () => {});

  const now = new Date().toISOString();
  await supabase
    .from("customers")
    .update({
      welcome_sent_at: now,
      name_ask_sent_at: now,
      conversation_step: "ask_name",
      capture_mode: "manual",
      capture_started_at: now,
    })
    .eq("id", customerId)
    .then(() => {}, () => {});

  return {
    ok: true,
    protocol,
    channel: channel.kind,
    instance: channel.instanceName,
  };
}
