// Trava a simulação do cliente fictício usada no preview do estúdio da Iris.
// Garante que cada tipo de passo gera a resposta coerente (nome, telefone,
// foto da conta…) e que passos informativos não inventam resposta.

import { describe, it, expect } from "vitest";
import {
  simulatedClientReply,
  botConfirmationAfter,
  PREVIEW_PERSONA,
  type Step,
} from "../flowTypes";

function mkStep(over: Partial<Step>): Step {
  return {
    id: "s", flow_id: "f", position: 1, step_type: "message", step_key: null,
    title: "Passo", summary: null, icon: "msg", message_text: "", text_delay_ms: null,
    slot_key: null, transitions: [], captures: [], fallback: { mode: "repeat" },
    is_active: true, ...over,
  } as Step;
}

describe("simulatedClientReply — cliente fictício coerente", () => {
  it("capture_name → cliente responde o nome da persona", () => {
    const r = simulatedClientReply(mkStep({ step_type: "capture_name" }));
    expect(r).toEqual({ kind: "text", text: PREVIEW_PERSONA.nome });
  });

  it("confirm_phone → cliente responde o telefone da persona", () => {
    const r = simulatedClientReply(mkStep({ step_type: "confirm_phone" }));
    expect(r).toEqual({ kind: "text", text: PREVIEW_PERSONA.telefone });
  });

  it("capture_email → cliente responde o e-mail da persona", () => {
    const r = simulatedClientReply(mkStep({ step_type: "capture_email" }));
    expect(r).toEqual({ kind: "text", text: PREVIEW_PERSONA.email });
  });

  it("capture_conta → cliente envia mídia (foto da conta)", () => {
    const r = simulatedClientReply(mkStep({ step_type: "capture_conta" }));
    expect(r?.kind).toBe("media");
  });

  it("capture_documento → cliente envia mídia (foto do documento)", () => {
    const r = simulatedClientReply(mkStep({ step_type: "capture_documento" }));
    expect(r?.kind).toBe("media");
  });

  it("mensagem sem botões → não há resposta simulada", () => {
    const r = simulatedClientReply(mkStep({ step_type: "message" }));
    expect(r).toBeNull();
  });

  it("mensagem COM botões → cliente clica no primeiro botão", () => {
    const step = mkStep({
      step_type: "message",
      captures: [{ field: "_buttons", enabled: true, value: [{ id: "sim", title: "✅ Sim" }] }],
    });
    const r = simulatedClientReply(step);
    expect(r).toEqual({ kind: "text", text: "✅ Sim" });
  });
});

describe("botConfirmationAfter — confirmação de leitura (OCR)", () => {
  it("capture_conta confirma o valor lido", () => {
    expect(botConfirmationAfter(mkStep({ step_type: "capture_conta" }))).toContain("R$ 450,00");
  });
  it("capture_documento confirma o nome lido", () => {
    expect(botConfirmationAfter(mkStep({ step_type: "capture_documento" }))).toContain("João Silva");
  });
  it("mensagem comum não gera confirmação", () => {
    expect(botConfirmationAfter(mkStep({ step_type: "message" }))).toBeNull();
  });
});
