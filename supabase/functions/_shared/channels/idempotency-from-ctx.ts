/**
 * Converte SendContext → IdempotencyOptions para senders (Evolution/Whapi).
 * Só ativa quando `ctx.supabase` está presente e o slot ainda não foi
 * adquirido pelo dispatcher V3 (`idempotencySlotAcquired`).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { SendContext } from "./types.ts";

export interface OutboundIdempotencyOptions {
  idempotencyKey?: string;
  customerId?: string;
  consultantId?: string;
  payloadHash?: string;
  supabase?: SupabaseClient;
}

/** Monta opts de idempotência a partir do contexto de envio do adapter. */
export function idempotencyFromCtx(
  ctx: SendContext,
  payloadHash: string,
): OutboundIdempotencyOptions | undefined {
  if (ctx.idempotencySlotAcquired) return undefined;
  if (!ctx.supabase || !ctx.idempotencyKey) return undefined;
  return {
    supabase: ctx.supabase,
    idempotencyKey: ctx.idempotencyKey,
    customerId: ctx.customerId,
    consultantId: ctx.consultantId,
    payloadHash: payloadHash || ctx.idempotencyKey,
  };
}
