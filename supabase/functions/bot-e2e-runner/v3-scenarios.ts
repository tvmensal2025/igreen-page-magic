/**
 * Engine v3 direct scenarios for `bot-e2e-runner`.
 *
 * Spec: `.kiro/specs/flow-engine-v3-rewrite/design.md` §4.3.
 * Task: 30 (`flow-engine-v3-rewrite/tasks.md`).
 *
 * Each scenario builds a synthetic `EngineInput` (flow + state +
 * capabilities + hooks + config), drives it through the *pure*
 * `runEngine` function directly, and asserts on `outbound`,
 * `stateUpdate`, and `logs`. No real Whapi / Evolution call — these
 * scenarios validate engine semantics in isolation, complementary to
 * the carryover scenarios that exercise the webhook end-to-end.
 *
 * G1–G6 invariants checked on every scenario:
 *  - G1: no two adjacent outbounds share `idempotencyContent`.
 *  - G2: when `inbound` is user-driven, `outbound.length > 0` OR a
 *        `*_deferred` log is present.
 *  - G3: exactly one decision log per turn.
 *  - G4: variant fidelity (variant B → no audio; variant D buttons → ≤3).
 *  - G5: `paused_system` ⇔ exactly one `insert_handoff_alert` sentinel.
 *  - G6: `flow.strictMode === true` ⇒ no `engine_ai_*_deferred` logs.
 *
 * Scenarios:
 *   V_A1                    — variant A audio-first happy path
 *   V_B1                    — variant B persuasive-text-only (no audio, ai_answer deferred)
 *   V_D1                    — variant D buttons happy (Whapi capabilities)
 *   V_D2                    — variant D buttons → retry → handoff (lead types free text)
 *   AI1                     — `ai_answer` mode (deferred FAQ answer)
 *   AI2                     — `ai` decide mode (deferred decision with candidate list)
 *   SILENT                  — `no_input` cron tick produces zero outbound (G2 carve-out)
 *
 * Carryover regression (Task 31, scenarios A1–A4 + B1–B2 from
 * `flow-d-retry-rules-fix`, validated under engine v3):
 *   R_A1_OCR_OK             — variant D, OCR-style media inbound advances normally
 *   R_A2_OCR_RETRY1         — variant D, retry mode, fail 1x → retry_text emitted, retries=1
 *   R_A3_OCR_RETRY_EXHAUSTED — variant D, retry exhausted → paused_system + handoff alert
 *   R_A4_NO_RETRY           — variant A, no retry config (mode=repeat) → SAFE_TEXT_FALLBACK
 *   R_B1_CHOICE_RETRY1      — variant B ask_choice, lixo 1x → retry_text, retries=1
 *   R_B2_CHOICE_RETRY_EXHAUSTED — variant B ask_choice retry exhausted → paused_system + handoff alert
 *
 * Side effects: each scenario flips `consultants.use_engine_v3 = true`
 * for the test consultor before running, then restores the previous
 * value during teardown so we never leak the flag flip into other
 * scenarios. The flag flip is itself the v3-routing precondition
 * (Requirement 11.1) — it is read by `router.ts` per request.
 */

import { runEngine } from "../_shared/engine/runner.ts";
import type {
  BotFlow,
  BotFlowStep,
  ChannelCapabilities,
  CustomerSnapshot,
  EngineConfig,
  EngineHooks,
  EngineInput,
  EngineOutput,
  InboundEvent,
  MediaOrderEntry,
  OutboundMessage,
  StructuredLog,
} from "../_shared/engine/types.ts";

// ─── Public surface ──────────────────────────────────────────────────────────

export type V3DirectScenario =
  | "V_A1"
  | "V_B1"
  | "V_D1"
  | "V_D2"
  | "AI1"
  | "AI2"
  | "SILENT"
  // Task 31 carryover from `flow-d-retry-rules-fix` (A1–A4, B1–B2),
  // re-validated under engine v3. `R_` prefix avoids collision with
  // `V_A1`/`V_B1` above and with the legacy whapi-webhook scenarios
  // (`fluxo_d_ocr_ok` etc.) which still exercise the legacy path.
  | "R_A1_OCR_OK"
  | "R_A2_OCR_RETRY1"
  | "R_A3_OCR_RETRY_EXHAUSTED"
  | "R_A4_NO_RETRY"
  | "R_B1_CHOICE_RETRY1"
  | "R_B2_CHOICE_RETRY_EXHAUSTED";

export const V3_DIRECT_SCENARIOS: ReadonlySet<V3DirectScenario> = new Set<
  V3DirectScenario
>([
  "V_A1",
  "V_B1",
  "V_D1",
  "V_D2",
  "AI1",
  "AI2",
  "SILENT",
  "R_A1_OCR_OK",
  "R_A2_OCR_RETRY1",
  "R_A3_OCR_RETRY_EXHAUSTED",
  "R_A4_NO_RETRY",
  "R_B1_CHOICE_RETRY1",
  "R_B2_CHOICE_RETRY_EXHAUSTED",
]);

export interface V3ScenarioCheck {
  name: string;
  passed: boolean;
  detail?: string;
}

export interface V3ScenarioResult {
  ok: boolean;
  status: "passed" | "failed";
  checks: V3ScenarioCheck[];
  /** Per-turn snapshots for diagnostics; never asserted on directly. */
  turns: Array<{
    turn: number;
    inbound: InboundEvent;
    outboundCount: number;
    decisionLogs: string[];
    finalStepId: string | null;
  }>;
  finalStateUpdate: Partial<CustomerSnapshot>;
  scenario: V3DirectScenario;
}

// ─── Fixture builders (pure) ─────────────────────────────────────────────────

const T0 = "2026-01-01T12:00:00.000Z";

function makeConfig(now = T0): EngineConfig {
  return {
    now,
    minuteBucket: Math.floor(Date.parse(now) / 60000),
    isDarkMode: false,
    allowedDomains: [],
    idempotencyKeyFn: (parts) =>
      `${parts.stepId}:${parts.content}:${parts.minuteBucket}`,
    humanDelayFn: (n) => Math.min(n * 50, 5000),
    limits: {
      maxOutboundsPerTurn: 6,
      maxRetriesBeforeHandoff: 3,
      maxAiQuestionsPerStep: 3,
    },
  };
}

const STUB_HOOKS: EngineHooks = {
  ocr: {
    describe: () => ({
      kind: "ocr",
      pipelines: ["ocr_conta", "ocr_documento"],
    }),
  },
  otp: { describe: () => ({ kind: "otp", intercepts: "before_engine" }) },
  portal: {
    describe: () => ({
      kind: "portal",
      pipelines: ["cadastro_portal", "finalizar_cadastro"],
    }),
  },
  captures: { extract: () => ({}) },
  aiAnswer: {
    describe: () => ({
      kind: "ai_answer",
      module: "_shared/ai-faq-answerer.ts",
    }),
  },
  aiDecide: {
    describe: () => ({ kind: "ai_decide", module: "_shared/ai-decisions.ts" }),
  },
};

const CAPS_WHAPI: ChannelCapabilities = {
  channel: "whapi",
  supportsButtons: true,
  maxButtons: 3,
  supportsList: true,
  supportsAudio: true,
  supportsVideo: true,
  supportsTypingPresence: true,
  supportsReactions: true,
  inboundIdField: "messageId",
};

const CAPS_EVOLUTION: ChannelCapabilities = {
  channel: "evolution",
  supportsButtons: false,
  maxButtons: 0,
  supportsList: false,
  supportsAudio: true,
  supportsVideo: true,
  supportsTypingPresence: true,
  supportsReactions: false,
  inboundIdField: "wa_id",
};

function uuid(): string {
  return crypto.randomUUID();
}

interface MakeStepArgs {
  id: string;
  flowId: string;
  stepKey?: string | null;
  stepType?: BotFlowStep["stepType"];
  position?: number;
  messageText?: string | null;
  persuasiveText?: string | null;
  choiceOptions?: BotFlowStep["choiceOptions"];
  preferredChoiceKind?: BotFlowStep["preferredChoiceKind"];
  transitions?: BotFlowStep["transitions"];
  fallback?: BotFlowStep["fallback"];
  reachableStepIds: string[];
}

function makeStep(args: MakeStepArgs): BotFlowStep {
  return {
    id: args.id,
    flowId: args.flowId,
    stepKey: args.stepKey ?? null,
    stepType: args.stepType ?? "text_message",
    position: args.position ?? 1,
    messageText: args.messageText ?? null,
    persuasiveText: args.persuasiveText ?? null,
    choiceOptions: args.choiceOptions ?? null,
    preferredChoiceKind: args.preferredChoiceKind ?? null,
    captures: [],
    transitions: args.transitions ?? [],
    fallback: args.fallback ?? { mode: "repeat" },
    waitFor: "none",
    waitSeconds: 0,
    pipelineKind: null,
    slotKey: null,
    conditionExpr: null,
    reachableStepIds: args.reachableStepIds,
  };
}

function makeState(
  flow: BotFlow,
  overrides: Partial<CustomerSnapshot> = {},
): CustomerSnapshot {
  return {
    customerId: uuid(),
    consultantId: flow.consultantId,
    flowId: flow.id,
    currentStepId: flow.steps[0]?.id ?? null,
    status: "running",
    pauseReason: null,
    retries: 0,
    aiQuestionsThisStep: 0,
    enteredStepAt: T0,
    expiresAt: null,
    lastInboundAt: null,
    lastOutboundAt: null,
    lastOutboundContentHash: null,
    customer: {
      name: null,
      electricityBillValue: null,
      documentUploaded: false,
      otpValidatedAt: null,
      phoneWhatsapp: null,
    },
    ...overrides,
  };
}

// ─── Invariant checkers (G1-G6) ─────────────────────────────────────────────

const DECISION_LOG_KINDS = new Set<StructuredLog["kind"]>([
  "engine_transition_match",
  "engine_repeat",
  "engine_goto",
  "engine_safe_text",
  "engine_handoff",
  "engine_ai_answer_deferred",
  "engine_ai_decide_deferred",
  "engine_no_match",
]);

function isUserDriven(kind: InboundEvent["kind"]): boolean {
  return (
    kind === "text" ||
    kind === "button_click" ||
    kind === "number_reply" ||
    kind === "media"
  );
}

/** G1 — no two adjacent outbounds share `idempotencyContent`. */
function checkG1(out: EngineOutput): V3ScenarioCheck {
  for (let i = 1; i < out.outbound.length; i++) {
    if (
      out.outbound[i].idempotencyContent ===
        out.outbound[i - 1].idempotencyContent
    ) {
      return {
        name: "G1: no duplicate adjacent outbounds",
        passed: false,
        detail:
          `duplicate at index ${i}: '${out.outbound[i].idempotencyContent}'`,
      };
    }
  }
  return { name: "G1: no duplicate adjacent outbounds", passed: true };
}

/** G2 — user-driven inbound MUST produce outbound or a deferred-emitting log. */
function checkG2(input: EngineInput, out: EngineOutput): V3ScenarioCheck {
  if (!isUserDriven(input.inbound.kind)) {
    return { name: "G2: no silent turn (n/a — non-user-driven)", passed: true };
  }
  const hasOutbound = out.outbound.length > 0;
  const hasDeferredLog = out.logs.some((l) =>
    l.kind === "engine_ai_answer_deferred" ||
    l.kind === "engine_ai_decide_deferred"
  );
  return {
    name: "G2: user-driven inbound produces outbound or deferred",
    passed: hasOutbound || hasDeferredLog,
    detail: `outbound=${out.outbound.length}, deferredLog=${hasDeferredLog}`,
  };
}

/** G3 — exactly one decision log per turn. */
function checkG3(out: EngineOutput): V3ScenarioCheck {
  const decisions = out.logs.filter((l) => DECISION_LOG_KINDS.has(l.kind));
  return {
    name: "G3: exactly one decision log",
    passed: decisions.length === 1,
    detail: `count=${decisions.length}, kinds=[${
      decisions.map((d) => d.kind).join(",")
    }]`,
  };
}

/** G4 — variant fidelity (B has no audio; D buttons ≤ 3 when supported). */
function checkG4(input: EngineInput, out: EngineOutput): V3ScenarioCheck {
  if (input.flow.variant === "B") {
    const hasAudio = out.outbound.some((m) =>
      m.kind === "audio_slot" || (m.kind === "media" && m.media.kind === "audio")
    );
    if (hasAudio) {
      return {
        name: "G4b: variant B emits no audio",
        passed: false,
        detail: "audio outbound found",
      };
    }
  }
  if (input.flow.variant === "D" && input.capabilities.supportsButtons) {
    for (const m of out.outbound) {
      if (
        m.kind === "choice" && m.choice.preferred === "button" &&
        m.choice.options.length > 3
      ) {
        return {
          name: "G4c: variant D button choices ≤ 3",
          passed: false,
          detail: `options.length=${m.choice.options.length}`,
        };
      }
    }
  }
  return { name: "G4: variant fidelity", passed: true };
}

/** G5 — `paused_system` ⇔ exactly one `insert_handoff_alert` sentinel. */
function checkG5(out: EngineOutput): V3ScenarioCheck {
  const alerts = out.logs.filter((l) =>
    l.sideEffect?.kind === "insert_handoff_alert"
  );
  if (out.stateUpdate.status === "paused_system") {
    return {
      name: "G5: paused_system → exactly one handoff alert",
      passed: alerts.length === 1,
      detail: `alerts=${alerts.length}`,
    };
  }
  return {
    name: "G5: non-handoff turn → no handoff alert",
    passed: alerts.length === 0,
    detail: `alerts=${alerts.length}`,
  };
}

/** G6 — strict mode ⇒ no AI deferred logs. */
function checkG6(input: EngineInput, out: EngineOutput): V3ScenarioCheck {
  if (!input.flow.strictMode) {
    return { name: "G6: strict mode (n/a — strictMode=false)", passed: true };
  }
  const aiLogs = out.logs.filter((l) =>
    l.kind === "engine_ai_answer_deferred" ||
    l.kind === "engine_ai_decide_deferred" ||
    l.kind === "engine_ai_decide_invalid"
  );
  return {
    name: "G6: strict mode blocks AI deferred",
    passed: aiLogs.length === 0,
    detail: `aiLogs=${aiLogs.length}`,
  };
}

function runAllInvariantChecks(
  input: EngineInput,
  out: EngineOutput,
  turn: number,
): V3ScenarioCheck[] {
  const prefix = `[turn ${turn}] `;
  const annotate = (c: V3ScenarioCheck): V3ScenarioCheck => ({
    ...c,
    name: prefix + c.name,
  });
  return [
    annotate(checkG1(out)),
    annotate(checkG2(input, out)),
    annotate(checkG3(out)),
    annotate(checkG4(input, out)),
    annotate(checkG5(out)),
    annotate(checkG6(input, out)),
  ];
}

// ─── Scenario builders ──────────────────────────────────────────────────────

interface ScenarioFixture {
  flow: BotFlow;
  initialState: CustomerSnapshot;
  capabilities: ChannelCapabilities;
  inbounds: InboundEvent[];
  /** Custom assertions evaluated after the inbound sequence completes. */
  assert: (
    finalState: CustomerSnapshot,
    perTurnOutputs: EngineOutput[],
  ) => V3ScenarioCheck[];
}

// V_A1 — variant A audio-first happy path
function buildV_A1(consultantId: string): ScenarioFixture {
  const flowId = uuid();
  const stepWelcome = uuid();
  const stepMenu = uuid();
  const stepConta = uuid();
  const reachable = [stepWelcome, stepMenu, stepConta];

  const flow: BotFlow = {
    id: flowId,
    consultantId,
    variant: "A",
    strictMode: false,
    steps: [
      makeStep({
        id: stepWelcome,
        flowId,
        stepKey: "welcome",
        stepType: "text_message",
        position: 1,
        messageText: "Olá! Tudo bem?",
        transitions: [
          { trigger_phrases: ["oi", "olá"], goto_step_id: stepMenu },
        ],
        fallback: { mode: "repeat" },
        reachableStepIds: reachable,
      }),
      makeStep({
        id: stepMenu,
        flowId,
        stepKey: "menu_inicial",
        stepType: "ask_choice",
        position: 2,
        messageText: "Quer saber mais?",
        choiceOptions: [
          { id: "opt-1", title: "Sim" },
          { id: "opt-2", title: "Não" },
        ],
        preferredChoiceKind: "number",
        transitions: [
          { trigger_phrases: ["1", "sim"], goto_step_id: stepConta },
        ],
        fallback: { mode: "repeat" },
        reachableStepIds: reachable,
      }),
      makeStep({
        id: stepConta,
        flowId,
        stepKey: "aguardando_conta",
        stepType: "ask_media",
        position: 3,
        messageText: "Pode me enviar a foto da conta de luz?",
        transitions: [
          {
            trigger_intent: "media_received",
            goto_step_id: null,
            goto_special: null,
          },
        ],
        fallback: { mode: "repeat" },
        reachableStepIds: reachable,
      }),
    ],
    mediaOrderByStepKey: {
      menu_inicial: [
        { kind: "text", text: "Vou te explicar rapidinho 👇" },
        { kind: "image", url: "https://test/image.png", caption: "diagrama" },
        { kind: "audio", url: "https://test/audio.ogg", durationSec: 12 },
        { kind: "video", url: "https://test/video.mp4", durationSec: 30 },
      ],
    },
  };

  const initialState = makeState(flow, { currentStepId: stepWelcome });

  return {
    flow,
    initialState,
    capabilities: CAPS_WHAPI,
    inbounds: [
      { kind: "text", text: "oi" },
      { kind: "number_reply", raw: "1" },
    ],
    assert: (finalState, outputs) => {
      const checks: V3ScenarioCheck[] = [];

      // Turn 1: welcome → menu, must emit text/image/audio/video in order.
      const t1 = outputs[0];
      const kinds = t1.outbound.map((m) =>
        m.kind === "media" ? `media:${m.media.kind}` : m.kind
      );
      checks.push({
        name: "V_A1 turn 1: media order = text/image/audio/video",
        passed: kinds.length === 4 &&
          kinds[0] === "text" &&
          kinds[1] === "media:image" &&
          kinds[2] === "media:audio" &&
          kinds[3] === "media:video",
        detail: `got=${kinds.join("|")}`,
      });
      checks.push({
        name: "V_A1 turn 1: state advanced to menu",
        passed: t1.stateUpdate.currentStepId === stepMenu,
        detail: `currentStepId=${t1.stateUpdate.currentStepId}`,
      });

      // Turn 2: number_reply "1" → match transition to aguardando_conta.
      const t2 = outputs[1];
      checks.push({
        name: "V_A1 turn 2: state advanced to aguardando_conta",
        passed: t2.stateUpdate.currentStepId === stepConta,
        detail: `currentStepId=${t2.stateUpdate.currentStepId}`,
      });
      checks.push({
        name: "V_A1 turn 2: emitted at least one outbound",
        passed: t2.outbound.length >= 1,
        detail: `outboundCount=${t2.outbound.length}`,
      });

      checks.push({
        name: "V_A1 final: lead reached aguardando_conta",
        passed: finalState.currentStepId === stepConta,
        detail: `currentStepId=${finalState.currentStepId}`,
      });
      return checks;
    },
  };
}

// V_B1 — variant B persuasive-text-only (no audio, ai_answer deferred)
function buildV_B1(consultantId: string): ScenarioFixture {
  const flowId = uuid();
  const stepWelcome = uuid();
  const stepPitch = uuid();
  const reachable = [stepWelcome, stepPitch];

  const flow: BotFlow = {
    id: flowId,
    consultantId,
    variant: "B",
    strictMode: false,
    steps: [
      makeStep({
        id: stepWelcome,
        flowId,
        stepKey: "welcome",
        stepType: "text_message",
        position: 1,
        messageText: "Olá! Tudo bem?",
        transitions: [
          { trigger_phrases: ["oi", "olá"], goto_step_id: stepPitch },
        ],
        fallback: { mode: "repeat" },
        reachableStepIds: reachable,
      }),
      makeStep({
        id: stepPitch,
        flowId,
        stepKey: "pitch",
        stepType: "ask_text",
        position: 2,
        messageText: "Tem alguma dúvida?",
        persuasiveText:
          "Tô aqui pra te mostrar como economizar até 20% na conta de luz sem investimento inicial. Vale a pena?",
        transitions: [
          // Use trigger phrases that won't substring-match the open-ended
          // question we drive in turn 2 ("queria saber se vale a pena").
          // "vale" alone would substring-match the question, sending us
          // back to welcome instead of triggering the ai_answer fallback.
          { trigger_phrases: ["pode_continuar"], goto_step_id: stepWelcome },
        ],
        fallback: { mode: "ai_answer", max_questions: 3 },
        reachableStepIds: reachable,
      }),
    ],
    // Variant B MUST suppress audio entries even when configured.
    mediaOrderByStepKey: {
      pitch: [
        { kind: "audio", url: "https://test/audio.ogg", durationSec: 10 },
      ],
    },
  };

  const initialState = makeState(flow, { currentStepId: stepWelcome });

  return {
    flow,
    initialState,
    capabilities: CAPS_WHAPI,
    inbounds: [
      { kind: "text", text: "oi" },
      { kind: "text", text: "queria saber se vale a pena" },
    ],
    assert: (finalState, outputs) => {
      const checks: V3ScenarioCheck[] = [];

      // Turn 1: advance to pitch, emit persuasive_text only (no audio).
      const t1 = outputs[0];
      const t1Kinds = t1.outbound.map((m) =>
        m.kind === "media" ? `media:${m.media.kind}` : m.kind
      );
      const t1HasAudio = t1Kinds.some((k) =>
        k === "media:audio" || k === "audio_slot"
      );
      checks.push({
        name: "V_B1 turn 1: NO audio outbound (variant B static guarantee)",
        passed: !t1HasAudio,
        detail: `kinds=${t1Kinds.join("|")}`,
      });
      const t1HasPersuasive = t1.outbound.some((m) =>
        m.kind === "text" && /20%|economizar/.test(m.text)
      );
      checks.push({
        name: "V_B1 turn 1: emitted persuasive text",
        passed: t1HasPersuasive,
        detail: `texts=${
          t1.outbound.filter((m) => m.kind === "text").map((m) =>
            (m as { text: string }).text.slice(0, 40)
          ).join("|")
        }`,
      });
      checks.push({
        name: "V_B1 turn 1: advanced to pitch step",
        passed: t1.stateUpdate.currentStepId === stepPitch,
      });

      // Turn 2: free-text question → ai_answer deferred (no outbound).
      const t2 = outputs[1];
      checks.push({
        name: "V_B1 turn 2: zero outbound (deferred ai_answer)",
        passed: t2.outbound.length === 0,
        detail: `outboundCount=${t2.outbound.length}`,
      });
      checks.push({
        name: "V_B1 turn 2: deferred = ai_answer",
        passed: t2.deferred?.kind === "ai_answer",
        detail: `deferred=${t2.deferred?.kind ?? "undefined"}`,
      });
      checks.push({
        name: "V_B1 turn 2: engine_ai_answer_deferred log present",
        passed: t2.logs.some((l) => l.kind === "engine_ai_answer_deferred"),
      });
      checks.push({
        name: "V_B1 turn 2: stayed on pitch step (returns after AI)",
        passed: t2.stateUpdate.currentStepId === undefined ||
          t2.stateUpdate.currentStepId === stepPitch ||
          finalState.currentStepId === stepPitch,
        detail: `currentStepId=${finalState.currentStepId}`,
      });
      return checks;
    },
  };
}

// V_D1 — variant D buttons happy (Whapi)
function buildV_D1(consultantId: string): ScenarioFixture {
  const flowId = uuid();
  const stepWelcome = uuid();
  const stepMenu = uuid();
  const stepNext = uuid();
  const reachable = [stepWelcome, stepMenu, stepNext];

  const optAId = uuid();
  const optBId = uuid();
  const optCId = uuid();

  const flow: BotFlow = {
    id: flowId,
    consultantId,
    variant: "D",
    strictMode: false,
    steps: [
      makeStep({
        id: stepWelcome,
        flowId,
        stepKey: "welcome",
        stepType: "text_message",
        position: 1,
        messageText: "Bem-vindo!",
        transitions: [
          { trigger_phrases: ["oi"], goto_step_id: stepMenu },
        ],
        fallback: { mode: "repeat" },
        reachableStepIds: reachable,
      }),
      makeStep({
        id: stepMenu,
        flowId,
        stepKey: "menu",
        stepType: "ask_choice",
        position: 2,
        messageText: "Escolha uma opção:",
        choiceOptions: [
          { id: optAId, title: "Economizar" },
          { id: optBId, title: "Saber mais" },
          { id: optCId, title: "Falar com humano" },
          { id: uuid(), title: "Quarta opção (deve ser cortada)" },
        ],
        preferredChoiceKind: "button",
        transitions: [
          { trigger_phrases: [optAId], goto_step_id: stepNext },
        ],
        fallback: { mode: "repeat" },
        reachableStepIds: reachable,
      }),
      makeStep({
        id: stepNext,
        flowId,
        stepKey: "next",
        stepType: "text_message",
        position: 3,
        messageText: "Ótima escolha!",
        fallback: { mode: "repeat" },
        reachableStepIds: reachable,
      }),
    ],
    mediaOrderByStepKey: {},
  };

  return {
    flow,
    initialState: makeState(flow, { currentStepId: stepWelcome }),
    capabilities: CAPS_WHAPI,
    inbounds: [
      { kind: "text", text: "oi" },
      { kind: "button_click", buttonId: optAId, rawText: "Economizar" },
    ],
    assert: (finalState, outputs) => {
      const checks: V3ScenarioCheck[] = [];

      // Turn 1: advance to menu — choice rendered with preferred=button, ≤3 options.
      const t1 = outputs[0];
      const choice = t1.outbound.find((m) => m.kind === "choice") as
        | (OutboundMessage & { kind: "choice" })
        | undefined;
      checks.push({
        name: "V_D1 turn 1: emitted choice outbound",
        passed: !!choice,
      });
      checks.push({
        name: "V_D1 turn 1: choice.preferred = 'button'",
        passed: choice?.choice.preferred === "button",
        detail: `preferred=${choice?.choice.preferred}`,
      });
      checks.push({
        name: "V_D1 turn 1: choice.options.length ≤ 3 (Whapi cap)",
        passed: (choice?.choice.options.length ?? 0) <= 3,
        detail: `options=${choice?.choice.options.length}`,
      });

      // Turn 2: button_click → match transition to next step.
      const t2 = outputs[1];
      checks.push({
        name: "V_D1 turn 2: advanced to next step on button click",
        passed: t2.stateUpdate.currentStepId === stepNext,
        detail: `currentStepId=${t2.stateUpdate.currentStepId}`,
      });
      checks.push({
        name: "V_D1 final: lead reached next step",
        passed: finalState.currentStepId === stepNext,
      });
      return checks;
    },
  };
}

// V_D2 — variant D buttons fallback to retry → handoff (lead types free text)
function buildV_D2(consultantId: string): ScenarioFixture {
  const flowId = uuid();
  const stepWelcome = uuid();
  const stepMenu = uuid();
  const reachable = [stepWelcome, stepMenu];

  const flow: BotFlow = {
    id: flowId,
    consultantId,
    variant: "D",
    strictMode: false,
    steps: [
      makeStep({
        id: stepWelcome,
        flowId,
        stepKey: "welcome",
        stepType: "text_message",
        position: 1,
        messageText: "Bem-vindo!",
        transitions: [
          { trigger_phrases: ["oi"], goto_step_id: stepMenu },
        ],
        fallback: { mode: "repeat" },
        reachableStepIds: reachable,
      }),
      makeStep({
        id: stepMenu,
        flowId,
        stepKey: "menu",
        stepType: "ask_choice",
        position: 2,
        messageText: "Escolha uma opção:",
        choiceOptions: [
          { id: uuid(), title: "Sim" },
          { id: uuid(), title: "Não" },
        ],
        preferredChoiceKind: "button",
        transitions: [],
        fallback: {
          mode: "retry",
          max_retries: 2,
          on_fail: "handoff",
          handoff_reason: "retry_exhausted",
        },
        reachableStepIds: reachable,
      }),
    ],
    mediaOrderByStepKey: {},
  };

  return {
    flow,
    initialState: makeState(flow, { currentStepId: stepWelcome }),
    capabilities: CAPS_WHAPI,
    inbounds: [
      { kind: "text", text: "oi" }, // → advance to menu
      { kind: "text", text: "lixo aleatório 1" }, // retry attempt 1
      { kind: "text", text: "lixo aleatório 2" }, // retry attempt 2
      { kind: "text", text: "lixo aleatório 3" }, // exceeds max → handoff
    ],
    assert: (finalState, outputs) => {
      const checks: V3ScenarioCheck[] = [];

      // Turn 1: welcome → menu.
      checks.push({
        name: "V_D2 turn 1: advanced to menu",
        passed: outputs[0].stateUpdate.currentStepId === stepMenu,
      });

      // Turns 2 & 3: retry, no escalation.
      for (let i = 1; i <= 2; i++) {
        const t = outputs[i];
        const isHandoff = t.stateUpdate.status === "paused_system";
        checks.push({
          name: `V_D2 turn ${i + 1}: retry, no handoff yet`,
          passed: !isHandoff,
          detail: `status=${t.stateUpdate.status ?? "(unchanged)"}`,
        });
      }

      // Turn 4: retries exhausted → handoff.
      const tFinal = outputs[3];
      checks.push({
        name: "V_D2 turn 4: state.status = paused_system",
        passed: tFinal.stateUpdate.status === "paused_system",
        detail: `status=${tFinal.stateUpdate.status}`,
      });
      checks.push({
        name: "V_D2 turn 4: engine_handoff log present",
        passed: tFinal.logs.some((l) => l.kind === "engine_handoff"),
      });
      checks.push({
        name: "V_D2 turn 4: G5 — exactly one insert_handoff_alert sentinel",
        passed: tFinal.logs.filter((l) =>
          l.sideEffect?.kind === "insert_handoff_alert"
        ).length === 1,
      });
      checks.push({
        name: "V_D2 final: status = paused_system",
        passed: finalState.status === "paused_system",
      });
      return checks;
    },
  };
}

// AI1 — `ai_answer` mode (deferred FAQ)
function buildAI1(consultantId: string): ScenarioFixture {
  const flowId = uuid();
  const stepStart = uuid();
  const reachable = [stepStart];

  const flow: BotFlow = {
    id: flowId,
    consultantId,
    variant: "A",
    strictMode: false,
    steps: [
      makeStep({
        id: stepStart,
        flowId,
        stepKey: "start",
        stepType: "ask_text",
        position: 1,
        messageText: "Pode me dizer seu nome?",
        transitions: [
          { trigger_phrases: ["joão", "joao"], goto_step_id: null },
        ],
        fallback: { mode: "ai_answer", max_questions: 3 },
        reachableStepIds: reachable,
      }),
    ],
    mediaOrderByStepKey: {},
  };

  return {
    flow,
    initialState: makeState(flow, { currentStepId: stepStart }),
    capabilities: CAPS_WHAPI,
    inbounds: [
      { kind: "text", text: "qual o tempo de contrato mesmo?" },
    ],
    assert: (_finalState, outputs) => {
      const checks: V3ScenarioCheck[] = [];
      const t1 = outputs[0];
      checks.push({
        name: "AI1: zero outbound (deferred)",
        passed: t1.outbound.length === 0,
        detail: `outboundCount=${t1.outbound.length}`,
      });
      checks.push({
        name: "AI1: deferred.kind = 'ai_answer'",
        passed: t1.deferred?.kind === "ai_answer",
        detail: `deferred=${t1.deferred?.kind}`,
      });
      checks.push({
        name: "AI1: engine_ai_answer_deferred log present",
        passed: t1.logs.some((l) => l.kind === "engine_ai_answer_deferred"),
      });
      checks.push({
        name: "AI1: stayed on the same step",
        passed: t1.stateUpdate.currentStepId === undefined ||
          t1.stateUpdate.currentStepId === stepStart,
      });
      return checks;
    },
  };
}

// AI2 — `ai` decide mode (deferred decision with candidate list)
function buildAI2(consultantId: string): ScenarioFixture {
  const flowId = uuid();
  const stepStart = uuid();
  const stepA = uuid();
  const stepB = uuid();
  const stepC = uuid();
  const reachable = [stepStart, stepA, stepB, stepC];

  const baseStep = (id: string, key: string, position: number): BotFlowStep =>
    makeStep({
      id,
      flowId,
      stepKey: key,
      stepType: "text_message",
      position,
      messageText: `step ${key}`,
      fallback: { mode: "repeat" },
      reachableStepIds: reachable,
    });

  const flow: BotFlow = {
    id: flowId,
    consultantId,
    variant: "A",
    strictMode: false,
    steps: [
      makeStep({
        id: stepStart,
        flowId,
        stepKey: "start",
        stepType: "ask_text",
        position: 1,
        messageText: "Por onde a gente começa?",
        transitions: [
          // Use distinctive tokens so the open-ended turn 1 inbound
          // ("ainda não decidi, talvez algo entre eles") does NOT
          // substring-match — we want the `ai` fallback to fire.
          { trigger_phrases: ["__opt_a__"], goto_step_id: stepA },
          { trigger_phrases: ["__opt_b__"], goto_step_id: stepB },
          { trigger_phrases: ["__opt_c__"], goto_step_id: stepC },
        ],
        fallback: { mode: "ai" },
        reachableStepIds: reachable,
      }),
      baseStep(stepA, "step_a", 2),
      baseStep(stepB, "step_b", 3),
      baseStep(stepC, "step_c", 4),
    ],
    mediaOrderByStepKey: {},
  };

  return {
    flow,
    initialState: makeState(flow, { currentStepId: stepStart }),
    capabilities: CAPS_WHAPI,
    inbounds: [
      { kind: "text", text: "ainda não decidi, talvez algo entre eles" },
    ],
    assert: (_finalState, outputs) => {
      const checks: V3ScenarioCheck[] = [];
      const t1 = outputs[0];
      checks.push({
        name: "AI2: zero outbound (deferred)",
        passed: t1.outbound.length === 0,
        detail: `outboundCount=${t1.outbound.length}`,
      });
      checks.push({
        name: "AI2: deferred.kind = 'ai_decide'",
        passed: t1.deferred?.kind === "ai_decide",
        detail: `deferred=${t1.deferred?.kind}`,
      });
      const candidates = t1.deferred?.kind === "ai_decide"
        ? t1.deferred.candidates
        : [];
      checks.push({
        name: "AI2: candidates ⊆ reachableStepIds (engine validates)",
        passed: candidates.every((c) => reachable.includes(c)),
        detail: `candidates=${candidates.join(",")}`,
      });
      checks.push({
        name: "AI2: candidates includes the 3 configured transitions",
        passed: candidates.length === 3 &&
          candidates.includes(stepA) &&
          candidates.includes(stepB) &&
          candidates.includes(stepC),
      });
      checks.push({
        name: "AI2: engine_ai_decide_deferred log present",
        passed: t1.logs.some((l) => l.kind === "engine_ai_decide_deferred"),
      });
      return checks;
    },
  };
}

// SILENT — `no_input` cron tick produces zero outbound (G2 carve-out)
function buildSILENT(consultantId: string): ScenarioFixture {
  const flowId = uuid();
  const stepStart = uuid();
  const stepA = uuid();
  const reachable = [stepStart, stepA];

  const flow: BotFlow = {
    id: flowId,
    consultantId,
    variant: "A",
    strictMode: false,
    steps: [
      makeStep({
        id: stepStart,
        flowId,
        stepKey: "start",
        stepType: "ask_text",
        position: 1,
        messageText: "Tem alguma dúvida?",
        transitions: [
          { trigger_phrases: ["sim"], goto_step_id: stepA },
        ],
        // ai mode: handler emits empty outbound + deferred. For non-user-driven
        // inbound (no_input), the runner does NOT enforce G2 — outbound stays
        // empty, satisfying the SILENT guarantee.
        fallback: { mode: "ai" },
        reachableStepIds: reachable,
      }),
      makeStep({
        id: stepA,
        flowId,
        stepKey: "step_a",
        stepType: "text_message",
        position: 2,
        messageText: "Ótimo!",
        fallback: { mode: "repeat" },
        reachableStepIds: reachable,
      }),
    ],
    mediaOrderByStepKey: {},
  };

  return {
    flow,
    initialState: makeState(flow, { currentStepId: stepStart }),
    capabilities: CAPS_WHAPI,
    inbounds: [
      { kind: "no_input" }, // cron-driven re-entry
    ],
    assert: (_finalState, outputs) => {
      const checks: V3ScenarioCheck[] = [];
      const t1 = outputs[0];
      checks.push({
        name: "SILENT: zero outbound on no_input (G2 carve-out)",
        passed: t1.outbound.length === 0,
        detail: `outboundCount=${t1.outbound.length}`,
      });
      checks.push({
        name: "SILENT: no spurious decision logs beyond ai_decide_deferred",
        passed: t1.logs.filter((l) => DECISION_LOG_KINDS.has(l.kind))
            .length === 1 &&
          t1.logs.some((l) => l.kind === "engine_ai_decide_deferred"),
      });
      return checks;
    },
  };
}

// ─── Task 31 carryover scenarios (R_A1–R_A4, R_B1–R_B2) ────────────────────
//
// These six fixtures re-encode the regression scenarios from
// `.kiro/specs/flow-d-retry-rules-fix` under engine v3. They drive
// `runEngine` directly with synthetic `EngineInput` (no Supabase, no
// real OCR) and assert on the retry-counter / handoff-alert invariants
// that the legacy `flow-d-retry-rules-fix` deploy fixed in the legacy
// engines. Engine v3 must reproduce the same behaviour by construction
// — `retryHandler` (alias `repeatHandler`) in
// `_shared/flow-engine/fallbacks.ts` consumes
// `step.fallback.{max_retries,on_fail,handoff_reason}` and either
// re-emits the step (retries < max) or escalates to `humanoHandler`
// (retries >= max + on_fail = "handoff").
//
// Naming uses an `R_` prefix to keep them disjoint from `V_A1`/`V_B1`
// above (Task 30) and from the legacy whapi-webhook IDs
// `fluxo_d_ocr_ok` etc., which still exercise the legacy path until
// Phase 4 (Task 39) deletes it.

// R_A1_OCR_OK — variant D, OCR-style media inbound advances normally.
//
// Maps to legacy `fluxo_d_ocr_ok` / `flow-d-retry-rules-fix` A1: when
// the lead sends a valid photo on a step waiting for media, the
// transition with `trigger_intent = "media_received"` matches and the
// engine advances. Retry counter resets to 0. No handoff.
function buildR_A1_OCR_OK(consultantId: string): ScenarioFixture {
  const flowId = uuid();
  const stepWelcome = uuid();
  const stepCapture = uuid();
  const stepConfirm = uuid();
  const reachable = [stepWelcome, stepCapture, stepConfirm];

  const flow: BotFlow = {
    id: flowId,
    consultantId,
    variant: "D",
    strictMode: false,
    steps: [
      makeStep({
        id: stepWelcome,
        flowId,
        stepKey: "welcome",
        stepType: "text_message",
        position: 1,
        messageText: "Olá! Tudo bem?",
        transitions: [
          { trigger_phrases: ["oi"], goto_step_id: stepCapture },
        ],
        fallback: { mode: "repeat" },
        reachableStepIds: reachable,
      }),
      makeStep({
        id: stepCapture,
        flowId,
        stepKey: "capture_conta",
        stepType: "ask_media",
        position: 2,
        messageText: "Pode me enviar a foto da conta de luz? 📸",
        transitions: [
          {
            trigger_intent: "media_received",
            goto_step_id: stepConfirm,
          },
        ],
        fallback: {
          mode: "retry",
          max_retries: 2,
          on_fail: "handoff",
          handoff_reason: "capture_conta_retry_exhausted",
        },
        reachableStepIds: reachable,
      }),
      makeStep({
        id: stepConfirm,
        flowId,
        stepKey: "confirmando",
        stepType: "text_message",
        position: 3,
        messageText: "Recebi! Vou validar aqui ✅",
        fallback: { mode: "repeat" },
        reachableStepIds: reachable,
      }),
    ],
    mediaOrderByStepKey: {},
  };

  return {
    flow,
    initialState: makeState(flow, { currentStepId: stepWelcome }),
    capabilities: CAPS_WHAPI,
    inbounds: [
      { kind: "text", text: "oi" },
      { kind: "media", mediaKind: "image", mediaRef: "https://test/conta.jpg" },
    ],
    assert: (finalState, outputs) => {
      const checks: V3ScenarioCheck[] = [];

      // Turn 1: welcome → capture_conta.
      checks.push({
        name: "R_A1 turn 1: advanced to capture_conta",
        passed: outputs[0].stateUpdate.currentStepId === stepCapture,
        detail: `currentStepId=${outputs[0].stateUpdate.currentStepId}`,
      });

      // Turn 2: media inbound → trigger_intent="media_received" matches → confirm.
      const t2 = outputs[1];
      checks.push({
        name: "R_A1 turn 2: media inbound matched media_received transition",
        passed: t2.stateUpdate.currentStepId === stepConfirm,
        detail: `currentStepId=${t2.stateUpdate.currentStepId}`,
      });
      checks.push({
        name: "R_A1 turn 2: emitted engine_transition_match log",
        passed: t2.logs.some((l) => l.kind === "engine_transition_match"),
      });
      checks.push({
        name: "R_A1 turn 2: retries reset to 0 on transition",
        passed: t2.stateUpdate.retries === 0,
        detail: `retries=${t2.stateUpdate.retries}`,
      });
      checks.push({
        name: "R_A1 turn 2: NO handoff (status not paused_system)",
        passed: t2.stateUpdate.status !== "paused_system",
        detail: `status=${t2.stateUpdate.status ?? "(unchanged)"}`,
      });
      checks.push({
        name: "R_A1 final: lead reached confirming step",
        passed: finalState.currentStepId === stepConfirm,
      });
      return checks;
    },
  };
}

// R_A2_OCR_RETRY1 — variant D, retry mode, fail 1x → retry_text emitted.
//
// Maps to legacy `fluxo_d_ocr_retry_1x` / A2: when the lead sends a
// non-matching inbound on a `retry`-mode step, the engine re-emits the
// step's outbound (retry_text fallback) and increments retries. No
// handoff fires while retries < max_retries.
function buildR_A2_OCR_RETRY1(consultantId: string): ScenarioFixture {
  const flowId = uuid();
  const stepCapture = uuid();
  const stepConfirm = uuid();
  const reachable = [stepCapture, stepConfirm];

  const flow: BotFlow = {
    id: flowId,
    consultantId,
    variant: "D",
    strictMode: false,
    steps: [
      makeStep({
        id: stepCapture,
        flowId,
        stepKey: "capture_conta",
        stepType: "ask_media",
        position: 1,
        messageText: "Pode me enviar a foto da conta de luz? 📸",
        transitions: [
          {
            trigger_intent: "media_received",
            goto_step_id: stepConfirm,
          },
        ],
        fallback: {
          mode: "retry",
          max_retries: 2,
          on_fail: "handoff",
          handoff_reason: "capture_conta_retry_exhausted",
        },
        reachableStepIds: reachable,
      }),
      makeStep({
        id: stepConfirm,
        flowId,
        stepKey: "confirmando",
        stepType: "text_message",
        position: 2,
        messageText: "Recebi!",
        fallback: { mode: "repeat" },
        reachableStepIds: reachable,
      }),
    ],
    mediaOrderByStepKey: {},
  };

  return {
    flow,
    initialState: makeState(flow, { currentStepId: stepCapture }),
    capabilities: CAPS_WHAPI,
    inbounds: [
      // Wrong inbound: a text instead of media. No transition matches
      // (trigger_intent="media_received" is the only one), so the
      // retry-mode fallback fires.
      { kind: "text", text: "isso é uma conta?" },
    ],
    assert: (finalState, outputs) => {
      const checks: V3ScenarioCheck[] = [];
      const t1 = outputs[0];

      checks.push({
        name: "R_A2 turn 1: emitted at least one outbound (retry_text)",
        passed: t1.outbound.length >= 1,
        detail: `outboundCount=${t1.outbound.length}`,
      });
      checks.push({
        name: "R_A2 turn 1: emitted engine_repeat log (retry handler fired)",
        passed: t1.logs.some((l) => l.kind === "engine_repeat"),
      });
      checks.push({
        name: "R_A2 turn 1: retries=1",
        passed: t1.stateUpdate.retries === 1,
        detail: `retries=${t1.stateUpdate.retries}`,
      });
      checks.push({
        name: "R_A2 turn 1: NO handoff (status unchanged)",
        passed: t1.stateUpdate.status !== "paused_system",
        detail: `status=${t1.stateUpdate.status ?? "(unchanged)"}`,
      });
      checks.push({
        name: "R_A2 turn 1: stayed on capture_conta (no advance)",
        passed:
          (t1.stateUpdate.currentStepId === undefined ||
            t1.stateUpdate.currentStepId === stepCapture) &&
          finalState.currentStepId === stepCapture,
        detail: `currentStepId=${finalState.currentStepId}`,
      });
      return checks;
    },
  };
}

// R_A3_OCR_RETRY_EXHAUSTED — variant D, retry exhausted → paused + handoff.
//
// Maps to legacy `fluxo_d_ocr_retry_exhausted` / A3: when retries
// exceed `max_retries` and `on_fail = "handoff"`, the retry handler
// delegates to `humanoHandler`, which sets `status = paused_system` and
// emits a single `insert_handoff_alert` sentinel log (G5).
function buildR_A3_OCR_RETRY_EXHAUSTED(
  consultantId: string,
): ScenarioFixture {
  const flowId = uuid();
  const stepCapture = uuid();
  const stepConfirm = uuid();
  const reachable = [stepCapture, stepConfirm];

  const flow: BotFlow = {
    id: flowId,
    consultantId,
    variant: "D",
    strictMode: false,
    steps: [
      makeStep({
        id: stepCapture,
        flowId,
        stepKey: "capture_conta",
        stepType: "ask_media",
        position: 1,
        messageText: "Pode me enviar a foto da conta de luz? 📸",
        transitions: [
          {
            trigger_intent: "media_received",
            goto_step_id: stepConfirm,
          },
        ],
        fallback: {
          mode: "retry",
          max_retries: 2,
          on_fail: "handoff",
          handoff_reason: "capture_conta_retry_exhausted",
        },
        reachableStepIds: reachable,
      }),
      makeStep({
        id: stepConfirm,
        flowId,
        stepKey: "confirmando",
        stepType: "text_message",
        position: 2,
        messageText: "Recebi!",
        fallback: { mode: "repeat" },
        reachableStepIds: reachable,
      }),
    ],
    mediaOrderByStepKey: {},
  };

  return {
    flow,
    initialState: makeState(flow, { currentStepId: stepCapture }),
    capabilities: CAPS_WHAPI,
    inbounds: [
      // 3 wrong inbounds (text instead of media). max_retries=2, so the
      // 3rd attempt (retries goes 0→1, 1→2, 2→3 attempted) triggers
      // escalation to humanoHandler.
      { kind: "text", text: "lixo 1" },
      { kind: "text", text: "lixo 2" },
      { kind: "text", text: "lixo 3" },
    ],
    assert: (finalState, outputs) => {
      const checks: V3ScenarioCheck[] = [];

      // Turns 1 & 2: retry, no escalation.
      for (let i = 0; i < 2; i++) {
        const t = outputs[i];
        checks.push({
          name: `R_A3 turn ${i + 1}: retry, status not paused`,
          passed: t.stateUpdate.status !== "paused_system",
          detail: `status=${t.stateUpdate.status ?? "(unchanged)"}, retries=${t.stateUpdate.retries}`,
        });
        checks.push({
          name: `R_A3 turn ${i + 1}: emitted engine_repeat log`,
          passed: t.logs.some((l) => l.kind === "engine_repeat"),
        });
      }

      // Turn 3: retries exhausted → handoff.
      const tFinal = outputs[2];
      checks.push({
        name: "R_A3 turn 3: status = paused_system",
        passed: tFinal.stateUpdate.status === "paused_system",
        detail: `status=${tFinal.stateUpdate.status}`,
      });
      checks.push({
        name: "R_A3 turn 3: pauseReason = capture_conta_retry_exhausted",
        passed: tFinal.stateUpdate.pauseReason ===
          "capture_conta_retry_exhausted",
        detail: `pauseReason=${tFinal.stateUpdate.pauseReason}`,
      });
      checks.push({
        name: "R_A3 turn 3: engine_handoff log present",
        passed: tFinal.logs.some((l) => l.kind === "engine_handoff"),
      });
      checks.push({
        name: "R_A3 turn 3: G5 — exactly one insert_handoff_alert sentinel",
        passed: tFinal.logs.filter((l) =>
          l.sideEffect?.kind === "insert_handoff_alert"
        ).length === 1,
      });
      checks.push({
        name: "R_A3 final: status = paused_system",
        passed: finalState.status === "paused_system",
      });
      return checks;
    },
  };
}

// R_A4_NO_RETRY — variant A, no retry config (mode=repeat) → SAFE_TEXT.
//
// Maps to legacy `fluxo_a_ocr_fail` / A4: when the step has no `retry`
// fallback configured (just default `repeat`) and the inbound doesn't
// match any transition, the engine still re-emits the step (via
// repeatHandler — alias for retryHandler with default max). The lead
// sees the step's `messageText` again. No handoff fires unless retries
// climb past the engine's default ceiling
// (`config.limits.maxRetriesBeforeHandoff = 3` — see makeConfig).
//
// This scenario asserts the *baseline* behaviour: with the engine's
// default limits, a single mismatched inbound bumps retries to 1 and
// re-emits the step. No SAFE_TEXT_FALLBACK should fire on the first
// attempt — the runner only invokes safe-text when the variant-built
// outbound is empty (G2). With variant A + a non-empty messageText,
// repeatHandler produces a non-empty outbound on its own.
function buildR_A4_NO_RETRY(consultantId: string): ScenarioFixture {
  const flowId = uuid();
  const stepStart = uuid();
  const reachable = [stepStart];

  const flow: BotFlow = {
    id: flowId,
    consultantId,
    variant: "A",
    strictMode: false,
    steps: [
      makeStep({
        id: stepStart,
        flowId,
        stepKey: "start",
        stepType: "ask_text",
        position: 1,
        messageText: "Manda 'sim' pra continuar.",
        // No retry_text on fallback — bare `repeat` mode. retryHandler
        // (alias for repeatHandler) will re-emit the step's messageText
        // via variant A's synthesizeFromStep.
        transitions: [
          { trigger_phrases: ["sim"], goto_step_id: null },
        ],
        fallback: { mode: "repeat" },
        reachableStepIds: reachable,
      }),
    ],
    mediaOrderByStepKey: {},
  };

  return {
    flow,
    initialState: makeState(flow, { currentStepId: stepStart }),
    capabilities: CAPS_WHAPI,
    inbounds: [
      // Inbound that doesn't match the "sim" transition.
      { kind: "text", text: "qualquer coisa" },
    ],
    assert: (_finalState, outputs) => {
      const checks: V3ScenarioCheck[] = [];
      const t1 = outputs[0];

      checks.push({
        name: "R_A4 turn 1: emitted engine_repeat log (repeat handler fired)",
        passed: t1.logs.some((l) => l.kind === "engine_repeat"),
      });
      checks.push({
        name: "R_A4 turn 1: emitted at least one outbound (re-emit step)",
        passed: t1.outbound.length >= 1,
        detail: `outboundCount=${t1.outbound.length}`,
      });
      // Outbound text should match the step's messageText (re-emit).
      const t1Text = t1.outbound.find((m) => m.kind === "text");
      checks.push({
        name: "R_A4 turn 1: outbound text re-emits messageText",
        passed: t1Text?.kind === "text" &&
          t1Text.text === "Manda 'sim' pra continuar.",
        detail: `text='${t1Text?.kind === "text" ? t1Text.text : "(none)"}'`,
      });
      checks.push({
        name: "R_A4 turn 1: retries=1",
        passed: t1.stateUpdate.retries === 1,
        detail: `retries=${t1.stateUpdate.retries}`,
      });
      checks.push({
        name: "R_A4 turn 1: NO handoff",
        passed: t1.stateUpdate.status !== "paused_system",
        detail: `status=${t1.stateUpdate.status ?? "(unchanged)"}`,
      });
      return checks;
    },
  };
}

// R_B1_CHOICE_RETRY1 — variant B ask_choice, lixo 1x → retry_text, retries=1.
//
// Maps to legacy `ask_choice_retry_1x` / B1: a variant-B `ask_choice`
// step with `fallback.mode = "retry"`. Lead sends garbage; the engine
// re-emits the choice and increments retries. Variant B's static
// guarantee: no audio outbound regardless of step config (G4b).
function buildR_B1_CHOICE_RETRY1(consultantId: string): ScenarioFixture {
  const flowId = uuid();
  const stepMenu = uuid();
  const stepNext = uuid();
  const reachable = [stepMenu, stepNext];

  const optSimId = uuid();
  const optNaoId = uuid();

  const flow: BotFlow = {
    id: flowId,
    consultantId,
    variant: "B",
    strictMode: false,
    steps: [
      makeStep({
        id: stepMenu,
        flowId,
        stepKey: "menu",
        stepType: "ask_choice",
        position: 1,
        messageText: "Quer continuar?",
        persuasiveText:
          "Tô aqui pra te ajudar a economizar até 20% na conta. Bora?",
        choiceOptions: [
          { id: optSimId, title: "Sim, bora" },
          { id: optNaoId, title: "Agora não" },
        ],
        preferredChoiceKind: "number",
        transitions: [
          { trigger_phrases: [optSimId, "sim"], goto_step_id: stepNext },
        ],
        fallback: {
          mode: "retry",
          max_retries: 2,
          on_fail: "handoff",
          handoff_reason: "menu_retry_exhausted",
        },
        reachableStepIds: reachable,
      }),
      makeStep({
        id: stepNext,
        flowId,
        stepKey: "next",
        stepType: "text_message",
        position: 2,
        messageText: "Boa!",
        fallback: { mode: "repeat" },
        reachableStepIds: reachable,
      }),
    ],
    // Variant B static guarantee: even when audio is configured, it
    // must be suppressed. Putting an audio entry here ensures we
    // exercise the strip path.
    mediaOrderByStepKey: {
      menu: [
        { kind: "audio", url: "https://test/audio.ogg", durationSec: 8 },
      ],
    },
  };

  return {
    flow,
    initialState: makeState(flow, { currentStepId: stepMenu }),
    capabilities: CAPS_WHAPI,
    inbounds: [
      { kind: "text", text: "lixo aleatório 🤡" },
    ],
    assert: (finalState, outputs) => {
      const checks: V3ScenarioCheck[] = [];
      const t1 = outputs[0];

      checks.push({
        name: "R_B1 turn 1: emitted engine_repeat log",
        passed: t1.logs.some((l) => l.kind === "engine_repeat"),
      });
      checks.push({
        name: "R_B1 turn 1: emitted at least one outbound (retry_text)",
        passed: t1.outbound.length >= 1,
        detail: `outboundCount=${t1.outbound.length}`,
      });
      checks.push({
        name: "R_B1 turn 1: retries=1",
        passed: t1.stateUpdate.retries === 1,
        detail: `retries=${t1.stateUpdate.retries}`,
      });
      checks.push({
        name: "R_B1 turn 1: NO handoff",
        passed: t1.stateUpdate.status !== "paused_system",
        detail: `status=${t1.stateUpdate.status ?? "(unchanged)"}`,
      });
      // Variant B static guarantee: no audio outbound, even when
      // mediaOrderByStepKey configures one.
      const hasAudio = t1.outbound.some((m) =>
        m.kind === "audio_slot" ||
        (m.kind === "media" && m.media.kind === "audio")
      );
      checks.push({
        name: "R_B1 turn 1: NO audio outbound (variant B static guarantee)",
        passed: !hasAudio,
        detail: `audioCount=${
          t1.outbound.filter((m) =>
            m.kind === "audio_slot" ||
            (m.kind === "media" && m.media.kind === "audio")
          ).length
        }`,
      });
      checks.push({
        name: "R_B1 turn 1: stayed on menu step",
        passed:
          (t1.stateUpdate.currentStepId === undefined ||
            t1.stateUpdate.currentStepId === stepMenu) &&
          finalState.currentStepId === stepMenu,
        detail: `currentStepId=${finalState.currentStepId}`,
      });
      return checks;
    },
  };
}

// R_B2_CHOICE_RETRY_EXHAUSTED — variant B ask_choice retry exhausted.
//
// Maps to legacy `ask_choice_retry_exhausted` / B2: lead sends garbage
// 3x on a variant-B `ask_choice` step with max_retries=2. The 3rd
// attempt escalates to handoff (status=paused_system, handoff alert
// sentinel emitted exactly once — G5).
function buildR_B2_CHOICE_RETRY_EXHAUSTED(
  consultantId: string,
): ScenarioFixture {
  const flowId = uuid();
  const stepMenu = uuid();
  const stepNext = uuid();
  const reachable = [stepMenu, stepNext];

  const optSimId = uuid();
  const optNaoId = uuid();

  const flow: BotFlow = {
    id: flowId,
    consultantId,
    variant: "B",
    strictMode: false,
    steps: [
      makeStep({
        id: stepMenu,
        flowId,
        stepKey: "menu",
        stepType: "ask_choice",
        position: 1,
        messageText: "Quer continuar?",
        persuasiveText:
          "Tô aqui pra te ajudar a economizar até 20% na conta. Bora?",
        choiceOptions: [
          { id: optSimId, title: "Sim, bora" },
          { id: optNaoId, title: "Agora não" },
        ],
        preferredChoiceKind: "number",
        transitions: [
          { trigger_phrases: [optSimId, "sim"], goto_step_id: stepNext },
        ],
        fallback: {
          mode: "retry",
          max_retries: 2,
          on_fail: "handoff",
          handoff_reason: "menu_retry_exhausted",
        },
        reachableStepIds: reachable,
      }),
      makeStep({
        id: stepNext,
        flowId,
        stepKey: "next",
        stepType: "text_message",
        position: 2,
        messageText: "Boa!",
        fallback: { mode: "repeat" },
        reachableStepIds: reachable,
      }),
    ],
    mediaOrderByStepKey: {},
  };

  return {
    flow,
    initialState: makeState(flow, { currentStepId: stepMenu }),
    capabilities: CAPS_WHAPI,
    inbounds: [
      { kind: "text", text: "lixo 1 🤡" },
      { kind: "text", text: "lixo 2 🤡" },
      { kind: "text", text: "lixo 3 🤡" },
    ],
    assert: (finalState, outputs) => {
      const checks: V3ScenarioCheck[] = [];

      // Turns 1 & 2: retry, no escalation.
      for (let i = 0; i < 2; i++) {
        const t = outputs[i];
        checks.push({
          name: `R_B2 turn ${i + 1}: retry, status not paused`,
          passed: t.stateUpdate.status !== "paused_system",
          detail: `status=${t.stateUpdate.status ?? "(unchanged)"}, retries=${t.stateUpdate.retries}`,
        });
        checks.push({
          name: `R_B2 turn ${i + 1}: emitted engine_repeat log`,
          passed: t.logs.some((l) => l.kind === "engine_repeat"),
        });
      }

      // Turn 3: retries exhausted → handoff.
      const tFinal = outputs[2];
      checks.push({
        name: "R_B2 turn 3: status = paused_system",
        passed: tFinal.stateUpdate.status === "paused_system",
        detail: `status=${tFinal.stateUpdate.status}`,
      });
      checks.push({
        name: "R_B2 turn 3: pauseReason = menu_retry_exhausted",
        passed: tFinal.stateUpdate.pauseReason === "menu_retry_exhausted",
        detail: `pauseReason=${tFinal.stateUpdate.pauseReason}`,
      });
      checks.push({
        name: "R_B2 turn 3: engine_handoff log present",
        passed: tFinal.logs.some((l) => l.kind === "engine_handoff"),
      });
      checks.push({
        name: "R_B2 turn 3: G5 — exactly one insert_handoff_alert sentinel",
        passed: tFinal.logs.filter((l) =>
          l.sideEffect?.kind === "insert_handoff_alert"
        ).length === 1,
      });
      checks.push({
        name: "R_B2 final: status = paused_system",
        passed: finalState.status === "paused_system",
      });
      return checks;
    },
  };
}

// ─── Scenario dispatch table ────────────────────────────────────────────────

const SCENARIO_BUILDERS: Record<
  V3DirectScenario,
  (consultantId: string) => ScenarioFixture
> = {
  V_A1: buildV_A1,
  V_B1: buildV_B1,
  V_D1: buildV_D1,
  V_D2: buildV_D2,
  AI1: buildAI1,
  AI2: buildAI2,
  SILENT: buildSILENT,
  R_A1_OCR_OK: buildR_A1_OCR_OK,
  R_A2_OCR_RETRY1: buildR_A2_OCR_RETRY1,
  R_A3_OCR_RETRY_EXHAUSTED: buildR_A3_OCR_RETRY_EXHAUSTED,
  R_A4_NO_RETRY: buildR_A4_NO_RETRY,
  R_B1_CHOICE_RETRY1: buildR_B1_CHOICE_RETRY1,
  R_B2_CHOICE_RETRY_EXHAUSTED: buildR_B2_CHOICE_RETRY_EXHAUSTED,
};

// ─── Apply state update helper (mirrors dispatcher merge) ───────────────────

function applyStateUpdate(
  state: CustomerSnapshot,
  update: Partial<CustomerSnapshot>,
): CustomerSnapshot {
  return {
    ...state,
    ...update,
    customer: { ...state.customer, ...(update.customer ?? {}) },
  };
}

// ─── Public runner ──────────────────────────────────────────────────────────

/**
 * Run one v3 direct scenario end-to-end:
 *  1. Flip `consultants.use_engine_v3 = true` (Requirement 11.1).
 *  2. Drive the inbound sequence through `runEngine` directly.
 *  3. Validate G1–G6 invariants on every turn.
 *  4. Run scenario-specific assertions on the final state + per-turn outputs.
 *  5. Restore the previous flag value.
 */
export async function runV3DirectScenario(args: {
  scenario: V3DirectScenario;
  // deno-lint-ignore no-explicit-any
  supabase: any;
  consultantId: string;
}): Promise<V3ScenarioResult> {
  const { scenario, supabase, consultantId } = args;
  const checks: V3ScenarioCheck[] = [];

  // ─── 1. Flip use_engine_v3 = true (Requirement 11.1) ───────────────────
  let previousFlag: boolean | null = null;
  try {
    const { data: priorRow } = await supabase
      .from("consultants")
      .select("use_engine_v3")
      .eq("id", consultantId)
      .maybeSingle();
    previousFlag = (priorRow?.use_engine_v3 as boolean | undefined) ?? false;
    const { error: updErr } = await supabase
      .from("consultants")
      .update({ use_engine_v3: true })
      .eq("id", consultantId);
    checks.push({
      name: "Setup: consultants.use_engine_v3 = true",
      passed: !updErr,
      detail: updErr ? updErr.message : `previous=${previousFlag}`,
    });
  } catch (e) {
    checks.push({
      name: "Setup: consultants.use_engine_v3 = true",
      passed: false,
      detail: (e as Error).message,
    });
  }

  // ─── 2. Build fixture + drive inbounds through runEngine ──────────────
  const fixture = SCENARIO_BUILDERS[scenario](consultantId);
  let state = fixture.initialState;
  const turns: V3ScenarioResult["turns"] = [];
  const outputs: EngineOutput[] = [];

  for (let i = 0; i < fixture.inbounds.length; i++) {
    const inbound = fixture.inbounds[i];
    const config = makeConfig(
      new Date(Date.parse(T0) + i * 60_000).toISOString(),
    );
    const input: EngineInput = {
      state,
      inbound,
      flow: fixture.flow,
      capabilities: fixture.capabilities,
      hooks: STUB_HOOKS,
      config,
    };

    let out: EngineOutput;
    try {
      out = runEngine(input);
    } catch (e) {
      checks.push({
        name: `Turn ${i + 1}: runEngine threw`,
        passed: false,
        detail: (e as Error).message,
      });
      break;
    }

    outputs.push(out);
    checks.push(...runAllInvariantChecks(input, out, i + 1));

    state = applyStateUpdate(state, out.stateUpdate);
    turns.push({
      turn: i + 1,
      inbound,
      outboundCount: out.outbound.length,
      decisionLogs: out.logs.filter((l) => DECISION_LOG_KINDS.has(l.kind)).map(
        (l) => l.kind,
      ),
      finalStepId: state.currentStepId,
    });
  }

  // ─── 3. Run scenario-specific assertions ──────────────────────────────
  if (outputs.length === fixture.inbounds.length) {
    checks.push(...fixture.assert(state, outputs));
  }

  // ─── 4. Restore previous flag ─────────────────────────────────────────
  if (previousFlag !== null) {
    try {
      await supabase
        .from("consultants")
        .update({ use_engine_v3: previousFlag })
        .eq("id", consultantId);
    } catch (_) {
      // swallow — restoration is best-effort, never blocks scenario result.
    }
  }

  const ok = checks.every((c) => c.passed);
  return {
    ok,
    status: ok ? "passed" : "failed",
    checks,
    turns,
    finalStateUpdate: outputs.length > 0
      ? outputs[outputs.length - 1].stateUpdate
      : {},
    scenario,
  };
}
