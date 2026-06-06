// Handler: nome — pede o nome do lead.

import { microWrite } from "./_micro-writer.ts";
import type { Handler } from "./_types.ts";

export const nomeHandler: Handler = async (ctx) => {
  const { text, modelUsed } = await microWrite({
    etapa: "nome",
    representante: ctx.representante,
    nomeLead: null, // por definição ainda não temos
    tarefa: "Pergunte o NOME do lead, leve e direto.",
    regrasExtras: "Use 'nome' ou 'chamar' na frase.",
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
