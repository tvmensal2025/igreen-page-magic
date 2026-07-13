/**
 * rodizio-assign.ts
 *
 * Wrapper da RPC atômica `rodizio_assign_lead` (migration
 * 20260713120000_rodizio_assign_atomic). Substitui o par
 * `rodizio_next` + CAS no webhook: trava o customer, só então consome o turno
 * e atribui `referral_partner_id` na mesma transação.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type RodizioAssignOutcome =
  | "assigned"
  | "already_assigned"
  | "pool_empty"
  | "customer_missing"
  | "rpc_error";

export interface RodizioAssignResult {
  outcome: RodizioAssignOutcome;
  partnerId: string | null;
  position: number | null;
  poolId: string | null;
  errorMessage?: string;
}

/** Extrai a primeira linha do retorno TABLE da RPC (array ou objeto). */
export function parseRodizioAssignRows(rows: unknown): {
  outcome: string | null;
  partnerId: string | null;
  position: number | null;
  poolId: string | null;
} {
  const pick = Array.isArray(rows) ? rows[0] : rows;
  if (!pick || typeof pick !== "object") {
    return { outcome: null, partnerId: null, position: null, poolId: null };
  }
  const row = pick as Record<string, unknown>;
  const outcome = typeof row.outcome === "string" ? row.outcome.trim() : null;
  const partnerRaw = row.partner_id;
  const partnerId =
    typeof partnerRaw === "string" && partnerRaw.trim().length > 0
      ? partnerRaw.trim()
      : null;
  const position =
    typeof row.position === "number" && Number.isFinite(row.position)
      ? row.position
      : null;
  const poolRaw = row.pool_id;
  const poolId =
    typeof poolRaw === "string" && poolRaw.trim().length > 0
      ? poolRaw.trim()
      : null;
  return { outcome, partnerId, position, poolId };
}

function normalizeOutcome(raw: string | null): RodizioAssignOutcome {
  switch (raw) {
    case "assigned":
    case "already_assigned":
    case "pool_empty":
    case "customer_missing":
      return raw;
    default:
      return "rpc_error";
  }
}

/**
 * Chama `rodizio_assign_lead` e normaliza o resultado para o webhook/chat.
 * Nunca lança: erros viram outcome `rpc_error`.
 */
export async function assignRodizioLead(
  supabase: SupabaseClient,
  customerId: string,
  campaignId: string,
): Promise<RodizioAssignResult> {
  try {
    const { data, error } = await supabase.rpc("rodizio_assign_lead", {
      p_customer_id: customerId,
      p_campaign_id: campaignId,
    });
    if (error) {
      console.warn("[rodizio-assign] RPC falhou:", error.message);
      return {
        outcome: "rpc_error",
        partnerId: null,
        position: null,
        poolId: null,
        errorMessage: error.message,
      };
    }
    const parsed = parseRodizioAssignRows(data);
    const outcome = normalizeOutcome(parsed.outcome);
    return {
      outcome,
      partnerId: parsed.partnerId,
      position: parsed.position,
      poolId: parsed.poolId,
    };
  } catch (e) {
    const msg = (e as Error).message;
    console.warn("[rodizio-assign] exceção:", msg);
    return {
      outcome: "rpc_error",
      partnerId: null,
      position: null,
      poolId: null,
      errorMessage: msg,
    };
  }
}
