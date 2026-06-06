// State machine determinística da Vendedora v2.
// Decide a próxima etapa apenas com base em dados confirmados no customer +
// flags do state. Sem LLM, sem heurística sobre o texto do lead.

import type { Etapa, FluxoBState } from "./types.ts";

export function decideEtapa(customer: any, state: FluxoBState): Etapa {
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
export const RICH_ETAPAS = new Set<Etapa>(["simulacao", "confirmacao", "doc"]);

/** Etapa "confirmacao" não é parte do schema antigo, é uma sub-etapa v2. */
export type EtapaV2 = Etapa | "confirmacao";
