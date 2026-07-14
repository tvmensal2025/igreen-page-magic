// Fluxo profissional de atendimento manual:
//   início → saudação + "Atendimento iniciado" + protocolo + nome
//   fim    → "Atendimento finalizado" + pesquisa 1–5
//
// Canal:
//   - Super admin → Whapi (settings.whapi_token)
//   - Demais consultores → Evolution (instância do consultor)

import {
  assignProtocolToCustomer,
  buildWelcomeHeaderGreeting,
  buildWelcomeHeaderProtocol,
} from "./protocol.ts";
import {
  resolveChannelForCustomer,
  resolveChannel,
  isUnavailable,
  type ChannelEnv,
  type ResolvedChannel,
} from "./channel-sender.ts";
import { getAdapter } from "./channels/index.ts";
import { registerSend, checkSendQuota } from "./anti-ban.ts";
import { isSuperAdminConsultant } from "./attendance-channel-env.ts";
import { normalizePhone } from "./utils.ts";
import { resolveConsultantMessage } from "./consultant-template.ts";

export const ATTENDANCE_RATING_STEP = "aguardando_avaliacao_atendimento";
/** Step terminal após nota registrada — bots/crons devem ignorar. */
export const ATTENDANCE_DONE_STEP = "atendimento_finalizado";

/** Steps do atendimento profissional (pesquisa + encerrado). */
export const ATTENDANCE_TERMINAL_STEPS = new Set<string>([
  ATTENDANCE_RATING_STEP,
  ATTENDANCE_DONE_STEP,
]);

const NAME_ASK_TEXT = "Para começarmos, me conta seu *nome completo*?";

export interface SendWelcomeResult {
  ok: boolean;
  skipped?: "already_sent" | "no_phone";
  code?: string;
  detail?: string;
  protocol?: string;
  channel?: "evolution" | "whapi";
  instance?: string;
}

export interface EndAttendanceResult {
  ok: boolean;
  skipped?: "already_rated" | "rating_pending" | "no_phone";
  code?: string;
  detail?: string;
}

// deno-lint-ignore no-explicit-any
type SB = any;

export function buildAttendanceClosingText(): string {
  return [
    "✅ *Atendimento finalizado*",
    "",
    "Foi um prazer te atender!",
    "Se precisar de algo, estamos por aqui.",
  ].join("\n");
}

/** Pesquisa em texto numerado (1–5). Negrito só no número — evita “grito” visual. */
export function buildAttendanceRatingPrompt(): string {
  return [
    "⭐ Como você avalia o atendimento de hoje?",
    "",
    "Responda com um número de *1* a *5*:",
    "",
    "*1* — Muito ruim",
    "*2* — Ruim",
    "*3* — Regular",
    "*4* — Bom",
    "*5* — Excelente",
  ].join("\n");
}

async function resolveAttendanceTpl(
  supabase: SB,
  consultantId: string | null,
  key: string,
  fallback: string,
  vars: Record<string, string | number | null | undefined> = {},
): Promise<string> {
  const r = await resolveConsultantMessage(supabase, consultantId, key, vars, fallback);
  return r.text || fallback;
}

export function parseAttendanceRating(input: {
  messageText?: string | null;
  buttonId?: string | null;
}): number | null {
  const bid = String(input.buttonId || "").toLowerCase();
  const mBtn = bid.match(/^rating[_-]?([1-5])$/);
  if (mBtn) return Number(mBtn[1]);

  const raw = String(input.messageText || "").trim();
  // Aceita: "5", "5.", "5!", "5/5", "nota 5", "*5*", etc.
  const mNum = raw.match(/^\*?([1-5])\*?(?:\s*[.!]?|\s*\/\s*5)?$/);
  if (mNum) return Number(mNum[1]);
  const mLoose = raw.match(/^(?:nota|avaliacao|avalia[cç][aã]o|score)?\s*[:\-]?\s*([1-5])(?:\s*\/\s*5)?\s*[.!]?$/i);
  if (mLoose) return Number(mLoose[1]);

  const norm = raw.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (/^(um|uma|muito\s*ruim)$/.test(norm)) return 1;
  if (/^(dois|ruim)$/.test(norm)) return 2;
  if (/^(tres|regular|medio|ok)$/.test(norm)) return 3;
  if (/^(quatro|bom)$/.test(norm)) return 4;
  if (/^(cinco|excelente|otimo)$/.test(norm)) return 5;
  return null;
}

async function resolveConsultantDisplayName(
  supabase: SB,
  consultantId: string | null | undefined,
): Promise<string | null> {
  if (!consultantId) return null;
  const { data } = await supabase
    .from("consultants")
    .select("name, display_name")
    .eq("id", consultantId)
    .maybeSingle();
  const display = String((data as any)?.display_name || "").trim();
  const name = String((data as any)?.name || "").trim();
  // Prefere display_name; se name parece login (sem espaço / minúsculo), usa display.
  if (display) return display.split(/\s+/).slice(0, 2).join(" ");
  if (name && /\s/.test(name)) return name.split(/\s+/).slice(0, 2).join(" ");
  return name || null;
}

/**
 * Resolve canal de saída para atendimento manual.
 * Super admin → Whapi; demais → Evolution da instância do consultor.
 * Respeita origin_* quando já gravado; senão grava o canal correto.
 */
async function resolveAttendanceChannel(
  supabase: SB,
  args: {
    customerId: string;
    consultantId: string | null | undefined;
    env: ChannelEnv;
    superadminConsultantId?: string | null;
  },
): Promise<{ ok: true; channel: ResolvedChannel } | { ok: false; code: string; detail: string }> {
  const { customerId, consultantId, env } = args;
  const isSuper = isSuperAdminConsultant(
    String(consultantId || ""),
    args.superadminConsultantId ?? null,
  );

  // 1) Tenta origin gravado
  let channel = await resolveChannelForCustomer(supabase, customerId, env);
  if (!isUnavailable(channel)) {
    // Se origin aponta Evolution mas é super admin com Whapi, troca para Whapi.
    if (isSuper && channel.kind === "evolution" && env.whapiToken) {
      const adapter = getAdapter({
        kind: "whapi",
        input: { apiToken: env.whapiToken, instanceName: "whapi-superadmin" },
      });
      await supabase.from("customers").update({
        origin_channel: "whapi",
        origin_instance_name: "whapi-superadmin",
      }).eq("id", customerId).then(() => {}, () => {});
      return { ok: true, channel: { kind: "whapi", instanceName: "whapi-superadmin", adapter } };
    }
    return { ok: true, channel };
  }

  // 2) Sem origin / offline → escolhe pelo papel
  if (isSuper) {
    if (!env.whapiToken) {
      return { ok: false, code: "channel_unavailable", detail: "whapi_token_missing" };
    }
    const adapter = getAdapter({
      kind: "whapi",
      input: { apiToken: env.whapiToken, instanceName: "whapi-superadmin" },
    });
    await supabase.from("customers").update({
      origin_channel: "whapi",
      origin_instance_name: "whapi-superadmin",
    }).eq("id", customerId).then(() => {}, () => {});
    return {
      ok: true,
      channel: { kind: "whapi", instanceName: "whapi-superadmin", adapter },
    };
  }

  if (!consultantId) {
    return { ok: false, code: "channel_unavailable", detail: "no_consultant" };
  }
  const fallback = await resolveChannel(supabase, consultantId, env);
  if (!fallback) {
    return { ok: false, code: "channel_unavailable", detail: "no_instance_for_consultant" };
  }
  await supabase.from("customers").update({
    origin_channel: fallback.kind,
    origin_instance_name: fallback.instanceName,
  }).eq("id", customerId).then(() => {}, () => {});
  return { ok: true, channel: fallback };
}

export async function sendWelcomeHeader(
  supabase: SB,
  args: {
    customerId: string;
    env: ChannelEnv;
    consultantId?: string;
    superadminConsultantId?: string | null;
    /** Override — se enviado, substitui greeting+protoBlock por 1 única mensagem. */
    customTemplate?: { text: string; audio_url?: string | null; typing_delay_ms?: number } | null;
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
  // Sempre 55+DDD+número no JID — phone sem DDI (11 dígitos) gerava destino inválido.
  // Não força UPDATE no banco aqui (pode colidir com unique phone+consultant).
  const digits = normalizePhone(String(customer.phone_whatsapp || ""));
  if (!digits || digits.length < 12) return { ok: false, code: "no_phone", skipped: "no_phone" };

  const consultantId = args.consultantId || customer.consultant_id || null;
  const consultantName = await resolveConsultantDisplayName(supabase, consultantId);

  let partnerName: string | null = null;
  if (customer.referral_partner_id) {
    const { data: p } = await supabase
      .from("referral_partners")
      .select("nome")
      .eq("id", customer.referral_partner_id)
      .maybeSingle();
    partnerName = (p as { nome?: string } | null)?.nome ?? null;
  }

  const protoRes = await assignProtocolToCustomer(supabase, customerId, {
    partnerId: customer.referral_partner_id || null,
    partnerName,
    consultantId,
    consultantName,
  });
  // Fallback seguro: se RPC falhar, gera protocolo local (não bloqueia atendimento)
  let protocol = protoRes?.protocol || customer.tracking_protocol || "";
  if (!protocol) {
    const stamp = new Date().toISOString().slice(2, 10).replace(/-/g, "");
    const short = String(customerId).replace(/-/g, "").slice(0, 4).toUpperCase();
    protocol = `IGR-${stamp}-${short}`;
    await supabase.from("customers").update({ tracking_protocol: protocol }).eq("id", customerId)
      .then(() => {}, () => {});
  }

  const resolved = await resolveAttendanceChannel(supabase, {
    customerId,
    consultantId,
    env,
    superadminConsultantId: args.superadminConsultantId,
  });
  if (!resolved.ok) return { ok: false, code: resolved.code, detail: resolved.detail };
  const channel = resolved.channel;

  const quota = await checkSendQuota(supabase, channel.instanceName);
  const bypassQuota = channel.kind === "whapi" ||
    quota.reason === "instance_not_found" ||
    quota.reason === "rpc_error" ||
    quota.reason === "exception";
  if (!quota.allowed && !bypassQuota) {
    return { ok: false, code: "rate_limited", detail: quota.reason };
  }

  const jid = `${digits}@s.whatsapp.net`;

  // ▶ Override — se o consultor personalizou a msg de "abrir chamado", envia ela
  //   como mensagem única (protocolo/nome do consultor já são substituídos via {{var}}).
  if (args.customTemplate && args.customTemplate.text?.trim()) {
    const text = args.customTemplate.text
      .replaceAll("{{protocolo}}", protocol || "")
      .replaceAll("{{ protocolo }}", protocol || "");
    const sendCtxOv = {
      customerId,
      consultantId: consultantId || "",
      stepId: "manual:start_attendance:custom",
      idempotencyKey: `welcome-custom:${customerId}:${Date.now()}`,
      supabase,
    };
    const rr = await channel.adapter.sendText(jid, text, sendCtxOv as never);
    if (!rr.ok) {
      return { ok: false, code: "send_failed_greeting", detail: (rr as { detail?: string }).detail };
    }
    await registerSend(supabase, channel.instanceName).catch(() => {});
    await supabase.from("conversations").insert({
      customer_id: customerId,
      message_direction: "outbound",
      message_text: text,
      message_type: "text",
      conversation_step: "welcome",
    }).then(() => {}, () => {});
    const nowIso = new Date().toISOString();
    // HANDOFF por padrão: bot NÃO segue pra cadastro CPF/RG sozinho.
    // Consultor decide na hora quando reativar a IA (botão IA OFF→ON no header do chat).
    await supabase.from("customers").update({
      welcome_sent_at: nowIso,
      name_ask_sent_at: nowIso,
      conversation_step: "aguardando_humano",
      capture_mode: "manual",
      bot_paused: true,
      bot_paused_reason: "manual_start_attendance",
      bot_paused_at: nowIso,
      assigned_human_id: consultantId,
    }).eq("id", customerId).then(() => {}, () => {});
    return { ok: true, protocol, channel: channel.kind, instance: channel.instanceName };
  }


  const greeting = buildWelcomeHeaderGreeting(consultantName);
  const askName = await resolveAttendanceTpl(
    supabase,
    consultantId,
    "attendance_ask_name",
    NAME_ASK_TEXT,
    { consultor: consultantName, protocolo: protocol },
  );
  const protocolTpl = await resolveAttendanceTpl(
    supabase,
    consultantId,
    "attendance_protocol_block",
    buildWelcomeHeaderProtocol(protocol, consultantName),
    { consultor: consultantName || "", protocolo: protocol },
  );
  const protoBlock = `${protocolTpl}\n\n${askName}`;

  const sendCtx = {
    customerId,
    consultantId: consultantId || "",
    stepId: "manual:start_attendance",
    idempotencyKey: `welcome:${customerId}:${Date.now()}`,
    supabase,
  };

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

  await new Promise((r) => setTimeout(r, 900));

  const r2 = await channel.adapter.sendText(jid, protoBlock, {
    ...sendCtx,
    idempotencyKey: `welcome-proto:${customerId}:${Date.now()}`,
  } as never);
  if (!r2.ok) {
    return { ok: false, code: "send_failed_protocol", detail: (r2 as { detail?: string }).detail };
  }
  await registerSend(supabase, channel.instanceName).catch(() => {});
  await supabase.from("conversations").insert({
    customer_id: customerId,
    message_direction: "outbound",
    message_text: protoBlock,
    message_type: "text",
    conversation_step: "aguardando_humano",
  }).then(() => {}, () => {});

  const now = new Date().toISOString();
  // HANDOFF por padrão: bot NÃO cadastra CPF/RG sozinho depois do nome.
  // Consultor reativa a IA quando quiser pelo botão IA OFF→ON no header do chat.
  await supabase
    .from("customers")
    .update({
      welcome_sent_at: now,
      name_ask_sent_at: now,
      conversation_step: "aguardando_humano",
      capture_mode: "manual",
      capture_started_at: now,
      tracking_protocol: protocol,
      bot_paused: true,
      bot_paused_reason: "manual_start_attendance",
      bot_paused_at: now,
      assigned_human_id: consultantId,
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

export async function sendAttendanceRatingRequest(
  supabase: SB,
  args: {
    customerId: string;
    env: ChannelEnv;
    consultantId?: string;
    superadminConsultantId?: string | null;
  },
): Promise<EndAttendanceResult> {
  const { customerId, env } = args;

  const { data: customer } = await supabase
    .from("customers")
    .select(
      "id, phone_whatsapp, consultant_id, welcome_sent_at, tracking_protocol, attendance_rating, attendance_rating_requested_at",
    )
    .eq("id", customerId)
    .maybeSingle();

  if (!customer) return { ok: false, code: "customer_not_found" };
  if (!customer.welcome_sent_at) return { ok: false, code: "attendance_not_started" };
  if (customer.attendance_rating != null) return { ok: true, skipped: "already_rated" };
  if (customer.attendance_rating_requested_at) return { ok: true, skipped: "rating_pending" };

  const digits = normalizePhone(String(customer.phone_whatsapp || ""));
  if (!digits || digits.length < 12) return { ok: false, code: "no_phone", skipped: "no_phone" };

  const consultantId = args.consultantId || customer.consultant_id || null;
  const resolved = await resolveAttendanceChannel(supabase, {
    customerId,
    consultantId,
    env,
    superadminConsultantId: args.superadminConsultantId,
  });
  if (!resolved.ok) return { ok: false, code: resolved.code, detail: resolved.detail };
  const channel = resolved.channel;

  const jid = `${digits}@s.whatsapp.net`;
  const sendCtx = {
    customerId,
    consultantId: consultantId || "",
    stepId: "manual:end_attendance",
    idempotencyKey: `attendance-end:${customerId}:${Date.now()}`,
    supabase,
  };

  const closing = await resolveAttendanceTpl(
    supabase,
    consultantId,
    "attendance_closing",
    buildAttendanceClosingText(),
  );
  const r1 = await channel.adapter.sendText(jid, closing, sendCtx as never);
  if (!r1.ok) {
    return { ok: false, code: "send_failed_closing", detail: (r1 as { detail?: string }).detail };
  }
  await registerSend(supabase, channel.instanceName).catch(() => {});
  await supabase.from("conversations").insert({
    customer_id: customerId,
    message_direction: "outbound",
    message_text: closing,
    message_type: "text",
    conversation_step: ATTENDANCE_RATING_STEP,
  }).then(() => {}, () => {});

  await new Promise((r) => setTimeout(r, 900));

  const prompt = await resolveAttendanceTpl(
    supabase,
    consultantId,
    "attendance_rating_prompt",
    buildAttendanceRatingPrompt(),
  );
  const r2 = await channel.adapter.sendText(jid, prompt, {
    ...sendCtx,
    idempotencyKey: `attendance-rating:${customerId}:${Date.now()}`,
  } as never);
  if (!r2.ok) {
    return { ok: false, code: "send_failed_rating", detail: (r2 as { detail?: string }).detail };
  }
  await registerSend(supabase, channel.instanceName).catch(() => {});
  await supabase.from("conversations").insert({
    customer_id: customerId,
    message_direction: "outbound",
    message_text: prompt,
    message_type: "text",
    conversation_step: ATTENDANCE_RATING_STEP,
  }).then(() => {}, () => {});

  const now = new Date().toISOString();
  // Mantém bot "ativo" só para o intercept da nota no webhook; o restante
  // do pipeline é bloqueado pelo early-return em tryInterceptAttendanceRating.
  // Após a nota, o intercept seta bot_paused=true + step atendimento_finalizado.
  await supabase
    .from("customers")
    .update({
      attendance_ended_at: now,
      attendance_rating_requested_at: now,
      conversation_step: ATTENDANCE_RATING_STEP,
      bot_paused: false,
      bot_paused_reason: null,
      bot_paused_until: null,
      bot_paused_at: null,
    })
    .eq("id", customerId)
    .then(() => {}, () => {});

  return { ok: true };
}

export function buildAttendanceThanksText(rating: number): string {
  return [
    `Obrigado pela avaliação *${rating}/5*! ⭐💚`,
    "",
    "Sua opinião nos ajuda a melhorar cada vez mais. 🙌",
    "Foi um prazer te atender — qualquer coisa, é só chamar! 😊",
  ].join("\n");
}

export function buildAttendanceRatingRetryText(): string {
  return [
    "Pra eu registrar certinho, responde só com um número de *1* a *5* 🙂",
    "",
    "*1* — Muito ruim 😞",
    "*2* — Ruim 😕",
    "*3* — Regular 😐",
    "*4* — Bom 🙂",
    "*5* — Excelente 🤩",
  ].join("\n");
}

/** Quando o cliente manda PDF/foto/áudio no passo da nota — não trava, só orienta. */
export function buildAttendanceRatingMediaHintText(): string {
  return [
    "Recebi seu arquivo 📎🙂",
    "",
    "Pra finalizar, me responde só com a *nota* de *1* a *5* do atendimento:",
    "",
    "*1* — Muito ruim 😞",
    "*2* — Ruim 😕",
    "*3* — Regular 😐",
    "*4* — Bom 🙂",
    "*5* — Excelente 🤩",
  ].join("\n");
}

function normalizeAttendanceStep(raw: string | null | undefined): string {
  return String(raw || "")
    .replace(/^flow:/, "")
    .replace(/^passo_/, "");
}

/** True se o lead está aguardando digitar a nota (step ou flag pedida sem nota). */
export function isAwaitingAttendanceRating(customer: {
  conversation_step?: string | null;
  attendance_rating?: number | null;
  attendance_rating_requested_at?: string | null;
}): boolean {
  if (customer.attendance_rating != null) return false;
  const step = normalizeAttendanceStep(customer.conversation_step);
  if (step === ATTENDANCE_RATING_STEP) return true;
  return !!customer.attendance_rating_requested_at;
}

/** True se a nota já foi registrada (ou step terminal pós-nota). */
export function isAttendanceDone(customer: {
  conversation_step?: string | null;
  attendance_rating?: number | null;
}): boolean {
  if (customer.attendance_rating != null) return true;
  return normalizeAttendanceStep(customer.conversation_step) === ATTENDANCE_DONE_STEP;
}

/**
 * True se crons/nudges NÃO devem mexer no lead:
 * aguardando nota, já avaliado, ou step terminal de atendimento.
 */
export function isAttendanceTerminalStep(
  conversationStep: string | null | undefined,
): boolean {
  return ATTENDANCE_TERMINAL_STEPS.has(normalizeAttendanceStep(conversationStep));
}

export interface AttendanceRatingInterceptArgs {
  supabase: SB;
  customer: {
    id: string;
    consultant_id?: string | null;
    conversation_step?: string | null;
    attendance_rating?: number | null;
    attendance_rating_requested_at?: string | null;
  };
  remoteJid: string;
  messageText?: string | null;
  buttonId?: string | null;
  /** PDF/foto/áudio/vídeo — nunca entra em OCR/bot no passo da nota. */
  isMedia?: boolean;
  mediaKind?: "document" | "image" | "audio" | "video" | "file" | null;
  /** Se true, não grava inbound (webhook já logou). */
  skipInboundLog?: boolean;
  sendText: (jid: string, text: string) => Promise<boolean>;
}

export async function tryInterceptAttendanceRating(
  args: AttendanceRatingInterceptArgs,
): Promise<{ intercepted: boolean; rating?: number; invalid?: boolean; media?: boolean }> {
  if (!isAwaitingAttendanceRating(args.customer)) {
    return { intercepted: false };
  }

  const rating = parseAttendanceRating({
    messageText: args.messageText,
    buttonId: args.buttonId,
  });

  const inboundText = String(args.messageText || args.buttonId || "").slice(0, 200);
  const isMediaOnly = !!args.isMedia && !rating;

  // PDF/foto/áudio no passo da nota: NÃO trava, NÃO roda OCR — só pede a nota.
  if (isMediaOnly) {
    const kind = args.mediaKind || "file";
    const label = kind === "document" ? "[documento/pdf]"
      : kind === "image" ? "[imagem]"
      : kind === "audio" ? "[áudio]"
      : kind === "video" ? "[vídeo]"
      : "[arquivo]";
    if (!args.skipInboundLog) {
      await args.supabase.from("conversations").insert({
        customer_id: args.customer.id,
        message_direction: "inbound",
        message_text: inboundText || label,
        message_type: kind === "document" ? "document" : (kind === "image" ? "image" : "text"),
        conversation_step: ATTENDANCE_RATING_STEP,
      }).then(() => {}, () => {});
    }
    const hint = await resolveAttendanceTpl(
      args.supabase,
      args.customer.consultant_id || null,
      "attendance_rating_media_hint",
      buildAttendanceRatingMediaHintText(),
    );
    try {
      await args.sendText(args.remoteJid, hint);
      await args.supabase.from("conversations").insert({
        customer_id: args.customer.id,
        message_direction: "outbound",
        message_text: hint,
        message_type: "text",
        conversation_step: ATTENDANCE_RATING_STEP,
      }).then(() => {}, () => {});
    } catch (_) { /* best-effort */ }
    await args.supabase.from("customers").update({
      conversation_step: ATTENDANCE_RATING_STEP,
      bot_paused: false,
      bot_paused_reason: null,
      bot_paused_until: null,
      updated_at: new Date().toISOString(),
    }).eq("id", args.customer.id).then(() => {}, () => {});
    return { intercepted: true, invalid: true, media: true };
  }

  // Resposta inválida no passo da nota: re-pede e NÃO deixa o bot genérico falar.
  if (!rating) {
    if (!args.skipInboundLog && inboundText) {
      await args.supabase.from("conversations").insert({
        customer_id: args.customer.id,
        message_direction: "inbound",
        message_text: inboundText,
        message_type: "text",
        conversation_step: ATTENDANCE_RATING_STEP,
      }).then(() => {}, () => {});
    }
    const retry = await resolveAttendanceTpl(
      args.supabase,
      args.customer.consultant_id || null,
      "attendance_rating_retry",
      buildAttendanceRatingRetryText(),
    );
    try {
      await args.sendText(args.remoteJid, retry);
      await args.supabase.from("conversations").insert({
        customer_id: args.customer.id,
        message_direction: "outbound",
        message_text: retry,
        message_type: "text",
        conversation_step: ATTENDANCE_RATING_STEP,
      }).then(() => {}, () => {});
    } catch (_) { /* best-effort */ }
    // Garante step correto caso tenha sido apagado por re-welcome.
    await args.supabase.from("customers").update({
      conversation_step: ATTENDANCE_RATING_STEP,
      updated_at: new Date().toISOString(),
    }).eq("id", args.customer.id).then(() => {}, () => {});
    return { intercepted: true, invalid: true };
  }

  if (!args.skipInboundLog) {
    await args.supabase.from("conversations").insert({
      customer_id: args.customer.id,
      message_direction: "inbound",
      message_text: inboundText || String(rating),
      message_type: "text",
      conversation_step: ATTENDANCE_RATING_STEP,
    }).then(() => {}, () => {});
  }

  const now = new Date().toISOString();
  const { error: saveErr } = await args.supabase
    .from("customers")
    .update({
      attendance_rating: rating,
      attendance_rating_at: now,
      conversation_step: ATTENDANCE_DONE_STEP,
      bot_paused: true,
      bot_paused_reason: "attendance_rated",
      bot_paused_at: now,
      bot_paused_until: null,
      updated_at: now,
    })
    .eq("id", args.customer.id);

  if (saveErr) {
    console.error("[attendance-rating] falha ao salvar nota:", saveErr.message);
    // Ainda assim tenta agradecer; o consultor vê no painel se a coluna falhou.
  }

  const thanks = await resolveAttendanceTpl(
    args.supabase,
    args.customer.consultant_id || null,
    "attendance_rating_thanks",
    buildAttendanceThanksText(rating),
    { nota: rating },
  );
  try {
    await args.sendText(args.remoteJid, thanks);
    await args.supabase.from("conversations").insert({
      customer_id: args.customer.id,
      message_direction: "outbound",
      message_text: thanks,
      message_type: "text",
      conversation_step: ATTENDANCE_DONE_STEP,
    }).then(() => {}, () => {});
  } catch (e) {
    console.error("[attendance-rating] falha ao enviar thanks:", (e as Error)?.message);
  }

  return { intercepted: true, rating };
}
