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
  | "campaign_inactive"
  | "campaign_conflict"
  | "assignment_conflict"
  | "tenant_mismatch"
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
    case "campaign_inactive":
    case "campaign_conflict":
    case "assignment_conflict":
    case "tenant_mismatch":
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

export type CampaignBindOutcome =
  | "bound"
  | "already_bound"
  | "campaign_conflict"
  | "tenant_mismatch"
  | "customer_missing"
  | "rpc_error";

export interface CampaignBindResult {
  outcome: CampaignBindOutcome;
  campaignId: string | null;
  errorMessage?: string;
}

/**
 * Fixa source_campaign_id sob FOR UPDATE e devolve a campanha realmente
 * persistida. Em conflito, não sobrescreve a primeira origem gravada.
 *
 * Se a RPC ainda não existir no banco (migration pendente), faz CAS legado
 * com `.is("source_campaign_id", null)` para não zerar a atribuição no webhook.
 */
export async function bindCustomerCampaign(
  supabase: SupabaseClient,
  customerId: string,
  campaignId: string,
): Promise<CampaignBindResult> {
  try {
    const { data, error } = await supabase.rpc("bind_customer_campaign", {
      p_customer_id: customerId,
      p_campaign_id: campaignId,
    });
    if (error) {
      const msg = String(error.message || "");
      if (isMissingRpcError(msg)) {
        console.warn("[bind-campaign] RPC ausente — fallback CAS legado:", msg);
        return await bindCustomerCampaignLegacy(supabase, customerId, campaignId);
      }
      return { outcome: "rpc_error", campaignId: null, errorMessage: msg };
    }
    const pick = Array.isArray(data) ? data[0] : data;
    const rawOutcome = typeof pick?.outcome === "string" ? pick.outcome : "rpc_error";
    const outcome: CampaignBindOutcome = [
      "bound",
      "already_bound",
      "campaign_conflict",
      "tenant_mismatch",
      "customer_missing",
    ].includes(rawOutcome)
      ? rawOutcome as CampaignBindOutcome
      : "rpc_error";
    const persistedCampaignId =
      typeof pick?.campaign_id === "string" && pick.campaign_id.trim()
        ? pick.campaign_id.trim()
        : null;
    return { outcome, campaignId: persistedCampaignId };
  } catch (e) {
    const msg = (e as Error).message;
    if (isMissingRpcError(msg)) {
      console.warn("[bind-campaign] RPC ausente (exceção) — fallback CAS legado:", msg);
      return await bindCustomerCampaignLegacy(supabase, customerId, campaignId);
    }
    return {
      outcome: "rpc_error",
      campaignId: null,
      errorMessage: msg,
    };
  }
}

function isMissingRpcError(message: string): boolean {
  return /could not find the function|function .* does not exist|PGRST202|42883/i.test(message);
}

/** CAS legado: só grava se source_campaign_id ainda estiver nulo. */
async function bindCustomerCampaignLegacy(
  supabase: SupabaseClient,
  customerId: string,
  campaignId: string,
): Promise<CampaignBindResult> {
  try {
    const { data: row, error: readError } = await supabase
      .from("customers")
      .select("source_campaign_id")
      .eq("id", customerId)
      .maybeSingle();
    if (readError) {
      return { outcome: "rpc_error", campaignId: null, errorMessage: readError.message };
    }
    if (!row) {
      return { outcome: "customer_missing", campaignId: null };
    }
    const current =
      typeof (row as { source_campaign_id?: string | null }).source_campaign_id === "string"
        ? String((row as { source_campaign_id: string }).source_campaign_id)
        : null;
    if (current === campaignId) {
      return { outcome: "already_bound", campaignId: current };
    }
    if (current) {
      return { outcome: "campaign_conflict", campaignId: current };
    }

    const { data: updated, error: writeError } = await supabase
      .from("customers")
      .update({
        source_campaign_id: campaignId,
        lead_source: "meta_ads",
      })
      .eq("id", customerId)
      .is("source_campaign_id", null)
      .select("source_campaign_id")
      .maybeSingle();

    if (writeError) {
      return { outcome: "rpc_error", campaignId: null, errorMessage: writeError.message };
    }
    const persisted =
      typeof (updated as { source_campaign_id?: string | null } | null)?.source_campaign_id === "string"
        ? String((updated as { source_campaign_id: string }).source_campaign_id)
        : null;
    if (persisted === campaignId) {
      return { outcome: "bound", campaignId: persisted };
    }

    // Corrida: outra mensagem gravou primeiro.
    const { data: again } = await supabase
      .from("customers")
      .select("source_campaign_id")
      .eq("id", customerId)
      .maybeSingle();
    const after =
      typeof (again as { source_campaign_id?: string | null } | null)?.source_campaign_id === "string"
        ? String((again as { source_campaign_id: string }).source_campaign_id)
        : null;
    if (after === campaignId) return { outcome: "already_bound", campaignId: after };
    if (after) return { outcome: "campaign_conflict", campaignId: after };
    return { outcome: "rpc_error", campaignId: null, errorMessage: "legacy_bind_failed" };
  } catch (e) {
    return {
      outcome: "rpc_error",
      campaignId: null,
      errorMessage: (e as Error).message,
    };
  }
}