import { describe, expect, it } from "vitest";

type RetentionSettings = {
  priority_order: string[];
};

function decide(
  settings: RetentionSettings,
  orchestratorEnabled: boolean,
  recentSources: string[],
  sourceKey: string,
): { allowed: boolean; blockedBy?: string } {
  if (!orchestratorEnabled) return { allowed: true };
  if (recentSources.length === 0) return { allowed: true };
  const idx = (k: string) => {
    const i = settings.priority_order.indexOf(k);
    return i >= 0 ? i : 999;
  };
  const myPri = idx(sourceKey);
  for (const other of recentSources) {
    if (other === sourceKey) continue;
    if (idx(other) <= myPri) return { allowed: false, blockedBy: other };
  }
  return { allowed: true };
}

const ORDER = {
  priority_order: [
    "process_followups",
    "bot_stuck_recovery",
    "faq_reengagement_nudge",
    "bot_followup_checker",
    "cadence_engine",
    "reactivation_cron",
  ],
};

describe("retention orchestrator pure", () => {
  it("permite tudo com orquestrador desligado", () => {
    expect(decide(ORDER, false, ["reactivation_cron"], "cadence_engine").allowed).toBe(true);
  });

  it("permite cadência se só houve toque de prioridade menor", () => {
    const r = decide(ORDER, true, ["reactivation_cron"], "cadence_engine");
    expect(r.allowed).toBe(true);
  });

  it("bloqueia reaquecimento se follow-up recente (prioridade maior)", () => {
    const r = decide(ORDER, true, ["process_followups"], "reactivation_cron");
    expect(r.allowed).toBe(false);
    expect(r.blockedBy).toBe("process_followups");
  });

  it("mesmo source não bloqueia a si", () => {
    expect(decide(ORDER, true, ["cadence_engine"], "cadence_engine").allowed).toBe(true);
  });

  it("sem toques recentes permite", () => {
    expect(decide(ORDER, true, [], "bot_followup_checker").allowed).toBe(true);
  });
});
