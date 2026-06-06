// Handler: valor — pede o valor da conta de luz.

import { microWrite } from "./_micro-writer.ts";
import type { Handler } from "./_types.ts";

export const valorHandler: Handler = async (ctx) => {
  const { text, modelUsed } = await microWrite({
    etapa: "valor",
    representante: ctx.representante,
    nomeLead: ctx.nomeLead,
    tarefa: "Pergunte o VALOR MÉDIO MENSAL da conta de luz, em reais.",
    regrasExtras: "Use *valor* em negrito. NÃO apresente desconto ainda.",
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
