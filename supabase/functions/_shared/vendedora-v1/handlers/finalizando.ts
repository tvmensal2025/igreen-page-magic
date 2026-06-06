// Handler: finalizando — delega a closer.ts/tentarFechar.
// O closer é a autoridade única para fechar o cadastro.

import { templatePorEtapa } from "../templates.ts";
import type { Handler } from "./_types.ts";

export const finalizandoHandler: Handler = async (ctx) => {
  return {
    reply: templatePorEtapa("finalizando", ctx.nomeLead),
    updates: { conversation_step: "cadastro_finalizando" },
    stateUpdates: {},
    toolsApplied: ["finalizar_cadastro"],
    closerHint: true,
    modelUsed: "template",
  };
};
