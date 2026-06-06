// Handler: pos_cadastro — mensagem final. Template puro.

import { templatePorEtapa } from "../templates.ts";
import type { Handler } from "./_types.ts";

export const posCadastroHandler: Handler = async (ctx) => {
  return {
    reply: templatePorEtapa("pos_cadastro", ctx.nomeLead),
    updates: {},
    stateUpdates: { cadastro_finalizado: true },
    toolsApplied: [],
    modelUsed: "template",
  };
};
