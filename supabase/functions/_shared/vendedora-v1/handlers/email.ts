// Handler: email — pede o e-mail do lead.

import { microWrite } from "./_micro-writer.ts";
import type { Handler } from "./_types.ts";

export const emailHandler: Handler = async (ctx) => {
  const { text, modelUsed } = await microWrite({
    etapa: "email",
    representante: ctx.representante,
    nomeLead: ctx.nomeLead,
    tarefa: "Peça o MELHOR E-MAIL do lead para finalizar o cadastro.",
    regrasExtras: "Use 📧. Termine com '?'. Mencione que é a última info.",
    historyMsgs: ctx.historyMsgs,
    inboundText: ctx.inboundText,
  });
  return {
    reply: text,
    updates: { conversation_step: "aguardando_email" },
    stateUpdates: {},
    toolsApplied: [],
    modelUsed,
  };
};
