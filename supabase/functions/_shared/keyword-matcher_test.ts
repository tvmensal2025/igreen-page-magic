import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildCadastroLink,
  deriveEffectiveKeywordList,
  deriveEffectiveKeywords,
  findGenericKeywords,
  hasExactTokenSequence,
  isGenericKeyword,
  isPartOfPartnerName,
  isWeakNameKeyword,
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

// ─────────────────────────────────────────────────────────────────────────────
// Keyword genérica NUNCA atribui — caso real do parceiro José ("Zap").
// ─────────────────────────────────────────────────────────────────────────────

const JOSE_ZAP: PartnerKeywords = { partnerId: "partner-jose", keywords: ["Zap"] };

Deno.test("caso José: keyword 'Zap' não atribui em nenhuma frase", () => {
  // "Zap" é como o brasileiro chama WhatsApp — não identifica ninguém.
  assertEquals(matchKeyword("Oi! Vim pelo Zap e quero o desconto", [JOSE_ZAP]), null);
  assertEquals(matchKeyword("me chama no zap", [JOSE_ZAP]), null);
  assertEquals(matchKeyword("vi no zap zap", [JOSE_ZAP]), null);
  assertEquals(matchKeyword("Zap", [JOSE_ZAP]), null);
});

Deno.test("keyword genérica não rouba lead de parceiro com keyword boa", () => {
  const partners: PartnerKeywords[] = [
    JOSE_ZAP,
    { partnerId: "partner-nilma", keywords: ["nilma"] },
  ];
  // Mensagem com as duas palavras: só a keyword específica vale.
  const hit = matchKeyword("Oi, vim pelo zap da nilma", partners);
  assertEquals(hit?.partnerId, "partner-nilma");
});

Deno.test("keyword genérica não vence por ser mais longa", () => {
  // "informacoes" (11 chars) é genérica; "nilma" (5) é válida.
  const partners: PartnerKeywords[] = [
    { partnerId: "generico", keywords: ["informacoes"] },
    { partnerId: "partner-nilma", keywords: ["nilma"] },
  ];
  const hit = matchKeyword("quero informacoes, indicação nilma", partners);
  assertEquals(hit?.partnerId, "partner-nilma");
});

Deno.test("keyword genérica QUALIFICADA volta a funcionar", () => {
  const partners: PartnerKeywords[] = [
    { partnerId: "partner-jose", keywords: ["zap do jose"] },
  ];
  assertEquals(
    matchKeyword("Oi! Vim pelo zap do jose", partners)?.partnerId,
    "partner-jose",
  );
  // E não casa em texto que só tem "zap"
  assertEquals(matchKeyword("me chama no zap", partners), null);
});

Deno.test("isGenericKeyword: blocklist, tamanho mínimo e vazio", () => {
  for (const kw of ["Zap", "zap", "whatsapp", "wpp", "energia", "oi", "posto", "quero", "sim"]) {
    assertEquals(isGenericKeyword(kw), true, `deveria bloquear "${kw}"`);
  }
  for (const kw of ["", "  ", "a", "jo"]) {
    assertEquals(isGenericKeyword(kw), true, `deveria bloquear curto/vazio "${kw}"`);
  }
  for (const kw of ["nilma", "Valdenice", "jose padaria central", "posto shell br 101"]) {
    assertEquals(isGenericKeyword(kw), false, `deveria aceitar "${kw}"`);
  }
});

Deno.test("findGenericKeywords aponta o parceiro que precisa trocar a palavra", () => {
  const partners: PartnerKeywords[] = [
    { partnerId: "partner-jose", keywords: ["Zap", "jose padaria central"] },
    { partnerId: "partner-nilma", keywords: ["nilma"] },
  ];
  const ruins = findGenericKeywords(partners);
  assertEquals(ruins.length, 1);
  assertEquals(ruins[0].partnerId, "partner-jose");
  assertEquals(ruins[0].keyword, "Zap");
});

Deno.test("deriveEffectiveKeywords: prenome solto vira o nome inteiro (caso Erica)", () => {
  const eff = deriveEffectiveKeywords({
    partnerId: "partner-erica",
    keywords: ["Erica"],
    nome: "Erica pereira",
    qrPhrase:
      "Olá, a Erica Pereira me indicou vocês porque eu quero economizar na minha conta de luz, pode me ajudar?",
  });
  assertEquals(eff.keywords[0], "Erica pereira");
  assertEquals(
    matchKeyword("Olá, a Erica Pereira me indicou vocês, quero economizar", [eff])?.partnerId,
    "partner-erica",
  );
  // Prenome solto de terceiro não é mais atribuição do parceiro.
  assertEquals(matchKeyword("minha amiga erica falou de voces", [eff]), null);
});

Deno.test("deriveEffectiveKeywords: prenome do parceiro não rouba lead do consultor homônimo", () => {
  const eff = deriveEffectiveKeywords({
    partnerId: "partner-rafael",
    keywords: ["rafael"],
    nome: "Rafael Ferreira Dias",
    qrPhrase: "Olá, o(a) Rafael Ferreira Dias me indicou vocês porque quero economizar na luz",
  });
  assertEquals(eff.keywords[0], "Rafael Ferreira Dias");
  assertEquals(matchKeyword("o Rafael falou comigo sobre a energia", [eff]), null);
});

Deno.test("deriveEffectiveKeywords: keyword genérica cai na frase do QR, não em palpite", () => {
  const eff = deriveEffectiveKeywords({
    partnerId: "partner-jose",
    keywords: ["Zap"],
    nome: "Jose luiz",
    qrPhrase:
      "Olá! Vim pela indicação da Loja Zap e gostaria de saber como posso economizar na conta de luz.",
  });
  // Nada de deduzir "loja zap" pelo vizinho: a âncora é a frase inteira.
  assertEquals(eff.keywords.length, 1);
  assertEquals(
    matchKeyword(
      "Olá! Vim pela indicação da Loja Zap e gostaria de saber como posso economizar na conta de luz.",
      [eff],
    )?.partnerId,
    "partner-jose",
  );
  assertEquals(matchKeyword("me chama no zap", [eff]), null);
});

Deno.test("deriveEffectiveKeywords: sem keyword usa o nome do parceiro", () => {
  const eff = deriveEffectiveKeywords({
    partnerId: "partner-rodrigo",
    keywords: [],
    nome: "Rodrigo Horácio",
    qrPhrase: null,
  });
  assertEquals(eff.keywords, ["Rodrigo Horácio"]);
  assertEquals(
    matchKeyword("Oi, o Rodrigo Horacio me indicou", [eff])?.partnerId,
    "partner-rodrigo",
  );
});

Deno.test("deriveEffectiveKeywords: keyword própria específica passa intacta", () => {
  const boa = deriveEffectiveKeywords({
    partnerId: "p1",
    keywords: ["mercado do elias", "Zap"],
    nome: "Elias Souza",
  });
  assertEquals(boa.keywords, ["mercado do elias"]);

  // Keyword genérica, nome genérico e frase curta → parceiro fica de fora.
  const lista = deriveEffectiveKeywordList([
    { partnerId: "p2", keywords: ["oi"], nome: "Loja", qrPhrase: "Oi, desconto" },
    boa,
  ]);
  assertEquals(lista.map((p) => p.partnerId), ["p1"]);
});

Deno.test("empate entre parceiros diferentes não atribui a ninguém", () => {
  const a: PartnerKeywords = { partnerId: "p-a", keywords: ["padaria central"] };
  const b: PartnerKeywords = { partnerId: "p-b", keywords: ["padaria central"] };
  assertEquals(matchKeyword("vim da padaria central", [a, b]), null);
  // Sozinho continua atribuindo.
  assertEquals(matchKeyword("vim da padaria central", [a])?.partnerId, "p-a");
  // Chave mais específica vence o empate.
  const c: PartnerKeywords = { partnerId: "p-c", keywords: ["padaria central do zé"] };
  assertEquals(
    matchKeyword("vim da padaria central do zé", [a, b, c])?.partnerId,
    "p-c",
  );
});

Deno.test("isWeakNameKeyword aponta parceiro sem sobrenome no cadastro", () => {
  assertEquals(isWeakNameKeyword("Daniel", "Daniel"), true);
  assertEquals(isWeakNameKeyword("Erica", "Erica pereira"), false);
  assertEquals(isWeakNameKeyword("mercado do elias", "Elias"), false);
});

Deno.test("isPartOfPartnerName reconhece pedaço do nome, não palavra qualquer", () => {
  assertEquals(isPartOfPartnerName("Erica", "Erica pereira"), true);
  assertEquals(isPartOfPartnerName("dias", "Rafael Ferreira Dias"), true);
  assertEquals(isPartOfPartnerName("Rafael Ferreira Dias", "Rafael Ferreira Dias"), false);
  assertEquals(isPartOfPartnerName("posto shell", "Rafael Ferreira Dias"), false);
});

Deno.test("allowGeneric:true existe só para diagnóstico", () => {
  assertEquals(
    matchKeyword("me chama no zap", [JOSE_ZAP], { allowGeneric: true })?.partnerId,
    "partner-jose",
  );
});
