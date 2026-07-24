# Requirements Document

> ⚠️ FONTE DE VERDADE WA = **Whapi** (não Evolution). Este spec pode estar defasado — siga `.kiro/steering/regras-duras.md` + `wa-webhook.md`. Ver `.kiro/specs/STATUS.md`.

## Introduction

The iGreen bot is the WhatsApp conversational front door of a multi-tenant SaaS platform that originates leads for an energy-co-op (iGreen Energy). Each consultor configures their own sales flow in `/admin/fluxos` (FluxoBuilder UI, table `bot_flow_steps`) and expects the bot to follow that flow to the letter on every inbound message.

Today, two parallel engines (`runBotFlow` hardcoded "sys" pipeline + `runConversationalFlow` data-driven flow) coexist and are duplicated across `evolution-webhook` and `whapi-webhook`. The result is path competition, duplicate sends, silent turns, AI firing where it was not configured, and divergent behavior between Whapi and Evolution leads.

This rewrite replaces the two competing engines with a single pure function `runEngine` (`_shared/flow-engine/v3-runner.ts`). Webhook entries become thin: parse inbound → load state → call engine → execute outbounds via channel adapter → persist update. All business logic lives in the runner; everything else is I/O.

The user-facing contract is one sentence: **what the consultor configured in `/admin/fluxos` is what the lead receives, in the configured order, with no hidden AI fallback and no duplicates**. Six correctness guarantees (G1–G6 in the design) encode this contract by construction. They are validated by property-based tests over `runEngine`, integration scenarios in `bot-e2e-runner`, and production smoke against the super-admin's Fluxo D.

Rollout is per-consultor via a `consultants.use_engine_v3` boolean flag, with a one-shot migration script pausing in-progress leads whose `customers.conversation_step` is not a UUID (legacy literal-string state) so that humans can pick up the conversation and v3 starts those leads fresh.

---

## Glossary

- **State (CustomerSnapshot)**: The minimum slice of `customer_flow_state` + `customers` that the engine reads. Mutated only by the dispatcher applying `stateUpdate`.
- **BotFlow**: One row of `bot_flows` (variant, strict mode) plus all rows of `bot_flow_steps` for that flow plus the consultor's resolved `flow_step_media_order` JSONB.
- **ChannelCapabilities**: Static declaration of what the channel can do (buttons, list, audio, video, max buttons), defined in `_shared/channels/types.ts`. Drives variant rendering decisions.
- **OutboundMessage**: A single send command emitted by the engine — kind ∈ {`text`, `choice`, `media`, `audio_slot`, `presence`}. Mapped 1:1 to a `ChannelAdapter` method by the dispatcher.
- **Variant**: The product configuration A/B/C/D set per flow. Determines the `VariantStrategy` used to render outbound. Not the same as a step type.
- **Flow**: One `bot_flows` row owned by a consultor. Contains many steps.
- **Step**: One `bot_flow_steps` row. Has a type, captures, transitions, fallback, optional `pipelineKind`.
- **Transition**: One declared rule moving from a step to another step (`trigger_phrases` / `trigger_intent` → `goto_step_id`).
- **Fallback**: What happens when no transition matches the inbound. `mode ∈ {repeat, retry, goto, ai, ai_answer, humano, advance}`. Not the same as a transition.
- **Cascade-eliminated (legacy term)**: The old "send text + media + button" sequence built ad-hoc inside `bot-flow.ts`. Engine v3 has no cascade — only an ordered `OutboundMessage[]`.
- **Hook**: A declarative binding the engine knows about (OCR, OTP, portal, captures, AI). The engine's `runEngine` only sees `EngineHooks`; the dispatcher binds them to real modules.
- **Deferred Action**: An async side effect (AI call, OCR call, portal submit, OTP submit) that the engine asks the dispatcher to perform. The engine returns immediately; the dispatcher re-enters the engine with the result.
- **Strict Mode**: `bot_flows.strict_mode = true`. Disables AI fallbacks (`ai`, `ai_answer`) regardless of per-step config. Enforces "exactly what the consultor wrote".
- **Idempotency Content**: A string derived from outbound content, used to deduplicate within and across turns (powers guarantee G1).
- **Engine v3**: The new pure runner in `_shared/flow-engine/v3-runner.ts`, plus its dispatcher (`v3-dispatcher.ts`), loader (`v3-loader.ts`), and router (`router.ts`).
- **Legacy**: The two parallel engines being deleted — `runBotFlow` (sys pipeline) and `runConversationalFlow` (data-driven) — each duplicated in `evolution-webhook` and `whapi-webhook`.

---

## Requirements

### Requirement 1: Single Engine Contract

**User Story:** As a developer, I want one source of truth for the bot's behavior, so that bugs do not multiply across handlers and I can reason about a single decision tree.

#### Acceptance Criteria

1. WHEN an inbound message arrives at the `evolution-webhook` HTTP entry AND `consultants.use_engine_v3 = true` for the target consultor, THE Engine_V3 SHALL be invoked exactly once per turn through the function `runEngine`.
2. WHEN an inbound message arrives at the `whapi-webhook` HTTP entry AND `consultants.use_engine_v3 = true` for the target consultor, THE Engine_V3 SHALL be invoked exactly once per turn through the function `runEngine`.
3. THE `runEngine` function SHALL be referentially transparent such that the same `EngineInput` always produces the same `EngineOutput`.
4. THE `runEngine` function SHALL NOT call `Date.now`, `fetch`, `Math.random`, `crypto.randomUUID`, or any Supabase client method.
5. WHERE time-like or random values are needed inside `runEngine`, THE Engine_V3 SHALL read time values exclusively from `EngineConfig.now`, minute-bucket values exclusively from `EngineConfig.minuteBucket`, and idempotency-key or random-derived values exclusively from `EngineConfig.idempotencyKeyFn`, AND SHALL NOT substitute one source for another or source them from anywhere else.
6. THE Engine_V3 dispatcher (`v3-dispatcher.ts`) SHALL be the only component that performs I/O against channel adapters, the database, or external hooks.
7. THE webhook entry points SHALL NOT contain business logic beyond inbound parsing, OTP intercept handoff, router invocation, and dispatcher invocation.

---

### Requirement 2: No Duplicate Outbounds (Guarantee G1)

**User Story:** As a lead, I want to receive each message at most once per turn, so that I do not see the same text or media block twice in a row.

#### Acceptance Criteria

1. WHEN `runEngine` produces its `outbound` array for a turn, THE Engine_V3 SHALL ensure that no two adjacent items in `outbound` have the same `idempotencyContent`.
2. WHEN the engine emits the first outbound of a turn AND `state.lastOutboundContentHash` equals `hash(outbound[0].idempotencyContent)` AND less than 2 seconds have elapsed since `state.lastOutboundAt`, THE Engine_V3 SHALL drop that leading outbound and emit log `engine_dedupe_blocked`.
3. WHEN `runEngine` returns a non-empty `outbound` array, THE Engine_V3 SHALL set `stateUpdate.lastOutboundContentHash` to `hash(outbound[outbound.length - 1].idempotencyContent)` for cross-turn deduplication on the next turn.
4. THE Engine_V3 SHALL ensure every emitted `OutboundMessage` carries a non-empty `idempotencyContent` string.

---

### Requirement 3: No Silent Turn (Guarantee G2)

**User Story:** As a lead, I want to receive a response whenever I send a message, so that I never feel ignored by the bot.

#### Acceptance Criteria

1. WHEN `inbound.kind ∈ {text, button_click, number_reply, media}`, THE Engine_V3 SHALL return a result satisfying `outbound.length ≥ 1` OR a deferred-action declaration visible in `logs` as `engine_ai_answer_deferred`, `engine_ai_decide_deferred`, or an OCR/portal deferred log.
2. WHEN `inbound.kind ∈ {text, button_click, number_reply, media}` AND no transition matches AND `step.fallback` is null AND no fallback handler produces outbound or a deferred action, THE Engine_V3 SHALL emit a single safe-text outbound whose text is `step.messageText` if non-empty, otherwise the literal `"Pode me responder, por favor? 🙂"`.
3. WHEN the safe-text path fires under criterion 3.2, THE Engine_V3 SHALL emit a log of kind `engine_safe_text` and a log of kind `engine_no_match` for the turn.
4. IF an internal engine error prevents normal outbound generation for an inbound of kind ∈ {`text`, `button_click`, `number_reply`, `media`}, THEN THE Engine_V3 SHALL emit a single safe-text outbound containing the literal `"Pode me responder, por favor? 🙂"` AND SHALL emit a log of kind `engine_safe_text` for that turn, so that the lead is never silenced.

---

### Requirement 4: Single Decision Branch per Turn (Guarantee G3)

**User Story:** As a maintainer, I want exactly one decision log per turn, so that I can pinpoint which branch the engine took when I debug production traffic.

#### Acceptance Criteria

1. WHEN `runEngine` processes a turn, THE Engine_V3 SHALL ensure that exactly one log of kind ∈ {`engine_transition_match`, `engine_repeat`, `engine_goto`, `engine_safe_text`, `engine_handoff`, `engine_ai_answer_deferred`, `engine_ai_decide_deferred`, `engine_no_match`} appears in `result.logs`.
2. WHEN a transition matches the inbound for a turn, THE Engine_V3 SHALL emit exactly one log of kind `engine_transition_match` for that turn AND SHALL NOT emit `engine_transition_match` together with any other decision-log kind in the same turn.
3. THE Engine_V3 SHALL NOT emit two or more decision logs of the same kind in the same turn.

---

### Requirement 5: Variant Fidelity (Guarantee G4)

**User Story:** As a consultor, I want each variant of my flow to render exactly as documented, so that variant B leads receive persuasive text without robotic audio, variant D leads receive real interactive buttons on Whapi, and variant A leads receive media in the order I configured.

#### Acceptance Criteria

1. WHEN `flow.variant = "A"` AND `flow.mediaOrderByStepKey[step.stepKey]` is defined and non-empty, THE Engine_V3 SHALL render outbound media items in the exact order declared in `mediaOrderByStepKey[step.stepKey]`.
2. WHEN `flow.variant = "A"` AND `flow.mediaOrderByStepKey[step.stepKey]` is undefined or empty, THE Engine_V3 SHALL fall back to the step's natural construction order (text, then choice options, then any declared media).
3. WHEN `flow.variant = "B"`, THE Engine_V3 SHALL NOT emit any `OutboundMessage` with `kind = "audio_slot"` or with `kind = "media"` and `media.kind = "audio"`.
4. WHEN `flow.variant = "B"` AND the current step has audio configured in `mediaOrderByStepKey`, THE Engine_V3 SHALL emit a single text outbound whose content is `step.persuasiveText` when non-empty, otherwise `step.messageText`.
5. WHEN `flow.variant = "D"` AND `step.stepType = "ask_choice"` AND `capabilities.supportsButtons = true`, THE Engine_V3 SHALL emit at least one `OutboundMessage` of `kind = "choice"` with `choice.preferred = "button"` and `choice.options.length ≤ 3`.
6. WHEN `flow.variant = "D"` AND `step.stepType = "ask_choice"` AND `capabilities.supportsButtons = false`, THE Engine_V3 SHALL emit exactly one `OutboundMessage` of `kind = "choice"` with `choice.preferred = "text"` (numbered text list, the TEXT_LIST setting) AND SHALL NOT emit any `OutboundMessage` with `choice.preferred = "button"` for that turn.
7. IF `flow.variant = "C"`, THEN THE Engine_V3 SHALL emit a log of kind `engine_variant_unsupported` AND SHALL invoke the `humano` fallback handler with `handoff_reason = "variant_c_not_supported"`.

---

### Requirement 6: Single Channel of Escalation (Guarantee G5)

**User Story:** As a consultor, I want every paused conversation to produce exactly one alert in my dashboard, so that I never miss a handoff and I never see duplicate alerts for the same pause.

#### Acceptance Criteria

1. WHEN `runEngine` returns `stateUpdate.status = "paused_system"`, THE Engine_V3 SHALL ensure exactly one entry in `result.logs` carries `sideEffect.kind = "insert_handoff_alert"`.
2. WHEN the dispatcher receives a `StructuredLog` with `sideEffect.kind = "insert_handoff_alert"`, THE Dispatcher SHALL guarantee insertion of exactly one row into `bot_handoff_alerts` for that turn by retrying through transient failures and routing the insertion through a dead-letter queue or alternative durable storage until the database is available, AND SHALL NOT silently drop a handoff alert.
3. WHEN `runEngine` returns `stateUpdate.status ≠ "paused_system"`, THE Engine_V3 SHALL NOT emit any `StructuredLog` with `sideEffect.kind = "insert_handoff_alert"`.

---

### Requirement 7: Strict Mode Honors Consultor Intent (Guarantee G6)

**User Story:** As a consultor running in strict mode, I want full control over what the bot says, so that no AI module fires unexpectedly even when individual steps still declare AI fallback modes.

#### Acceptance Criteria

1. WHEN `flow.strictMode = true`, THE Engine_V3 SHALL NOT emit any deferred AI action regardless of source, including per-step `step.fallback.mode ∈ {ai, ai_answer}` configuration AND any global, middleware, or hook-driven AI invocation path.
2. WHEN `flow.strictMode = true` AND `step.fallback.mode ∈ {ai, ai_answer}` AND the inbound does not match any transition, THE Engine_V3 SHALL invoke the safe-text fallback path AND SHALL emit a log of kind `engine_strict_mode_blocked_ai`.
3. WHEN `flow.strictMode = true`, THE Engine_V3 SHALL NOT emit any log whose kind references AI functionality, including `engine_ai_answer_deferred`, `engine_ai_decide_deferred`, `engine_ai_decide_invalid`, or any future AI-related log kind, regardless of step configuration.

---

### Requirement 8: Variant A Media Order Configurability

**User Story:** As a consultor, I want the media order I drag-and-drop in `/admin/fluxos` to be the order leads see, so that my carefully sequenced narrative is preserved on every render.

#### Acceptance Criteria

1. WHEN `flow_step_media_order[step.stepKey]` has been configured by the consultor in the FluxoBuilder UI AND the resolved value is defined and non-empty for that step, THE Engine_V3 SHALL emit media for that step in the exact order declared on every render of the step.
2. WHEN `flow_step_media_order[step.stepKey]` is not configured for a step, THE Engine_V3 SHALL emit media in the step's natural construction order (text → declared media items in declaration order → choice options last).
3. WHEN the step is rendered both on initial entry and after a `repeat` fallback, THE Engine_V3 SHALL produce media items in the same order across both renders for the same `mediaOrderByStepKey[step.stepKey]` configuration.

---

### Requirement 9: AI Modes Fire Only When Explicitly Configured

**User Story:** As a consultor, I want AI to fire only on the specific steps where I declared `fallback.mode = "ai"` or `"ai_answer"`, so that AI cost and AI behavior never surprise me.

#### Acceptance Criteria

1. THE Engine_V3 SHALL NOT invoke any AI hook (`hooks.aiAnswer`, `hooks.aiDecide`) unless `step.fallback.mode = "ai"` or `step.fallback.mode = "ai_answer"`.
2. WHEN `step.fallback.mode = "ai_answer"` AND `flow.strictMode = false` AND `inbound.kind = "text"` AND no transition matches AND `state.retries < config.limits.maxAiQuestionsPerStep`, THE Engine_V3 SHALL emit a `DeferredAction` with `kind = "ai_answer"` and `thenRepeatStep = true`.
3. WHEN `step.fallback.mode = "ai"` AND `flow.strictMode = false` AND no transition matches, THE Engine_V3 SHALL emit a `DeferredAction` with `kind = "ai_decide"` whose `candidates` list contains only step ids that are members of `step.reachableStepIds`.
4. IF the AI returns a `step_id` outside the declared `candidates` list, THEN THE Dispatcher SHALL re-enter the engine with `inbound = { kind: "no_input" }` AND THE Engine_V3 SHALL fall through to safe-text and emit log `engine_ai_decide_invalid`.
5. WHEN `step.fallback.mode = "ai_answer"` AND `state.retries ≥ config.limits.maxAiQuestionsPerStep`, THE Engine_V3 SHALL escalate to the `humano` fallback handler with `handoff_reason = "ai_limit_atingido"`.

---

### Requirement 10: Migration Pauses Non-UUID Leads

**User Story:** As an operator, I want in-progress leads to be cleanly paused at deploy time, so that legacy state does not break v3 and a human picks up each interrupted conversation.

#### Acceptance Criteria

1. WHEN the migration script `migrate-engine-v3` runs against the production database, THE Migration_Script SHALL identify every row in `customers` where `bot_paused = false` AND `conversation_step IS NOT NULL` AND `conversation_step` is not a UUID.
2. WHEN a row is identified per criterion 10.1, THE Migration_Script SHALL update that row to `bot_paused = true`, `bot_paused_reason = "engine_v3_migration"`, `bot_paused_at = NOW()`.
3. WHEN a row is paused per criterion 10.2, THE Migration_Script SHALL insert exactly one row into `bot_handoff_alerts` with `customer_id = row.id`, `reason = "engine_v3_migration"`, `source = "migration"`.
4. WHEN the migration script is re-run after a previous successful run, THE Migration_Script SHALL skip rows that are already paused and SHALL NOT create duplicate `bot_handoff_alerts` entries for them.
5. WHEN the migration script encounters a database error on a single row, THE Migration_Script SHALL increment its `errors` counter, log the error, and continue processing remaining rows.

---

### Requirement 11: Feature Flag Rollout

**User Story:** As an operator, I want to enable Engine v3 per consultor via a flag, so that I can stage the rollout safely and roll back instantly without redeploying.

#### Acceptance Criteria

1. THE Engine_V3 SHALL be enabled for a given consultor only when `consultants.use_engine_v3 = true` for that consultor's row.
2. WHEN the webhook entry processes an inbound AND `consultants.use_engine_v3 = false` for the target consultor, THE Engine_Router SHALL route the inbound to the legacy handlers AND SHALL NOT execute any v3 code path.
3. WHEN the webhook entry processes an inbound AND `consultants.use_engine_v3 = true` for the target consultor, THE Engine_Router SHALL route the inbound to `runEngine` AND SHALL NOT execute any legacy code path.
4. WHEN `consultants.use_engine_v3` is flipped during an in-flight conversation, THE Engine_Router SHALL read the flag fresh on the next inbound and route that inbound to whichever engine is currently selected.
5. THE Engine_V3 SHALL read only UUID values from `customers.conversation_step` and SHALL NOT crash when reading state written by a legacy turn that obeyed the post-migration UUID invariant.
6. WHILE legacy and v3 coexist, THE legacy engine SHALL continue to read `customers.conversation_step` in any format (UUID or literal string) AND SHALL NOT modify the value of `customers.conversation_step` as part of that read (reads are side-effect free with respect to the underlying data).

---

### Requirement 12: Channel Adapters Unchanged

**User Story:** As a maintainer, I want the existing Whapi and Evolution channel adapters to keep their current contracts, so that the rewrite does not introduce regressions in the I/O layer.

#### Acceptance Criteria

1. THE Engine_V3 SHALL emit `OutboundMessage[]` using only types defined in `_shared/channels/types.ts`.
2. THE Engine_V3 SHALL NOT call any method on a `ChannelAdapter` instance directly. WHERE channel I/O is required, THE Engine_V3 MAY interact with the adapter only through approved abstraction layers (e.g., `_shared/channels/dispatch-choice.ts`) that translate `OutboundMessage` values into adapter calls.
3. THE Engine_V3 SHALL respect `ChannelCapabilities.supportsButtons`, `ChannelCapabilities.supportsList`, and `ChannelCapabilities.maxButtons` declared by the adapter when choosing variant rendering.
4. THE rewrite SHALL NOT modify the public exports or internal logic of `_shared/channels/whapi.ts`, `_shared/channels/evolution.ts`, or `_shared/channels/dispatch-choice.ts`.
5. WHEN `capabilities.maxButtons = 0`, THE Engine_V3 SHALL NOT emit any `OutboundMessage` with `choice.preferred = "button"` AND SHALL fall back to `choice.preferred = "list"` when `capabilities.supportsList = true`, otherwise to `choice.preferred = "text"` (numbered text list).

---

### Requirement 13: Preserve OTP, OCR Review, and Portal Worker

**User Story:** As a maintainer, I want the working OTP intercept, OCR review pipeline, and portal worker subsystems to keep working untouched, so that the rewrite stays focused on the engine and does not risk regressions in adjacent systems.

#### Acceptance Criteria

1. WHEN an inbound is intercepted by the existing `recover-stuck-otp` OTP intercept module, THE Engine_V3 SHALL NOT be invoked for that inbound.
2. WHEN `step.pipelineKind ∈ {ocr_conta, ocr_documento}` AND `inbound.kind = "media"`, THE Engine_V3 SHALL emit a `DeferredAction` with `kind = "ocr"` AND SHALL NOT change `stateUpdate.currentStepId` until the dispatcher re-enters the engine with the OCR result.
3. WHEN `step.pipelineKind ∈ {cadastro_portal, finalizar_cadastro}`, THE Engine_V3 SHALL emit a `DeferredAction` with `kind = "portal_submit"` bound to `hooks.portal`.
4. THE rewrite SHALL NOT modify the OCR review pipeline (`ocr_review_pending` table, `ocr-review-timeout` cron, painel admin OCR review card).
5. THE rewrite SHALL NOT modify the portal worker (`_shared/portal-worker.ts`, `submit-otp` function, Playwright + iGreen integration).

---

### Requirement 14: Engine Logs Persisted

**User Story:** As a developer, I want every turn's decisions auditable in a single table, so that I can debug production behavior and compute rollout metrics.

#### Acceptance Criteria

1. WHEN `runEngine` returns a result, THE Dispatcher SHALL persist every `StructuredLog` from `result.logs` to the `engine_logs` table within 5 seconds of receiving the result.
2. WHEN a `StructuredLog` carries `sideEffect.kind = "insert_handoff_alert"`, THE Dispatcher SHALL insert exactly one row into `bot_handoff_alerts` for that turn BEFORE inserting the corresponding log row into `engine_logs`.
3. THE Dispatcher SHALL persist each log with its `at`, `kind`, `customerId`, `flowId`, `stepId`, `payload`, and `sideEffect` fields preserved as defined in `_shared/flow-engine/v3-runner.ts`.
4. WHEN a turn requires both a `bot_handoff_alerts` insertion (per criterion 14.2) and an `engine_logs` insertion, THE Dispatcher SHALL ensure the `bot_handoff_alerts` insertion succeeds independently of the `engine_logs` insertion such that a failed `engine_logs` insertion SHALL NOT prevent or roll back the `bot_handoff_alerts` insertion (partial success is permitted: alert first, log second).

---

### Requirement 15: Outbound and Retry Limits

**User Story:** As an operator, I want hard ceilings on outbound count and retry count per turn, so that misconfigured flows and runaway loops cannot blow up cost or message volume.

#### Acceptance Criteria

1. WHEN the candidate `outbound` array length would exceed `config.limits.maxOutboundsPerTurn` (default 6), THE Engine_V3 SHALL truncate the array to that limit AND SHALL emit a log of kind `engine_outbound_limit_exceeded`.
2. WHEN `state.retries ≥ config.limits.maxRetriesBeforeHandoff` (default 3) AND a `repeat` or `retry` fallback handler attempts to retry, THE FallbackHandler SHALL escalate to `humanoHandler` instead of repeating.
3. WHEN `state.retries ≥ config.limits.maxAiQuestionsPerStep` (default 3) AND `step.fallback.mode = "ai_answer"` is selected, THE FallbackHandler SHALL escalate to `humanoHandler` with `handoff_reason = "ai_limit_atingido"`.
4. THE Engine_V3 SHALL ensure `stateUpdate.retries` (when set) is non-negative AND no greater than `state.retries + 1`.

---

### Requirement 16: FluxoBuilder UI Compatibility

**User Story:** As a consultor, I want to keep configuring my flows in `/admin/fluxos` exactly as I do today, so that the rewrite does not force me to learn a new editor.

#### Acceptance Criteria

1. THE Engine_V3 SHALL read every column on `bot_flows` and `bot_flow_steps` that the existing FluxoBuilder UI writes.
2. THE rewrite SHALL NOT introduce any new mandatory column on `bot_flows` or `bot_flow_steps`.
3. WHERE the rewrite adds the optional column `bot_flow_steps.persuasive_text`, THE Engine_V3 SHALL treat the column as optional, treating a missing column, a null value, and an empty string identically as "not provided", AND SHALL fall back to `messageText` in those cases (per Requirement 5.4).
4. WHEN a consultor saves a flow in `/admin/fluxos` AND `consultants.use_engine_v3 = true`, THE Engine_V3 SHALL execute the flow as saved on the next inbound for that consultor's leads.
5. THE rewrite SHALL NOT require any change to `src/components/admin/fluxo/*` source files.
6. IF the fallback chain `persuasive_text` → `messageText` cannot produce a non-empty text for a step that requires text output (both sources missing or empty), THEN THE Engine_V3 SHALL raise an error to the dispatcher AND SHALL NOT silently emit an empty outbound for that step.

---

## Non-Goals

The following items are explicitly out of scope for this spec. They are listed here to bound the work and prevent scope creep during implementation.

**Não vamos**:

- Não vamos refazer FluxoBuilder UI (`src/components/admin/fluxo/*`). A UI e o schema permanecem como estão.
- Não vamos refazer OTP intercept (`recover-stuck-otp`). Continua interceptando antes do engine.
- Não vamos refazer Portal Worker (Playwright + iGreen, `_shared/portal-worker.ts`, `submit-otp`).
- Não vamos refazer OCR review pipeline (Gemini, painel admin OCR card, cron `ocr-review-timeout`, tabela `ocr_review_pending`).
- Não vamos refazer detecção facial.
- Não vamos refazer sync-iGreen.
- Não vamos refazer Channel Adapters (`_shared/channels/whapi.ts`, `_shared/channels/evolution.ts`, `_shared/channels/dispatch-choice.ts`). O contrato do adapter é o contrato do engine.
- Não vamos implementar Variante C (vídeo) — fica para spec futura. Engine v3 trata variant C como handoff explícito (Requirement 5.7).
- Não vamos modificar o schema de `bot_flows` / `bot_flow_steps` existente. Apenas adições não-destrutivas: `consultants.use_engine_v3`, `customer_flow_state.last_outbound_content_hash`, `bot_flow_steps.persuasive_text` (opcional), e a nova tabela `engine_logs`.
- Não vamos prometer "100% sem bugs em qualquer fluxo configurado errado pelo consultor". O engine garante que executa o fluxo como salvo; configuração inválida produz `safe-text` ou handoff, nunca silêncio.
- Não vamos manter os 2 engines competindo após Phase 4. Após 30 dias estáveis em todos os consultores, o legado e o router são deletados; só sobra v3.
