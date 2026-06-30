// Shared resolver + sender for Evolution/Whapi.
// Extracted from crm-auto-progress so pos-venda-auto-progress can reuse the
// same battle-tested pipeline (anti-ban, quiet hours, voice templates).

import { checkSendQuota, registerSend } from "./anti-ban.ts";
import { getAdapter, type ChannelAdapter, type SendContext } from "./channels/index.ts";

export interface ChannelEnv {
  evolutionUrl: string | undefined;
  evolutionKey: string | undefined;
  whapiToken: string;
}

export interface ResolvedChannel {
  kind: "evolution" | "whapi";
  instanceName: string;
  adapter: ChannelAdapter;
}

/**
 * @deprecated Para envios a CLIENTE finais, use `resolveChannelForCustomer`.
 * Não checa saúde da instância — use só para notificar o próprio consultor
 * ou fluxos sem `customerId`.
 */
export async function resolveChannel(
  supabase: any,
  consultantId: string,
  env: ChannelEnv,
): Promise<ResolvedChannel | null> {
  const { data: instance } = await supabase
    .from("whatsapp_instances")
    .select("instance_name")
    .eq("consultant_id", consultantId)
    .limit(1)
    .maybeSingle();

  if (instance?.instance_name && env.evolutionUrl && env.evolutionKey) {
    const adapter = getAdapter({
      kind: "evolution",
      input: {
        apiUrl: env.evolutionUrl,
        apiKey: env.evolutionKey,
        instanceName: instance.instance_name,
      },
    });
    return { kind: "evolution", instanceName: instance.instance_name, adapter };
  }

  if (env.whapiToken) {
    const adapter = getAdapter({
      kind: "whapi",
      input: { apiToken: env.whapiToken, instanceName: "whapi-superadmin" },
    });
    return { kind: "whapi", instanceName: "whapi-superadmin", adapter };
  }

  return null;
}

export type ChannelUnavailableReason =
  | "no_origin_recorded"
  | "instance_not_found"
  | "instance_offline"
  | "instance_locked"
  | "manual_review_required"
  | "missing_credentials";

export interface UnavailableChannel {
  unavailable: true;
  reason: ChannelUnavailableReason;
  detail: string;
  instanceName: string | null;
  kind: "evolution" | "whapi" | null;
}

const HEALTHY_STATUSES = new Set(["connected", "online", "open"]);

/**
 * Resolve o canal de saída para um cliente, respeitando origin_channel +
 * origin_instance_name gravados no primeiro inbound. NUNCA troca de canal
 * automaticamente: se a instância está offline, devolve `unavailable`.
 */
export async function resolveChannelForCustomer(
  supabase: any,
  customerId: string,
  env: ChannelEnv,
): Promise<ResolvedChannel | UnavailableChannel> {
  const { data: c } = await supabase
    .from("customers")
    .select("origin_channel, origin_instance_name, consultant_id")
    .eq("id", customerId)
    .maybeSingle();

  const kind = (c?.origin_channel as "evolution" | "whapi" | null) || null;
  const instanceName = (c?.origin_instance_name as string | null) || null;

  if (!kind || !instanceName) {
    return {
      unavailable: true, reason: "no_origin_recorded",
      detail: "customer sem origin_channel/origin_instance_name",
      instanceName, kind,
    };
  }

  if (kind === "evolution") {
    if (!env.evolutionUrl || !env.evolutionKey) {
      return {
        unavailable: true, reason: "missing_credentials",
        detail: "EVOLUTION_API_URL/KEY ausentes", instanceName, kind,
      };
    }
    const { data: inst } = await supabase
      .from("whatsapp_instances")
      .select("status, manual_review_required, fatal_lock_until")
      .eq("instance_name", instanceName)
      .maybeSingle();
    if (!inst) {
      return {
        unavailable: true, reason: "instance_not_found",
        detail: `instância ${instanceName} não cadastrada`, instanceName, kind,
      };
    }
    if (inst.manual_review_required) {
      return {
        unavailable: true, reason: "manual_review_required",
        detail: `instância ${instanceName} em revisão manual`, instanceName, kind,
      };
    }
    if (inst.fatal_lock_until && new Date(inst.fatal_lock_until) > new Date()) {
      return {
        unavailable: true, reason: "instance_locked",
        detail: `instância ${instanceName} travada até ${inst.fatal_lock_until}`,
        instanceName, kind,
      };
    }
    const status = String(inst.status || "").toLowerCase();
    if (status && !HEALTHY_STATUSES.has(status)) {
      return {
        unavailable: true, reason: "instance_offline",
        detail: `instância ${instanceName} status=${status}`, instanceName, kind,
      };
    }
    const adapter = getAdapter({
      kind: "evolution",
      input: { apiUrl: env.evolutionUrl, apiKey: env.evolutionKey, instanceName },
    });
    return { kind: "evolution", instanceName, adapter };
  }

  // kind === "whapi" — superadmin token compartilhado, sem health-check próprio.
  if (!env.whapiToken) {
    return {
      unavailable: true, reason: "missing_credentials",
      detail: "WHAPI_TOKEN ausente", instanceName, kind,
    };
  }
  const adapter = getAdapter({
    kind: "whapi",
    input: { apiToken: env.whapiToken, instanceName },
  });
  return { kind: "whapi", instanceName, adapter };
}

export function isUnavailable(
  ch: ResolvedChannel | UnavailableChannel | null,
): ch is UnavailableChannel {
  return !!ch && (ch as UnavailableChannel).unavailable === true;
}

async function guardOk(supabase: any, instanceName: string, label: string): Promise<boolean> {
  const quota = await checkSendQuota(supabase, instanceName);
  if (!quota.allowed) {
    console.warn(`🚫 [channel-sender:${label}] bloqueado ${instanceName} reason=${quota.reason}`);
    return false;
  }
  return true;
}

export function ctx(consultantId: string, customerId: string, stage: string): SendContext {
  return {
    customerId: customerId || "auto-progress",
    consultantId,
    stepId: `auto_progress:${stage}`,
    idempotencyKey: `${consultantId}:${customerId}:${stage}:${Date.now()}`,
  };
}

async function sendText(
  supabase: any,
  channel: ResolvedChannel,
  jid: string,
  text: string,
  sendCtx: SendContext,
): Promise<boolean> {
  if (!(await guardOk(supabase, channel.instanceName, "text"))) return false;
  try {
    const r = await channel.adapter.sendText(jid, text, { ...sendCtx, supabase });
    if (!r.ok) {
      console.error(`[${channel.kind}] sendText falhou:`, (r as any).detail);
      return false;
    }
    await registerSend(supabase, channel.instanceName);
    return true;
  } catch (e) {
    console.error(`[${channel.kind}] sendText exception:`, (e as Error)?.message);
    return false;
  }
}

async function sendMedia(
  supabase: any,
  channel: ResolvedChannel,
  jid: string,
  url: string,
  caption: string,
  kind: "image" | "video" | "document",
  sendCtx: SendContext,
): Promise<boolean> {
  if (!(await guardOk(supabase, channel.instanceName, kind))) return false;
  const media =
    kind === "document"
      ? { kind, url, filename: "arquivo", caption }
      : { kind, url, caption };
  try {
    const r = await channel.adapter.sendMedia(jid, media as any, sendCtx);
    if (!r.ok) {
      console.error(`[${channel.kind}] sendMedia(${kind}) falhou:`, (r as any).detail);
      return false;
    }
    await registerSend(supabase, channel.instanceName);
    return true;
  } catch (e) {
    console.error(`[${channel.kind}] sendMedia(${kind}) exception:`, (e as Error)?.message);
    return false;
  }
}

async function sendAudio(
  supabase: any,
  channel: ResolvedChannel,
  jid: string,
  url: string,
  sendCtx: SendContext,
): Promise<boolean> {
  if (!(await guardOk(supabase, channel.instanceName, "audio"))) return false;
  try {
    const r = await channel.adapter.sendMedia(jid, { kind: "audio", url, ptt: true }, sendCtx);
    if (!r.ok) {
      console.error(`[${channel.kind}] sendAudio falhou:`, (r as any).detail);
      return false;
    }
    await registerSend(supabase, channel.instanceName);
    return true;
  } catch (e) {
    console.error(`[${channel.kind}] sendAudio exception:`, (e as Error)?.message);
    return false;
  }
}

async function sendAudioWithRetry(
  supabase: any,
  channel: ResolvedChannel,
  jid: string,
  url: string,
  sendCtx: SendContext,
): Promise<boolean> {
  const ok = await sendAudio(supabase, channel, jid, url, sendCtx);
  if (ok) return true;
  if (channel.kind !== "evolution") return false;
  // Evolution: 1 retry leve com backoff curto (áudio .ogg falha intermitente).
  await new Promise((r) => setTimeout(r, 1500));
  return await sendAudio(supabase, channel, jid, url, sendCtx);
}


async function renderVoiceTemplate(
  supabase: any,
  voiceTemplateId: string,
  name: string,
): Promise<string | null> {
  try {
    const { data, error } = await supabase.functions.invoke("voice-template-stitch", {
      body: { action: "render", template_id: voiceTemplateId, name: name || "", variables: {} },
    });
    if (error) return null;
    if ((data as any)?.error) return null;
    return (data as any)?.url || null;
  } catch {
    return null;
  }
}

interface MsgConfig {
  message_type: string;
  message_text: string | null;
  media_url: string | null;
  image_url: string | null;
  voice_template_id?: string | null;
}

async function sendSingleMessage(
  supabase: any,
  channel: ResolvedChannel,
  jid: string,
  phone: string,
  msg: MsgConfig,
  sendCtx: SendContext,
  customerName?: string,
): Promise<string> {
  const displayName = customerName || phone;
  const messageText = (msg.message_text || "")
    .replace(/\{\{nome\}\}/g, displayName)
    .replace(/\{\{telefone\}\}/g, phone);
  const msgType = msg.message_type || "text";

  if (msg.image_url && msgType !== "image") {
    await sendMedia(supabase, channel, jid, msg.image_url, "", "image", sendCtx);
  }

  let audioUrl = msg.media_url;
  if (msgType === "audio" && msg.voice_template_id) {
    const rendered = await renderVoiceTemplate(supabase, msg.voice_template_id, customerName || "");
    if (rendered) audioUrl = rendered;
  }

  if (msgType === "audio" && audioUrl) {
    await sendAudio(supabase, channel, jid, audioUrl, sendCtx);
    if (messageText) await sendText(supabase, channel, jid, messageText, sendCtx);
  } else if (msgType === "image" && msg.media_url) {
    await sendMedia(supabase, channel, jid, msg.media_url, messageText, "image", sendCtx);
  } else if (msgType === "video" && msg.media_url) {
    await sendMedia(supabase, channel, jid, msg.media_url, messageText, "video", sendCtx);
  } else if (messageText) {
    await sendText(supabase, channel, jid, messageText, sendCtx);
  }

  return messageText || "[mídia]";
}

export async function sendStageAutoMessages(
  supabase: any,
  channel: ResolvedChannel,
  jid: string,
  phone: string,
  stageData: any,
  consultantId: string,
  customerId: string,
  rejectionReason?: string | null,
  dealOrigin?: string | null,
  customerName?: string,
): Promise<string> {
  const sendCtx = ctx(consultantId, customerId, stageData.stage_key);

  const { data: multiMsgs } = await supabase
    .from("stage_auto_messages")
    .select("*")
    .eq("stage_id", stageData.id)
    .order("position", { ascending: true });

  const filtered = (multiMsgs || []).filter((m: any) => {
    const reasonMatch = !m.rejection_reason || m.rejection_reason === rejectionReason;
    const originMatch = !m.deal_origin || m.deal_origin === dealOrigin;
    return reasonMatch && originMatch;
  });

  let preview = "";

  if (filtered.length > 0) {
    for (let i = 0; i < filtered.length; i++) {
      const msg = filtered[i];
      if (i > 0 && msg.delay_seconds > 0) {
        await new Promise((r) => setTimeout(r, msg.delay_seconds * 1000));
      }
      preview = await sendSingleMessage(supabase, channel, jid, phone, msg, sendCtx, customerName);
    }
  } else {
    const hasContent = stageData.auto_message_text || stageData.auto_message_media_url || stageData.auto_message_image_url;
    if (!hasContent) return "";
    preview = await sendSingleMessage(supabase, channel, jid, phone, {
      message_type: stageData.auto_message_type,
      message_text: stageData.auto_message_text,
      media_url: stageData.auto_message_media_url,
      image_url: stageData.auto_message_image_url,
    }, sendCtx, customerName);
  }

  return preview;
}

export function isValidJid(jid: string): boolean {
  if (!jid) return false;
  if (jid === "status@broadcast") return false;
  if (/sem_celular/i.test(jid)) return false;
  const phone = jid.split("@")[0];
  return phone.replace(/\D/g, "").length >= 8;
}

export function normalizePhone(raw: string): string {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.startsWith("55") && digits.length >= 12) return digits;
  if (digits.length === 11) return `55${digits}`;
  if (digits.length === 10) return `55${digits}`;
  return digits;
}

export function toJid(raw: string): string {
  if (!raw) return raw;
  if (raw.includes("@")) return raw;
  return `${normalizePhone(raw)}@s.whatsapp.net`;
}
