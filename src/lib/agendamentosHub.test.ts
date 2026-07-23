import { describe, expect, it } from "vitest";
import {
  buildAgendamentosTimeline,
  groupTimelineByDay,
  type BulkCampaignRow,
  type CadenceScheduleRow,
  type DailyReheatRow,
  type ScheduledMessageRow,
} from "@/lib/agendamentosHub";

const baseManual: ScheduledMessageRow = {
  id: "m1",
  remote_jid: "5511999999999@s.whatsapp.net",
  message_text: "Oi!",
  scheduled_at: new Date(Date.now() + 3600_000).toISOString(),
  status: "pending",
  sent_at: null,
};

const baseBulk: BulkCampaignRow = {
  id: "b1",
  name: "Campanha teste",
  status: "running",
  total: 10,
  sent: 3,
  failed: 0,
  scheduled_at: null,
  started_at: new Date().toISOString(),
};

describe("buildAgendamentosTimeline", () => {
  it("inclui agendamento manual pendente com badge 'Agenda manual'", () => {
    const items = buildAgendamentosTimeline({ manual: [baseManual], posVenda: [], botFollowups: [], bulk: [] });
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("manual_scheduled");
    expect(items[0].badge).toBe("Agenda manual");
    expect(items[0].status).toBe("pending");
  });

  it("NÃO inclui manual cancelada/enviada/processing na timeline de próximos envios", () => {
    const items = buildAgendamentosTimeline({
      manual: [
        { ...baseManual, id: "m2", status: "cancelled" },
        { ...baseManual, id: "m3", status: "sent" },
        { ...baseManual, id: "m4", status: "processing" },
        { ...baseManual, id: "m5", status: "skipped" },
      ],
      posVenda: [],
      botFollowups: [],
      bulk: [],
    });
    expect(items).toHaveLength(0);
  });

  it("manual com horário vencido aparece como overdue (vai sair agora)", () => {
    const items = buildAgendamentosTimeline({
      manual: [{ ...baseManual, scheduled_at: new Date(Date.now() - 60_000).toISOString() }],
      posVenda: [],
      botFollowups: [],
      bulk: [],
    });
    expect(items[0].status).toBe("overdue");
  });

  it("campanha pausada ganha badge de atenção (não some do radar)", () => {
    const items = buildAgendamentosTimeline({
      manual: [],
      posVenda: [],
      botFollowups: [],
      bulk: [{ ...baseBulk, status: "paused" }],
    });
    expect(items).toHaveLength(1);
    expect(items[0].badge).toContain("pausada");
    expect(items[0].status).toBe("pending");
  });

  it("campanha rodando mantém badge de andamento", () => {
    const items = buildAgendamentosTimeline({ manual: [], posVenda: [], botFollowups: [], bulk: [baseBulk] });
    expect(items[0].badge).toBe("Campanha WA em andamento");
    expect(items[0].status).toBe("running");
  });

  it("inclui campanha de ligação agendada na timeline e no contador de campanhas", () => {
    const items = buildAgendamentosTimeline({
      manual: [],
      posVenda: [],
      botFollowups: [],
      bulk: [],
      voice: [{
        id: "v1",
        name: "Campanha de ligação",
        status: "scheduled",
        total: 76,
        dialed: 0,
        answered: 0,
        failed: 0,
        scheduled_at: new Date(Date.now() + 3600_000).toISOString(),
        started_at: null,
        created_at: new Date().toISOString(),
      }],
    });
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("voice_campaign");
    expect(items[0].badge).toBe("Ligação agendada");
    expect(items[0].preview).toContain("0/76");
  });

  it("ordena por horário crescente", () => {
    const later = { ...baseManual, id: "m-later", scheduled_at: new Date(Date.now() + 7200_000).toISOString() };
    const sooner = { ...baseManual, id: "m-sooner", scheduled_at: new Date(Date.now() + 600_000).toISOString() };
    const items = buildAgendamentosTimeline({ manual: [later, sooner], posVenda: [], botFollowups: [], bulk: [] });
    expect(items.map((i) => i.id)).toEqual(["manual-m-sooner", "manual-m-later"]);
  });

  it("cadência expõe channel e pizzaGroup", () => {
    const cadence: CadenceScheduleRow[] = [{
      id: "c1",
      customer_id: "cust-1",
      stage: "COLD_1",
      next_action_at: new Date(Date.now() + 3600_000).toISOString(),
      paused_until: null,
      customer_name: "Maria",
      customer_phone: "5511999999999",
    }];
    const items = buildAgendamentosTimeline({
      manual: [],
      posVenda: [],
      botFollowups: [],
      bulk: [],
      cadence,
    });
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("cadence_send");
    expect(items[0].channel).toBe("whatsapp");
    expect(items[0].pizzaGroup).toBe("B");
    expect(items[0].motorLabel).toBe("Motor A→B→C");
  });

  it("inclui daily_reheat planned com actionsPreview", () => {
    const reheat: DailyReheatRow[] = [{
      id: "r1",
      customer_id: "cust-2",
      queue: "A",
      step: "nudge",
      status: "planned",
      next_action_at: new Date(Date.now() + 1800_000).toISOString(),
      planned_actions: ["send_audio", "sms"],
      customer_name: "João",
    }];
    const items = buildAgendamentosTimeline({
      manual: [],
      posVenda: [],
      botFollowups: [],
      bulk: [],
      dailyReheat: reheat,
    });
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("daily_reheat");
    expect(items[0].pizzaGroup).toBe("A");
    expect(items[0].actionsPreview).toEqual(["Áudio", "SMS"]);
    expect(items[0].channel).toBe("mixed");
  });

  it("deduplica reheat quando cadência do mesmo lead está na mesma janela", () => {
    const at = new Date(Date.now() + 3600_000).toISOString();
    const items = buildAgendamentosTimeline({
      manual: [],
      posVenda: [],
      botFollowups: [],
      bulk: [],
      cadence: [{
        id: "c1",
        customer_id: "same",
        stage: "A_NUDGE",
        next_action_at: at,
        paused_until: null,
        customer_name: "Lead",
      }],
      dailyReheat: [{
        id: "r1",
        customer_id: "same",
        queue: "A",
        step: "nudge",
        status: "planned",
        next_action_at: at,
        planned_actions: ["send_audio"],
        customer_name: "Lead",
      }],
    });
    expect(items.map((i) => i.kind)).toEqual(["cadence_send"]);
  });

  it("groupTimelineByDay separa atrasados e hoje", () => {
    const overdue = {
      ...baseManual,
      id: "over",
      scheduled_at: new Date(Date.now() - 3600_000).toISOString(),
    };
    const soon = {
      ...baseManual,
      id: "soon",
      scheduled_at: new Date(Date.now() + 600_000).toISOString(),
    };
    const items = buildAgendamentosTimeline({
      manual: [overdue, soon],
      posVenda: [],
      botFollowups: [],
      bulk: [],
    });
    const groups = groupTimelineByDay(items);
    expect(groups.some((g) => g.key === "overdue")).toBe(true);
    expect(groups.some((g) => g.key === "today")).toBe(true);
  });
});
