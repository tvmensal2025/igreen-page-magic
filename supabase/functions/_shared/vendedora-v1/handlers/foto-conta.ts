// Handler: foto_conta — pede a foto da conta de luz. Template puro.

import { templatePorEtapa } from "../templates.ts";
import type { Handler } from "./_types.ts";

export const fotoContaHandler: Handler = async (ctx) => {
  return {
    reply: templatePorEtapa("foto_conta", ctx.nomeLead),
    updates: { conversation_step: "aguardando_conta" },
    stateUpdates: {},
    toolsApplied: ["pedir_foto_conta"],
    modelUsed: "template",
  };
};
