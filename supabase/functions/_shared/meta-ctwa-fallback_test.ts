import {
  looksLikePaidCtwaOpener,
  matchesMetaCtwaPhrase,
} from "./meta-ctwa-fallback.ts";

Deno.test("looksLikePaidCtwaOpener — frase iGreen CTWA", () => {
  const msg = "Oi! Quero saber como consigo pagar menos na conta de luz.";
  if (!looksLikePaidCtwaOpener(msg)) throw new Error("deveria reconhecer CTWA iGreen");
  if (!matchesMetaCtwaPhrase(msg)) throw new Error("matchesMetaCtwaPhrase deveria bater");
});

Deno.test("looksLikePaidCtwaOpener — oi genérico não conta", () => {
  if (looksLikePaidCtwaOpener("oi")) throw new Error("oi curto não é CTWA");
  if (looksLikePaidCtwaOpener("tudo bem?")) throw new Error("conversa normal não é CTWA");
});
