import { describe, expect, it, vi } from "vitest";

// buildStageConfigPatch é pura; mockamos o client para importar o módulo
// sem criar conexão Supabase real.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { buildStageConfigPatch } from "./syncCadenceToBotFlow";
import {
  MULTICHANNEL_CADENCE_TEMPLATES,
  WHAPI_MAX_BUTTON_TITLE,
  emptyLibrary,
} from "./multichannelCadenceTexts";

const tplByKey = (key: string) => {
  const tpl = MULTICHANNEL_CADENCE_TEMPLATES.find((t) => t.key === key);
  if (!tpl) throw new Error(`template ${key} não encontrado`);
  return tpl;
};

describe("buildStageConfigPatch (ContentContract B/C)", () => {
  it("whatsapp_buttons: texto + botões do catálogo", () => {
    const lib = emptyLibrary();
    const { patch, buttonErrors } = buildStageConfigPatch(tplByKey("b1_wa_reopen"), lib);
    expect(buttonErrors).toEqual([]);
    expect(String(patch.message_text || "")).toContain("{{nome}}");
    const buttons = patch.buttons as Array<{ id: string; title: string }>;
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.length).toBeLessThanOrEqual(3);
    for (const b of buttons) {
      expect(b.id).toBeTruthy();
      expect(b.title.length).toBeLessThanOrEqual(WHAPI_MAX_BUTTON_TITLE);
    }
  });

  it("sms: só texto, sem campo buttons", () => {
    const lib = emptyLibrary();
    const { patch } = buildStageConfigPatch(tplByKey("b3_sms_1"), lib);
    expect("buttons" in patch).toBe(false);
    expect(String(patch.message_text || "")).toContain("wa.me");
  });

  it("override do painel vence o template", () => {
    const lib = emptyLibrary();
    lib.buttons["b1_wa_reopen"] = [
      { id: "bill_low", title: "Até R$250" },
      { id: "bill_mid", title: "R$250 a R$600" },
    ];
    const { patch, buttonErrors } = buildStageConfigPatch(tplByKey("b1_wa_reopen"), lib);
    expect(buttonErrors).toEqual([]);
    expect(patch.buttons).toEqual([
      { id: "bill_low", title: "Até R$250" },
      { id: "bill_mid", title: "R$250 a R$600" },
    ]);
  });

  it("botão inválido: erro reportado e campo buttons fora do patch", () => {
    const lib = emptyLibrary();
    lib.buttons["b1_wa_reopen"] = [
      { id: "bill_low", title: "Um título grande demais para caber no Whapi" },
    ];
    const { patch, buttonErrors } = buildStageConfigPatch(tplByKey("b1_wa_reopen"), lib);
    expect(buttonErrors.length).toBeGreaterThan(0);
    expect("buttons" in patch).toBe(false);
    // texto continua sincronizável mesmo com botões inválidos
    expect(String(patch.message_text || "").length).toBeGreaterThan(0);
  });

  it("recall C com botões também entra no contrato", () => {
    const lib = emptyLibrary();
    const { patch, buttonErrors } = buildStageConfigPatch(tplByKey("c_recall_60d_wa"), lib);
    expect(buttonErrors).toEqual([]);
    expect(Array.isArray(patch.buttons)).toBe(true);
  });

  it("call_script: texto + voice_audio_clip_id quando há clip", () => {
    const lib = emptyLibrary();
    lib.audioClipIds["b4_call_1"] = "clip-sofia-call-1";
    const { patch } = buildStageConfigPatch(tplByKey("b4_call_1"), lib);
    expect(String(patch.message_text || "").length).toBeGreaterThan(0);
    expect(patch.voice_audio_clip_id).toBe("clip-sofia-call-1");
  });

  it("call_script: aceita clip com sufixo de gênero", () => {
    const lib = emptyLibrary();
    lib.audioClipIds["b4_call_1__feminino"] = "clip-f";
    const { patch } = buildStageConfigPatch(tplByKey("b4_call_1"), lib);
    expect(patch.voice_audio_clip_id).toBe("clip-f");
  });

  it("sms: nunca grava voice_audio_clip_id", () => {
    const lib = emptyLibrary();
    lib.audioClipIds["b3_sms_1"] = "should-ignore";
    const { patch } = buildStageConfigPatch(tplByKey("b3_sms_1"), lib);
    expect("voice_audio_clip_id" in patch).toBe(false);
  });
});
