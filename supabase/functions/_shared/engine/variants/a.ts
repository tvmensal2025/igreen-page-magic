/**
 * Variant A — "Padrão com áudio".
 *
 * Spec: `.kiro/specs/flow-engine-v3-rewrite/design.md` §2.2.1.
 * Validates: Requirements 5.1, 5.2, 8.1, 8.2, 8.3, 16.6.
 *
 * Pure builder — never reads system clock, never performs I/O. The
 * runner picks this strategy when `flow.variant === "A"`.
 *
 * Behaviour:
 *  - When `flow.mediaOrderByStepKey[step.stepKey]` is defined and
 *    non-empty, render exactly in declared order. Each `MediaOrderEntry`
 *    maps 1:1 to an `OutboundMessage` via {@link renderMediaItem}.
 *  - When the order is missing/empty, synthesize from
 *    `step.messageText` + `step.choiceOptions` via
 *    {@link synthesizeFromStep} (text first, choice last).
 *
 * Every emitted outbound carries a non-empty `idempotencyContent`
 * derived from `step.id` + the item kind + a content fingerprint
 * (Requirement 2.4).
 */

import type {
  BotFlow,
  BotFlowStep,
  ChannelCapabilities,
  EngineConfig,
  MediaOrderEntry,
  OutboundMessage,
  VariantStrategy,
} from "../types.ts";

/**
 * Compose a non-empty idempotency string for an outbound. The runner
 * relies on `step.id` (a UUID) being part of the key to keep cross-step
 * outbounds distinct even when content overlaps.
 */
export function buildIdempotencyContent(
  stepId: string,
  kind: string,
  content: string,
): string {
  // Truncate aggressively — `idempotencyContent` is hashed before being
  // compared (see helpers.ts `hash`), so length only matters for the
  // adjacency dedupe check inside a single turn.
  return `${stepId}:${kind}:${content.slice(0, 200)}`;
}

/**
 * Translate one ordered media slot into an outbound. Pure switch on
 * `item.kind`. Audio slots are emitted regardless of capabilities — the
 * adapter can downgrade them, but variant A always declares the intent.
 */
export function renderMediaItem(
  item: MediaOrderEntry,
  step: BotFlowStep,
  _capabilities: ChannelCapabilities,
  config: EngineConfig,
): OutboundMessage[] {
  switch (item.kind) {
    case "text":
      return [{
        kind: "text",
        text: item.text,
        idempotencyContent: buildIdempotencyContent(step.id, "text", item.text),
        humanDelayMs: config.humanDelayFn(item.text.length),
      }];
    case "image": {
      const media = item.caption !== undefined
        ? { kind: "image" as const, url: item.url, caption: item.caption }
        : { kind: "image" as const, url: item.url };
      return [{
        kind: "media",
        media,
        idempotencyContent: buildIdempotencyContent(step.id, "image", item.url),
      }];
    }
    case "audio":
      return [{
        kind: "media",
        media: { kind: "audio", url: item.url, durationSec: item.durationSec },
        idempotencyContent: buildIdempotencyContent(step.id, "audio", item.url),
      }];
    case "video": {
      const media = item.caption !== undefined
        ? {
          kind: "video" as const,
          url: item.url,
          caption: item.caption,
          durationSec: item.durationSec,
        }
        : {
          kind: "video" as const,
          url: item.url,
          durationSec: item.durationSec,
        };
      return [{
        kind: "media",
        media,
        idempotencyContent: buildIdempotencyContent(step.id, "video", item.url),
      }];
    }
    case "document":
      return [{
        kind: "media",
        media: {
          kind: "document",
          url: item.url,
          filename: item.filename,
        },
        idempotencyContent: buildIdempotencyContent(
          step.id,
          "document",
          item.url,
        ),
      }];
  }
}

/**
 * Fallback renderer used when no `mediaOrderByStepKey` entry exists for
 * the step. Builds outbound from raw `messageText` + `choiceOptions` so
 * the consultor's flow still emits something deterministic.
 *
 * - Text outbound emitted only when `messageText` is non-empty after trim.
 * - Choice outbound appended when `step.stepType === "ask_choice"` and
 *   `step.choiceOptions` is non-empty.
 * - When both are absent, returns `[]` — the runner's safe-text branch
 *   handles the empty turn (G2).
 */
export function synthesizeFromStep(
  step: BotFlowStep,
  _capabilities: ChannelCapabilities,
): OutboundMessage[] {
  const out: OutboundMessage[] = [];
  const text = (step.messageText ?? "").trim();

  if (text) {
    out.push({
      kind: "text",
      text,
      idempotencyContent: buildIdempotencyContent(step.id, "text", text),
    });
  }

  // Emit choice when the step has explicit `_buttons` (choiceOptions) regardless
  // of `stepType`. Legacy flows model "message + buttons" with step_type='message'
  // and the buttons live inside `captures._buttons`. Restricting choice emission
  // to `ask_choice` would silently drop the buttons for those flows (Bug fixed in
  // Phase 1 smoke 2026-05-26).
  const hasButtons = step.choiceOptions && step.choiceOptions.length > 0;
  const isChoiceStep = step.stepType === "ask_choice";
  if (hasButtons || isChoiceStep) {
    if (step.choiceOptions && step.choiceOptions.length > 0) {
      const ids = step.choiceOptions.map((c) => c.id).join("|");
      out.push({
        kind: "choice",
        prompt: text || "Escolha uma opção:",
        choice: {
          preferred: step.preferredChoiceKind ?? "button",
          options: step.choiceOptions,
        },
        idempotencyContent: buildIdempotencyContent(step.id, "choice", ids),
      });
    }
  }

  return out;
}

export const variantA: VariantStrategy = {
  buildStepOutbound({ step, flow, capabilities, config }) {
    const order: MediaOrderEntry[] =
      flow.mediaOrderByStepKey[step.stepKey ?? ""] ?? [];

    if (order.length === 0) {
      return synthesizeFromStep(step, capabilities);
    }

    // Detect "stub" media order entries: bare `{kind: "..."}` with no
    // payload (text/url/media_id). Those are ORDER HINTS only — the real
    // content lives on the step (`step.messageText` + step buttons). In
    // that case fall back to synthesis from the step, which already
    // emits text + choice when the step has buttons.
    //
    // Mixed orders (some entries have real content, others are stubs)
    // render only the entries with payload.
    const hasAnyPayload = order.some(
      (item) =>
        (item as any).text !== undefined ||
        (item as any).url !== undefined ||
        (item as any).media_id !== undefined,
    );
    if (!hasAnyPayload) {
      return synthesizeFromStep(step, capabilities);
    }

    const out = order.flatMap((item: MediaOrderEntry) => {
      // Skip stub entries within a mixed order (no payload to render).
      if (
        (item as any).text === undefined &&
        (item as any).url === undefined &&
        (item as any).media_id === undefined
      ) {
        return [];
      }
      return renderMediaItem(item, step, capabilities, config);
    });

    // Append choice when the step has buttons configured. The
    // mediaOrder entries don't carry buttons; we always append the
    // choice as the last outbound so the lead can interact after
    // consuming media. Without this, steps with audio/video + buttons
    // would emit only the media and the lead never sees the options.
    const hasButtons = step.choiceOptions && step.choiceOptions.length > 0;
    const alreadyHasChoice = out.some((m) => m.kind === "choice");
    if (hasButtons && !alreadyHasChoice && step.choiceOptions) {
      const ids = step.choiceOptions.map((c) => c.id).join("|");
      // Use the step's text as the choice prompt, or the last text outbound
      // already emitted, falling back to a generic prompt.
      const lastText = [...out].reverse().find((m) => m.kind === "text") as
        | { kind: "text"; text: string }
        | undefined;
      const prompt = (step.messageText ?? "").trim()
        || lastText?.text
        || "Escolha uma opção:";
      out.push({
        kind: "choice",
        prompt,
        choice: {
          preferred: step.preferredChoiceKind ?? "button",
          options: step.choiceOptions,
        },
        idempotencyContent: buildIdempotencyContent(step.id, "choice", ids),
      });
    }

    return out;
  },
};

// Helpers compartilhados pelos demais módulos de variantes.
export type { BotFlow, BotFlowStep, ChannelCapabilities, EngineConfig };
