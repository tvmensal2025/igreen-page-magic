import { describe, expect, it } from "vitest";
import {
  hasUsableHandoffPhone,
  isHandoffBotPauseReason,
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
