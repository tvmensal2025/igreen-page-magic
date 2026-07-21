// Engine v3 webhook entry helper.
//
// Spec: `.kiro/specs/flow-engine-v3-rewrite/design.md` §1.2 (router) +
// §2.7 (turn evaluation order) + tasks.md Task 29.
//
// Single shared module used by both webhook entries (evolution-webhook
// and whapi-webhook) to delegate one inbound to the v3 engine. Keeps
// drift between the two webhooks zero.
//
// Behaviour:
//  - Builds an `InboundEvent` from the parsed inbound shape both
//    webhooks already have on hand.
//  - Calls `loadContext` → `runEngine` → `executeActions` against the
//    provided channel adapter.
//  - On ANY thrown error: writes a single `engine_logs` row with kind
//    `engine_safe_text` and `sideEffect.kind = "insert_handoff_alert"`,
//    pauses the customer via `bot_paused = true`, inserts a handoff
//    alert, and returns `{ handled: true }` so the webhook does NOT
//    fall through to the legacy handler. This preserves the hard
//    invariant from Task 29: "On v3 errors: log to engine_logs and
//    fall through to handoff (NOT legacy)".
//
// Validates: Requirements 1.1, 1.2, 1.6, 1.7, 12.4, 13.1.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { ChannelAdapter, ParsedMessage } from "../channels/types.ts";
import type {
  CaptureSpec,
  EngineConfig,
  EngineHooks,
  InboundEvent,
} from "./types.ts";
import { loadContext } from "./loader.ts";
import { runEngine } from "./runner.ts";
import { executeActions } from "../dispatcher/index.ts";
import { defaultHooks, withCapturesExtractor } from "./hooks.ts";
import { syncCustomerStage } from "../conversion/crm-sync.ts";
import {
  extractCPF,
  extractNome,
  extractTelefone,
  extractValor,
  extractValorPermissivo,
} from "../captureExtractors.ts";

/**
 * Inbound shape both webhooks already compute. Keeping it narrow avoids
 * importing the legacy channel-specific parser shapes here.
 */
export interface V3WebhookEntryInbound {
  messageText: string;
  buttonId?: string | null;
  isFile?: boolean;
  isButton?: boolean;
  hasImage?: boolean;
  hasAudio?: boolean;
  hasDocument?: boolean;
  mediaKind?: "image" | "audio" | "video" | "document" | null;
  /** Provider message id (whapi/evolution) — used as `mediaRef` for media inbound. */
  messageId?: string | null;
}

export interface V3WebhookEntryArgs {
  supabase: SupabaseClient;
  adapter: ChannelAdapter;
  /** UUID of the customer row whose state lives in `customer_flow_state`. */
  customerId: string;
  /** UUID of the consultant who owns the customer (already loaded by the webhook). */
  consultantId: string;
  /** WhatsApp JID, e.g. "5511999999999@s.whatsapp.net". */
  jid: string;
  inbound: V3WebhookEntryInbound;
  /** Optional bot test run correlation, forwarded to bot_test_outbound. */
  testRunId?: string | null;
  testTurn?: number | null;
}

export interface V3WebhookEntryResult {
  /** Always true once this helper returns — caller MUST NOT delegate to legacy. */
  handled: true;
  /** Number of outbounds successfully sent. */
  sent: number;
  /** Number of outbounds the adapter rejected. */
  failed: number;
  /** True when v3 ran end-to-end without error. False when fallback-to-handoff fired. */
  ok: boolean;
  /** Error message captured from the v3 path (if any). */
  error?: string;
}

/**
 * Build an `InboundEvent` from the webhook's already-parsed message shape.
 * Order of precedence mirrors the legacy router: button > number-reply >
 * media > text > no_input.
 */
function toInboundEvent(parsed: V3WebhookEntryInbound): InboundEvent {
  if (parsed.isButton && parsed.buttonId) {
    return {
      kind: "button_click",
      buttonId: String(parsed.buttonId),
      rawText: parsed.messageText || undefined,
    };
  }
  // Number reply: a bare digit "1"/"2" against a numbered list.
  const txt = (parsed.messageText ?? "").trim();
  if (!parsed.isFile && /^\d{1,2}$/.test(txt)) {
    return { kind: "number_reply", raw: txt };
  }
  if (parsed.isFile || parsed.hasImage || parsed.hasAudio || parsed.hasDocument) {
    const mediaKind: "image" | "audio" | "video" | "document" =
      parsed.mediaKind === "audio" || parsed.hasAudio
        ? "audio"
        : parsed.mediaKind === "video"
        ? "video"
        : parsed.mediaKind === "document" || parsed.hasDocument
        ? "document"
        : "image";
    return {
      kind: "media",
      mediaKind,
      mediaRef: String(parsed.messageId ?? ""),
    };
  }
  if (txt) {
    return { kind: "text", text: parsed.messageText };
  }
  return { kind: "no_input" };
}

/**
 * Pure capture extractor binding. Maps the engine's declarative
 * `CaptureSpec[]` to concrete regex helpers in `_shared/captureExtractors.ts`.
 * No I/O — the engine consumes this synchronously.
 */
function bindCaptures(args: { inbound: InboundEvent; specs: CaptureSpec[] }): Record<string, unknown> {
  const text = args.inbound.kind === "text"
    ? args.inbound.text
    : args.inbound.kind === "button_click"
    ? args.inbound.rawText ?? ""
    : args.inbound.kind === "number_reply"
    ? args.inbound.raw
    : "";
  if (!text) return {};
  const out: Record<string, unknown> = {};
  for (const spec of args.specs) {
    if (!spec?.enabled || !spec.field) continue;
    const field = spec.field;
    let value: unknown = null;
    switch (field) {
      case "name":
      case "nome":
        // Step de captura explícita de nome → aceita resposta de 1 palavra única.
        value = extractNome(text, { allowSingleWord: true });
        break;
      case "phone":
      case "telefone":
        value = extractTelefone(text);
        break;
      case "cpf":
        value = extractCPF(text);
        break;
      case "valor":
      case "electricity_bill_value":
        value = extractValor(text) ?? extractValorPermissivo(text);
        break;
      default:
        // Free-form: store the raw trimmed text under the requested field.
        value = text.trim();
    }
    if (value !== null && value !== undefined && value !== "") {
      out[field] = value;
    }
  }
  return out;
}

/**
 * Build the per-turn `EngineConfig`. Time and randomness are surfaced
 * here (the runner stays pure) — see design §2.1.4.
 */
function makeConfig(): EngineConfig {
  const nowMs = Date.now();
  return {
    now: new Date(nowMs).toISOString(),
    minuteBucket: Math.floor(nowMs / 60_000),
    isDarkMode: false,
    allowedDomains: ["igreen.energy"],
    idempotencyKeyFn: (parts) =>
      `${parts.stepId}:${parts.content}:${parts.minuteBucket}`,
    humanDelayFn: (charLen) => Math.min(12_000, Math.max(2_000, charLen * 60)),
    limits: {
      maxOutboundsPerTurn: 6,
      maxRetriesBeforeHandoff: 3,
      maxAiQuestionsPerStep: 3,
    },
  };
}

/**
 * Hooks factory wired to the existing capture extractors. The async
 * hooks (OCR, OTP, portal, AI) keep the declarative `describe()` shape
 * — the dispatcher is responsible for binding them to real impls when
 * resolving DeferredActions.
 */
function makeHooks(): EngineHooks {
  return withCapturesExtractor(defaultHooks(), bindCaptures);
}

/**
 * Fall-through to handoff: pause the customer, insert a handoff alert,
 * and write a single engine_logs row capturing the failure. Used only
 * on v3 error paths so the webhook never leaks a silent turn back to
 * legacy.
 */
async function fallThroughToHandoff(
  supabase: SupabaseClient,
  args: { customerId: string; consultantId: string; error: unknown },
): Promise<void> {
  const message = args.error instanceof Error
    ? args.error.message
    : String(args.error);
  const reason = "engine_v3_error";
  // 1. Pause the customer (idempotent — bot_paused already true is fine).
  try {
    await supabase
      .from("customers")
      .update({
        bot_paused: true,
        bot_paused_reason: reason,
        bot_paused_at: new Date().toISOString(),
      })
      .eq("id", args.customerId);
  } catch (_) {/* swallow */}
  // 2. Insert handoff alert.
  try {
    await supabase.from("bot_handoff_alerts").insert({
      customer_id: args.customerId,
      consultant_id: args.consultantId,
      reason,
      metadata: {
        source: "engine_v3_webhook_entry",
        error: message,
      },
    });
  } catch (_) {/* swallow */}
  // 3. Engine log row so the daily rollout cron sees the failure.
  try {
    await supabase.from("engine_logs").insert({
      at: new Date().toISOString(),
      kind: "engine_safe_text",
      customer_id: args.customerId,
      flow_id: null,
      step_id: null,
      payload: { branch: "webhook_entry_error", error: message },
      side_effect: { kind: "insert_handoff_alert", reason },
    });
  } catch (_) {/* swallow */}
}

/**
 * Single-turn engine v3 dispatch. Webhook callers invoke this only when
 * `isEngineV3Enabled(supabase, consultantId)` returned `true` — the
 * helper is intentionally side-effecting (loads context, runs the
 * engine, writes to DB). It NEVER throws; all failures are caught and
 * routed to `fallThroughToHandoff`.
 */
/**
 * Build a normalized inbound row for `conversations`. Returns null when
 * the webhook (legacy code path) already inserted it; this helper trusts
 * the caller to pass `inboundAlreadyLogged: true` in that case via the
 * absence of inboundLog. For v3-only paths, we always log here so the
 * ChatView mirrors the user's message.
 */
function buildInboundLog(parsed: V3WebhookEntryInbound):
  | { text: string; type: "text" | "audio" | "image" | "video" | "document" | "button" }
  | null
{
  if (parsed.isButton) {
    return { text: parsed.messageText || `[botão:${parsed.buttonId ?? ""}]`, type: "button" };
  }
  if (parsed.hasAudio) return { text: "[áudio]", type: "audio" };
  if (parsed.hasImage) return { text: "[imagem]", type: "image" };
  if (parsed.hasDocument) return { text: "[arquivo]", type: "document" };
  if (parsed.isFile) return { text: "[arquivo]", type: "document" };
  if (parsed.messageText) return { text: parsed.messageText, type: "text" };
  return null;
}

export async function runUnifiedEngineWebhookEntry(
  args: V3WebhookEntryArgs,
): Promise<V3WebhookEntryResult> {
  try {
    // Pre-engine: ensure capture_mode='auto' so the legacy
    // `manual_capture_text_saved_no_auto_flow` short-circuit doesn't
    // kick in for v3-driven leads. The default-trigger sets manual on
    // INSERT for leads without name+cpf; for v3 we always want auto.
    try {
      await args.supabase
        .from("customers")
        .update({ capture_mode: "auto" })
        .eq("id", args.customerId)
        .neq("capture_mode", "auto");
    } catch (_) {/* swallow */}

    // Pre-engine: nome público do consultor p/ {{representante}}.
    // Nunca slug/login (silviaclaudiaalmeida) nem display de outra pessoa.
    let consultantName: string | null = null;
    try {
      const { resolvePublicConsultantLabel } = await import("../consultant-public-label.ts");
      const { data: cRow } = await args.supabase
        .from("consultants")
        .select("name, display_name")
        .eq("id", args.consultantId)
        .maybeSingle();
      const label = resolvePublicConsultantLabel(
        (cRow as { name?: string | null } | null)?.name,
        (cRow as { display_name?: string | null } | null)?.display_name,
        "",
      );
      consultantName = label || null;
    } catch (_) {/* swallow */}

    const ctx = await loadContext({
      supabase: args.supabase,
      customerId: args.customerId,
      capabilities: args.adapter.capabilities,
    });
    const inbound = toInboundEvent(args.inbound);
    const config = makeConfig();
    const hooks = makeHooks();

    const result = runEngine({
      state: ctx.state,
      inbound,
      flow: ctx.flow,
      capabilities: ctx.capabilities,
      hooks,
      config,
    });

    // C3: anexa warnings do loader (ex: engine_audio_slot_missing) ao
    // result.logs para que o dispatcher persista em `engine_logs`.
    if (ctx.warnings && ctx.warnings.length > 0) {
      result.logs.push(...ctx.warnings);
    }

    const inboundLog = buildInboundLog(args.inbound);

    const outcome = await executeActions({
      supabase: args.supabase,
      adapter: args.adapter,
      jid: args.jid,
      state: ctx.state,
      result,
      now: config.now,
      testRunId: args.testRunId ?? null,
      testTurn: args.testTurn ?? null,
      inboundLog,
      consultantName,
    });

    // ─── Deferred AI answer: resolve + re-emit step buttons ──────────
    if (result.deferred?.kind === "ai_answer" && result.deferred.thenRepeatStep) {
      try {
        const { answerFaqWithAI } = await import("../ai-faq-answerer.ts");
        const faq = await answerFaqWithAI({
          supabase: args.supabase,
          question: result.deferred.question,
          consultantId: args.consultantId,
          leadName: ctx.state.customer.name ?? "",
          currentStepLabel: result.deferred.stepId,
        });
        if (faq.text) {
          const qSlug = encodeURIComponent(result.deferred.question.trim().slice(0, 120));
          await args.adapter.sendText(args.jid, faq.text, {
            customerId: args.customerId,
            consultantId: args.consultantId,
            stepId: result.deferred.stepId,
            idempotencyKey: `deferred_faq:${args.customerId}:${result.deferred.stepId}:${qSlug}`,
          });
        }
        // Re-emit ONLY the current step's choice (buttons), not the full
        // step prompt — senão o lead recebe a resposta da FAQ + o texto do
        // passo repetido a cada dúvida (verboso). Filtramos o outbound para
        // manter apenas `kind: "choice"`.
        if (!faq.shouldHandoff) {
          const postState = { ...ctx.state, ...result.stateUpdate };
          const repeatResult = runEngine({
            state: postState,
            inbound: { kind: "no_input" } as InboundEvent,
            flow: ctx.flow,
            capabilities: ctx.capabilities,
            hooks,
            config,
          });
          const choiceOnly = repeatResult.outbound.filter((o) => o.kind === "choice");
          if (choiceOnly.length > 0) {
            await executeActions({
              supabase: args.supabase,
              adapter: args.adapter,
              jid: args.jid,
              state: postState,
              result: { ...repeatResult, outbound: choiceOnly },
              now: config.now,
              testRunId: args.testRunId ?? null,
              testTurn: args.testTurn ?? null,
              inboundLog: null,
              consultantName,
            });
          }
        }
      } catch (e: unknown) {
        console.warn("[v3-deferred] ai_answer resolution failed:", e instanceof Error ? e.message : String(e));
      }
    }

    // ─── CRM Kanban sync: advance deal stage based on new step ────────
    const postStepId = result.stateUpdate.currentStepId ?? ctx.state.currentStepId;
    try {
      if (postStepId) {
        await syncCustomerStage(args.supabase, {
          customerId: args.customerId,
          stepKeyAfter: postStepId,
          consultantId: args.consultantId,
        });
      }
    } catch (e: any) {
      console.warn("[v3-webhook-entry] crm-stage-sync failed (non-fatal):", e?.message);
      // M5: persiste falha em engine_logs para a view de saúde contabilizar.
      try {
        await args.supabase.from("engine_logs").insert({
          at: new Date().toISOString(),
          kind: "engine_crm_sync_failed",
          customer_id: args.customerId,
          flow_id: ctx.flow.id,
          step_id: postStepId,
          payload: { error: e?.message ?? String(e), post_step_id: postStepId },
        });
      } catch (_) {/* last resort */}
    }

    return {
      handled: true,
      sent: outcome.sent,
      failed: outcome.failed,
      ok: true,
    };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[engine-v3-webhook-entry] error: ${message}`);
    await fallThroughToHandoff(args.supabase, {
      customerId: args.customerId,
      consultantId: args.consultantId,
      error: e,
    });
    return { handled: true, sent: 0, failed: 0, ok: false, error: message };
  }
}
