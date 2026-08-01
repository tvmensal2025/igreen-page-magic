import { describe, expect, it } from "vitest";
import {
  hasUsableHandoffPhone,
  isHandoffBotPauseReason,
  isHandoffClienteNotLead,
  classifyPauseReason,
  formatHandoffReason,
} from "./handoffReturnToPizza";

describe("isHandoffBotPauseReason", () => {
  it("reconhece takeover humano", () => {
    expect(isHandoffBotPauseReason("humano_assumiu")).toBe(true);
    expect(isHandoffBotPauseReason("humano_assumiu_audio")).toBe(true);
    expect(isHandoffBotPauseReason("ai_handoff_duvidas")).toBe(true);
    expect(isHandoffBotPauseReason("low_confidence_handoff")).toBe(true);
  });

  it("ignora opt-out / complaint", () => {
    expect(isHandoffBotPauseReason("opt_out")).toBe(false);
    expect(isHandoffBotPauseReason("complaint")).toBe(false);
    expect(isHandoffBotPauseReason("attendance_rated")).toBe(false);
  });
});

describe("isHandoffClienteNotLead", () => {
  it("carteira igreen_sync não é lead", () => {
    expect(
      isHandoffClienteNotLead({
        id: "1",
        name: "Osmar",
        phone_whatsapp: "553496646917",
        conversation_step: null,
        bot_paused: true,
        bot_paused_reason: "humano_assumiu",
        customer_origin: "igreen_sync",
        status: "approved",
        andamento_igreen: "validado",
        pos_venda_stage: "aprovado",
      }),
    ).toBe(true);
  });

  it("lead whatsapp não é cliente", () => {
    expect(
      isHandoffClienteNotLead({
        id: "2",
        name: "Novo",
        phone_whatsapp: "5511999999999",
        conversation_step: "a1",
        bot_paused: true,
        bot_paused_reason: "humano_assumiu",
        customer_origin: "whatsapp_lead",
        status: "pending",
      }),
    ).toBe(false);
  });

  it("is_converted = true não é lead", () => {
    expect(
      isHandoffClienteNotLead({
        id: "3",
        name: "Convertido",
        phone_whatsapp: "5511888888888",
        conversation_step: null,
        bot_paused: false,
        bot_paused_reason: null,
        customer_origin: "whatsapp_lead",
        is_converted: true,
      }),
    ).toBe(true);
  });
});

describe("handoff painel — quem NÃO entra", () => {
  it("cliente carteira (Osmar) é cliente, não lead", () => {
    expect(
      isHandoffClienteNotLead({
        id: "osmar",
        name: "OSMAR PEREIRA GOMES",
        phone_whatsapp: "553496646917",
        conversation_step: null,
        bot_paused: false,
        bot_paused_reason: null,
        customer_origin: "igreen_sync",
        status: "approved",
        pos_venda_stage: "aprovado",
        andamento_igreen: "validado",
      }),
    ).toBe(true);
  });

  it("opt_out / complaint não são motivo de handoff", () => {
    expect(isHandoffBotPauseReason("opt_out")).toBe(false);
    expect(isHandoffBotPauseReason("complaint")).toBe(false);
  });
});

describe("classifyPauseReason", () => {
  it("humano → handoff", () => {
    expect(classifyPauseReason("humano_assumiu")).toBe("handoff");
    expect(classifyPauseReason("handoff_humano")).toBe("handoff");
  });

  it("dnc → security", () => {
    expect(classifyPauseReason("dnc")).toBe("security");
  });
});

describe("hasUsableHandoffPhone", () => {
  it("aceita BR com 55", () => {
    expect(hasUsableHandoffPhone("5519998804421")).toBe(true);
  });
  it("rejeita sem_celular", () => {
    expect(hasUsableHandoffPhone("sem_celular_abc")).toBe(false);
  });
});

describe("formatHandoffReason", () => {
  it("label humano_assumiu", () => {
    expect(formatHandoffReason("humano_assumiu")).toContain("assumiu");
  });
});
