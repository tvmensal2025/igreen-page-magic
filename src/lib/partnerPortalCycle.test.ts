import { describe, expect, it } from "vitest";
import {
  classifyPartnerCycleLead,
  countBySlice,
  stageNoticeForSlice,
} from "@/lib/partnerPortalCycle";

describe("partnerPortalCycle", () => {
  it("classifica NEW na fatia Entrada (A)", () => {
    const c = classifyPartnerCycleLead({
      id: "1",
      name: "Maria Silva",
      name_source: "manual",
      phone_whatsapp: "5511999998888",
      status: "pending",
      stage: "NEW",
      do_not_contact: false,
    });
    expect(c?.group).toBe("A");
    expect(c?.sliceId).toBe("ask_name");
    expect(c?.displayName).toBe("Maria Silva");
    expect(c?.phoneDisplay).toMatch(/11/);
    expect(c?.stageNotice).toMatch(/WhatsApp/i);
  });

  it("sem stage e sem fila fica fora da pizza", () => {
    const c = classifyPartnerCycleLead({
      id: "empty",
      phone_whatsapp: "11999990000",
      status: "pending",
      stage: null,
    });
    expect(c).toBeNull();
  });

  it("fila A tem prioridade sobre stage", () => {
    const c = classifyPartnerCycleLead({
      id: "q",
      phone_whatsapp: "11999991111",
      status: "pending",
      stage: "COLD_1",
      queue_queue: "A",
      queue_step: "sms",
      active_cadence: true,
    });
    expect(c?.group).toBe("A");
    expect(c?.sliceId).toBe("sms");
  });

  it("exclui pós-venda mesmo com stage", () => {
    const c = classifyPartnerCycleLead({
      id: "pv",
      phone_whatsapp: "11999992222",
      status: "pending",
      stage: "NEW",
      pos_venda_stage: "d30",
    });
    expect(c).toBeNull();
  });

  it("classifica COLD_1 em B d1", () => {
    const c = classifyPartnerCycleLead({
      id: "2",
      phone_whatsapp: "11988887777",
      status: "pending",
      stage: "COLD_1",
      active_cadence: true,
    });
    expect(c?.group).toBe("B");
    expect(c?.sliceId).toBe("d1");
  });

  it("classifica RECALL_60D em C r30", () => {
    const c = classifyPartnerCycleLead({
      id: "3",
      phone_whatsapp: "11977776666",
      status: "pending",
      stage: "RECALL_60D",
      active_cadence: true,
    });
    expect(c?.group).toBe("C");
    expect(c?.sliceId).toBe("r30");
  });

  it("exclui bloqueado", () => {
    const c = classifyPartnerCycleLead({
      id: "4",
      phone_whatsapp: "11966665555",
      status: "pending",
      stage: "NEW",
      do_not_contact: true,
    });
    expect(c).toBeNull();
  });

  it("PAUSED Grupo A vai para flow", () => {
    const c = classifyPartnerCycleLead({
      id: "5",
      phone_whatsapp: "11955554444",
      status: "pending",
      stage: "PAUSED",
      paused_reason: "lead_responded",
    });
    expect(c?.group).toBe("A");
    expect(c?.sliceId).toBe("flow");
  });

  it("stageNotice usa texto amigável", () => {
    expect(stageNoticeForSlice("sms", "A_SMS")).toMatch(/SMS/i);
    expect(stageNoticeForSlice("call1", "A_CALL")).toMatch(/Ligação/i);
  });

  it("countBySlice agrega", () => {
    const leads = [
      classifyPartnerCycleLead({
        id: "a",
        phone_whatsapp: "11911112222",
        status: "pending",
        stage: "NEW",
      })!,
      classifyPartnerCycleLead({
        id: "b",
        phone_whatsapp: "11911113333",
        status: "pending",
        stage: "A_SMS",
      })!,
    ];
    const counts = countBySlice(leads, "A");
    expect(counts.ask_name).toBe(1);
    expect(counts.sms).toBe(1);
  });
});
