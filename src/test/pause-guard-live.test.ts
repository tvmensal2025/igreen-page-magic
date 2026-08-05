/**
 * Etapa 4 — bot falando depois de humano, opt-out, DNC ou bloqueio
 * (auditoria 2026-08).
 *
 * O guard re-lê o cliente antes de cada outbound. Aqui garantimos que ele
 * corta o envio nos casos de bloqueio e que uma leitura falha NÃO libera o
 * bot (fail-closed).
 */
import { describe, it, expect, vi } from "vitest";
import { wrapSenderWithLivePauseGuard } from "../../supabase/functions/_shared/bot/paused.ts";

function fakeSupabase(result: { data?: any; error?: any }) {
  const q: any = {
    select: () => q,
    eq: () => q,
    maybeSingle: async () => ({ data: result.data ?? null, error: result.error ?? null }),
  };
  return { from: () => q };
}

function makeSender() {
  return {
    sendText: vi.fn(async () => true),
    sendButtons: vi.fn(async () => true),
    sendMedia: vi.fn(async () => true),
  };
}

function guard(result: { data?: any; error?: any }) {
  const base = makeSender();
  const wrapped = wrapSenderWithLivePauseGuard(base as any, {
    supabase: fakeSupabase(result),
    consultantId: "consultor-1",
    getCustomerId: () => "lead-1",
  });
  return { base, wrapped };
}

describe("wrapSenderWithLivePauseGuard", () => {
  it("libera o envio quando o lead está normal", async () => {
    const { base, wrapped } = guard({ data: { bot_paused: false } });
    await expect(wrapped.sendText("jid", "oi")).resolves.toBe(true);
    expect(base.sendText).toHaveBeenCalled();
  });

  it.each([
    ["consultor assumiu", { bot_paused: true, bot_paused_reason: "handoff_request" }],
    ["humano vinculado", { assigned_human_id: "user-1" }],
    ["opt-out", { bot_paused_reason: "opt_out" }],
    ["DNC", { do_not_contact: true }],
    ["pausa programada no futuro", { bot_paused_until: new Date(Date.now() + 60_000).toISOString() }],
  ])("não envia texto — %s", async (_label, row) => {
    const { base, wrapped } = guard({ data: row });
    await expect(wrapped.sendText("jid", "oi")).resolves.toBe(false);
    expect(base.sendText).not.toHaveBeenCalled();
  });

  it("bloqueia também botões e mídia", async () => {
    const { base, wrapped } = guard({ data: { do_not_contact: true } });
    await expect(wrapped.sendButtons!("jid", "msg", [])).resolves.toBe(false);
    await expect(wrapped.sendMedia!("jid", "url", "", "audio")).resolves.toBe(false);
    expect(base.sendButtons).not.toHaveBeenCalled();
    expect(base.sendMedia).not.toHaveBeenCalled();
  });

  it("fail-closed: leitura com erro não libera o bot", async () => {
    const { base, wrapped } = guard({ error: { message: "connection reset" } });
    await expect(wrapped.sendText("jid", "oi")).resolves.toBe(false);
    expect(base.sendText).not.toHaveBeenCalled();
  });

  it("modo captação manual continua respondendo (OCR precisa rodar)", async () => {
    const { base, wrapped } = guard({
      data: { bot_paused: true, bot_paused_reason: "manual_capture" },
    });
    await expect(wrapped.sendText("jid", "oi")).resolves.toBe(true);
    expect(base.sendText).toHaveBeenCalled();
  });
});
