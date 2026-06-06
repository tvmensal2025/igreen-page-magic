import type { FluxoBState, SupabaseClient } from "./types.ts";
import { DEFAULT_STATE, ETAPAS_ORDER } from "./types.ts";

export function readState(customer: any): FluxoBState {
  const raw = customer?.fluxo_b_state;
  const base: FluxoBState = !raw || typeof raw !== "object"
    ? { ...DEFAULT_STATE }
    : {
      ...DEFAULT_STATE,
      ...raw,
      objecoes_tratadas: Array.isArray(raw.objecoes_tratadas) ? raw.objecoes_tratadas : [],
      info: raw.info && typeof raw.info === "object" ? raw.info : {},
      tentativas_etapa: Number(raw.tentativas_etapa) || 0,
    };

  // Inferência retroativa pra leads em andamento — evita regressão na cutover.
  const idx = ETAPAS_ORDER.indexOf(base.etapa);
  const idxFoto = ETAPAS_ORDER.indexOf("foto_conta");
  if (base.simulacao_apresentada === undefined) {
    base.simulacao_apresentada = idx >= idxFoto;
  }
  if (base.interesse_confirmado === undefined) {
    base.interesse_confirmado = idx >= idxFoto;
  }
  if (base.cadastro_finalizado === undefined) {
    base.cadastro_finalizado = base.etapa === "pos_cadastro";
  }
  return base;
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
