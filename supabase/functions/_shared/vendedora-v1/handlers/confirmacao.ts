// Handler: confirmacao — confirma interesse antes de pedir mídia.
// Já tentamos extrair interesse no orquestrador (extractInteresse).
// Se chegou aqui, é porque não foi confirmado ainda.

import { microWrite } from "./_micro-writer.ts";
import type { Handler } from "./_types.ts";

export const confirmacaoHandler: Handler = async (ctx) => {
  const { text, modelUsed } = await microWrite({
    etapa: "confirmacao",
    representante: ctx.representante,
    nomeLead: ctx.nomeLead,
    tarefa: "Pergunte se o lead quer seguir com o cadastro agora. Curto, direto, sem repetir a simulação inteira.",
    regrasExtras: "Termine com pergunta tipo 'posso seguir?' ou 'fechado?'. NÃO peça foto/documento ainda.",
    historyMsgs: ctx.historyMsgs,
    inboundText: ctx.inboundText,
  });
  return {
    reply: text,
    updates: {},
    stateUpdates: {},
    toolsApplied: [],
    modelUsed,
  };
};
