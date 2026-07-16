import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: vi.fn(),
    },
  },
}));

vi.mock("@/services/messageSender", () => ({
  sendWhatsAppMessage: vi.fn(),
}));

import { supabase } from "@/integrations/supabase/client";
import { sendWhatsAppMessage } from "@/services/messageSender";
import {
  runAttendanceBatch,
  hasValidBatchPhone,
} from "@/components/captacao/runAttendanceBatch";

describe("hasValidBatchPhone", () => {
  it("rejeita vazio, sem_celular e curto", () => {
    expect(hasValidBatchPhone(null)).toBe(false);
    expect(hasValidBatchPhone("sem_celular")).toBe(false);
    expect(hasValidBatchPhone("123")).toBe(false);
  });
  it("aceita telefone com DDD", () => {
    expect(hasValidBatchPhone("11971254913")).toBe(true);
    expect(hasValidBatchPhone("+55 (11) 97125-4913")).toBe(true);
  });
});

describe("runAttendanceBatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marca sem telefone como failed sem chamar APIs", async () => {
    const results = await runAttendanceBatch({
      consultantId: "c1",
      instanceName: "inst",
      isWhapi: false,
      leads: [{ id: "a", name: "A", phone_whatsapp: null, welcome_sent_at: null }],
      startAttendance: true,
      audioUrl: null,
      imageUrl: null,
      delayMs: 0,
    });
    expect(results[0].status).toBe("failed");
    expect(results[0].detail).toBe("Sem telefone");
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });

  it("reabre protocolo com restart quando já iniciado e sem mídia", async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({
      data: { ok: true, protocol: "IG-1" },
      error: null,
    } as any);

    const results = await runAttendanceBatch({
      consultantId: "c1",
      instanceName: "inst",
      isWhapi: false,
      leads: [{
        id: "a",
        name: "A",
        phone_whatsapp: "11999999999",
        welcome_sent_at: "2026-01-01T00:00:00Z",
      }],
      startAttendance: true,
      audioUrl: null,
      imageUrl: null,
      delayMs: 0,
    });

    expect(supabase.functions.invoke).toHaveBeenCalledWith(
      "start-customer-attendance",
      expect.objectContaining({
        body: expect.objectContaining({
          customerId: "a",
          consultantId: "c1",
          restart: true,
        }),
      }),
    );
    expect(results[0].status).toBe("ok");
    expect(results[0].detail).toMatch(/reaberto/i);
  });

  it("respeita AbortSignal e marca restantes como Parado", async () => {
    const ac = new AbortController();
    vi.mocked(supabase.functions.invoke).mockImplementation(async () => {
      ac.abort();
      return { data: { ok: true }, error: null } as any;
    });
    vi.mocked(sendWhatsAppMessage).mockResolvedValue({ status: "sent" } as any);

    const results = await runAttendanceBatch({
      consultantId: "c1",
      instanceName: "inst",
      isWhapi: true,
      leads: [
        { id: "a", name: "A", phone_whatsapp: "11999999999", welcome_sent_at: null },
        { id: "b", name: "B", phone_whatsapp: "11888888888", welcome_sent_at: null },
      ],
      startAttendance: true,
      audioUrl: "https://example.com/a.ogg",
      imageUrl: null,
      delayMs: 0,
      signal: ac.signal,
    });

    expect(results.some((r) => r.detail === "Parado" || r.status === "skipped")).toBe(true);
  });

  it("não muta o array original de leads", async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({
      data: { ok: true },
      error: null,
    } as any);
    const leads = [
      { id: "a", name: "A", phone_whatsapp: "11999999999", welcome_sent_at: null as string | null },
    ];
    const before = leads[0].welcome_sent_at;
    await runAttendanceBatch({
      consultantId: "c1",
      instanceName: "inst",
      isWhapi: false,
      leads,
      startAttendance: true,
      audioUrl: null,
      imageUrl: null,
      delayMs: 0,
    });
    expect(leads[0].welcome_sent_at).toBe(before);
  });
});
