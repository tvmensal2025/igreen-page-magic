import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  BRAIN_TARGET_CPL_CENTS,
  brainModeToLegacy,
  DEFAULT_BRAIN_DECISION_POLICY,
  resolveBrainActionAuthorization,
  resolveBrainDecisionPolicy,
  resolveBrainMode,
  resolveTargetCplCents,
  resolveWasteGuardMode,
} from "./brain-policy.ts";
import { decideAdsAction } from "./ad-automation-policy.ts";

// ───────────────────────────── CPL único ─────────────────────────────

Deno.test("CPL alvo: sem configuração cai no oficial R$ 7,50", () => {
  assertEquals(resolveTargetCplCents(null), BRAIN_TARGET_CPL_CENTS);
  assertEquals(resolveTargetCplCents(undefined), BRAIN_TARGET_CPL_CENTS);
  assertEquals(resolveTargetCplCents(0), BRAIN_TARGET_CPL_CENTS);
  assertEquals(resolveTargetCplCents("nada"), BRAIN_TARGET_CPL_CENTS);
});

Deno.test("CPL alvo: R$ 2 da coluna legada não vale como alvo", () => {
  assertEquals(resolveTargetCplCents(200, "campaign_column"), BRAIN_TARGET_CPL_CENTS);
});

Deno.test("CPL alvo: R$ 2 digitado no brain_config continua valendo", () => {
  assertEquals(resolveTargetCplCents(200, "brain_config"), 200);
  assertEquals(resolveTargetCplCents(200, "explicit"), 200);
});

Deno.test("CPL alvo: respeita limites 50..2000", () => {
  assertEquals(resolveTargetCplCents(10), 50);
  assertEquals(resolveTargetCplCents(999999), 2000);
});

// ─────────────────────── Política de decisão ───────────────────────

Deno.test("política default: 5% padrão, 10% máximo, 24h entre execuções", () => {
  const p = resolveBrainDecisionPolicy({});
  assertEquals(p.defaultStepPct, 5);
  assertEquals(p.maxStepPct, 10);
  assertEquals(p.minHoursBetweenExecutions, 24);
  assertEquals(p.targetCplCents, BRAIN_TARGET_CPL_CENTS);
});

Deno.test("política: degrau configurado nunca passa de 10%", () => {
  const p = resolveBrainDecisionPolicy({
    decision_policy: { default_step_pct: 30, max_step_pct: 30 },
  });
  assertEquals(p.maxStepPct, 10);
  assertEquals(p.defaultStepPct, 10);
});

Deno.test("política: degrau padrão nunca ultrapassa o teto configurado", () => {
  const p = resolveBrainDecisionPolicy({
    decision_policy: { default_step_pct: 8, max_step_pct: 3 },
  });
  assertEquals(p.maxStepPct, 3);
  assertEquals(p.defaultStepPct, 3);
});

Deno.test("política: herda min_runway_days do brain_config legado", () => {
  assertEquals(resolveBrainDecisionPolicy({ min_runway_days: 7 }).minRunwayDays, 7);
});

Deno.test("política: config inválida volta ao default sem lançar", () => {
  const p = resolveBrainDecisionPolicy({ decision_policy: "quebrado" });
  assertEquals(p, {
    ...DEFAULT_BRAIN_DECISION_POLICY,
    targetCplCents: BRAIN_TARGET_CPL_CENTS,
  });
});

// ───────────────────────────── Modos ─────────────────────────────

Deno.test("modo: legado mapeia para a linguagem nova", () => {
  assertEquals(resolveBrainMode({ automation_mode: "disabled" }), "off");
  assertEquals(resolveBrainMode({ automation_mode: "shadow" }), "recommend");
  assertEquals(resolveBrainMode({ automation_mode: "limited" }), "assisted");
  assertEquals(resolveBrainMode({ automation_mode: "full" }), "automatic");
  assertEquals(resolveBrainMode({}), "off");
  assertEquals(resolveBrainMode(null), "off");
});

Deno.test("modo: brain_mode novo tem precedência e volta ao legado", () => {
  assertEquals(
    resolveBrainMode({ brain_mode: "recommend", automation_mode: "full" }),
    "recommend",
  );
  assertEquals(brainModeToLegacy("automatic"), "full");
  assertEquals(brainModeToLegacy("off"), "disabled");
});

// ─────────────── Autorização por tipo de ação ───────────────

const AUTOMATIC_ON = {
  brain_mode: "automatic",
  kill_switch: false,
  autopilot: true,
};

Deno.test("autorização: modo off não recomenda nem executa", () => {
  for (
    const action of [
      "pause_waste",
      "increase_budget",
      "reduce_budget",
      "resume_campaign",
    ] as const
  ) {
    const d = resolveBrainActionAuthorization({ brain_mode: "off" }, action);
    assertEquals(d.canRecommend, false);
    assertEquals(d.canExecute, false);
  }
});

Deno.test("autorização: padrão seguro recomenda mas não executa", () => {
  const d = resolveBrainActionAuthorization(AUTOMATIC_ON, "increase_budget");
  assertEquals(d.canRecommend, true);
  assertEquals(d.canExecute, false);
  assertEquals(d.reason, "default_recommend:automatic");
});

Deno.test("autorização: execute exige opt-in por ação", () => {
  const cfg = {
    ...AUTOMATIC_ON,
    action_authorizations: { increase_budget: "execute" },
  };
  assertEquals(
    resolveBrainActionAuthorization(cfg, "increase_budget").canExecute,
    true,
  );
  // Outra ação sem opt-in continua só recomendando.
  assertEquals(
    resolveBrainActionAuthorization(cfg, "pause_waste").canExecute,
    false,
  );
});

Deno.test("autorização: recomendar aumento sim, executar aumento não", () => {
  const cfg = {
    ...AUTOMATIC_ON,
    action_authorizations: { increase_budget: "recommend", pause_waste: "recommend" },
  };
  const inc = resolveBrainActionAuthorization(cfg, "increase_budget");
  const pause = resolveBrainActionAuthorization(cfg, "pause_waste");
  assertEquals([inc.canRecommend, inc.canExecute], [true, false]);
  assertEquals([pause.canRecommend, pause.canExecute], [true, false]);
});

Deno.test("autorização: kill switch bloqueia escrita e mantém análise", () => {
  const d = resolveBrainActionAuthorization({
    ...AUTOMATIC_ON,
    kill_switch: true,
    action_authorizations: { increase_budget: "execute" },
  }, "increase_budget");
  assertEquals(d.canExecute, false);
  assertEquals(d.canRecommend, true);
  assertEquals(d.reason, "kill_switch_blocks_meta_write");
});

Deno.test("autorização: assisted nunca executa sozinho", () => {
  const d = resolveBrainActionAuthorization({
    brain_mode: "assisted",
    kill_switch: false,
    autopilot: true,
    action_authorizations: { increase_budget: "execute" },
  }, "increase_budget");
  assertEquals(d.canExecute, false);
  assertEquals(d.reason, "mode_ceiling:assisted");
});

Deno.test("autorização: ação pode ser desligada individualmente", () => {
  const d = resolveBrainActionAuthorization({
    ...AUTOMATIC_ON,
    action_authorizations: { pause_waste: "off" },
  }, "pause_waste");
  assertEquals(d.authorization, "off");
  assertEquals(d.canRecommend, false);
});

Deno.test("autorização: revisão de criativo nunca vira execução", () => {
  const d = resolveBrainActionAuthorization({
    ...AUTOMATIC_ON,
    action_authorizations: { recommend_creative_review: "execute" },
  }, "recommend_creative_review");
  assertEquals(d.canExecute, false);
  assertEquals(d.canRecommend, true);
});

// ───────────────────────── Waste Guard ─────────────────────────

Deno.test("waste guard adaptativo nasce em recommend", () => {
  assertEquals(resolveWasteGuardMode({}), "recommend");
  assertEquals(resolveWasteGuardMode(null), "recommend");
  assertEquals(resolveWasteGuardMode({ waste_guard_mode: "lixo" }), "recommend");
  assertEquals(resolveWasteGuardMode({ waste_guard_mode: "off" }), "off");
  assertEquals(
    resolveWasteGuardMode({ waste_guard_mode: "automatic" }),
    "automatic",
  );
});

// ────────── Gate Meta: novos kinds mantêm a assimetria ──────────

Deno.test("gate Meta: reduzir budget é protetivo, aumentar não", () => {
  const inert = {
    autopilot: false,
    automation_mode: "disabled" as const,
    kill_switch: true,
  };
  assertEquals(decideAdsAction(inert, "budget_decrease").allowed, true);
  assertEquals(decideAdsAction(inert, "budget_increase").allowed, false);
});

Deno.test("gate Meta: aumentar budget continua fail-closed em shadow", () => {
  assertEquals(
    decideAdsAction(
      { autopilot: true, automation_mode: "shadow", kill_switch: false },
      "budget_increase",
    ).allowed,
    false,
  );
  assertEquals(
    decideAdsAction(
      { autopilot: true, automation_mode: "limited", kill_switch: false },
      "budget_increase",
    ).allowed,
    true,
  );
});
