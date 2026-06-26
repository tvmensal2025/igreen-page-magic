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

  it("frase longa salva (acima do limite) cai na padrão curta com a keyword", () => {
    // Exatamente o caso que o usuário pegou: qr_phrase longa do "Valdenice me
    // indicou...". Deve ENCURTAR para a frase padrão, não respeitar a longa.
    const longa =
      "Olá, a Valdenice me indicou você porque quero economizar na minha conta de luz e queria saber mais.";
    const msg = resolveQrMessage(longa, "Valdenice");
    expect(msg.length).toBeLessThanOrEqual(QR_PHRASE_MAX);
    expect(msg.length).toBeLessThan(longa.length);
    expect(containsKeyword(msg, "Valdenice")).toBe(true);
  });

  it("quando anexar a keyword estouraria o limite, usa a padrão curta", () => {
    // Frase própria dentro do limite, mas sem a keyword; a keyword é longa o
    // suficiente para que custom + "(indicação: ...)" passe de QR_PHRASE_MAX.
    const custom = "Quero muito reduzir o valor da minha conta de energia agora";
    const kw = "promocao-especial-black-friday-energia";
    const msg = resolveQrMessage(custom, kw);
    expect(msg.length).toBeLessThanOrEqual(QR_PHRASE_MAX);
    expect(containsKeyword(msg, kw)).toBe(true);
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
