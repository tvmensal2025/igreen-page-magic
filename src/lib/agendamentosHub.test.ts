import { describe, expect, it } from "vitest";
import { buildAgendamentosTimeline, type BulkCampaignRow, type ScheduledMessageRow } from "@/lib/agendamentosHub";

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
});
