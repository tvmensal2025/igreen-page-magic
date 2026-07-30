/**
 * Cobertura estática AUD-005: senders automáticos/manuais críticos
 * devem importar assertCanContact e/ou assertBotOutboundAllowed.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FN = path.resolve(HERE, "../../supabase/functions");

/** Funções que enviam contato a lead e precisam do gate único. */
const REQUIRED = [
  "reactivation-send/index.ts",
  "reactivation-cron/index.ts",
  "bot-followup-checker/index.ts",
  "process-followups/index.ts",
  "faq-reengagement-nudge/index.ts",
  "cadence-tick/index.ts",
  "send-scheduled-messages/index.ts",
  "bulk-scheduler/index.ts",
  "outbound-media-flush-cron/index.ts",
  "bot-stuck-recovery/index.ts",
  "portal-otp-watchdog/index.ts",
  "resend-portal-link/index.ts",
  "admin-send-material/index.ts",
  "manual-step-send/index.ts",
  "start-customer-attendance/index.ts",
  "voice-dialer-cron/index.ts",
  "voice-sms-send/index.ts",
  "voice-dialer-enqueue/index.ts",
  "_shared/bot/outbound-gate.ts",
  // AUD-005 buracos fechados 2026-07-30
  "finalize-capture/index.ts",
  "recover-stuck-otp/index.ts",
  "worker-callback/index.ts",
  "pos-venda-auto-progress/index.ts",
] as const;

function hasGate(src: string): boolean {
  return (
    src.includes("assertCanContact") ||
    src.includes("assertBotOutboundAllowed") ||
    // Pós-venda: isPausedByPhone já cobre do_not_contact (+ humano).
    // NÃO exige assertBotOutboundAllowed (pós-venda ignora bot_global).
    src.includes("isPausedByPhone")
  );
}

describe("AUD-005 outbound DNC coverage", () => {
  it("todos os senders críticos importam o gate de contato", () => {
    const missing: string[] = [];
    for (const rel of REQUIRED) {
      const full = path.join(FN, rel);
      const src = readFileSync(full, "utf8");
      if (!hasGate(src)) missing.push(rel);
    }
    expect(missing, `faltando gate: ${missing.join(", ")}`).toEqual([]);
  });
});
