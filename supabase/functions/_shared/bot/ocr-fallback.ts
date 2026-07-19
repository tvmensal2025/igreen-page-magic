/**
 * Fallback OCR (conta / documento): texto editável no Multicanal + áudio opcional.
 * Gravação: bot_flow_steps.fallback { mode: "retry", retry_text, retry_audio_clip_id }.
 */

export interface OcrFallbackResult {
  retryText: string;
  escalate: boolean;
  /** Clip Sofia opcional (voice_audio_clips.id) — Multicanal 5b/6b. */
  retryAudioClipId: string | null;
}

type SendMediaFn = (
  jid: string,
  url: string,
  caption: string,
  kind: string,
  durationSec?: number,
) => Promise<unknown>;

type SendTextFn = (jid: string, text: string) => Promise<unknown>;

/**
 * Lê fallback do passo capture_conta / capture_documento no fluxo ativo da variante.
 * Sem mode=retry → devolve defaultRetryText (fail-safe hardcoded).
 */
export async function resolveOcrFallback(
  supabase: any,
  customerId: string,
  consultantId: string | null | undefined,
  stepType: "capture_conta" | "capture_documento",
  attempts: number,
  defaultRetryText: string,
  flowVariant?: string | null,
): Promise<OcrFallbackResult> {
  try {
    if (!consultantId) {
      return { retryText: defaultRetryText, escalate: false, retryAudioClipId: null };
    }
    const variant = String(flowVariant || "A").toUpperCase();
    let flowQ = supabase
      .from("bot_flows")
      .select("id")
      .eq("consultant_id", consultantId)
      .eq("is_active", true)
      .eq("variant", variant)
      .order("created_at", { ascending: true })
      .limit(1);
    let { data: flow } = await flowQ.maybeSingle();
    if (!flow?.id) {
      const { data: anyFlow } = await supabase
        .from("bot_flows")
        .select("id")
        .eq("consultant_id", consultantId)
        .eq("is_active", true)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      flow = anyFlow;
    }
    if (!flow?.id) {
      return { retryText: defaultRetryText, escalate: false, retryAudioClipId: null };
    }
    const { data: stepRow } = await supabase
      .from("bot_flow_steps")
      .select("fallback")
      .eq("flow_id", flow.id)
      .eq("step_type", stepType)
      .eq("is_active", true)
      .order("position", { ascending: true })
      .limit(1)
      .maybeSingle();
    const fb = (stepRow as any)?.fallback;
    if (!fb || fb.mode !== "retry") {
      return { retryText: defaultRetryText, escalate: false, retryAudioClipId: null };
    }
    const maxRetries = Math.max(1, Number(fb.max_retries ?? 2));
    const retryText = String(fb.retry_text || defaultRetryText);
    const escalate = attempts >= maxRetries && String(fb.then || "") === "humano";
    const clipRaw = fb.retry_audio_clip_id;
    const retryAudioClipId =
      clipRaw && String(clipRaw).trim() ? String(clipRaw).trim() : null;
    return { retryText, escalate, retryAudioClipId };
  } catch (e) {
    console.warn("[resolveOcrFallback] erro:", (e as any)?.message);
    return { retryText: defaultRetryText, escalate: false, retryAudioClipId: null };
  }
}

/** Resolve URL do clip em voice_audio_clips. */
export async function resolveVoiceClipAudioUrl(
  supabase: any,
  clipId: string | null | undefined,
): Promise<{ url: string; durationSec: number | null } | null> {
  if (!clipId) return null;
  try {
    const { data } = await supabase
      .from("voice_audio_clips")
      .select("audio_url, duration_sec")
      .eq("id", clipId)
      .maybeSingle();
    const url = String((data as any)?.audio_url || "").trim();
    if (!url) return null;
    const durationSec = Number((data as any)?.duration_sec || 0) || null;
    return { url, durationSec };
  } catch (e) {
    console.warn("[resolveVoiceClipAudioUrl]", (e as any)?.message);
    return null;
  }
}

/**
 * Envia texto de retry OCR e, se houver clip, o áudio em seguida.
 * Retorna true se enviou algo inline (caller deve zerar reply / marcar __inline_sent).
 */
export async function sendOcrRetryMessage(opts: {
  supabase: any;
  remoteJid: string;
  customerId: string;
  conversationStep: string;
  text: string;
  retryAudioClipId: string | null;
  sendText: SendTextFn;
  sendMedia: SendMediaFn;
}): Promise<boolean> {
  const {
    supabase,
    remoteJid,
    customerId,
    conversationStep,
    text,
    retryAudioClipId,
    sendText,
    sendMedia,
  } = opts;

  const msg = String(text || "").trim();
  if (!msg && !retryAudioClipId) return false;

  if (msg) {
    try {
      await sendText(remoteJid, msg);
      await supabase.from("conversations").insert({
        customer_id: customerId,
        message_direction: "outbound",
        message_text: msg,
        message_type: "text",
        conversation_step: conversationStep,
      });
    } catch (e) {
      console.warn("[sendOcrRetryMessage] texto:", (e as any)?.message);
    }
  }

  if (retryAudioClipId) {
    const clip = await resolveVoiceClipAudioUrl(supabase, retryAudioClipId);
    if (clip?.url) {
      try {
        await sendMedia(
          remoteJid,
          clip.url,
          "",
          "audio",
          clip.durationSec || undefined,
        );
        await supabase.from("conversations").insert({
          customer_id: customerId,
          message_direction: "outbound",
          message_text: `[ocr-retry-audio:${retryAudioClipId}]`,
          message_type: "audio",
          conversation_step: conversationStep,
        });
      } catch (e) {
        console.warn("[sendOcrRetryMessage] áudio:", (e as any)?.message);
      }
    }
  }

  return true;
}
