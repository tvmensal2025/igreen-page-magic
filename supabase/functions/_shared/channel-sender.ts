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

/**
 * Resolve canal do lead; se origem offline, tenta failover Evolution↔Whapi
 * do mesmo consultor (plano Zero Lead Perdido — não perder o toque do dia).
 */
export async function resolveChannelForCustomerWithFailover(
  supabase: any,
  customerId: string,
  env: ChannelEnv,
): Promise<ResolvedChannel | UnavailableChannel> {
  const primary = await resolveChannelForCustomer(supabase, customerId, env);
  if (!isUnavailable(primary)) return primary;

  const { data: c } = await supabase
    .from("customers")
    .select("consultant_id, origin_channel")
    .eq("id", customerId)
    .maybeSingle();
  const consultantId = c?.consultant_id as string | null;
  if (!consultantId) return primary;

  const originKind = (c?.origin_channel as string | null) || null;

  // Failover → Evolution saudável do consultor
  if (originKind !== "evolution" && env.evolutionUrl && env.evolutionKey) {
    const { data: inst } = await supabase
      .from("whatsapp_instances")
      .select("instance_name, status, manual_review_required, fatal_lock_until")
      .eq("consultant_id", consultantId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const status = String(inst?.status || "").toLowerCase();
    if (
      inst?.instance_name &&
      !inst.manual_review_required &&
      !(inst.fatal_lock_until && new Date(inst.fatal_lock_until) > new Date()) &&
      (!status || HEALTHY_STATUSES.has(status))
    ) {
      const adapter = getAdapter({
        kind: "evolution",
        input: {
          apiUrl: env.evolutionUrl,
          apiKey: env.evolutionKey,
          instanceName: inst.instance_name,
        },
      });
      return { kind: "evolution", instanceName: inst.instance_name, adapter };
    }
  }

  // Failover → Whapi
  if (originKind !== "whapi" && env.whapiToken) {
    const adapter = getAdapter({
      kind: "whapi",
      input: { apiToken: env.whapiToken, instanceName: "whapi-failover" },
    });
    return { kind: "whapi", instanceName: "whapi-failover", adapter };
  }

  // Sem origin: tentar qualquer canal saudável
  if (!originKind) {
    const legacy = await resolveChannel(supabase, consultantId, env);
    if (legacy) return legacy;
  }

  return primary;
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

export interface SendResult {
  preview: string;
  image_ok: boolean | null;  // null = não havia imagem
  audio_ok: boolean | null;  // null = não havia áudio
  text_ok: boolean | null;   // null = não havia texto
}

function emptyResult(): SendResult {
  return { preview: "", image_ok: null, audio_ok: null, text_ok: null };
}

export function formatSendStatus(r: SendResult): { status: string; tag: string } {
  const parts: string[] = [];
  if (r.image_ok !== null) parts.push(`img:${r.image_ok ? "ok" : "fail"}`);
  if (r.audio_ok !== null) parts.push(`audio:${r.audio_ok ? "ok" : "fail"}`);
  if (r.text_ok !== null) parts.push(`text:${r.text_ok ? "ok" : "fail"}`);
  const tag = parts.length ? `[${parts.join("|")}]` : "";

  const fails: string[] = [];
  if (r.image_ok === false) fails.push("image");
  if (r.audio_ok === false) fails.push("audio");
  if (r.text_ok === false) fails.push("text");
  const total = [r.image_ok, r.audio_ok, r.text_ok].filter((v) => v !== null).length;
  if (total === 0) return { status: "no_content", tag };
  if (fails.length === 0) return { status: "sent", tag };
  if (fails.length === total) return { status: "failed", tag };
  return { status: `partial:${fails.join("+")}_missing`, tag };
}

async function sendSingleMessage(
  supabase: any,
  channel: ResolvedChannel,
  jid: string,
  phone: string,
  msg: MsgConfig,
  sendCtx: SendContext,
  customerName?: string,
): Promise<SendResult> {
  const displayName = customerName || phone;
  const messageText = (msg.message_text || "")
    .replace(/\{\{nome\}\}/g, displayName)
    .replace(/\{\{telefone\}\}/g, phone);
  const msgType = msg.message_type || "text";

  const result: SendResult = emptyResult();

  // Imagem "extra" quando msgType=audio com image_url anexada.
  if (msg.image_url && msgType !== "image") {
    result.image_ok = await sendMedia(supabase, channel, jid, msg.image_url, "", "image", sendCtx);
  }

  let audioUrl = msg.media_url;
  if (msgType === "audio" && msg.voice_template_id) {
    const rendered = await renderVoiceTemplate(supabase, msg.voice_template_id, customerName || "");
    if (rendered) audioUrl = rendered;
  }

  if (msgType === "audio" && audioUrl) {
    result.audio_ok = await sendAudioWithRetry(supabase, channel, jid, audioUrl, sendCtx);
    // Fallback: se áudio falhou definitivamente, manda link curto para o cliente
    // ainda conseguir ouvir (sem trocar de canal).
    if (result.audio_ok === false) {
      await sendText(supabase, channel, jid, `🎧 Áudio: ${audioUrl}`, sendCtx);
    }
    if (messageText) {
      result.text_ok = await sendText(supabase, channel, jid, messageText, sendCtx);
    }
  } else if (msgType === "image" && msg.media_url) {
    result.image_ok = await sendMedia(supabase, channel, jid, msg.media_url, messageText, "image", sendCtx);
    if (messageText) result.text_ok = result.image_ok; // caption embutido
  } else if (msgType === "video" && msg.media_url) {
    const ok = await sendMedia(supabase, channel, jid, msg.media_url, messageText, "video", sendCtx);
    result.image_ok = ok;
    if (messageText) result.text_ok = ok;
  } else if (messageText) {
    result.text_ok = await sendText(supabase, channel, jid, messageText, sendCtx);
  }

  result.preview = messageText || "[mídia]";
  return result;
}

function mergeResults(a: SendResult, b: SendResult): SendResult {
  const merge = (x: boolean | null, y: boolean | null): boolean | null => {
    if (x === null) return y;
    if (y === null) return x;
    return x && y;
  };
  return {
    preview: b.preview || a.preview,
    image_ok: merge(a.image_ok, b.image_ok),
    audio_ok: merge(a.audio_ok, b.audio_ok),
    text_ok: merge(a.text_ok, b.text_ok),
  };
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
): Promise<SendResult> {
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

  let acc: SendResult = emptyResult();

  if (filtered.length > 0) {
    for (let i = 0; i < filtered.length; i++) {
      const msg = filtered[i];
      if (i > 0 && msg.delay_seconds > 0) {
        await new Promise((r) => setTimeout(r, msg.delay_seconds * 1000));
      }
      const r = await sendSingleMessage(supabase, channel, jid, phone, msg, sendCtx, customerName);
      acc = mergeResults(acc, r);
    }
  } else {
    const hasContent = stageData.auto_message_text || stageData.auto_message_media_url || stageData.auto_message_image_url;
    if (!hasContent) return acc;
    acc = await sendSingleMessage(supabase, channel, jid, phone, {
      message_type: stageData.auto_message_type,
      message_text: stageData.auto_message_text,
      media_url: stageData.auto_message_media_url,
      image_url: stageData.auto_message_image_url,
    }, sendCtx, customerName);
  }

  return acc;
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
