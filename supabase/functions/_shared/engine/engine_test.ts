// PBT do engine puro (Phase C Task 18 — Properties 1, 2, 3, 4, 5).
// Verifica as invariantes do design.md:
//   - Property 1: tick determinístico.
//   - Property 2: tick não chama supabase nem fetch (testamos com spies).
//   - Property 3: nextState.current_step_id ∈ reachableStepIds.
//   - Property 4: status='converted' ⇒ actions=[].
//   - Property 5: status='paused_manual' ⇒ no send_*.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { tick } from "./engine.ts";
// IMPORTANTE: importar os tipos da MESMA fonte que `tick` usa
// (`legacy-router-types.ts`). O módulo `types.ts` define um `EngineConfig`
// diferente (sem `capabilities`, com `now`/`limits`), o que causava erro de
// type-check ao passar o CONFIG para `tick`.
import type {
  ChannelCapabilities,
  EngineConfig,
  EngineCustomerState,
  EngineStep,
  InboundEvent,
} from "./legacy-router-types.ts";

// Capabilities mock. Engine não usa diretamente — só no config.
const CAPS: ChannelCapabilities = {
  channel: "evolution",
  supportsButtons: true,
  maxButtons: 3,
  supportsList: false,
  supportsAudio: true,
  supportsVideo: true,
  supportsTypingPresence: true,
  supportsReactions: false,
  inboundIdField: "messageId",
};

const CONFIG: EngineConfig = {
  isDarkMode: false,
  capabilities: CAPS,
  allowedDomains: ["igreen.energy"],
  // Idempotency-key determinística para tornar tick determinístico nos testes.
  idempotencyKeyFn: (parts) => `${parts.stepId}|${parts.content}|${parts.minuteBucket}`,
  minuteBucket: 0,
  humanDelayFn: (len: number) => Math.min(12000, Math.max(2000, len * 60)),
};

function makeState(overrides: Partial<EngineCustomerState> = {}): EngineCustomerState {
  return {
    customerId: "cust-1",
    flowId: "flow-1",
    currentStepId: "step-1",
    status: "running",
    pauseReason: null,
    retries: 0,
    enteredStepAt: "2026-01-01T00:00:00Z",
    expiresAt: null,
    assignedHumanId: null,
    lastInboundAt: null,
    lastOutboundAt: null,
    customer: {
      name: "João",
      electricityBillValue: 300,
      documentUploaded: false,
      otpValidatedAt: null,
      consultantId: "cons-1",
      phoneWhatsapp: "5511999999999",
    },
    ...overrides,
  };
}

function makeStep(overrides: Partial<EngineStep> = {}): EngineStep {
  return {
    id: "step-1",
    flowId: "flow-1",
    stepKey: "welcome",
    stepType: "text_message",
    position: 1,
    messageText: "Olá!",
    mediaOrder: [],
    choiceOptions: null,
    preferredChoiceKind: null,
    captures: [],
    transitions: [],
    fallback: { mode: "repeat" },
    waitFor: "none",
    waitSeconds: 0,
    pipelineKind: null,
    slotKey: null,
    conditionExpr: null,
    reachableStepIds: ["step-1", "step-2"],
    ...overrides,
  };
}

// ─── Property 1 — Determinismo ───────────────────────────────────────────────
Deno.test("engine.tick: determinístico para mesma entrada", () => {
  const state = makeState();
  const step = makeStep();
  const event: InboundEvent = { kind: "text", text: "oi" };
  const r1 = tick(state, step, event, CONFIG);
  const r2 = tick(state, step, event, CONFIG);
  assertEquals(JSON.stringify(r1), JSON.stringify(r2));
});

// ─── Property 2 — Sem efeitos colaterais ─────────────────────────────────────
Deno.test("engine.tick: não chama fetch nem Supabase (smoke por proxy)", () => {
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  (globalThis as any).fetch = () => { fetchCalled = true; return Promise.resolve(new Response()); };
  try {
    const state = makeState();
    const step = makeStep();
    tick(state, step, { kind: "text", text: "hello" }, CONFIG);
    assertEquals(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ─── Property 3 — current_step_id sempre reachable ───────────────────────────
Deno.test("engine.tick: nextState.currentStepId é sempre alcançável", () => {
  const state = makeState();
  const step = makeStep({ reachableStepIds: ["step-1", "step-2", "step-3"] });
  const r = tick(state, step, { kind: "text", text: "x" }, CONFIG);
  assert(
    r.nextState.currentStepId === null ||
    step.reachableStepIds.includes(r.nextState.currentStepId),
    `currentStepId=${r.nextState.currentStepId} fora de reachable=${JSON.stringify(step.reachableStepIds)}`,
  );
});

// ─── Property 4 — converted/lost/opt_out → actions vazias ────────────────────
Deno.test("engine.tick: status terminal não emite ações", () => {
  for (const status of ["converted" as const, "lost" as const]) {
    const state = makeState({ status });
    const step = makeStep();
    const r = tick(state, step, { kind: "text", text: "qq coisa" }, CONFIG);
    assertEquals(r.actions, []);
  }
});

// ─── Property 5 — paused_manual silencia outbound ────────────────────────────
Deno.test("engine.tick: paused_manual não emite send_*", () => {
  const state = makeState({ status: "paused_manual", pauseReason: "humano_assumiu", assignedHumanId: "h1" });
  const step = makeStep();
  const r = tick(state, step, { kind: "text", text: "msg" }, CONFIG);
  const sendActions = r.actions.filter(a => a.kind.startsWith("send_"));
  assertEquals(sendActions, []);
});

Deno.test("engine.tick: opt_out silencia outbound", () => {
  const state = makeState({ status: "running", pauseReason: "opt_out" });
  const step = makeStep();
  const r = tick(state, step, { kind: "text", text: "msg" }, CONFIG);
  assertEquals(r.actions.length, 0);
});

// ─── Comportamento por step_type ─────────────────────────────────────────────

Deno.test("engine.tick: text_message emite send_text e avança", () => {
  const state = makeState();
  const step = makeStep({ messageText: "Bem-vindo!" });
  const r = tick(state, step, { kind: "text", text: "oi" }, CONFIG);
  assertEquals(r.actions[0].kind, "send_text");
  assertEquals(r.nextState.currentStepId, "step-2");
});

Deno.test("engine.tick: system_capture delega para runBotFlow", () => {
  const state = makeState();
  const step = makeStep({ stepType: "system_capture", pipelineKind: "ocr_conta" });
  const r = tick(state, step, { kind: "media", mediaKind: "image" }, CONFIG);
  assertEquals(r.actions[0].kind, "delegate_legacy_runBotFlow");
  assertEquals((r.actions[0] as any).reason, "ocr_conta");
});

Deno.test("engine.tick: ask_choice resolve rawNumberReply para option_id", () => {
  const state = makeState();
  const step = makeStep({
    stepType: "ask_choice",
    choiceOptions: [
      { id: "sim_phone", title: "Sim" },
      { id: "outro", title: "Outro" },
    ],
    preferredChoiceKind: "button",
    transitions: [
      { trigger_intent: "afirm", trigger_phrases: ["sim_phone"], goto_step_id: "step-2", goto_special: null },
      { trigger_intent: "neg", trigger_phrases: ["outro"], goto_step_id: "step-2", goto_special: null },
    ],
    reachableStepIds: ["step-1", "step-2"],
  });
  const r = tick(state, step, { kind: "text", rawNumberReply: "1" }, CONFIG);
  assertEquals(r.nextState.currentStepId, "step-2");
  assertEquals((r.capturedFields as any).__selected_option, "sim_phone");
});

Deno.test("engine.tick: ask_choice rejeita rawNumberReply fora do range", () => {
  const state = makeState();
  const step = makeStep({
    stepType: "ask_choice",
    choiceOptions: [{ id: "a", title: "A" }, { id: "b", title: "B" }],
    transitions: [
      { trigger_intent: "x", trigger_phrases: ["a"], goto_step_id: "step-2", goto_special: null },
    ],
    fallback: { mode: "repeat" },
  });
  // "5" não existe — engine cai no fallback.
  const r = tick(state, step, { kind: "text", rawNumberReply: "5" }, CONFIG);
  assertEquals(r.nextState.currentStepId, "step-1"); // repeat
  assertEquals(r.actions.length, 0);
});

Deno.test("engine.tick: ask_text captura field e avança", () => {
  const state = makeState();
  const step = makeStep({
    stepType: "ask_text",
    captures: [{ field: "name", enabled: true }],
  });
  const r = tick(state, step, { kind: "text", text: "Maria" }, CONFIG);
  assertEquals((r.capturedFields as any).name, "Maria");
  assertEquals(r.nextState.currentStepId, "step-2");
});

Deno.test("engine.tick: branch escolhe thenStepId quando condition é true", () => {
  const state = makeState({ customer: { ...makeState().customer, electricityBillValue: 500 } });
  const step = makeStep({
    stepType: "branch",
    conditionExpr: {
      field: "customer.electricityBillValue",
      op: ">=",
      value: 200,
      thenStepId: "step-2",
      elseStepId: "step-1",
    },
    reachableStepIds: ["step-1", "step-2"],
  });
  const r = tick(state, step, { kind: "text" }, CONFIG);
  assertEquals(r.nextState.currentStepId, "step-2");
});

Deno.test("engine.tick: branch escolhe elseStepId quando condition é false", () => {
  const state = makeState({ customer: { ...makeState().customer, electricityBillValue: 50 } });
  const step = makeStep({
    stepType: "branch",
    conditionExpr: {
      field: "customer.electricityBillValue",
      op: ">=",
      value: 200,
      thenStepId: "step-2",
      elseStepId: "step-1",
    },
    reachableStepIds: ["step-1", "step-2"],
  });
  const r = tick(state, step, { kind: "text" }, CONFIG);
  assertEquals(r.nextState.currentStepId, "step-1");
});

Deno.test("engine.tick: ask_media com texto pede foto de novo", () => {
  const state = makeState();
  const step = makeStep({ stepType: "ask_media" });
  const r = tick(state, step, { kind: "text", text: "uma palavra" }, CONFIG);
  assertEquals(r.actions[0].kind, "send_text");
  assertEquals(r.nextState.currentStepId, "step-1"); // não avança
});
