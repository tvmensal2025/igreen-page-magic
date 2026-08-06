import { describe, expect, it } from "vitest";
import {
  describePartnerNextStep,
  formatPartnerTimeUntil,
  formatPartnerScheduleWhen,
  buildPartnerLeadCardText,
} from "./partnerPortalNextStep";

describe("partnerPortalNextStep", () => {
  it("handoff: Sofia volta no Zap", () => {
    const s = describePartnerNextStep({
      stage: "PAUSED",
      pausedReason: "handoff_humano",
      nextActionAt: "2026-08-07T20:00:00Z",
    });
    expect(s.isHandoff).toBe(true);
    expect(s.what).toMatch(/Sofia/i);
    expect(s.channel).toBe("Zap");
  });

  it("AI_QUALIFYING próximo é Sofia no Zap", () => {
    const s = describePartnerNextStep({
      stage: "AI_QUALIFYING",
      nextActionAt: "2026-08-06T18:00:00Z",
    });
    expect(s.channel).toBe("Zap");
    expect(s.what).toMatch(/Sofia/i);
  });

  it("COLD_1 próximo é SMS", () => {
    const s = describePartnerNextStep({ stage: "COLD_1" });
    expect(s.channel).toBe("SMS");
    expect(s.shortLabel).toBe("SMS D+1");
  });

  it("tempo restante em português claro", () => {
    const future = new Date("2030-06-01T12:00:00Z").getTime();
    const r = formatPartnerTimeUntil("2030-06-01T12:00:00Z", future - 3_600_000 * 5);
    expect(r.text).toMatch(/Faltam 5 horas/i);
    expect(r.tone).toBe("later");
  });

  it("card handoff em linguagem leiga", () => {
    const future = new Date("2030-06-01T15:00:00Z").getTime();
    const card = buildPartnerLeadCardText({
      isHandoff: true,
      stageNotice: "O consultor está atendendo essa pessoa agora.",
      nextStepWhat: "A Sofia manda outra mensagem no Zap",
      nextActionAt: "2030-06-01T15:00:00Z",
      nowMs: future - 3_600_000,
    });
    expect(card.nowLine).toMatch(/consultor/i);
    expect(card.nextLine).toMatch(/Sofia/i);
    expect(card.nextLine).toMatch(/faltam/i);
  });

  it("countdown mostra atraso em português", () => {
    const past = new Date("2020-01-01T12:00:00Z").getTime();
    const c = formatPartnerTimeUntil("2020-01-01T12:00:00Z", past + 120_000);
    expect(c.tone).toBe("overdue");
    expect(c.text).toMatch(/Passou há/i);
  });

  it("formata horário curto", () => {
    const t = formatPartnerScheduleWhen("2026-08-07T20:16:35Z");
    expect(t).toMatch(/\d{2}\/\d{2}/);
    expect(t).toMatch(/às \d{2}h\d{2}/);
  });
});
