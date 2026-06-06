// State machine determinística — decide a etapa por código, sem LLM.
// Lê apenas dados confirmados (customer + state). Nada do inbound entra aqui.

import type { Etapa, FluxoBState } from "./types.ts";

const MEDIA_PLACEHOLDERS = new Set(["evolution-media:pending", "collected", "nao_aplicavel", ""]);
const hasMedia = (v: any) => {
  const s = String(v ?? "").trim();
  return s.length > 0 && !MEDIA_PLACEHOLDERS.has(s);
};

export function decideEtapa(customer: any, state: FluxoBState): Etapa {
  if (state.cadastro_finalizado) return "pos_cadastro";

  const temNome = !!String(customer?.name ?? "").trim();
  const temValor = typeof customer?.electricity_bill_value === "number" && customer.electricity_bill_value > 0;
  const temConta = hasMedia(customer?.electricity_bill_photo_url) || !!state.midia_recebida?.conta;
  const temDoc = hasMedia(customer?.document_front_url) || !!state.midia_recebida?.doc_frente;
  const temEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(customer?.email ?? "").trim());

  if (!temNome) return "nome";
  if (!temValor) return "valor";
  if (!state.simulacao_apresentada) return "simulacao";
  if (!state.interesse_confirmado) return "simulacao";
  if (!temConta) return "foto_conta";
  if (!temDoc) return "doc";
  if (!temEmail) return "email";
  return "finalizando";
}
