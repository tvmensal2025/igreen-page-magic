import { describe, it, expect } from "vitest";
import { buildUpcomingPosVendaMessages, groupSentStageKeys } from "./posVendaSchedule";

describe("buildUpcomingPosVendaMessages", () => {
  const now = new Date("2026-06-24T12:00:00.000Z");
  const approvedAt = "2026-05-01T10:00:00.000Z";

  it("lista aprovado + marcos futuros para cliente aprovado sem envios", () => {
    const items = buildUpcomingPosVendaMessages(
      [{
        id: "c1",
        name: "Maria",
        phone_whatsapp: "5511999999999",
        pos_venda_stage: "aprovado",
        pos_venda_approved_at: approvedAt,
      }],
      new Map(),
      { aprovado: "Parabéns!", d30: "30 dias" },
      now,
    );
    const keys = items.map((i) => i.stageKey);
    expect(keys).toContain("pv_aprovado");
    expect(keys).toContain("pv_d30");
    expect(keys).toContain("pv_d60");
    expect(items.find((i) => i.stageKey === "pv_aprovado")?.isOverdue).toBe(true);
    expect(items.find((i) => i.stageKey === "pv_d120")?.isOverdue).toBe(false);
  });

  it("omite marcos já enviados", () => {
    const sent = groupSentStageKeys([
      { customer_id: "c1", stage_key: "pv_aprovado" },
      { customer_id: "c1", stage_key: "pv_d30" },
    ]);
    const items = buildUpcomingPosVendaMessages(
      [{
        id: "c1",
        name: "João",
        phone_whatsapp: "5511888888888",
        pos_venda_stage: "d30",
        pos_venda_approved_at: approvedAt,
      }],
      sent,
      {},
      now,
    );
    expect(items.some((i) => i.stageKey === "pv_aprovado")).toBe(false);
    expect(items.some((i) => i.stageKey === "pv_d30")).toBe(false);
    expect(items.some((i) => i.stageKey === "pv_d60")).toBe(true);
  });

  it("ignora clientes em espera", () => {
    const items = buildUpcomingPosVendaMessages(
      [{
        id: "c2",
        name: "Ana",
        phone_whatsapp: "5511777777777",
        pos_venda_stage: "espera",
        pos_venda_approved_at: null,
      }],
      new Map(),
      {},
      now,
    );
    expect(items).toHaveLength(0);
  });
});
