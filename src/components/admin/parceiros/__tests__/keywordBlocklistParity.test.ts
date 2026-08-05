// Paridade da blocklist de keyword genérica: front ↔ runtime (Deno).
//
// POR QUE ESTE TESTE EXISTE
// -------------------------
// A blocklist morava SÓ no front. O runtime não validava nada, então keyword
// genérica gravada por import/SQL/cadastro antigo atribuía lead normalmente.
// Foi assim que a keyword **"Zap"** do parceiro José entrou: "zap" nem estava
// na lista, e mesmo que estivesse, o webhook não olhava.
//
// Agora a régua canônica é `_shared/keyword-matcher.ts` (onde a atribuição
// acontece) e o front é espelho. Se um lado divergir, isto fica vermelho.

import { describe, it, expect } from "vitest";
import * as front from "../qrPhrase";
import * as runtime from "../../../../../supabase/functions/_shared/keyword-matcher";

describe("blocklist de keyword — paridade front ↔ runtime", () => {
  it("as duas listas têm exatamente as mesmas palavras", () => {
    const norm = (arr: string[]) =>
      [...arr].map((s) => s.trim().toLowerCase()).sort();
    expect(norm(front.GENERIC_KEYWORD_BLOCKLIST)).toEqual(
      norm(runtime.GENERIC_KEYWORD_BLOCKLIST),
    );
  });

  it("KEYWORD_MIN_LENGTH é igual nos dois", () => {
    expect(front.KEYWORD_MIN_LENGTH).toBe(runtime.KEYWORD_MIN_LENGTH);
  });

  it("isGenericKeyword concorda nos dois lados", () => {
    const casos = [
      "Zap",
      "zap",
      "ZAP ZAP",
      "whatsapp",
      "wpp",
      "energia",
      "oi",
      "posto",
      "",
      "  ",
      "ab",
      // válidas — precisam ser aceitas nos dois
      "jose padaria central",
      "posto shell br 101",
      "Valdenice",
      "nilma",
    ];
    for (const c of casos) {
      expect(
        front.isGenericKeyword(c),
        `divergência em "${c}"`,
      ).toBe(runtime.isGenericKeyword(c));
    }
  });
});

describe("nome como chave — paridade front ↔ runtime", () => {
  const casos: Array<[string, string]> = [
    ["Erica", "Erica pereira"],
    ["rafael", "Rafael Ferreira Dias"],
    ["dias", "Rafael Ferreira Dias"],
    ["Rafael Ferreira Dias", "Rafael Ferreira Dias"],
    ["Daniel", "Daniel"],
    ["mercado do elias", "Elias Souza"],
  ];

  it("isPartOfPartnerName concorda nos dois lados", () => {
    for (const [kw, nome] of casos) {
      expect(front.isPartOfPartnerName(kw, nome), `${kw} / ${nome}`).toBe(
        runtime.isPartOfPartnerName(kw, nome),
      );
    }
  });

  it("isWeakNameKeyword concorda nos dois lados", () => {
    for (const [kw, nome] of casos) {
      expect(front.isWeakNameKeyword(kw, nome), `${kw} / ${nome}`).toBe(
        runtime.isWeakNameKeyword(kw, nome),
      );
    }
  });

  it("o front mostra a mesma chave que o runtime vai usar", () => {
    const nome = "Erica pereira";
    const frase = "Olá, a Erica Pereira me indicou vocês porque quero economizar na luz";
    expect(front.resolveEffectiveKeyword("Erica", nome, frase)).toBe("Erica pereira");
    expect(
      runtime.deriveEffectiveKeywords({
        partnerId: "p",
        keywords: ["Erica"],
        nome,
        qrPhrase: frase,
      }).keywords[0],
    ).toBe("Erica pereira");
  });

  it("nome fora da frase do QR não é expandido (a frase é o que o lead envia)", () => {
    const nome = "Erica pereira";
    const frase = "Olá, vim do Mercado da Erica e quero desconto na luz";
    expect(front.resolveEffectiveKeyword("Erica", nome, frase)).toBe("Erica");
  });
});

describe("blocklist — o caso José", () => {
  it('"Zap" é recusada (é como o brasileiro chama WhatsApp)', () => {
    expect(front.isGenericKeyword("Zap")).toBe(true);
    expect(runtime.isGenericKeyword("Zap")).toBe(true);
  });

  it("variações de Zap/WhatsApp também são recusadas", () => {
    for (const kw of ["zap", "ZAP", "Zap Zap", "zapzap", "whatsapp", "WhatsApp", "whats", "wpp", "watsapp"]) {
      expect(runtime.isGenericKeyword(kw), kw).toBe(true);
    }
  });

  it("keyword genérica QUALIFICADA continua válida", () => {
    // A comparação é da keyword inteira, não substring.
    for (const kw of ["zap do jose", "posto shell br 101", "loja centro sorocaba"]) {
      expect(runtime.isGenericKeyword(kw), kw).toBe(false);
    }
  });

  it("keyword com menos de 3 caracteres é recusada", () => {
    for (const kw of ["a", "jo", "  x  "]) {
      expect(runtime.isGenericKeyword(kw), kw).toBe(true);
    }
  });
});
