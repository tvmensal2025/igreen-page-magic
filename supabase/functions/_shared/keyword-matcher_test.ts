import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildCadastroLink,
  hasExactTokenSequence,
  levenshtein,
  matchKeyword,
  normalizeText,
  type PartnerKeywords,
} from "./keyword-matcher.ts";

const NILMA: PartnerKeywords = {
  partnerId: "partner-nilma",
  keywords: ["nilma"],
};

const PARTNERS: PartnerKeywords[] = [
  NILMA,
  { partnerId: "partner-luiz", keywords: ["luiz"] },
  { partnerId: "partner-rafael", keywords: ["rafael"] },
  { partnerId: "partner-elias", keywords: ["Sou de Elias Fausto"] },
];

Deno.test("caso real: Nilza NÃO casa com keyword nilma (falso positivo antigo)", () => {
  // Distância 1 — o fuzzy antigo atribuía a Nilma. Agora deve ser null.
  assertEquals(levenshtein("nilza", "nilma"), 1);
  assertEquals(matchKeyword("Nilza", [NILMA]), null);
  assertEquals(matchKeyword("Meu nome é Nilza", [NILMA]), null);
  assertEquals(matchKeyword("Oi, sou a Nilza!", PARTNERS), null);
});

Deno.test("match exato da keyword nilma continua funcionando", () => {
  const hit = matchKeyword("Oi! Quero saber mais (indicação: nilma) #R711377", [NILMA]);
  assertEquals(hit?.partnerId, "partner-nilma");
  assertEquals(hit?.keyword, "nilma");
  assertEquals(hit?.score, 1.0);

  assertEquals(matchKeyword("nilma", [NILMA])?.partnerId, "partner-nilma");
  assertEquals(matchKeyword("A NILMA me indicou", [NILMA])?.partnerId, "partner-nilma");
});

Deno.test("não casa substring dentro de palavra maior", () => {
  // "luiz" não pode casar em "luiza"
  assertEquals(matchKeyword("Luiza", PARTNERS), null);
  assertEquals(matchKeyword("sou a Luiza", PARTNERS), null);
  // "rafael" não casa em "rafaela"
  assertEquals(matchKeyword("Rafaela", PARTNERS), null);
});

Deno.test("keyword multi-palavra exige sequência contígua", () => {
  const hit = matchKeyword("Oi, Sou de Elias Fausto, quero desconto", PARTNERS);
  assertEquals(hit?.partnerId, "partner-elias");

  // Tokens fora de ordem / incompletos
  assertEquals(matchKeyword("Sou de Fausto Elias", PARTNERS), null);
  assertEquals(matchKeyword("Elias Fausto", PARTNERS), null);
});

Deno.test("em conflito, prefere keyword mais longa", () => {
  const partners: PartnerKeywords[] = [
    { partnerId: "curto", keywords: ["elias"] },
    { partnerId: "longo", keywords: ["sou de elias fausto"] },
  ];
  const hit = matchKeyword("Sou de Elias Fausto", partners);
  assertEquals(hit?.partnerId, "longo");
});

Deno.test("hasExactTokenSequence: word-boundary", () => {
  assertEquals(hasExactTokenSequence(["a", "nilma", "b"], ["nilma"]), true);
  assertEquals(hasExactTokenSequence(["anilma"], ["nilma"]), false);
  assertEquals(
    hasExactTokenSequence(["sou", "de", "elias", "fausto"], ["sou", "de", "elias", "fausto"]),
    true,
  );
});

Deno.test("normalizeText remove acentos e pontuação", () => {
  assertEquals(normalizeText("Olá, Nilma!"), "ola nilma");
  assertEquals(normalizeText("indicação: nilma"), "indicacao nilma");
});

Deno.test("buildCadastroLink: id do dono + cli do parceiro", () => {
  const url = buildCadastroLink("12345", "999");
  assertEquals(url.includes("id=12345"), true);
  assertEquals(url.includes("cli=999"), true);
});
