// Trava a regressão que fez o parceiro José perder um lead que ele indicou.
//
// HISTÓRIA
// --------
// `buildDefaultQrPhrase` gerava:
//   "Oi! Vim pelo {keyword} e quero saber mais sobre o desconto na energia."
// e "quero saber mais" está em `META_CTWA_OPENING_PHRASES`. Logo
// `matchesMetaCtwaPhrase(frase) === true` → nos webhooks o lead era tratado como
// lead do Meta → `blockKeywordForMetaLead` → o bloco de atribuição de parceiro
// era pulado INTEIRO. Todo lead que usava a frase padrão do QR do parceiro ficava
// sem atribuição. Determinístico, não intermitente.
//
// Este teste usa as funções REAIS dos dois lados (gerador + detector), então
// qualquer mudança em `META_CTWA_OPENING_PHRASES` ou nas frases padrão que
// recrie a colisão falha aqui.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { matchesMetaCtwaPhrase, looksLikePaidCtwaOpener } from "./meta-ctwa-fallback.ts";
import { buildDefaultQrPhrase, containsKeyword, resolveQrMessage } from "./qr-phrase.ts";

const KEYWORDS = [
  "",
  "jose",
  "Valdenice",
  "Padaria Central",
  "posto shell br 101",
  "promocao-especial-black-friday-energia-solar-2026-cidade-grande",
];

Deno.test("frase padrão do QR nunca casa com âncora CTWA do Meta", () => {
  for (const kw of KEYWORDS) {
    const frase = buildDefaultQrPhrase(kw);
    assertEquals(
      matchesMetaCtwaPhrase(frase),
      false,
      `buildDefaultQrPhrase("${kw}") => "${frase}" foi classificada como CTWA`,
    );
  }
});

Deno.test("frase padrão do QR também não parece abertura CTWA paga", () => {
  // `looksLikePaidCtwaOpener` dispara enriquecimento CTWA e sinal de campanha.
  // A frase do parceiro não deve acionar nada disso.
  for (const kw of KEYWORDS) {
    const frase = buildDefaultQrPhrase(kw);
    assertEquals(
      looksLikePaidCtwaOpener(frase),
      false,
      `buildDefaultQrPhrase("${kw}") => "${frase}" pareceu abertura CTWA paga`,
    );
  }
});

Deno.test("resolveQrMessage sem frase salva continua CTWA-safe", () => {
  for (const kw of KEYWORDS) {
    const frase = resolveQrMessage(null, kw);
    assertEquals(matchesMetaCtwaPhrase(frase), false, `"${frase}"`);
  }
});

Deno.test("frase padrão mantém a keyword inteira (é ela que atribui o lead)", () => {
  for (const kw of KEYWORDS) {
    if (!kw) continue;
    const frase = buildDefaultQrPhrase(kw);
    assert(
      containsKeyword(frase, kw),
      `keyword "${kw}" foi perdida na frase "${frase}"`,
    );
  }
});

Deno.test("sanidade: o detector CTWA continua funcionando de verdade", () => {
  // Se este teste ficar verde por engano (detector quebrado / lista vazia), os
  // testes acima passariam sem provar nada.
  assertEquals(matchesMetaCtwaPhrase("Olá, posso ter mais informações sobre isso?"), true);
  assertEquals(matchesMetaCtwaPhrase("Oi! Quero saber mais sobre o desconto na energia."), true);
  assertEquals(matchesMetaCtwaPhrase("Meu nome é Maria"), false);
});
