// Handler: interesse — abertura. Template puro, sem LLM.

import { templatePorEtapa } from "../templates.ts";
import type { Handler } from "./_types.ts";

export const interesseHandler: Handler = async (ctx) => {
  const reply = templatePorEtapa("interesse", ctx.nomeLead);
  return {
    reply,
    updates: {},
    stateUpdates: {},
    toolsApplied: [],
    modelUsed: "template",
  };
};
