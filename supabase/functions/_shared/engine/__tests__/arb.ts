// Test arbitraries for the v3 engine — shared by every PBT module
// (`pbt_g1_test.ts` … `pbt_termination_test.ts`, Tasks 18–24) plus
// targeted unit tests that want randomized inputs.
//
// Spec: `.kiro/specs/flow-engine-v3-rewrite/design.md` §"Sample
// fast-check generators". Layered design: pre-generate the step-id set
// once, then build every transition / fallback / state / snapshot so
// every `goto_step_id` (and `reachableStepIds`) references a valid id —
// matching the engine invariant in §2.1.2.
//
// All generators are pure (fast-check Arbitrary values). The only
// non-determinism is the seed fast-check itself uses for shrinking;
// that is a property-test concern, not an engine purity concern.
//
// Validates: Requirements 1.3 (precondition for property tests).

import fc from "https://esm.sh/fast-check@3.23.2";
import type {
  BotFlow,
  BotFlowStep,
  CaptureSpec,
  ChannelCapabilities,
  ChoiceOptionSpec,
  CustomerSnapshot,
  EngineConfig,
  EngineHooks,
  EngineInput,
  FallbackSpec,
  InboundEvent,
  MediaOrderEntry,
  TransitionSpec,
} from "../types.ts";

// ─── Primitive enum arbitraries ─────────────────────────────────────────

export const arbStepType = fc.constantFrom<BotFlowStep["stepType"]>(
  "text_message",
  "media_message",
  "audio_slot",
  "ask_text",
  "ask_choice",
  "ask_media",
  "branch",
  "system_capture",
);

/** Pool de variantes suportadas pelo motor V3. A e C têm paridade total. */
export const arbVariant = fc.constantFrom<"A" | "B" | "C" | "D">(
  "A",
  "B",
  "C",
  "D",
);

// Mantido como alias para os testes que explicitam todas as variantes.
export const arbVariantWithC = arbVariant;

export const arbFallbackMode = fc.constantFrom<FallbackSpec["mode"]>(
  "repeat",
  "retry",
  "goto",
  "ai",
  "ai_answer",
  "humano",
  "advance",
);

export const arbWaitFor = fc.constantFrom<BotFlowStep["waitFor"]>(
  "none",
  "reply",
  "media",
  "timer",
);

export const arbPreferredChoiceKind = fc.constantFrom<
  BotFlowStep["preferredChoiceKind"]
>("button", "list", "number", null);

export const arbStatus = fc.constantFrom<CustomerSnapshot["status"]>(
  "new",
  "running",
  "waiting_reply",
  "waiting_media",
  "waiting_timer",
  "paused_manual",
  "paused_system",
  "converted",
  "lost",
);

// ─── InboundEvent ───────────────────────────────────────────────────────

export const arbInboundEvent: fc.Arbitrary<InboundEvent> = fc.oneof(
  fc.record({
    kind: fc.constant("text" as const),
    text: fc.string({ minLength: 1, maxLength: 200 }),
  }),
  fc.record({
    kind: fc.constant("button_click" as const),
    buttonId: fc.uuid(),
    rawText: fc.option(fc.string({ maxLength: 32 }), { nil: undefined }),
  }),
  fc.record({
    kind: fc.constant("number_reply" as const),
    raw: fc.constantFrom("1", "2", "3"),
  }),
  fc.record({
    kind: fc.constant("media" as const),
    mediaKind: fc.constantFrom<"image" | "audio" | "video" | "document">(
      "image",
      "audio",
      "video",
      "document",
    ),
    mediaRef: fc.uuid(),
  }),
  fc.record({ kind: fc.constant("timer_expired" as const) }),
  fc.record({ kind: fc.constant("no_input" as const) }),
);

// ─── ChoiceOptionSpec / CaptureSpec / TransitionSpec / FallbackSpec ─────

const arbChoiceOption: fc.Arbitrary<ChoiceOptionSpec> = fc.record({
  id: fc.uuid(),
  title: fc.string({ minLength: 1, maxLength: 24 }),
  description: fc.option(fc.string({ maxLength: 64 }), { nil: undefined }),
});

const arbCaptureSpec: fc.Arbitrary<CaptureSpec> = fc.record({
  field: fc.string({ minLength: 1, maxLength: 16 }),
  enabled: fc.boolean(),
  validator: fc.option(
    fc.constantFrom<NonNullable<CaptureSpec["validator"]>>(
      "email",
      "phone",
      "cpf",
      "cep",
      "currency",
      "date",
      "free",
    ),
    { nil: undefined },
  ),
  required: fc.option(fc.boolean(), { nil: undefined }),
});

function arbTransition(allStepIds: string[]): fc.Arbitrary<TransitionSpec> {
  const stepIdArb: fc.Arbitrary<string | null> = allStepIds.length > 0
    ? fc.option(fc.constantFrom(...allStepIds), { nil: null })
    : fc.constant(null);

  return fc.record({
    trigger_intent: fc.option(
      fc.string({ minLength: 1, maxLength: 16 }),
      { nil: null },
    ),
    trigger_phrases: fc.option(
      fc.array(fc.string({ minLength: 1, maxLength: 16 }), { maxLength: 4 }),
      { nil: null },
    ),
    goto_step_id: stepIdArb,
    goto_special: fc.option(
      fc.constantFrom<NonNullable<TransitionSpec["goto_special"]>>(
        "cadastro",
        "humano",
        "menu",
        "repeat",
      ),
      { nil: null },
    ),
  });
}

function arbFallback(allStepIds: string[]): fc.Arbitrary<FallbackSpec> {
  const stepIdArb: fc.Arbitrary<string | null> = allStepIds.length > 0
    ? fc.option(fc.constantFrom(...allStepIds), { nil: null })
    : fc.constant(null);

  return fc.record({
    mode: arbFallbackMode,
    goto_step_id: stepIdArb,
    ai_prompt: fc.option(fc.string({ maxLength: 64 }), { nil: undefined }),
    max_questions: fc.option(fc.integer({ min: 1, max: 5 }), { nil: undefined }),
    max_retries: fc.option(fc.integer({ min: 1, max: 5 }), { nil: undefined }),
    on_fail: fc.option(
      fc.constantFrom<NonNullable<FallbackSpec["on_fail"]>>(
        "advance",
        "handoff",
        "repeat",
        "next",
      ),
      { nil: undefined },
    ),
    handoff_reason: fc.option(
      fc.string({ minLength: 1, maxLength: 32 }),
      { nil: undefined },
    ),
    then: fc.option(
      fc.constantFrom<NonNullable<FallbackSpec["then"]>>(
        "humano",
        "next",
        "repeat",
      ),
      { nil: undefined },
    ),
  });
}

// ─── BotFlowStep ────────────────────────────────────────────────────────

/**
 * Builds a `BotFlowStep` arbitrary whose `transitions[].goto_step_id`
 * and `fallback.goto_step_id` only reference ids in `allStepIds`. The
 * generated step's `reachableStepIds` is set to exactly `allStepIds`,
 * matching the engine invariant in types §"BotFlowStep".
 *
 * `flowId` and the step's own `id` are passed in by the caller so a
 * full flow's steps share a `flowId` and the id set is closed.
 */
export function arbStep(
  allStepIds: string[],
  flowId: string,
  ownId: string,
  position: number,
): fc.Arbitrary<BotFlowStep> {
  return fc.record({
    id: fc.constant(ownId),
    flowId: fc.constant(flowId),
    stepKey: fc.option(
      fc.string({ minLength: 1, maxLength: 16 }),
      { nil: null },
    ),
    stepType: arbStepType,
    position: fc.constant(position),
    messageText: fc.option(
      fc.string({ minLength: 1, maxLength: 500 }),
      { nil: null },
    ),
    persuasiveText: fc.option(
      fc.string({ minLength: 1, maxLength: 500 }),
      { nil: null },
    ),
    choiceOptions: fc.option(
      fc.array(arbChoiceOption, { minLength: 1, maxLength: 5 }),
      { nil: null },
    ),
    preferredChoiceKind: arbPreferredChoiceKind,
    captures: fc.array(arbCaptureSpec, { maxLength: 3 }),
    transitions: fc.array(arbTransition(allStepIds), { maxLength: 4 }),
    fallback: arbFallback(allStepIds),
    waitFor: arbWaitFor,
    waitSeconds: fc.integer({ min: 0, max: 600 }),
    pipelineKind: fc.option(
      fc.constantFrom<NonNullable<BotFlowStep["pipelineKind"]>>(
        "cadastro_portal",
        "ocr_conta",
        "ocr_documento",
        "finalizar_cadastro",
      ),
      { nil: null },
    ),
    slotKey: fc.option(
      fc.string({ minLength: 1, maxLength: 16 }),
      { nil: null },
    ),
    conditionExpr: fc.option(
      fc.dictionary(fc.string({ maxLength: 8 }), fc.anything(), {
        maxKeys: 3,
      }) as fc.Arbitrary<Record<string, unknown>>,
      { nil: null },
    ),
    reachableStepIds: fc.constant([...allStepIds]),
  });
}

// ─── CustomerSnapshot ───────────────────────────────────────────────────

/**
 * Generates a snapshot whose `currentStepId` is either `null` (new
 * lead) or a member of `allStepIds`. ISO timestamps are constructed
 * from epoch integers so they round-trip cleanly through `Date.parse`
 * (used by `dropDuplicateLeader` in `helpers.ts`).
 */
export function arbCustomerSnapshot(
  allStepIds: string[],
  flowId: string,
): fc.Arbitrary<CustomerSnapshot> {
  const stepIdArb: fc.Arbitrary<string | null> = allStepIds.length > 0
    ? fc.option(fc.constantFrom(...allStepIds), { nil: null })
    : fc.constant(null);

  // Anchor timestamps near 2025-01-01 so all generated dates are
  // realistic and `Date.parse` produces valid epoch ms.
  const ANCHOR_MS = Date.UTC(2025, 0, 1);
  const arbIso = fc.integer({ min: 0, max: 60 * 60 * 24 * 365 }).map((sec) =>
    new Date(ANCHOR_MS + sec * 1000).toISOString()
  );
  const arbIsoNullable: fc.Arbitrary<string | null> = fc.option(arbIso, {
    nil: null,
  });

  return fc.record({
    customerId: fc.uuid(),
    consultantId: fc.uuid(),
    flowId: fc.constant(flowId),
    currentStepId: stepIdArb,
    status: arbStatus,
    pauseReason: fc.option(
      fc.string({ minLength: 1, maxLength: 32 }),
      { nil: null },
    ),
    retries: fc.integer({ min: 0, max: 5 }),
    aiQuestionsThisStep: fc.integer({ min: 0, max: 5 }),
    enteredStepAt: arbIso,
    expiresAt: arbIsoNullable,
    lastInboundAt: arbIsoNullable,
    lastOutboundAt: arbIsoNullable,
    lastOutboundContentHash: fc.option(
      fc.string({ minLength: 4, maxLength: 16 }),
      { nil: null },
    ),
    customer: fc.record({
      name: fc.option(fc.string({ minLength: 1, maxLength: 32 }), { nil: null }),
      electricityBillValue: fc.option(
        fc.integer({ min: 0, max: 10000 }),
        { nil: null },
      ),
      documentUploaded: fc.boolean(),
      otpValidatedAt: arbIsoNullable,
      phoneWhatsapp: fc.option(
        fc.string({ minLength: 8, maxLength: 16 }),
        { nil: null },
      ),
    }),
  });
}

// ─── ChannelCapabilities ────────────────────────────────────────────────

/**
 * Generates capability declarations matching real Whapi / Evolution
 * shapes: `maxButtons` is constrained to 0 or 3 (the only values that
 * appear in production today; 0 forces list/text, 3 is Whapi's hard
 * cap), and `supportsAudio` is locked to `true` since both providers
 * support audio in current spec.
 */
export const arbCapabilities: fc.Arbitrary<ChannelCapabilities> = fc.record({
  channel: fc.constantFrom<"whapi" | "evolution">("whapi", "evolution"),
  supportsButtons: fc.boolean(),
  maxButtons: fc.constantFrom(0, 3),
  supportsList: fc.boolean(),
  supportsAudio: fc.constant(true),
  supportsVideo: fc.boolean(),
  supportsTypingPresence: fc.boolean(),
  supportsReactions: fc.boolean(),
  inboundIdField: fc.constantFrom<"messageId" | "wa_id">("messageId", "wa_id"),
});

// ─── EngineConfig ───────────────────────────────────────────────────────

/**
 * Generates an `EngineConfig` whose `idempotencyKeyFn` and
 * `humanDelayFn` are pure closures (no clock, no DB), matching the
 * design §2.1.4 contract.
 */
export const arbConfig: fc.Arbitrary<EngineConfig> = fc.record({
  now: fc.integer({ min: 0, max: 60 * 60 * 24 * 365 }).map((sec) =>
    new Date(Date.UTC(2025, 0, 1) + sec * 1000).toISOString()
  ),
  minuteBucket: fc.integer({ min: 0, max: 50_000_000 }),
  isDarkMode: fc.constant(false),
  allowedDomains: fc.constant([] as string[]),
  idempotencyKeyFn: fc.constant(
    (parts: { stepId: string; content: string; minuteBucket: number }) =>
      `${parts.stepId}:${parts.content}:${parts.minuteBucket}`,
  ),
  humanDelayFn: fc.constant((charLen: number) => Math.min(charLen * 50, 5000)),
  limits: fc.constant({
    maxOutboundsPerTurn: 6,
    maxRetriesBeforeHandoff: 3,
    maxAiQuestionsPerStep: 3,
  }),
});

// ─── EngineHooks (stub) ─────────────────────────────────────────────────

/**
 * Stubbed hooks used by every PBT. Only `captures.extract` is
 * executable, and it returns `{}` (no extraction). All other hooks
 * expose `describe()` per the design §2.4 declarative pattern — the
 * engine never invokes their async side-effecting impls.
 */
export const STUB_HOOKS: EngineHooks = {
  ocr: {
    describe: () => ({
      kind: "ocr",
      pipelines: ["ocr_conta", "ocr_documento"],
    }),
  },
  otp: {
    describe: () => ({ kind: "otp", intercepts: "before_engine" }),
  },
  portal: {
    describe: () => ({
      kind: "portal",
      pipelines: ["cadastro_portal", "finalizar_cadastro"],
    }),
  },
  captures: {
    extract: (_args: { inbound: InboundEvent; specs: CaptureSpec[] }) => ({}),
  },
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

// ─── EngineInput (top-level) ────────────────────────────────────────────

/**
 * Builds a complete, valid `EngineInput`. Pre-generates the step-id
 * set so the resulting `BotFlow.steps[].transitions[].goto_step_id` and
 * `fallback.goto_step_id` always reference ids that exist in
 * `flow.steps` — the runner invariant from design §2.1.2.
 *
 * `mediaOrderByStepKey` defaults to `{}` so variant A's
 * `synthesizeFromStep` path is exercised. Tests targeting
 * `media_order` rendering should override this map after generation.
 */
export function arbEngineInput(): fc.Arbitrary<EngineInput> {
  // Pre-generate the id set OUTSIDE fast-check's chain so every step
  // sees the same closed set. Using `crypto.randomUUID` here is fine —
  // this is test-side scaffolding, not engine code.
  const ids = Array.from({ length: 5 }, () => crypto.randomUUID());
  const flowId = crypto.randomUUID();

  const stepArbs = ids.map((id, i) => arbStep(ids, flowId, id, i));
  const allStepsArb = fc.tuple(...stepArbs) as unknown as fc.Arbitrary<
    BotFlowStep[]
  >;

  const flowArb: fc.Arbitrary<BotFlow> = fc.record({
    id: fc.constant(flowId),
    consultantId: fc.uuid(),
    variant: arbVariant,
    strictMode: fc.boolean(),
    steps: allStepsArb,
    mediaOrderByStepKey: fc.constant(
      {} as Record<string, MediaOrderEntry[]>,
    ),
  });

  return fc.record({
    flow: flowArb,
    state: arbCustomerSnapshot(ids, flowId),
    inbound: arbInboundEvent,
    capabilities: arbCapabilities,
    hooks: fc.constant(STUB_HOOKS),
    config: arbConfig,
  });
}
