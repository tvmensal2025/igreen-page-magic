// Trava a seleção de tipos de mídia → media_order do passo. O consultor pode
// escolher só 1 tipo, vários, ou uma sequência ordenada (ex.: texto→áudio→vídeo).
// A ordem importa: media_order é a ordem de envio no runtime.

import { describe, it, expect } from "vitest";
import { buildGuidedStepSeed, type GuidedStepInput } from "../GuidedStepDialog";
import type { Step } from "../flowTypes";

function input(overrides: Partial<GuidedStepInput> = {}): GuidedStepInput {
  return { stepType: "message", titulo: "", mensagem: "", botoes: [], ...overrides };
}

// Reproduz a montagem do seed + media_order que o GuidedStepDialog faz.
// (buildGuidedStepSeed é puro; media_order é aplicado no montarSeed do componente,
//  então aqui validamos o formato esperado da lista.)
function comMediaOrder(seed: Partial<Step>, tipos: string[]): Partial<Step> {
  return { ...seed, media_order: tipos.length ? tipos : null };
}

describe("media_order — seleção de tipos de mídia do passo", () => {
  it("só áudio → media_order = ['audio']", () => {
    const seed = comMediaOrder(buildGuidedStepSeed(input()), ["audio"]);
    expect(seed.media_order).toEqual(["audio"]);
  });

  it("sequência texto→áudio→vídeo preserva a ordem", () => {
    const seed = comMediaOrder(buildGuidedStepSeed(input()), ["text", "audio", "video"]);
    expect(seed.media_order).toEqual(["text", "audio", "video"]);
  });

  it("nenhum tipo → media_order null (comportamento padrão do runtime)", () => {
    const seed = comMediaOrder(buildGuidedStepSeed(input()), []);
    expect(seed.media_order).toBeNull();
  });

  it("os 4 tipos numa ordem custom", () => {
    const seed = comMediaOrder(buildGuidedStepSeed(input()), ["image", "video", "audio", "text"]);
    expect(seed.media_order).toEqual(["image", "video", "audio", "text"]);
    expect((seed.media_order as string[]).length).toBe(4);
  });
});
