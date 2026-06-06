// Handler: doc — pede a foto do documento (RG ou CNH frente).

import { microWrite } from "./_micro-writer.ts";
import type { Handler } from "./_types.ts";

export const docHandler: Handler = async (ctx) => {
  const { text, modelUsed } = await microWrite({
    etapa: "doc",
    representante: ctx.representante,
    nomeLead: ctx.nomeLead,
    tarefa: "Peça a foto da FRENTE do RG ou CNH do lead.",
    regrasExtras: "Mencione RG ou CNH explicitamente. Use 📄. NÃO peça nada além do documento.",
    historyMsgs: ctx.historyMsgs,
    inboundText: ctx.inboundText,
  });
  return {
    reply: text,
    updates: { conversation_step: "aguardando_documento" },
    stateUpdates: {},
    toolsApplied: ["pedir_documento"],
    modelUsed,
  };
};
