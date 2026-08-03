// Testes do helper de frase padrão do QR/link de parceiros (qrPhrase.ts).
//
// Travam o comportamento que a auditoria pediu:
//   • frase padrão curta e determinística (sem IA);
//   • a keyword SEMPRE permanece no texto (atribuição por substring no webhook);
//   • frase própria do consultor é respeitada, mas ganha a keyword se faltar;
//   • nunca devolve string vazia.

import { describe, it, expect } from "vitest";
import {
  buildDefaultQrPhrase,
  resolveQrMessage,
  containsKeyword,
  QR_PHRASE_MAX,
} from "../qrPhrase";

describe("buildDefaultQrPhrase — frase padrão curta", () => {
  it("inclui a keyword quando fornecida", () => {
    const frase = buildDefaultQrPhrase("Valdenice");
    expect(frase).toContain("Valdenice");
    expect(containsKeyword(frase, "Valdenice")).toBe(true);
  });

  it("frase padrão é curta (dentro do limite recomendado)", () => {
    const frase = buildDefaultQrPhrase("Valdenice");
    expect(frase.length).toBeLessThanOrEqual(QR_PHRASE_MAX);
  });

  it("sem keyword devolve a base genérica (não vazia)", () => {
    const frase = buildDefaultQrPhrase("");
    expect(frase.length).toBeGreaterThan(0);
    expect(frase).toBe("Oi! Quero saber mais sobre o desconto na energia.");
  });

  it("trata keyword nula/undefined sem quebrar", () => {
    expect(buildDefaultQrPhrase(null).length).toBeGreaterThan(0);
    expect(buildDefaultQrPhrase(undefined).length).toBeGreaterThan(0);
  });

  it("limpa espaços extras da keyword", () => {
    const frase = buildDefaultQrPhrase("  Solar  SP  ");
    expect(frase).toContain("Solar SP");
  });
});

describe("resolveQrMessage — decisão da mensagem final", () => {
  it("aceita até 600 caracteres sem trocar pela frase padrão", () => {
    const custom = `Valdenice ${"texto personalizado ".repeat(30)}`.slice(0, 600);
    const msg = resolveQrMessage(custom, "Valdenice");
    expect(msg).toBe(custom.trim());
    expect(msg.length).toBeLessThanOrEqual(600);
  });

  it("limita acima de 600 sem substituir o começo salvo", () => {
    const custom = `Valdenice ${"x".repeat(700)}`;
    const msg = resolveQrMessage(custom, "Valdenice");
    expect(msg.length).toBe(600);
    expect(msg.startsWith("Valdenice ")).toBe(true);
  });

  it("sem frase própria usa a padrão curta com a keyword", () => {
    const msg = resolveQrMessage(null, "Valdenice");
    expect(msg).toContain("Valdenice");
    expect(msg.length).toBeLessThanOrEqual(QR_PHRASE_MAX);
  });

  it("respeita a frase do consultor quando já contém a keyword", () => {
    const custom = "Vim pela Valdenice, quero reduzir minha conta de luz";
    const msg = resolveQrMessage(custom, "Valdenice");
    expect(msg).toBe(custom);
  });

  it("anexa a keyword quando a frase do consultor não a contém", () => {
    const custom = "Quero economizar na conta de luz";
    const msg = resolveQrMessage(custom, "Valdenice");
    expect(containsKeyword(msg, "Valdenice")).toBe(true);
    expect(msg.startsWith(custom)).toBe(true);
  });

  it("considera keyword presente ignorando acento e maiúsculas", () => {
    // "João" na frase, keyword "joao" — deve ser reconhecida (mesma régua do webhook).
    const custom = "Indicação do João aqui, quero economizar";
    const msg = resolveQrMessage(custom, "joao");
    expect(msg).toBe(custom); // não anexa, já contém
  });

  it("frase vazia + keyword vazia devolve a base (nunca vazio)", () => {
    const msg = resolveQrMessage("", "");
    expect(msg.length).toBeGreaterThan(0);
  });

  it("frase salva longa é RESPEITADA (nunca troca pela padrão)", () => {
    // Regressão: frases de ~93 chars eram descartadas e o lead recebia a frase
    // padrão, ignorando o que o consultor salvou. Agora a frase salva vence.
    const longa =
      "Olá, a Valdenice me indicou você porque quero economizar na minha conta de luz e queria saber mais.";
    const msg = resolveQrMessage(longa, "Valdenice");
    expect(msg.length).toBeLessThanOrEqual(QR_PHRASE_MAX);
    expect(msg).toBe(longa);
    expect(containsKeyword(msg, "Valdenice")).toBe(true);
  });

  it("keyword longa é anexada sem descartar a frase do consultor", () => {
    const custom = "Quero muito reduzir o valor da minha conta de energia agora";
    const kw = "promocao-especial-black-friday-energia";
    const msg = resolveQrMessage(custom, kw);
    expect(msg.length).toBeLessThanOrEqual(QR_PHRASE_MAX);
    expect(msg.startsWith(custom)).toBe(true);
    expect(containsKeyword(msg, kw)).toBe(true);
  });

});

describe("resolveQrMessage — atribuição SÓ por keyword (sem marcador #R)", () => {
  it("não anexa #R mesmo recebendo shortCode", () => {
    const msg = resolveQrMessage(null, "Valdenice", "482917");
    expect(msg).not.toMatch(/#R/i);
    expect(msg).toContain("Valdenice");
  });

  it("preserva #R já digitado na frase salva pelo consultor", () => {
    const custom = "Oi, vim pela Valdenice #R482917 hoje";
    const msg = resolveQrMessage(custom, "Valdenice", "482917");
    expect(msg).toBe(custom);
  });

  it("aceita shortCode null/undefined sem quebrar", () => {
    expect(resolveQrMessage(null, "Valdenice", null)).not.toMatch(/#R/i);
    expect(resolveQrMessage(null, "Valdenice", undefined)).not.toMatch(/#R/i);
  });

  it("frase longa é respeitada e continua sem marcador", () => {
    const longa =
      "Olá, a Valdenice me indicou você porque quero economizar na minha conta de luz e queria saber mais.";
    const msg = resolveQrMessage(longa, "Valdenice", "482917");
    expect(msg).toBe(longa);
    expect(msg).not.toMatch(/#R/i);
  });
});

describe("containsKeyword — mesma régua do keyword-matcher", () => {
  it("casa por substring normalizada (sem acento/pontuação)", () => {
    expect(containsKeyword("Oi, sou a Valdência!", "valdencia")).toBe(true);
    expect(containsKeyword("conta de luz", "solar")).toBe(false);
  });

  it("keyword vazia é considerada sempre presente", () => {
    expect(containsKeyword("qualquer coisa", "")).toBe(true);
  });
});
