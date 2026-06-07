/**
 * Engine v3 — pure conversational runner.
 *
 * Spec: `.kiro/specs/flow-engine-v3-rewrite/design.md` (§2.1, §2.7).
 * Task: 13.
 *
 * This module is the single source of truth for the bot's conversational
 * behaviour. It is a referentially-transparent function: same
 * `EngineInput` always yields the same `EngineOutput`. No I/O, no system
 * clock, no randomness — `EngineConfig.now` / `idempotencyKeyFn` /
 * `humanDelayFn` cover all those needs.
 *
 * Purity is enforced statically by `__tests__/purity_lint_test.ts` —
 * any of `Date.now`, `fetch`, `Math.random`, `crypto.randomUUID`,
 * `setTimeout`, `setInterval`, `supabase.from`, or `from
 * "@supabase/supabase-js"` in this file will fail CI.
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3,
 *            3.4, 4.1, 4.2, 4.3, 5.7, 6.3, 7.1, 7.2, 7.3, 9.4, 15.1, 15.4.
 */

import type {
  BotFlowStep,
  CustomerSnapshot,
  EngineInput,
  EngineOutput,
  FallbackContext,
  FallbackHandler,
  InboundEvent,
  OutboundMessage,
  StructuredLog,
} from "./types.ts";
import {
  capLimits,
  dedupeAdjacent,
  dropDuplicateLeader,
  hash,
  matchTransition,
  pickVariant,
} from "./helpers.ts";
import {
  FALLBACK_HANDLERS,
  humanoHandler,
  SAFE_TEXT_FALLBACK,
} from "./fallbacks.ts";

// ─── Local helpers (pure) ───────────────────────────────────────────────

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

/** True for inbound kinds that are user-driven and require a response (G2). */
function isUserDrivenInbound(kind: InboundEvent["kind"]): boolean {
  return (
    kind === "text" ||
    kind === "button_click" ||
    kind === "number_reply" ||
    kind === "media"
  );
}

/** Build a StructuredLog with engine-mandated fields populated. */
function makeLog(
  kind: StructuredLog["kind"],
  input: EngineInput,
  stepId: string | null,
  payload: Record<string, unknown> = {},
): StructuredLog {
  return {
    kind,
    at: input.config.now,
    customerId: input.state.customerId,
    flowId: input.flow.id,
    stepId,
    payload,
  };
}

// stripAudioForVariantB removido — Fluxo B agora é Vendedora V2 e nunca
// emite outbounds pelo runner V3.

/** Clamp retries to [0, prev + 1] per Requirement 15.4. */
function clampRetries(prev: number, candidate: number | undefined): number | undefined {
  if (candidate === undefined) return undefined;
  if (!Number.isFinite(candidate)) return prev;
  if (candidate < 0) return 0;
  if (candidate > prev + 1) return prev + 1;
  return Math.floor(candidate);
}

/** Clamp aiQuestionsThisStep to [0, prev + 1] — mesma disciplina do retries. */
function clampAiQuestions(prev: number, candidate: number | undefined): number | undefined {
  if (candidate === undefined) return undefined;
  if (!Number.isFinite(candidate)) return prev;
  if (candidate < 0) return 0;
  if (candidate > prev + 1) return prev + 1;
  return Math.floor(candidate);
}

/** Find the first active step (lowest `position`) — entry point for new leads. */
function findFirstStep(steps: BotFlowStep[]): BotFlowStep | null {
  if (!Array.isArray(steps) || steps.length === 0) return null;
  let first = steps[0];
  for (const s of steps) {
    if (s.position < first.position) first = s;
  }
  return first;
}

/**
 * G2 fallback when nothing else has produced an outbound or deferred
 * action AND the inbound was user-driven. Emits the configured
 * step.messageText (or the hardcoded "Pode me responder, por favor? 🙂"
 * literal mandated by Requirement 3.2/3.4) and an `engine_no_match` log.
 */
function emitG2SafeText(
  input: EngineInput,
  step: BotFlowStep,
): { outbound: OutboundMessage[]; logs: StructuredLog[]; stateUpdate: Partial<CustomerSnapshot> } {
  const text = (step.messageText ?? "").trim() || "Pode me responder, por favor? 🙂";
  const outbound: OutboundMessage[] = [{
    kind: "text",
    text,
    idempotencyContent: `g2-safe:${step.id}:${input.state.retries}`,
  }];
  const stateUpdate: Partial<CustomerSnapshot> = {
    retries: input.state.retries + 1,
    lastOutboundAt: input.config.now,
  };
  const logs: StructuredLog[] = [
    makeLog("engine_no_match", input, step.id),
    makeLog("engine_safe_text", input, step.id),
  ];
  return { outbound, logs, stateUpdate };
}

// ─── runEngine ──────────────────────────────────────────────────────────

/**
 * Single tick of the conversational engine. See design §2.7 for the
 * step-by-step evaluation order encoded below.
 *
 * The function never throws on well-typed input; any thrown error from
 * a child module (variant.buildStepOutbound, fallback handler,
 * captures.extract, etc.) is caught at the outer boundary and converted
 * into a single safe-text outbound + `engine_safe_text` log so the lead
 * is never silenced (Requirement 3.4).
 */
export function runEngine(input: EngineInput): EngineOutput {
  try {
    return runEngineInner(input);
  } catch (err) {
    // Last-resort safety net (Requirement 3.4). Always returns ≥1 outbound
    // for user-driven inbounds; for `no_input`/`timer_expired` we return
    // empty (no lead waiting on a reply).
    const errMsg = err instanceof Error ? err.message : String(err);
    const errStack = err instanceof Error ? (err.stack ?? "") : "";
    // Surface a tiny stack snippet (line of throw) for production triage.
    const stackHint = errStack.split("\n").slice(0, 4).join(" ⏎ ").slice(0, 400);
    const stepId = typeof input?.state?.currentStepId === "string"
      ? input.state.currentStepId
      : null;
    if (!isUserDrivenInbound(input.inbound.kind)) {
      return {
        outbound: [],
        stateUpdate: {},
        logs: [makeLog("engine_safe_text", input, stepId, { error: errMsg, branch: "outer_catch_silent", stackHint })],
      };
    }
    return {
      outbound: [{
        kind: "text",
        text: "Pode me responder, por favor? 🙂",
        idempotencyContent: `g2-error:${stepId ?? "no-step"}:${input.state?.retries ?? 0}`,
      }],
      stateUpdate: {
        retries: clampRetries(input.state?.retries ?? 0, (input.state?.retries ?? 0) + 1),
        lastOutboundAt: input.config.now,
      },
      logs: [makeLog("engine_safe_text", input, stepId, { error: errMsg, branch: "outer_catch_recover", stackHint })],
    };
  }
}

function runEngineInner(input: EngineInput): EngineOutput {
  // ─── Step 1: resolve current step ─────────────────────────────────────
  const stepLookup = (id: string | null): BotFlowStep | null => {
    if (!id) return null;
    return input.flow.steps.find((s) => s.id === id) ?? null;
  };
  let step = stepLookup(input.state.currentStepId);

  const enterLogs: StructuredLog[] = [];
  let didResetStep = false;

  if (!step) {
    // New lead OR currentStepId points to a step that no longer exists.
    const first = findFirstStep(input.flow.steps);
    if (!first) {
      // Empty flow — escalate to humano. There is nothing else we can do.
      const ctx = makeFallbackContext(input, {
        // Synthetic step to satisfy FallbackContext; fallback handler only
        // reads step.id, step.fallback.handoff_reason, step.reachableStepIds.
        id: "no-step",
        flowId: input.flow.id,
        stepKey: null,
        stepType: "text_message",
        position: 0,
        messageText: null,
        persuasiveText: null,
        choiceOptions: null,
        preferredChoiceKind: null,
        captures: [],
        transitions: [],
        fallback: { mode: "humano", handoff_reason: "empty_flow" },
        waitFor: "none",
        waitSeconds: 0,
        pipelineKind: null,
        slotKey: null,
        conditionExpr: null,
        reachableStepIds: [],
      });
      const r = humanoHandler.handle(ctx);
      return {
        outbound: r.outbound,
        stateUpdate: r.stateUpdate,
        logs: [
          makeLog("engine_invalid_step", input, null, { reason: "empty_flow" }),
          ...r.logs,
        ],
      };
    }
    // currentStepId was set but doesn't match any step — log + reset.
    if (input.state.currentStepId) {
      enterLogs.push(
        makeLog("engine_invalid_step", input, null, {
          attemptedStepId: input.state.currentStepId,
          reset_to: first.id,
        }),
      );
    }
    enterLogs.push(makeLog("engine_step_enter", input, first.id, { newLead: !input.state.currentStepId }));
    step = first;
    didResetStep = true;
  }

  // ─── Step 2: variant C short-circuit ─────────────────────────────────
  if (input.flow.variant === "C") {
    const ctx = makeFallbackContext(input, {
      ...step,
      fallback: { ...step.fallback, mode: "humano", handoff_reason: "variant_c_not_supported" },
    });
    const r = humanoHandler.handle(ctx);
    return {
      outbound: r.outbound,
      stateUpdate: r.stateUpdate,
      logs: [
        ...enterLogs,
        makeLog("engine_variant_unsupported", input, step.id, { variant: "C" }),
        ...r.logs,
      ],
    };
  }

  // ─── Step 3: capture extraction ──────────────────────────────────────
  let captured: Record<string, unknown> = {};
  const captureLogs: StructuredLog[] = [];
  try {
    captured = input.hooks.captures.extract({
      inbound: input.inbound,
      specs: step.captures,
    }) ?? {};
    if (Object.keys(captured).length > 0) {
      captureLogs.push(makeLog("engine_capture_extracted", input, step.id, { keys: Object.keys(captured) }));
    }
  } catch (e) {
    captured = {};
    captureLogs.push(
      makeLog("engine_capture_validation_failed", input, step.id, {
        error: e instanceof Error ? e.message : String(e),
      }),
    );
  }

  // ─── Step 4: try transition match ─────────────────────────────────────
  const matched = matchTransition(step.transitions, input.inbound, captured);
  if (matched) {
    // Resolve target. goto_special handled separately.
    if (matched.goto_special === "humano") {
      const ctx = makeFallbackContext(input, {
        ...step,
        fallback: { ...step.fallback, mode: "humano", handoff_reason: "lead_pediu_humano" },
      });
      const r = humanoHandler.handle(ctx);
      return finalize(input, step, {
        outbound: r.outbound,
        stateUpdate: r.stateUpdate,
        logs: [...enterLogs, ...captureLogs, makeLog("engine_transition_match", input, step.id, { via: "goto_special:humano" }), ...r.logs],
      });
    }

    const targetId = matched.goto_step_id ?? null;
    if (targetId && step.reachableStepIds.includes(targetId)) {
      const target = stepLookup(targetId);
      if (target) {
        const variant = pickVariant(input.flow.variant);
        let outbound = variant.buildStepOutbound({
          step: target,
          flow: input.flow,
          capabilities: input.capabilities,
          config: input.config,
        });
        outbound = dedupeAdjacent(outbound);
        const cap = capLimits(outbound, input.config.limits.maxOutboundsPerTurn, input.state.customerId, input.flow.id, target.id, input.config.now);
        outbound = cap.outbound;

        const stateUpdate: Partial<CustomerSnapshot> = {
          currentStepId: target.id,
          retries: 0,
          aiQuestionsThisStep: 0,
          enteredStepAt: input.config.now,
          lastOutboundAt: outbound.length > 0 ? input.config.now : input.state.lastOutboundAt ?? null,
        };
        const logs: StructuredLog[] = [
          ...enterLogs,
          ...captureLogs,
          makeLog("engine_transition_match", input, step.id, { from: step.id, to: target.id }),
        ];
        if (cap.log) logs.push(cap.log);
        return finalize(input, target, { outbound, stateUpdate, logs });
      }
    }

    // Transition matched but goto_step_id is invalid — fall through to safe-text.
    const safe = SAFE_TEXT_FALLBACK.handle(makeFallbackContext(input, step));
    return finalize(input, step, {
      outbound: safe.outbound,
      stateUpdate: safe.stateUpdate,
      logs: [
        ...enterLogs,
        ...captureLogs,
        makeLog("engine_transition_match", input, step.id, { matched: true, invalid_target: targetId }),
        ...safe.logs,
      ],
    });
  }

  // ─── Step 5: no transition matched — pick fallback handler ───────────
  const mode = step.fallback?.mode;
  let handler: FallbackHandler;
  const strictBlocked = input.flow.strictMode === true && (mode === "ai" || mode === "ai_answer");
  const decisionLogs: StructuredLog[] = [];

  if (strictBlocked) {
    handler = SAFE_TEXT_FALLBACK;
    decisionLogs.push(makeLog("engine_strict_mode_blocked_ai", input, step.id, { mode }));
  } else if (mode && Object.prototype.hasOwnProperty.call(FALLBACK_HANDLERS, mode)) {
    handler = FALLBACK_HANDLERS[mode];
  } else {
    handler = SAFE_TEXT_FALLBACK;
  }

  const ctx = makeFallbackContext(input, step);
  let result = handler.handle(ctx);

  // ─── Step 6: G2 enforcement — never silent on user-driven inbound ────
  if (
    result.outbound.length === 0 &&
    result.deferred === undefined &&
    isUserDrivenInbound(input.inbound.kind)
  ) {
    const g2 = emitG2SafeText(input, step);
    // G3 invariant: exactly one decision log per turn. When G2 sequesters
    // the result because the fallback handler produced empty outbound, we
    // STRIP any previously-emitted decision logs (e.g. engine_repeat from
    // a degenerate variant.synthesize that returned []) so the only
    // decision log left is the G2 pair (engine_no_match + engine_safe_text
    // — which together count as a single "no match → safe text" decision).
    const filteredPriorLogs = result.logs.filter((l) => !DECISION_LOG_KINDS.has(l.kind));
    result = {
      outbound: g2.outbound,
      stateUpdate: g2.stateUpdate,
      logs: [...filteredPriorLogs, ...g2.logs],
    };
  }

  return finalize(input, step, {
    outbound: result.outbound,
    stateUpdate: didResetStep
      ? { currentStepId: step.id, enteredStepAt: input.config.now, ...result.stateUpdate }
      : result.stateUpdate,
    logs: [...enterLogs, ...captureLogs, ...decisionLogs, ...result.logs],
    deferred: result.deferred,
  });
}

// ─── finalize ───────────────────────────────────────────────────────────

/**
 * Steps 7–10: cross-turn dedupe → variant-B audio strip → set
 * `lastOutboundContentHash` → clamp retries.
 */
function finalize(
  input: EngineInput,
  currentStep: BotFlowStep,
  partial: {
    outbound: OutboundMessage[];
    stateUpdate: Partial<CustomerSnapshot>;
    logs: StructuredLog[];
    deferred?: EngineOutput["deferred"];
  },
): EngineOutput {
  let outbound = partial.outbound;
  const logs = partial.logs.slice();

  // Step 7a: cross-turn dedupe
  const drop = dropDuplicateLeader(outbound, input.state, input.config.now);
  if (drop.dropped) {
    outbound = drop.outbound;
    logs.push(makeLog("engine_dedupe_blocked", input, currentStep.id, {}));
  } else {
    outbound = drop.outbound;
  }

  // Step 7b: dedupeAdjacent + capLimits (after possible drop)
  outbound = dedupeAdjacent(outbound);
  const cap = capLimits(
    outbound,
    input.config.limits.maxOutboundsPerTurn,
    input.state.customerId,
    input.flow.id,
    currentStep.id,
    input.config.now,
  );
  outbound = cap.outbound;
  if (cap.log) logs.push(cap.log);

  // Step 8: variant B removido — Fluxo B agora é Vendedora V2 e nunca
  // chega no runner V3. Se chegar, deixamos quebrar mais cedo no loader.

  // Step 9: lastOutboundContentHash for next turn
  let stateUpdate: Partial<CustomerSnapshot> = { ...partial.stateUpdate };
  if (outbound.length > 0) {
    const last = outbound[outbound.length - 1];
    stateUpdate.lastOutboundContentHash = hash(last.idempotencyContent);
    if (stateUpdate.lastOutboundAt === undefined) {
      stateUpdate.lastOutboundAt = input.config.now;
    }
  }

  // Step 10: clamp retries + aiQuestionsThisStep
  if (stateUpdate.retries !== undefined) {
    stateUpdate.retries = clampRetries(input.state.retries, stateUpdate.retries);
  }
  if (stateUpdate.aiQuestionsThisStep !== undefined) {
    stateUpdate.aiQuestionsThisStep = clampAiQuestions(
      input.state.aiQuestionsThisStep,
      stateUpdate.aiQuestionsThisStep,
    );
  }
  // Auto-reset aiQuestionsThisStep quando o passo muda (mesma política do retries=0).
  if (stateUpdate.currentStepId !== undefined && stateUpdate.aiQuestionsThisStep === undefined) {
    stateUpdate.aiQuestionsThisStep = 0;
  }

  const out: EngineOutput = {
    outbound,
    stateUpdate,
    logs,
  };
  if (partial.deferred !== undefined) out.deferred = partial.deferred;
  return out;
}

// ─── makeFallbackContext ────────────────────────────────────────────────

function makeFallbackContext(input: EngineInput, step: BotFlowStep): FallbackContext {
  return {
    state: input.state,
    inbound: input.inbound,
    step,
    flow: input.flow,
    capabilities: input.capabilities,
    config: input.config,
    hooks: input.hooks,
  };
}
