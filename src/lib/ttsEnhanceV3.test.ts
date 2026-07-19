import { describe, expect, it } from "vitest";
import {
  enhanceScriptForV3,
  ensureSoftEdges,
  formatNameGreetForTts,
  prepareTtsSegment,
  MODEL_V2,
  MODEL_V3,
} from "./ttsEnhanceV3";

describe("enhanceScriptForV3", () => {
  it("normaliza espaços", () => {
    expect(enhanceScriptForV3("  olá   mundo  ")).toBe("olá mundo");
  });

  it("não empilha reticências após ponto (pausa gigante)", () => {
    const out = enhanceScriptForV3("Primeira frase. Segunda frase.");
    expect(out).toBe("Primeira frase. Segunda frase.");
    expect(out).not.toContain("....");
  });

  it("suaviza reticências já exageradas", () => {
    expect(enhanceScriptForV3("Olá.... mundo")).toBe("Olá. mundo");
  });

  it("namePause vira chamada contínua (vírgula, sem pausa longa)", () => {
    const out = enhanceScriptForV3("Olá, Maria.", { namePause: true });
    expect(out).toBe("Olá, Maria!");
    expect(out).not.toContain("[short pause]");
    expect(out).not.toContain("....");
  });

  it("namePause com Então também é contínuo (passo 3)", () => {
    const out = enhanceScriptForV3("Então, Maria.", { namePause: true });
    expect(out).toBe("Então, Maria!");
    expect(formatNameGreetForTts("Então, João.")).toBe("Então, João!");
  });


  it("edgePad coloca respiro no início e no fim", () => {
    const out = enhanceScriptForV3("Seja muito bem-vinda.", { edgePad: true });
    expect(out.startsWith("...")).toBe(true);
    expect(out.endsWith("...")).toBe(true);
    expect(out).toContain("Seja muito bem-vinda");
  });

  it("edgePad mantém pergunta no fim", () => {
    const out = ensureSoftEdges("Qual melhor horário?");
    expect(out.endsWith("?")).toBe(true);
    expect(out.startsWith("...")).toBe(true);
  });

  it("excitedOpen prefixa tag uma vez", () => {
    const out = enhanceScriptForV3("Atenção, moradores!", { excitedOpen: true });
    expect(out.startsWith("[excited]")).toBe(true);
  });

  it("não duplica tag se já existir", () => {
    const out = enhanceScriptForV3("[excited] Já tem", { excitedOpen: true });
    expect(out.match(/\[excited\]/g)?.length).toBe(1);
  });
});

describe("formatNameGreetForTts", () => {
  it("Olá, Nome. → Olá, Nome! (contínuo — reticências soavam como corte)", () => {
    expect(formatNameGreetForTts("Olá, João.")).toBe("Olá, João!");
  });
});

describe("prepareTtsSegment", () => {
  it("v2 com namePause ainda formata cumprimento", () => {
    expect(prepareTtsSegment("Olá, Ana.", MODEL_V2, { namePause: true })).toBe("Olá, Ana!");
  });


  it("v3 aplica enhance", () => {
    expect(prepareTtsSegment("Atenção!", MODEL_V3, { excitedOpen: true })).toMatch(/^\[excited\]/);
  });
});
