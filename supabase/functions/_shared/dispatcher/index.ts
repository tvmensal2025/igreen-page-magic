/**
 * Engine v3 dispatcher.
 *
 * Spec: `.kiro/specs/flow-engine-v3-rewrite/design.md` §1.2 (component
 * map: `v3-dispatcher.ts`) + §2.7 (turn evaluation order).
 * Task: 26.
 *
 * Pure runner produces an `EngineOutput`; this module is the impure
 * companion that:
 *   1) Sends every `OutboundMessage` through the channel adapter in order.
 *   2) Persists `stateUpdate` atomically to `customer_flow_state` (and
 *      the `last_outbound_content_hash` column added by the v3 schema
 *      migration).
 *   3) Writes every `StructuredLog` to `engine_logs`.
 *   4) Inserts `bot_handoff_alerts` for any log carrying
 *      `sideEffect.kind === "insert_handoff_alert"`. The alert insert
 *      ALWAYS fires before the log insert, with retry-then-DLQ semantics
 *      so a transient DB hiccup never silently swallows a handoff
 *      (Requirement 6.2 + 14.4).
 *
 * Validates: Requirements 1.6, 1.7, 6.2, 9.4, 12.2, 14.1, 14.2, 14.3, 14.4.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type {
  ChannelAdapter,
  CustomerSnapshot,
  EngineOutput,
  OutboundMessage,
  StructuredLog,
} from "../engine/types.ts";
import { persistFlowState } from "../customer-flow-state.ts";
import { renderChoice } from "../channels/dispatch-choice.ts";
import { renderTemplateVars } from "../render-vars.ts";

// ─── Public API ─────────────────────────────────────────────────────────

export interface ExecuteActionsArgs {
  supabase: SupabaseClient;
  adapter: ChannelAdapter;
  /** Phone or JID the adapter expects in `sendText(jid, ...)`. */
  jid: string;
  /** Customer state BEFORE the engine ran (for diffing + retry context). */
  state: CustomerSnapshot;
  /** Engine output to execute. */
  result: EngineOutput;
  /** ISO-8601 timestamp from EngineConfig.now (for last_outbound_at). */
  now: string;
  /**
   * Optional: when present, every successfully sent outbound is also
   * persisted to `bot_test_outbound` (run_id + turn) so the simulator
   * UI can render the engine v3 path identically to legacy.
   */
  testRunId?: string | null;
  testTurn?: number | null;
  /**
   * Optional: when present, persists a single inbound row to
   * `conversations` as `message_direction='inbound'`. Skipped when null
   * to avoid double-writes when the webhook already logged the inbound.
   */
  inboundLog?: {
    text: string;
    type: "text" | "audio" | "image" | "video" | "document" | "button";
  } | null;
  /**
   * Optional: consultor's display name for `{{representante}}` template
   * variable rendering. Webhook entry resolves this via a single SELECT.
   */
  consultantName?: string | null;
}

export interface ExecuteActionsOutcome {
  /** Number of outbounds successfully sent. */
  sent: number;
  /** Send failures (adapter returned ok=false or threw). */
  failed: number;
  /** Whether the customer_flow_state UPDATE succeeded. */
  statePersisted: boolean;
  /** Whether engine_logs insert succeeded. */
  logsPersisted: boolean;
  /** How many handoff alerts were inserted. */
  handoffAlerts: number;
  /** Adapter send results, in order. */
  sendResults: { kind: OutboundMessage["kind"]; ok: boolean; error?: string }[];
}

/**
 * Execute one engine output. Side-effecting: sends outbounds, writes
 * state, writes logs. Never throws on individual failures; aggregates
 * all errors in the returned outcome so the caller can decide whether
 * to log a Sentry alert.
 *
 * Order of operations:
 *  1. Send outbounds (in order) via adapter
 *  2. INSERT bot_handoff_alerts for any log with sideEffect (BEFORE state/logs)
 *  3. UPDATE customer_flow_state with stateUpdate
 *  4. UPDATE last_outbound_content_hash (separate query — not on the public
 *     persistFlowState surface)
 *  5. INSERT engine_logs batch
 *
 * Steps 2 and 5 are intentionally separated so a failed log insert does
 * NOT roll back the handoff alert (Requirement 14.4).
 */
export async function executeActions(
  args: ExecuteActionsArgs,
): Promise<ExecuteActionsOutcome> {
  const outcome: ExecuteActionsOutcome = {
    sent: 0,
    failed: 0,
    statePersisted: false,
    logsPersisted: false,
    handoffAlerts: 0,
    sendResults: [],
  };

  // ─── 0. Apply template variable rendering to all outbounds ────────────
  // The engine emits raw text from `bot_flow_steps.message_text`, which
  // contains `{{nome}}`, `{{representante}}`, `{{valor_conta}}` etc.
  // The legacy webhook (whapi-webhook/handlers/bot-flow.ts) renders
  // these via `renderTemplateVars` before calling sender.sendText.
  // We do the same here so v3 produces identical user-facing strings.
  const vars = {
    name: args.state.customer.name,
    name_source: (args.state.customer as any)?.nameSource ?? (args.state.customer as any)?.name_source ?? null,
    phone: args.state.customer.phoneWhatsapp,
    cpf: null,
    representante: args.consultantName ?? null,
    valor_conta: args.state.customer.electricityBillValue,
    variant: (args.state.customer as any)?.flowVariant ?? (args.state.customer as any)?.flow_variant,
  };
  const renderedOutbound: OutboundMessage[] = args.result.outbound.map((m) => {
    if (m.kind === "text") {
      return { ...m, text: renderTemplateVars(m.text, vars) };
    }
    if (m.kind === "choice") {
      return {
        ...m,
        prompt: renderTemplateVars(m.prompt, vars),
        choice: {
          ...m.choice,
          options: m.choice.options.map((o: any) => ({
            ...o,
            title: renderTemplateVars(String(o.title ?? ""), vars),
          })),
        },
      };
    }
    if (m.kind === "media" && (m.media as any).caption) {
      return {
        ...m,
        media: {
          ...m.media,
          caption: renderTemplateVars((m.media as any).caption, vars),
        } as any,
      };
    }
    return m;
  });
  // Use rendered list for all downstream operations.
  args.result = { ...args.result, outbound: renderedOutbound };

  // ─── 1. Send outbounds in order ───────────────────────────────────────
  // Pre-process: when the engine emits BOTH a text and a choice for the
  // same step (typical for Variant D welcome with `step_type='message'`
  // + `_buttons`), the text is the choice prompt — so we render only the
  // choice in mirrored tables to avoid duplicating the message in
  // ChatView and bot_test_outbound. The adapter still receives both
  // because Whapi's `messages/interactive` body shape needs them
  // separately.
  const outboundForMirror = pruneTextDuplicatedByChoice(args.result.outbound);

  for (const msg of args.result.outbound) {
    const r = await sendOne(args.adapter, args.jid, msg);
    outcome.sendResults.push({ kind: msg.kind, ok: r.ok, error: r.error });
    if (r.ok) outcome.sent++;
    else outcome.failed++;

    // C3 suspensórios: audio_slot que chegou ao adapter é falha silenciosa
    // do loader. Anexa log com sideEffect=insert_handoff_alert para o
    // bloco §2 já no próximo ciclo (idempotente porque o ciclo é único
    // por turno). O áudio em si nunca sai — só o alerta de handoff.
    if (!r.ok && msg.kind === "audio_slot") {
      args.result.logs.push({
        kind: "engine_audio_slot_unhandled",
        at: args.now,
        customerId: args.state.customerId,
        flowId: args.state.flowId,
        stepId: currentStepIdAfter(args.state, args.result),
        payload: { slotKey: (msg as any).slotKey ?? null, error: r.error },
        sideEffect: { kind: "insert_handoff_alert", reason: "audio_slot_unhandled" },
      });
    }
  }

  for (const msg of outboundForMirror) {
    // Mirror every outbound to `conversations` so ChatView, panels, and
    // legacy queries see the v3 engine output. Best-effort: never blocks
    // the dispatch loop on a logging failure.
    try {
      const cur = currentStepIdAfter(args.state, args.result);
      const conv = outboundToConversationRow(msg, cur);
      if (conv) {
        await args.supabase.from("conversations").insert({
          customer_id: args.state.customerId,
          message_direction: "outbound",
          message_text: conv.text,
          message_type: conv.type,
          conversation_step: cur,
        });
      }
    } catch (e: any) {
      console.warn("[v3-dispatcher] conversations outbound insert failed:", e?.message);
    }

    // Test mode: also persist into bot_test_outbound so the simulator UI
    // (`flow-simulate-run` polling loop) can render exactly what the
    // engine sent. Logged for both ok and failed sends so the test
    // harness can assert on rendering and on adapter errors.
    if (args.testRunId && args.testTurn != null) {
      try {
        const conv = outboundToConversationRow(msg, currentStepIdAfter(args.state, args.result));
        if (conv) {
          await args.supabase.from("bot_test_outbound").insert({
            run_id: args.testRunId,
            turn: args.testTurn,
            direction: "outbound",
            kind: conv.type,
            content: conv.text,
            conversation_step_after: currentStepIdAfter(args.state, args.result),
            conversation_step_before: args.state.currentStepId ?? null,
          });
        }
      } catch (e: any) {
        console.warn("[v3-dispatcher] bot_test_outbound insert failed:", e?.message);
      }
    }
  }

  // ─── 1b. Persist inbound log (best-effort) ────────────────────────────
  if (args.inboundLog && args.inboundLog.text) {
    try {
      await args.supabase.from("conversations").insert({
        customer_id: args.state.customerId,
        message_direction: "inbound",
        message_text: args.inboundLog.text,
        message_type: args.inboundLog.type,
        conversation_step: args.state.currentStepId ?? null,
      });
    } catch (e: any) {
      console.warn("[v3-dispatcher] conversations inbound insert failed:", e?.message);
    }
  }


  // ─── 2. Handoff alerts (BEFORE logs — Requirement 14.4) ───────────────
  const alertLogs = args.result.logs.filter(
    (l) => l.sideEffect?.kind === "insert_handoff_alert",
  );
  for (const log of alertLogs) {
    const ok = await insertHandoffAlertWithRetry(args.supabase, args.state, log);
    if (ok) outcome.handoffAlerts++;
  }

  // ─── 3. Persist customer_flow_state ───────────────────────────────────
  const su = args.result.stateUpdate;
  const hasStateChanges =
    su.currentStepId !== undefined ||
    su.status !== undefined ||
    su.pauseReason !== undefined ||
    su.retries !== undefined ||
    su.aiQuestionsThisStep !== undefined ||
    su.enteredStepAt !== undefined ||
    su.expiresAt !== undefined ||
    su.lastInboundAt !== undefined ||
    su.lastOutboundAt !== undefined;

  if (hasStateChanges) {
    outcome.statePersisted = await persistFlowState(args.supabase, {
      customerId: args.state.customerId,
      flowId: args.state.flowId,
      currentStepId: su.currentStepId,
      status: su.status as any,
      pauseReason: su.pauseReason as any,
      retries: su.retries,
      aiQuestionsThisStep: su.aiQuestionsThisStep,
      enteredStepAt: su.enteredStepAt,
      expiresAt: su.expiresAt,
      lastInboundAt: su.lastInboundAt,
      lastOutboundAt: su.lastOutboundAt,
    });
  } else {
    // Nothing to persist; treat as success.
    outcome.statePersisted = true;
  }

  // ─── 4. Update last_outbound_content_hash (separate query) ────────────
  if (su.lastOutboundContentHash !== undefined) {
    try {
      const { error } = await args.supabase
        .from("customer_flow_state")
        .update({ last_outbound_content_hash: su.lastOutboundContentHash })
        .eq("customer_id", args.state.customerId);
      if (error) {
        console.warn(
          "[v3-dispatcher] last_outbound_content_hash update failed:",
          error.message,
        );
      }
    } catch (e) {
      console.warn(
        "[v3-dispatcher] last_outbound_content_hash exception:",
        (e as Error)?.message,
      );
    }
  }

  // ─── 5. Persist engine_logs ───────────────────────────────────────────
  if (args.result.logs.length > 0) {
    outcome.logsPersisted = await insertEngineLogs(
      args.supabase,
      args.state,
      args.result.logs,
    );
  } else {
    outcome.logsPersisted = true;
  }

  return outcome;
}

// ─── Adapter send wrapper ───────────────────────────────────────────────

async function sendOne(
  adapter: ChannelAdapter,
  jid: string,
  msg: OutboundMessage,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = { customerId: undefined, flowId: undefined } as any;
  try {
    switch (msg.kind) {
      case "text": {
        const r = await adapter.sendText(jid, msg.text, ctx);
        return { ok: r.ok, error: r.ok ? undefined : (r as any).error };
      }
      case "choice": {
        // Use the dispatch-choice helper for consistent rendering. The
        // adapter's sendChoice already calls renderChoice internally;
        // we still pass `choice` directly so the adapter sees the
        // engine's intent (button vs list vs number).
        const r = await adapter.sendChoice(jid, msg.prompt, msg.choice, ctx);
        return { ok: r.ok, error: r.ok ? undefined : (r as any).error };
      }
      case "media": {
        const r = await adapter.sendMedia(jid, msg.media, ctx);
        return { ok: r.ok, error: r.ok ? undefined : (r as any).error };
      }
      case "audio_slot": {
        // The audio_slot kind requires the adapter to look up the
        // consultor's audio asset by `slotKey`. We do not have the
        // consultor id here, so we emit a placeholder log: the dispatcher
        // ALWAYS resolves audio_slot via the consultor's `ai_media_library`
        // BEFORE entering the engine, so this branch is reached only when
        // the engine emits `audio_slot` directly (rare; runner usually
        // synthesizes media items via `mediaOrderByStepKey` instead).
        console.warn(
          "[v3-dispatcher] unhandled audio_slot outbound; engine should resolve to media before emitting",
        );
        return { ok: false, error: "audio_slot unhandled" };
      }
      case "presence": {
        // Presence is best-effort. Adapter may or may not support it;
        // never block the conversation on a presence failure.
        try {
          await (adapter as any).sendPresence?.(
            jid,
            msg.presenceKind,
            msg.durationMs,
          );
        } catch (_) {/* noop */}
        return { ok: true };
      }
    }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

// ─── Handoff alert insert with retry + DLQ ──────────────────────────────

const HANDOFF_RETRY_ATTEMPTS = 3;
const HANDOFF_RETRY_DELAY_MS = 250;

async function insertHandoffAlertWithRetry(
  supabase: SupabaseClient,
  state: CustomerSnapshot,
  log: StructuredLog,
): Promise<boolean> {
  if (log.sideEffect?.kind !== "insert_handoff_alert") return false;
  const reason = log.sideEffect.reason;

  for (let attempt = 1; attempt <= HANDOFF_RETRY_ATTEMPTS; attempt++) {
    try {
      const { error } = await supabase.from("bot_handoff_alerts").insert({
        customer_id: state.customerId,
        consultant_id: state.consultantId,
        reason,
        metadata: {
          source: "engine_v3",
          stepId: log.stepId,
          flowId: log.flowId,
          ...(log.payload ?? {}),
        },
      });
      if (!error) return true;
      console.warn(
        `[v3-dispatcher] handoff alert insert attempt ${attempt} failed:`,
        error.message,
      );
    } catch (e: any) {
      console.warn(
        `[v3-dispatcher] handoff alert insert attempt ${attempt} exception:`,
        e?.message,
      );
    }
    if (attempt < HANDOFF_RETRY_ATTEMPTS) {
      await sleep(HANDOFF_RETRY_DELAY_MS * attempt);
    }
  }

  // DLQ: persist to engine_logs with a sentinel kind so a cron can
  // replay later. We DO NOT try to insert into a separate DLQ table to
  // keep schema additions minimal; the engine_logs payload preserves
  // everything the cron needs to retry.
  try {
    await supabase.from("engine_logs").insert({
      at: log.at,
      kind: "engine_handoff",
      customer_id: state.customerId,
      flow_id: state.flowId,
      step_id: log.stepId,
      payload: {
        ...(log.payload ?? {}),
        dlq: true,
        original_reason: reason,
      },
      side_effect: { kind: "dlq_handoff_alert", reason },
    });
  } catch (_) {/* noop — last resort */}
  return false;
}

// ─── engine_logs insert ─────────────────────────────────────────────────

async function insertEngineLogs(
  supabase: SupabaseClient,
  state: CustomerSnapshot,
  logs: StructuredLog[],
): Promise<boolean> {
  if (logs.length === 0) return true;
  const rows = logs.map((l) => ({
    at: l.at,
    kind: l.kind,
    customer_id: state.customerId,
    flow_id: state.flowId,
    step_id: l.stepId,
    payload: l.payload ?? {},
    side_effect: l.sideEffect ?? null,
  }));
  try {
    const { error } = await supabase.from("engine_logs").insert(rows);
    if (error) {
      console.warn("[v3-dispatcher] engine_logs insert failed:", error.message);
      return false;
    }
    return true;
  } catch (e: any) {
    console.warn("[v3-dispatcher] engine_logs exception:", e?.message);
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Conversation/test-run mirror helpers ──────────────────────────────

/**
 * Best-effort renderable summary of an outbound for `conversations` and
 * `bot_test_outbound`. Skips outbounds that have no displayable form
 * (e.g. presence indicators).
 *
 * Choice outbounds are serialized as JSON so the simulator UI's
 * `mapOutbound` can deserialize and render real clickable buttons. The
 * shape `{ "text": prompt, "buttons": [{id, title}] }` matches the
 * "Formato novo (JSON)" branch in `flow-simulate-run.mapOutbound`.
 */
function outboundToConversationRow(
  msg: OutboundMessage,
  _stepId: string | null,
): { text: string; type: string } | null {
  switch (msg.kind) {
    case "text":
      return { text: msg.text, type: "text" };
    case "choice": {
      const opts = msg.choice.options ?? [];
      // Emit JSON envelope so `mapOutbound` renders REAL clickable buttons.
      // ChatView also accepts JSON in `message_text` for buttons (the same
      // path the legacy emitted via outbound_message_log).
      const payload = {
        text: msg.prompt,
        buttons: opts.map((o: any) => ({
          id: String(o.id ?? ""),
          title: String(o.title ?? o.label ?? o.id ?? ""),
        })),
      };
      return { text: JSON.stringify(payload), type: "buttons" };
    }
    case "media": {
      const m = msg.media as any;
      const kind = m.kind ?? "media";
      const caption = m.caption ?? "";
      // Fallback to a sentinel text the legacy code already uses.
      return { text: caption || `[${kind}]`, type: kind };
    }
    case "audio_slot":
      return { text: "[áudio]", type: "audio" };
    case "presence":
      return null;
  }
}

/**
 * When the engine emits BOTH a text outbound and a choice outbound for
 * the same step where the text content equals the choice's prompt
 * (typical for Variant D `welcome` step with `step_type='message'` plus
 * `_buttons`), drop the standalone text from mirroring. The choice
 * already carries the prompt as its text. Without this, ChatView and
 * bot_test_outbound show the message twice.
 *
 * Order is preserved. Adapter call still receives both messages because
 * Whapi's `messages/interactive` body needs `body.text` and `action.buttons`
 * separately — only the mirror to log tables is collapsed.
 */
function pruneTextDuplicatedByChoice(messages: OutboundMessage[]): OutboundMessage[] {
  const out: OutboundMessage[] = [];
  for (let i = 0; i < messages.length; i++) {
    const cur = messages[i];
    const next = messages[i + 1];
    if (
      cur.kind === "text" &&
      next?.kind === "choice" &&
      next.prompt === cur.text
    ) {
      // Drop the duplicate text; the choice carries the prompt.
      continue;
    }
    out.push(cur);
  }
  return out;
}

/**
 * Compute the post-turn step id used for the `conversation_step` column
 * on the conversation rows. Falls back to the pre-turn step id when the
 * engine didn't change steps.
 */
function currentStepIdAfter(
  state: CustomerSnapshot,
  result: EngineOutput,
): string | null {
  const next = result.stateUpdate.currentStepId;
  if (typeof next === "string" && next.length > 0) return next;
  return state.currentStepId ?? null;
}
