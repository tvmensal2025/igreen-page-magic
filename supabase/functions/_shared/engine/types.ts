/**
 * Public type surface of the Engine v3 pure runner.
 *
 * Spec: `.kiro/specs/flow-engine-v3-rewrite/design.md` (§2.1 — §2.6).
 *
 * Consumed by `v3-runner.ts` (pure), `v3-dispatcher.ts` / `v3-loader.ts`
 * (impure I/O), `variants/{a,b,c,d}.ts`, `fallbacks.ts`, and
 * `__tests__/*` (PBT + unit).
 *
 * Purity contract: types and interfaces only — no functions, constants,
 * or value `enum`s. The runner MUST consume this file via `import type`
 * only; value-level imports between the runner and this file are
 * forbidden by the purity lint (`__tests__/purity_lint_test.ts`, Task 4).
 *
 * Time/randomness/I/O: time-like values come from {@link EngineConfig.now}
 * and {@link EngineConfig.minuteBucket}; random/hash-derived values come
 * from {@link EngineConfig.idempotencyKeyFn}; async work is **declared**
 * as a {@link DeferredAction} for the dispatcher to perform. The engine
 * awaits nothing and returns synchronously.
 *
 * Validates: Requirements 1.3, 2.4, 12.1, 12.5.
 */

import type {
  ChannelCapabilities,
  MediaPayload,
  OutboundChoice,
} from "../channels/types.ts";

// Re-export so downstream modules consume the engine's public surface
// without reaching into `../channels/types.ts` directly.
export type { ChannelCapabilities, MediaPayload, OutboundChoice };
// `ChannelAdapter` is re-exported here so the v3-dispatcher (and webhook
// entry helpers) can import it from the engine's public surface without
// reaching into `../channels/types.ts` directly. Type-only — no runtime
// import.
import type { ChannelAdapter } from "../channels/types.ts";
export type { ChannelAdapter };

// ─── Engine I/O ──────────────────────────────────────────────────────────────

/**
 * Per design §2.1. Full input to one tick of `runEngine`. Two `EngineInput`
 * values comparing deeply equal MUST produce two `EngineOutput` values
 * comparing deeply equal — the referential transparency invariant
 * (Requirement 1.3, validated by the round-trip property test, Task 24).
 */
export interface EngineInput {
  state: CustomerSnapshot;
  inbound: InboundEvent;
  flow: BotFlow;
  capabilities: ChannelCapabilities;
  hooks: EngineHooks;
  config: EngineConfig;
}

/**
 * Per design §2.1. Full output of one tick. The dispatcher applies
 * `outbound` in order, merges `stateUpdate` into `customer_flow_state`
 * via a single UPDATE, and inserts every {@link StructuredLog} into
 * `engine_logs` (with `sideEffect` sentinels fired before the log row,
 * see §2.6).
 */
export interface EngineOutput {
  outbound: OutboundMessage[];
  stateUpdate: Partial<CustomerSnapshot>;
  logs: StructuredLog[];
  /** Optional declarative async action — engine never awaits. */
  deferred?: DeferredAction;
}

// ─── State (CustomerSnapshot) ────────────────────────────────────────────────

/**
 * Per design §2.1.1. Minimal slice of `customer_flow_state` + `customers`
 * the engine reads. Engine never mutates this value; it returns a
 * {@link Partial} the dispatcher applies in one UPDATE.
 *
 * `currentStepId` is **always a UUID** in v3 (post-migration invariant —
 * see migration script §2.8 and Requirement 11.5). Legacy literal-string
 * states are paused before v3 ever sees them. The `status` enum mirrors
 * `CustomerFlowStatus` in `_shared/customer-flow-state.ts` minus
 * `delegated_legacy`, which v3 does not produce.
 */
export interface CustomerSnapshot {
  customerId: string;
  consultantId: string;
  flowId: string;
  /** UUID of `bot_flow_steps.id`, or `null` for a brand-new lead. */
  currentStepId: string | null;
  status:
    | "new" | "running" | "waiting_reply" | "waiting_media" | "waiting_timer"
    | "paused_manual" | "paused_system" | "converted" | "lost";
  pauseReason: string | null;
  retries: number;
  /**
   * Contador independente do `retries`: conta apenas as perguntas livres
   * que o usuário fez à IA dentro do passo atual (`fallback.mode = "ai_answer"`).
   * Persistido em `customer_flow_state.ai_questions_this_step`. Resetado
   * automaticamente quando `currentStepId` muda. Permite distinguir
   * "errou OCR 3x" (consome `retries`) de "fez 3 perguntas livres"
   * (consome `aiQuestionsThisStep`).
   */
  aiQuestionsThisStep: number;
  /** ISO-8601 from DB; engine treats as opaque. */
  enteredStepAt: string;
  expiresAt: string | null;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  /**
   * Hash of the last outbound's `idempotencyContent`. Powers cross-turn
   * dedupe (G1) — see {@link OutboundMessage.idempotencyContent}.
   */
  lastOutboundContentHash: string | null;
  /** Subset of `customers.*` fields used for guards inside steps. */
  customer: {
    name: string | null;
    electricityBillValue: number | null;
    documentUploaded: boolean;
    otpValidatedAt: string | null;
    phoneWhatsapp: string | null;
  };
}

// ─── Flow + Step + supporting specs ──────────────────────────────────────────

/** Per design §2.1.2. Choice option — used by `ask_choice` steps. */
export interface ChoiceOptionSpec {
  id: string;
  title: string;
  description?: string;
}

/** Per design §2.1.2. Capture specification — extracts a field from inbound. */
export interface CaptureSpec {
  field: string;
  enabled: boolean;
  /** Optional declarative validator name; runtime impl lives in `_shared/validators.ts`. */
  validator?: "email" | "phone" | "cpf" | "cep" | "currency" | "date" | "free";
  required?: boolean;
}

/** Per design §2.1.2. Transition rule — moves from one step to another. */
export interface TransitionSpec {
  trigger_intent?: string | null;
  trigger_phrases?: string[] | null;
  goto_step_id?: string | null;
  goto_special?: "cadastro" | "humano" | "menu" | "repeat" | null;
}

/**
 * Per design §2.1.2 + §2.3. Per-step fallback. `mode` selects the
 * {@link FallbackHandler} that runs when no {@link TransitionSpec}
 * matches the inbound. Modes `ai` and `ai_answer` are blocked in strict
 * mode (Requirement 7.1) regardless of step config.
 */
export interface FallbackSpec {
  mode:
    | "repeat" | "retry" | "goto" | "ai" | "ai_answer" | "humano" | "advance";
  goto_step_id?: string | null;
  ai_prompt?: string;
  max_questions?: number;
  max_retries?: number;
  on_fail?: "advance" | "handoff" | "repeat" | "next";
  handoff_reason?: string;
  then?: "humano" | "next" | "repeat";
}

/**
 * Per design §2.1.2. One ordered media slot. Materialized from
 * `consultants.flow_step_media_order[stepKey]` JSONB by `v3-loader.ts`.
 */
export type MediaOrderEntry =
  | { kind: "text"; text: string; delayMs?: number }
  | { kind: "image"; url: string; caption?: string; delayMs?: number }
  | { kind: "audio"; url: string; durationSec: number; delayMs?: number }
  | { kind: "video"; url: string; caption?: string; durationSec: number; delayMs?: number }
  | { kind: "document"; url: string; filename: string; delayMs?: number };

/** Per design §2.1.2. One row of `bot_flow_steps`, fully materialized. */
export interface BotFlowStep {
  id: string;
  flowId: string;
  stepKey: string | null;
  stepType:
    | "text_message" | "media_message" | "audio_slot"
    | "ask_text" | "ask_choice" | "ask_media"
    | "branch" | "system_capture";
  position: number;
  messageText: string | null;
  /**
   * Variant B persuasive text. Optional. Falls back to `messageText`
   * (Requirement 5.4, Requirement 16.3). Both empty → engine raises
   * via the dispatcher (Requirement 16.6).
   */
  persuasiveText: string | null;
  choiceOptions: ChoiceOptionSpec[] | null;
  preferredChoiceKind: "button" | "list" | "number" | null;
  captures: CaptureSpec[];
  transitions: TransitionSpec[];
  fallback: FallbackSpec;
  waitFor: "none" | "reply" | "media" | "timer";
  waitSeconds: number;
  pipelineKind:
    | "cadastro_portal" | "ocr_conta" | "ocr_documento"
    | "finalizar_cadastro" | null;
  slotKey: string | null;
  conditionExpr: Record<string, unknown> | null;
  /**
   * Pre-computed list of step ids reachable from this step. The engine
   * validates `transitions[].goto_step_id` and `fallback.goto_step_id`
   * against this set; out-of-list ids fall through to safe-text.
   */
  reachableStepIds: string[];
}

/** Per design §2.1.2. One row of `bot_flows`, plus all its steps. */
export interface BotFlow {
  id: string;
  consultantId: string;
  variant: "A" | "B" | "C" | "D" | "M";
  /**
   * `bot_flows.strict_mode`. When true, the engine blocks any AI fallback
   * (`ai`, `ai_answer`) regardless of per-step config (Requirement 7.1).
   */
  strictMode: boolean;
  steps: BotFlowStep[];
  /**
   * `stepKey` → ordered media list. Resolved at load time from
   * `consultants.flow_step_media_order` JSONB. Variant A renders strictly
   * in this order (Requirement 8.1); variant B suppresses audio entries
   * (Requirement 5.3); variant D delegates to A and overlays buttons.
   */
  mediaOrderByStepKey: Record<string, MediaOrderEntry[]>;
}

// ─── Inbound events ──────────────────────────────────────────────────────────

/**
 * Per design §2.1.3. Discriminated union of every inbound the engine
 * understands. `mediaRef` is opaque — the dispatcher resolves it via
 * `ChannelAdapter.downloadMedia`. `no_input` is the cron-driven re-entry
 * case (timer fired or AI deferred call resolved); it is the only kind
 * exempt from the G2 "no silent turn" guarantee.
 */
export type InboundEvent =
  | { kind: "text"; text: string }
  | { kind: "button_click"; buttonId: string; rawText?: string }
  | { kind: "number_reply"; raw: string }
  | { kind: "media"; mediaKind: "image" | "audio" | "video" | "document"; mediaRef: string }
  | { kind: "timer_expired" }
  | { kind: "no_input" };

// ─── Engine config (per-turn knobs) ──────────────────────────────────────────

/**
 * Per design §2.1.4. Per-turn configuration synthesized by the webhook
 * entry / router. Never persisted. Time, randomness, and limits are
 * passed in as data so the runner stays deterministic.
 */
export interface EngineConfig {
  /** ISO-8601 timestamp injected by the caller. Engine never reads system clock. */
  now: string;
  /** `floor(epoch_ms / 60000)` — used in idempotency-key derivation. */
  minuteBucket: number;
  /**
   * When true, engine computes the {@link EngineOutput} but the
   * dispatcher MUST NOT execute side effects. Used by `bot-e2e-runner`
   * dry-run mode and by `flow-engine-rollout-cron` shadow comparison.
   */
  isDarkMode: boolean;
  /** Allowed domains for any URL the engine emits in outbound text. */
  allowedDomains: string[];
  /** Pure idempotency-key derivation. Same args → same key. */
  idempotencyKeyFn: (parts: { stepId: string; content: string; minuteBucket: number }) => string;
  /** Pure human-pace delay computation. Same charLen → same delay. */
  humanDelayFn: (charLen: number) => number;
  /** Hard ceilings — engine bails to safe-text or handoff if exceeded. */
  limits: {
    /** Default 6. Truncation logged as `engine_outbound_limit_exceeded`. */
    maxOutboundsPerTurn: number;
    /** Default 3. `repeat`/`retry` escalate to handoff at this threshold. */
    maxRetriesBeforeHandoff: number;
    /** Default 3. `ai_answer` escalates to handoff at this threshold. */
    maxAiQuestionsPerStep: number;
  };
}

// ─── Hooks (declarative bindings to side-effecting modules) ──────────────────

/**
 * Per design §2.4. Hooks the engine consumes declaratively: every async
 * hook exposes {@link describe} returning a value tag, never an
 * executable async function. Only `captures.extract` is executable, and
 * it is itself pure (regex + string parsing). The dispatcher reads the
 * same shape and binds each `describe()` tag to a real impl.
 */
export interface EngineHooks {
  ocr: OcrHook;
  otp: OtpHook;
  portal: PortalHook;
  captures: CapturesHook;
  aiAnswer: AiAnswerHook;
  aiDecide: AiDecideHook;
}

/** Per design §2.4. OCR hook contract. */
export interface OcrHook {
  describe(): { kind: "ocr"; pipelines: ("ocr_conta" | "ocr_documento")[] };
}

/** Per design §2.4. OTP intercept contract — runs *before* engine. */
export interface OtpHook {
  describe(): { kind: "otp"; intercepts: "before_engine" };
}

/** Per design §2.4. Portal worker contract. */
export interface PortalHook {
  describe(): { kind: "portal"; pipelines: ("cadastro_portal" | "finalizar_cadastro")[] };
}

/**
 * Per design §2.4. Synchronous, pure capture extractor. The only
 * executable hook the engine calls during a tick. Implementation lives in
 * `_shared/captureExtractors.ts` (regex + string parsing only — no I/O).
 */
export interface CapturesHook {
  extract(args: { inbound: InboundEvent; specs: CaptureSpec[] }): Record<string, unknown>;
}

/** Per design §2.4. AI free-form answerer. Engine emits as deferred only. */
export interface AiAnswerHook {
  describe(): { kind: "ai_answer"; module: string };
}

/** Per design §2.4. AI step-id decider. Engine emits as deferred only. */
export interface AiDecideHook {
  describe(): { kind: "ai_decide"; module: string };
}

// ─── Outbound + Deferred ─────────────────────────────────────────────────────

/**
 * Per design §2.5. One send command emitted by the engine. The dispatcher
 * iterates `EngineOutput.outbound` in order, mapping each variant 1:1 to
 * a `ChannelAdapter` method without conditional business logic.
 *
 * ## `idempotencyContent` requirement
 *
 * Every {@link OutboundMessage} carries a non-empty string
 * `idempotencyContent` (Requirement 2.4). The engine guarantees:
 *
 *  - **Within-turn (G1):** no two adjacent outbounds share the same
 *    `idempotencyContent` (Requirement 2.1).
 *  - **Cross-turn (G1):** when `outbound[0].idempotencyContent` hashes to
 *    `state.lastOutboundContentHash` and < 2 seconds have elapsed since
 *    `state.lastOutboundAt`, the engine drops that leading outbound and
 *    emits log `engine_dedupe_blocked` (Requirement 2.2).
 *  - **Next-turn seed:** when `outbound.length > 0`, the engine writes
 *    `stateUpdate.lastOutboundContentHash =
 *     hash(outbound.at(-1).idempotencyContent)` (Requirement 2.3).
 *
 * Empty strings are a violation and trip the engine's defensive
 * outbound-shape assertions.
 */
export type OutboundMessage =
  | { kind: "text"; text: string; idempotencyContent: string; humanDelayMs?: number }
  | { kind: "choice"; prompt: string; choice: OutboundChoice; idempotencyContent: string }
  | { kind: "media"; media: MediaPayload; idempotencyContent: string }
  | { kind: "audio_slot"; slotKey: string; idempotencyContent: string }
  | { kind: "presence"; presenceKind: "composing" | "recording"; durationMs: number; idempotencyContent: string };

/**
 * Per design §2.5. Async side effect declared by the engine for the
 * dispatcher to perform. The engine returns immediately with empty
 * `outbound`; the dispatcher binds the matching {@link EngineHooks}
 * entry, awaits the result, and re-enters `runEngine` with
 * `inbound = { kind: "no_input" }` (or a synthesized event).
 * `thenRepeatStep` (set by `ai_answer`) tells the dispatcher to re-emit
 * the current step's outbound after the AI reply (design §2.3.3).
 */
export type DeferredAction =
  | { kind: "ai_answer"; question: string; stepId: string; flowId: string; thenRepeatStep?: boolean }
  | { kind: "ai_decide"; stepId: string; flowId: string; candidates: string[]; inboundText: string }
  | { kind: "ocr"; stepId: string; flowId: string; pipeline: "ocr_conta" | "ocr_documento"; mediaRef: string }
  | { kind: "portal_submit"; stepId: string; flowId: string; pipeline: "cadastro_portal" | "finalizar_cadastro" }
  | { kind: "otp_submit"; stepId: string; flowId: string; otpCode: string };

// ─── Logs ────────────────────────────────────────────────────────────────────

/**
 * Per design §2.6. Closed enumeration of every log kind the engine may
 * emit. The "decision" subset (`engine_transition_match`, `engine_repeat`,
 * `engine_goto`, `engine_safe_text`, `engine_handoff`,
 * `engine_ai_answer_deferred`, `engine_ai_decide_deferred`,
 * `engine_no_match`) is constrained by G3 to exactly one occurrence per
 * turn (Requirement 4.1).
 */
export type LogKind =
  | "engine_step_enter"
  | "engine_transition_match"
  | "engine_no_match"
  | "engine_safe_text"
  | "engine_repeat"
  | "engine_goto"
  | "engine_ai_answer_deferred"
  | "engine_ai_decide_deferred"
  | "engine_ai_decide_invalid"
  | "engine_handoff"
  | "engine_variant_unsupported"
  | "engine_capture_extracted"
  | "engine_capture_validation_failed"
  | "engine_strict_mode_blocked_ai"
  | "engine_dedupe_blocked"
  | "engine_outbound_limit_exceeded"
  | "engine_invalid_step"
  | "engine_audio_slot_missing"
  | "engine_audio_slot_unhandled"
  | "engine_crm_sync_failed";

/**
 * Per design §2.6. Structured log row. Persisted by the dispatcher into
 * `engine_logs` (Requirement 14.1). A log carrying `sideEffect` instructs
 * the dispatcher to perform a guaranteed side effect — e.g.
 * `insert_handoff_alert` is the only way the engine can request a
 * `bot_handoff_alerts` insertion (Requirement 6.1).
 */
export interface StructuredLog {
  kind: LogKind;
  /** ISO-8601 from {@link EngineConfig.now}. Engine never reads the system clock. */
  at: string;
  customerId: string;
  flowId: string;
  stepId: string | null;
  payload: Record<string, unknown>;
  sideEffect?:
    | { kind: "insert_handoff_alert"; reason: string }
    | { kind: "increment_metric"; metric: string };
}

// ─── Fallback handlers ───────────────────────────────────────────────────────

/** Per design §2.3. Inputs every fallback handler receives. */
export interface FallbackContext {
  state: CustomerSnapshot;
  inbound: InboundEvent;
  step: BotFlowStep;
  flow: BotFlow;
  capabilities: ChannelCapabilities;
  config: EngineConfig;
  hooks: EngineHooks;
}

/**
 * Per design §2.3. Pure fallback handler contract. Returns a partial
 * {@link EngineOutput} that the runner merges into the final result.
 * Setting `deferred` is the sole mechanism by which a handler can yield
 * to an async side effect (AI / OCR / portal) without violating G2
 * ("no silent turn") — see Requirement 3.1 carve-out.
 */
export interface FallbackHandler {
  handle(ctx: FallbackContext): {
    outbound: OutboundMessage[];
    stateUpdate: Partial<CustomerSnapshot>;
    logs: StructuredLog[];
    deferred?: DeferredAction;
  };
}

// ─── Variant strategies ──────────────────────────────────────────────────────

/**
 * Per design §2.2. Per-variant outbound builder. Pure — the runner picks
 * one based on `flow.variant` and calls `buildStepOutbound` whenever it
 * needs to render a step (initial entry, `repeat`, `goto`). Variant B's
 * implementation must NEVER return an `OutboundMessage` of `kind:
 * "audio_slot"` nor a `media` outbound with `media.kind: "audio"`
 * (Requirement 5.3, validated by Property 4b).
 */
export interface VariantStrategy {
  buildStepOutbound(args: {
    step: BotFlowStep;
    flow: BotFlow;
    capabilities: ChannelCapabilities;
    config: EngineConfig;
  }): OutboundMessage[];
}