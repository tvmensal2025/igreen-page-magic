// State machine determinística da Vendedora v2.
// Decide a próxima etapa apenas com base em dados confirmados no customer +
// flags do state. Sem LLM, sem heurística sobre o texto do lead.

import type { Etapa, FluxoBState } from "./types.ts";

/** Etapa "confirmacao" não existe no schema legacy — é uma sub-etapa só da v2. */
export type EtapaV2 = Etapa | "confirmacao";

export function decideEtapa(customer: any, state: FluxoBState): EtapaV2 {
  if (!customer?.name && !state.info?.nome) return "nome";

  const valor = customer?.electricity_bill_value;
  if (!valor || Number(valor) <= 0) return "valor";

  if (!state.simulacao_apresentada) return "simulacao";
  if (!state.interesse_confirmado) return "confirmacao";

  if (!state.midia_recebida?.conta) return "foto_conta";
  if (!state.midia_recebida?.doc_frente) return "doc";

  if (!customer?.email) return "email";

  if (!state.cadastro_finalizado) return "finalizando";
  return "pos_cadastro";
}

/** Etapas onde rodamos perfilador/RAG/crítico — onde há contexto rico. */
export const RICH_ETAPAS = new Set<EtapaV2>(["simulacao", "confirmacao", "doc"]);
