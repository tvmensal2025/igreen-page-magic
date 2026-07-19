/**
 * Engine v3 fallback handlers.
 *
 * Spec: `.kiro/specs/flow-engine-v3-rewrite/design.md` §2.3 (handler
 * contract + per-mode behaviour) and §2.7 (runner evaluation order).
 *
 * Tasks: 10 (sync handlers `repeat`/`retry`/`goto`/`advance`), 11
 * (`humanoHandler` + `SAFE_TEXT_FALLBACK`), 12 (deferred AI handlers
 * `ai_answer` / `ai`).
 *
 * Purity contract: every handler is a pure function of
 * {@link FallbackContext}; no `Date.now`, no `fetch`, no DB calls. AI/OCR
 * side effects are emitted as {@link DeferredAction} for the dispatcher
 * to perform out-of-band (G2 carve-out per design §2.3.3 / §2.3.4).
 *
 * Validates: Requirements 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 6.1, 6.2, 6.3,
 * 7.1, 7.2, 7.3, 9.1, 9.2, 9.3, 9.4, 9.5, 15.2, 15.3, 15.4.
 */

import type {
  BotFlowStep,
  CustomerSnapshot,
  DeferredAction,
  EngineConfig,
  FallbackContext,
  FallbackHandler,
  FallbackSpec,
  LogKind,
  OutboundMessage,
  StructuredLog,
} from "./types.ts";
import { pickVariant } from "./helpers.ts";

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build a {@link StructuredLog} with engine-mandated time/customer/flow
 * fields populated from {@link FallbackContext}. Keeps every handler's
 * log construction one-liner compact and consistent.
 */
function buildLog(
  kind: LogKind,
  ctx: FallbackContext,
  payload: Record<string, unknown> = {},
): StructuredLog {
  return {
    kind,
    at: ctx.config.now,
    customerId: ctx.state.customerId,
    flowId: ctx.flow.id,
    stepId: ctx.step.id,
    payload,
  };
}

/**
 * Maps a `handoff_reason` to the user-facing pt-BR string the bot sends
 * before pausing the conversation. Reasons not explicitly mapped fall
 * back to a generic message that includes the raw reason for debugging.
 */
function handoffMessageFor(reason: string | undefined): string {
  if (!reason) return "Vou chamar alguém pra te ajudar pessoalmente 🙌";
  if (reason === "ai_limit_atingido") {
    return "Vou chamar alguém pra te ajudar com sua dúvida 🙌";
  }
  if (reason === "engine_v3_migration") {
    return "Para te atender melhor, vou chamar uma pessoa do time 🙌";
  }
  if (reason === "lead_pediu_humano") {
    return "Vou chamar alguém pra te ajudar pessoalmente 🙌";
  }
  return `Vou chamar alguém pra te ajudar (${reason}) 🙌`;
}

/**
 * Re-derives a {@link FallbackContext} with `step.fallback.handoff_reason`
 * forced to `reason`. Used when one handler delegates to another (e.g.
 * `aiAnswer` → `humano` on retries-exhausted, `advance` → `humano` when
 * no next step). Keeps the rest of the context intact so the delegate
 * sees the same inbound, state, capabilities, and config.
 */
function withHandoffReason(
  ctx: FallbackContext,
  reason: string,
): FallbackContext {
  const nextFallback: FallbackSpec = { ...ctx.step.fallback, handoff_reason: reason };
  const nextStep: BotFlowStep = { ...ctx.step, fallback: nextFallback };
  return { ...ctx, step: nextStep };
}

// ─── Task 10 — synchronous handlers (repeat / retry / goto / advance) ───────

/**
 * `retry`/`repeat` handler — re-emits the current step's outbound and
 * increments {@link CustomerSnapshot.retries}. When retries cross the
 * configured ceiling (`step.fallback.max_retries` or
 * `config.limits.maxRetriesBeforeHandoff`), escalates per
 * `step.fallback.on_fail`:
 *
 *  - `"handoff"` (default): delegates to {@link humanoHandler} with
 *    `handoff_reason = "retry_exhausted"`.
 *  - `"advance"` / `"next"`: delegates to {@link advanceHandler}.
 *  - `"repeat"`: caps retries (no further increment) and re-emits step.
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 15.2, 15.4.
 */
export const retryHandler: FallbackHandler = {
  handle(ctx) {
    const max = Math.max(
      1,
      Number(ctx.step.fallback.max_retries ?? ctx.config.limits.maxRetriesBeforeHandoff),
    );
    const next = ctx.state.retries + 1;

    if (next > max) {
      const onFail = ctx.step.fallback.on_fail ?? "handoff";
      if (onFail === "handoff") {
        return humanoHandler.handle(
          withHandoffReason(
            ctx,
            ctx.step.fallback.handoff_reason ?? "retry_exhausted",
          ),
        );
      }
      if (onFail === "advance" || onFail === "next") {
        return advanceHandler.handle(ctx);
      }
      // onFail === "repeat" → keep retry without advancing; cap counter below.
    }

    const variant = pickVariant(ctx.flow.variant);
    const outbound = variant.buildStepOutbound({
      step: ctx.step,
      flow: ctx.flow,
      capabilities: ctx.capabilities,
      config: ctx.config,
    });

    const cappedNext = next > max ? max : next;
    const stateUpdate: Partial<CustomerSnapshot> = {
      retries: cappedNext,
      lastOutboundAt: ctx.config.now,
    };

    return {
      outbound,
      stateUpdate,
      logs: [buildLog("engine_repeat", ctx, { attempt: cappedNext, max })],
    };
  },
};

/**
 * Alias: `repeat` and `retry` share the exact same code path per design
 * §2.3.1 (the `flow-d-retry-rules-fix` semantics are absorbed here, no
 * separate `retry` module).
 */
export const repeatHandler: FallbackHandler = retryHandler;

/**
 * `goto` handler — jumps to `step.fallback.goto_step_id`. Validates the
 * target against `step.reachableStepIds`; on invalid config falls
 * through to {@link SAFE_TEXT_FALLBACK} (deterministic last resort —
 * never silently accepts an unconfigured path, Requirement 9.4).
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 15.2.
 */
export const gotoHandler: FallbackHandler = {
  handle(ctx) {
    const target = ctx.step.fallback.goto_step_id;
    if (!target || !ctx.step.reachableStepIds.includes(target)) {
      return SAFE_TEXT_FALLBACK.handle(ctx);
    }
    const targetStep = ctx.flow.steps.find((s) => s.id === target);
    if (!targetStep) return SAFE_TEXT_FALLBACK.handle(ctx);

    const variant = pickVariant(ctx.flow.variant);
    const outbound = variant.buildStepOutbound({
      step: targetStep,
      flow: ctx.flow,
      capabilities: ctx.capabilities,
      config: ctx.config,
    });

    return {
      outbound,
      stateUpdate: {
        currentStepId: target,
        retries: 0,
        enteredStepAt: ctx.config.now,
        lastOutboundAt: ctx.config.now,
      },
      logs: [buildLog("engine_goto", ctx, { from: ctx.step.id, to: target })],
    };
  },
};

/**
 * `advance` handler — jumps to the next step by `position`. When no next
 * step exists, escalates to {@link humanoHandler} with
 * `handoff_reason = "no_next_step"` (rather than silently looping or
 * returning empty, Requirement 3.1 G2).
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 15.2.
 */
export const advanceHandler: FallbackHandler = {
  handle(ctx) {
    const next = ctx.flow.steps
      .filter((s) => s.position > ctx.step.position)
      .sort((a, b) => a.position - b.position)[0];

    if (!next) {
      return humanoHandler.handle(withHandoffReason(ctx, "no_next_step"));
    }

    const variant = pickVariant(ctx.flow.variant);
    const outbound = variant.buildStepOutbound({
      step: next,
      flow: ctx.flow,
      capabilities: ctx.capabilities,
      config: ctx.config,
    });

    return {
      outbound,
      stateUpdate: {
        currentStepId: next.id,
        retries: 0,
        enteredStepAt: ctx.config.now,
        lastOutboundAt: ctx.config.now,
      },
      logs: [
        buildLog("engine_goto", ctx, {
          from: ctx.step.id,
          to: next.id,
          via: "advance",
        }),
      ],
    };
  },
};

// ─── Task 11 — humanoHandler + SAFE_TEXT_FALLBACK ───────────────────────────

/**
 * `humano` handler — pauses the flow for human takeover. Emits exactly
 * one text outbound and one `engine_handoff` log carrying the
 * `insert_handoff_alert` sentinel; the dispatcher treats that sentinel
 * as the *only* legal way to insert a row in `bot_handoff_alerts`,
 * which encodes guarantee G5 (single channel of escalation —
 * Requirement 6.1).
 *
 * `idempotencyContent` is keyed on `step.id + reason` so two consecutive
 * handoffs from the same step for the same reason dedupe within a turn
 * (G1) — but if the user is handed off, switches back, and is handed
 * off again later for the same reason, the cross-turn lastOutboundContentHash
 * comparison handles dedupe on the runner side.
 *
 * Validates: Requirements 3.2, 3.3, 6.1, 6.2, 6.3, 15.2.
 */
export const humanoHandler: FallbackHandler = {
  handle(ctx) {
    const reason = ctx.step.fallback.handoff_reason ?? "lead_pediu_humano";
    const text = handoffMessageFor(reason);
    const outbound: OutboundMessage[] = [{
      kind: "text",
      text,
      idempotencyContent: `handoff:${ctx.step.id}:${reason}`,
    }];
    const log: StructuredLog = {
      ...buildLog("engine_handoff", ctx, { reason }),
      sideEffect: { kind: "insert_handoff_alert", reason },
    };
    return {
      outbound,
      stateUpdate: {
        status: "paused_system",
        pauseReason: reason,
        lastOutboundAt: ctx.config.now,
      },
      logs: [log],
    };
  },
};

/**
 * Deterministic last-resort fallback. Re-emits the step's `messageText`
 * (or a generic Portuguese prompt if empty) and bumps `retries`. This is
 * the engine's escape valve for: invalid `goto` configs, AI blocked by
 * strict mode, AI returning out-of-list candidate, captures.extract
 * throwing, or any catch-all branch in the runner that needs to honour
 * G2 ("no silent turn").
 *
 * `idempotencyContent` includes `state.retries` so successive safe-text
 * emissions don't dedupe themselves out — the user sees one prompt per
 * unrecognized inbound until escalation kicks in.
 *
 * Validates: Requirements 3.2, 3.3, 3.4, 15.2.
 */
export const SAFE_TEXT_FALLBACK: FallbackHandler = {
  handle(ctx) {
    const text = (ctx.step.messageText ?? "").trim() ||
      "Sem pressa 🙂 Me conta com suas palavras que eu te oriento.";
    return {
      outbound: [{
        kind: "text",
        text,
        idempotencyContent: `safe:${ctx.step.id}:${ctx.state.retries}`,
      }],
      stateUpdate: {
        retries: ctx.state.retries + 1,
        lastOutboundAt: ctx.config.now,
      },
      logs: [buildLog("engine_safe_text", ctx, {})],
    };
  },
};

// ─── Task 12 — deferred AI handlers (ai_answer / ai) ────────────────────────

/**
 * `ai_answer` handler — deferred FAQ answerer. The engine itself never
 * calls the AI module; it emits a {@link DeferredAction} of kind
 * `"ai_answer"` and the dispatcher resolves it asynchronously, then
 * re-enters `runEngine` with `inbound = { kind: "no_input" }` and the
 * step's outbound is re-emitted via `thenRepeatStep: true` (design
 * §2.3.3).
 *
 * Guard rails — applied in this order (matches design §2.3.3):
 *
 *  1. `flow.strictMode === true` → route to {@link SAFE_TEXT_FALLBACK}
 *     and emit `engine_strict_mode_blocked_ai` (Requirement 7.1).
 *  2. `inbound.kind !== "text"` → route to safe-text (no AI for
 *     button/media/timer inbounds; AI cannot meaningfully answer them).
 *  3. `state.retries >= max_questions` → escalate to humano with
 *     `handoff_reason = "ai_limit_atingido"` (Requirement 9.5).
 *
 * Validates: Requirements 7.1, 7.2, 7.3, 9.1, 9.2, 9.3, 9.5, 15.3.
 */
export const aiAnswerHandler: FallbackHandler = {
  handle(ctx) {
    if (ctx.flow.strictMode) {
      const safe = SAFE_TEXT_FALLBACK.handle(ctx);
      return {
        ...safe,
        logs: [
          ...safe.logs,
          buildLog("engine_strict_mode_blocked_ai", ctx, { mode: "ai_answer" }),
        ],
      };
    }
    if (ctx.inbound.kind !== "text") {
      return SAFE_TEXT_FALLBACK.handle(ctx);
    }

    const max = Math.max(
      1,
      Number(ctx.step.fallback.max_questions ?? ctx.config.limits.maxAiQuestionsPerStep),
    );
    // M1: contador separado para perguntas livres à IA (não consome retries
    // de validação). Resetado quando o passo muda — ver v3-runner.finalize.
    if (ctx.state.aiQuestionsThisStep >= max) {
      return humanoHandler.handle(
        withHandoffReason(ctx, "ai_limit_atingido"),
      );
    }

    const deferred: DeferredAction = {
      kind: "ai_answer",
      question: ctx.inbound.text,
      stepId: ctx.step.id,
      flowId: ctx.flow.id,
      thenRepeatStep: true,
    };

    return {
      outbound: [],
      stateUpdate: { aiQuestionsThisStep: ctx.state.aiQuestionsThisStep + 1 },
      logs: [
        buildLog("engine_ai_answer_deferred", ctx, {
          question: ctx.inbound.text,
        }),
      ],
      deferred,
    };
  },
};

/**
 * `ai` handler — deferred step-id decider. Builds the `candidates` list
 * by intersecting `step.transitions[].goto_step_id` with
 * `step.reachableStepIds`, ensuring the AI can only choose a path the
 * consultor configured (Requirement 9.4). The dispatcher validates the
 * AI's response against this exact list before re-entering the engine —
 * out-of-list responses are logged as `engine_ai_decide_invalid` and
 * fall back to safe-text.
 *
 * Strict mode → safe-text + `engine_strict_mode_blocked_ai` log
 * (Requirement 7.1).
 *
 * Validates: Requirements 7.1, 7.2, 7.3, 9.1, 9.2, 9.3, 9.4, 15.3.
 */
export const aiDecideHandler: FallbackHandler = {
  handle(ctx) {
    if (ctx.flow.strictMode) {
      const safe = SAFE_TEXT_FALLBACK.handle(ctx);
      return {
        ...safe,
        logs: [
          ...safe.logs,
          buildLog("engine_strict_mode_blocked_ai", ctx, { mode: "ai" }),
        ],
      };
    }

    const candidates = ctx.step.transitions
      .map((t) => t.goto_step_id)
      .filter(
        (id): id is string =>
          typeof id === "string" &&
          id.length > 0 &&
          ctx.step.reachableStepIds.includes(id),
      );

    const inboundText = ctx.inbound.kind === "text" ? ctx.inbound.text : "";

    const deferred: DeferredAction = {
      kind: "ai_decide",
      stepId: ctx.step.id,
      flowId: ctx.flow.id,
      candidates,
      inboundText,
    };

    return {
      outbound: [],
      stateUpdate: {},
      logs: [
        buildLog("engine_ai_decide_deferred", ctx, {
          candidateCount: candidates.length,
        }),
      ],
      deferred,
    };
  },
};

// ─── Mode → handler map ─────────────────────────────────────────────────────

/**
 * Lookup keyed by {@link FallbackSpec.mode}. The runner consults this
 * map after `matchTransition` returns null. When `step.fallback.mode` is
 * outside this set (defensive — type system blocks it at compile time
 * but unsafe runtime payloads slip through), the runner falls through
 * to {@link SAFE_TEXT_FALLBACK} — see design §2.7 step 5.
 *
 * Note: `repeat` and `retry` resolve to the same handler instance per
 * design §2.3.1.
 */
export const FALLBACK_HANDLERS: Record<FallbackSpec["mode"], FallbackHandler> = {
  repeat: repeatHandler,
  retry: retryHandler,
  goto: gotoHandler,
  ai: aiDecideHandler,
  ai_answer: aiAnswerHandler,
  humano: humanoHandler,
  advance: advanceHandler,
};

// Silence unused-import warnings for symbols re-exported via the public
// type surface but only referenced inside JSDoc above. This keeps the
// `import type` block authoritative without TS6133.
type _UnusedSymbols = EngineConfig;
