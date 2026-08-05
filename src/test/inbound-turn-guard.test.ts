/**
 * Etapa 5 — cadência concorrendo com a resposta inbound (auditoria 2026-08).
 *
 * Enquanto o webhook segura o turno do lead (`bot_processing_until`) ou há
 * rajada na fila (`pending_inbound_message_id`), o toque proativo espera.
 * Envio manual do consultor não passa por esse gate.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { isInboundTurnInProgress } from "../../supabase/functions/_shared/bot/outbound-gate.ts";

const FN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../supabase/functions");

function fakeSupabase(result: { data?: any; error?: any }) {
  const q: any = {
    select: () => q,
    eq: () => q,
    maybeSingle: async () => ({ data: result.data ?? null, error: result.error ?? null }),
  };
  return { from: () => q } as any;
}

const inFuture = new Date(Date.now() + 60_000).toISOString();
const inPast = new Date(Date.now() - 60_000).toISOString();

describe("isInboundTurnInProgress", () => {
  it("bloqueia enquanto o lock do turno está válido", async () => {
    const sb = fakeSupabase({ data: { bot_processing_until: inFuture } });
    await expect(isInboundTurnInProgress(sb, "lead-1")).resolves.toBe(true);
  });

  it("bloqueia enquanto há rajada inbound na fila", async () => {
    const sb = fakeSupabase({
      data: { bot_processing_until: inPast, pending_inbound_message_id: "m2" },
    });
    await expect(isInboundTurnInProgress(sb, "lead-1")).resolves.toBe(true);
  });

  it("libera com lock expirado e fila vazia", async () => {
    const sb = fakeSupabase({
      data: { bot_processing_until: inPast, pending_inbound_message_id: null },
    });
    await expect(isInboundTurnInProgress(sb, "lead-1")).resolves.toBe(false);
  });

  it("libera quando nunca houve lock", async () => {
    const sb = fakeSupabase({ data: { bot_processing_until: null } });
    await expect(isInboundTurnInProgress(sb, "lead-1")).resolves.toBe(false);
  });

  it("erro de leitura não trava a cadência", async () => {
    const sb = fakeSupabase({ error: { message: "timeout" } });
    await expect(isInboundTurnInProgress(sb, "lead-1")).resolves.toBe(false);
  });
});

describe("guarda estática — quem usa respectInboundTurn", () => {
  it("cadence-tick pede respeito ao turno inbound em todos os canais", () => {
    const src = readFileSync(path.join(FN, "cadence-tick/index.ts"), "utf8");
    const matches = src.match(/respectInboundTurn:\s*true/g) || [];
    expect(matches.length).toBe(3);
  });

  it("envio manual do consultor continua sem esse gate", () => {
    for (const f of ["manual-step-send/index.ts", "start-customer-attendance/index.ts"]) {
      const src = readFileSync(path.join(FN, f), "utf8");
      expect(src).not.toContain("respectInboundTurn");
    }
  });
});
