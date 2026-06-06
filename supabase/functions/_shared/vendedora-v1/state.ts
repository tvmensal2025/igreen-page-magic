import type { FluxoBState, SupabaseClient } from "./types.ts";
import { DEFAULT_STATE } from "./types.ts";

export function readState(customer: any): FluxoBState {
  const raw = customer?.fluxo_b_state;
  if (!raw || typeof raw !== "object") return { ...DEFAULT_STATE };
  return {
    ...DEFAULT_STATE,
    ...raw,
    objecoes_tratadas: Array.isArray(raw.objecoes_tratadas) ? raw.objecoes_tratadas : [],
    info: raw.info && typeof raw.info === "object" ? raw.info : {},
    tentativas_etapa: Number(raw.tentativas_etapa) || 0,
  };
}

export async function writeState(
  supabase: SupabaseClient,
  customerId: string,
  state: FluxoBState,
): Promise<void> {
  await supabase
    .from("customers")
    .update({ fluxo_b_state: state, updated_at: new Date().toISOString() })
    .eq("id", customerId);
}
