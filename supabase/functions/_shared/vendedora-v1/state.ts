import type { FluxoBState, SupabaseClient } from "./types.ts";
import { DEFAULT_STATE, ETAPAS_ORDER } from "./types.ts";

export function readState(customer: any): FluxoBState {
  const raw = customer?.fluxo_b_state;
  if (!raw || typeof raw !== "object") return { ...DEFAULT_STATE };

  const etapa = (raw.etapa && ETAPAS_ORDER.includes(raw.etapa)) ? raw.etapa : "interesse";
  const idx = ETAPAS_ORDER.indexOf(etapa);
  const idxFotoConta = ETAPAS_ORDER.indexOf("foto_conta");
  const idxPosCadastro = ETAPAS_ORDER.indexOf("pos_cadastro");

  // Inferência retroativa: para conversas que existiam antes da v2, deduz os
  // novos campos a partir da posição no funil. Evita que leads em andamento
  // regridam para a etapa de simulação no dia do deploy.
  return {
    ...DEFAULT_STATE,
    ...raw,
    objecoes_tratadas: Array.isArray(raw.objecoes_tratadas) ? raw.objecoes_tratadas : [],
    info: raw.info && typeof raw.info === "object" ? raw.info : {},
    tentativas_etapa: Number(raw.tentativas_etapa) || 0,
    simulacao_apresentada: raw.simulacao_apresentada ?? (idx >= idxFotoConta),
    interesse_confirmado: raw.interesse_confirmado ?? (idx >= idxFotoConta),
    cadastro_finalizado: raw.cadastro_finalizado ?? (idx >= idxPosCadastro),
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
