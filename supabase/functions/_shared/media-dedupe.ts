// Helper to enforce: same audio/video media is NEVER sent twice to the same customer.
//
// Task 34 (whatsapp-flow-reliability-fix Phase 7): internamente passa a usar o
// par `reserve_media_send` / `confirm_media_send`, que substitui o antigo
// `try_log_media_send`. A API pública (`canSendMediaOnce: boolean`) é
// preservada para evitar tocar nos ~10 call sites — o wrapper faz reserve +
// confirm(true) inline, mantendo a semântica de "marca como enviado" e
// preservando o happy-path (regressão 3.19).
//
// Para call sites que precisam de garantia mais forte (reserve → send →
// confirm), exportamos também `reserveMediaSlot` / `confirmMediaSlot`. Reservas
// órfãs (>30s sem confirm) são recicladas automaticamente pelo próprio RPC e
// pelo sweeper em `outbound-media-flush-cron` (`sweep_orphan_media_reservations`).

import { isSendConfirmed } from "./bot/outbound-commit.ts";

export interface MediaSlotInput {
  consultantId?: string | null;
  customerId?: string | null;
  mediaId?: string | null;
  slotKey?: string | null;
  kind: string;
}

function shouldDedupe(kind: string): boolean {
  const k = (kind || "").toLowerCase();
  return k === "audio" || k === "video";
}

/** `true` quando esta mídia já saiu para este lead (slot queimado de propósito). */
async function alreadySent(supabase: any, opts: MediaSlotInput): Promise<boolean> {
  if (!shouldDedupe(opts.kind)) return false;
  if (!opts.customerId || !opts.mediaId) return false;
  try {
    const { data: existing } = await supabase
      .from("ai_slot_dispatch_log")
      .select("dispatch_status")
      .eq("customer_id", opts.customerId)
      .eq("media_id", opts.mediaId)
      .maybeSingle();
    if (existing?.dispatch_status === "sent") {
      console.log(`[media-dedupe] ⏭️ pulando ${opts.kind} já enviado (media_id=${opts.mediaId}) customer=${opts.customerId}`);
      return true;
    }
  } catch (_e) {
    // sem RLS / sem permissão: continua para reserve, que decide.
  }
  return false;
}

/**
 * Reserva um slot e devolve `reservationId` (ou null se ja foi enviado /
 * reserva fresca existe). Para áudio/vídeo apenas — outros tipos sempre
 * retornam um id sintético "skip" para sinalizar "siga em frente".
 */
export async function reserveMediaSlot(
  supabase: any,
  opts: MediaSlotInput,
): Promise<{ ok: boolean; reservationId: string | null }> {
  if (!shouldDedupe(opts.kind)) return { ok: true, reservationId: null };
  if (!opts.customerId || !opts.mediaId) return { ok: true, reservationId: null };

  try {
    const { data, error } = await supabase.rpc("reserve_media_send", {
      p_cons: opts.consultantId || null,
      p_cust: opts.customerId,
      p_media: opts.mediaId,
      p_slot_key: opts.slotKey || "unknown",
      p_kind: (opts.kind || "media").toLowerCase(),
    });
    if (error) {
      console.warn("[media-dedupe] reserve_media_send error:", error.message);
      // best-effort: na dúvida, deixa enviar
      return { ok: true, reservationId: null };
    }
    if (!data) {
      // RPC só retorna null quando faltou customer/media — tratamos como skip seguro.
      return { ok: true, reservationId: null };
    }
    return { ok: true, reservationId: String(data) };
  } catch (e) {
    console.warn("[media-dedupe] reserve_media_send failed:", (e as any)?.message);
    return { ok: true, reservationId: null };
  }
}

/** Marca a reserva como enviada (ok=true) ou liberada (ok=false). No-op sem id. */
export async function confirmMediaSlot(
  supabase: any,
  reservationId: string | null,
  ok: boolean,
): Promise<void> {
  if (!reservationId) return;
  try {
    const { error } = await supabase.rpc("confirm_media_send", {
      p_res_id: reservationId,
      p_ok: ok,
    });
    if (error) console.warn("[media-dedupe] confirm_media_send error:", error.message);
  } catch (e) {
    console.warn("[media-dedupe] confirm_media_send failed:", (e as any)?.message);
  }
}

/**
 * API legada — preserva semântica boolean. Internamente faz
 * reserve → confirm(true) imediato (equivalente ao try_log_media_send antigo
 * mas usando o caminho novo). Para fluxo two-phase real, use
 * reserveMediaSlot + confirmMediaSlot diretamente.
 */
export async function canSendMediaOnce(
  supabase: any,
  opts: MediaSlotInput,
): Promise<boolean> {
  if (!shouldDedupe(opts.kind)) return true;
  if (!opts.customerId || !opts.mediaId) return true;

  // Checa primeiro se já foi marcado como 'sent' — reserve_media_send mantém
  // o status='sent' (não recicla), então um SELECT prévio detecta dedupe sem
  // criar reserva órfã.
  if (await alreadySent(supabase, opts)) return false;

  const { reservationId } = await reserveMediaSlot(supabase, opts);
  // Confirma imediatamente — mantém compatibilidade com fluxo single-phase.
  // Callers two-phase devem usar reserveMediaSlot + confirmMediaSlot diretamente.
  if (reservationId) {
    await confirmMediaSlot(supabase, reservationId, true);
  }
  return true;
}

export type MediaDispatchOutcome<T> = {
  /** Já tinha ido para este lead — nada foi tentado. */
  skipped: boolean;
  /** O canal confirmou (ou pelo menos não negou) o envio. */
  sent: boolean;
  result: T | null;
  error: unknown;
};

/**
 * Envio de mídia em duas fases: **reservar → enviar → confirmar o resultado**.
 *
 * Auditoria 2026-08: `canSendMediaOnce` confirma o slot como enviado ANTES do
 * envio. Como áudio/vídeo nunca se repetem para o mesmo lead, um envio que
 * falha depois (erro do canal, humano assumiu no meio da cascata, URL fora do
 * ar) queimava a mídia para sempre — o lead nunca mais recebia aquele áudio.
 * Aqui a reserva só vira "enviado" se o canal confirmar; caso contrário ela é
 * liberada e a mídia pode sair de novo no próximo turno.
 */
export async function dispatchMediaOnce<T>(
  supabase: any,
  opts: MediaSlotInput,
  send: () => Promise<T>,
): Promise<MediaDispatchOutcome<T>> {
  if (await alreadySent(supabase, opts)) {
    return { skipped: true, sent: false, result: null, error: null };
  }

  const { reservationId } = await reserveMediaSlot(supabase, opts);

  let result: T | null = null;
  let sent = false;
  let error: unknown = null;
  try {
    result = await send();
    sent = isSendConfirmed(result);
  } catch (e) {
    error = e;
    sent = false;
  }

  await confirmMediaSlot(supabase, reservationId, sent);
  if (!sent) {
    console.warn(`[media-dedupe] ↩️ envio de ${opts.kind} não confirmado — slot liberado (media_id=${opts.mediaId})`);
  }
  return { skipped: false, sent, result, error };
}
