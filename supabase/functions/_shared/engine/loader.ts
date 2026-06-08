/**
 * Engine v3 context loader.
 *
 * Spec: `.kiro/specs/flow-engine-v3-rewrite/design.md` §1.2 (component
 * map: `v3-loader.ts`) and §2.1 (CustomerSnapshot / BotFlow shape).
 * Task: 25.
 *
 * Single round-trip from Supabase: reads `customer_flow_state` joined
 * with `customers`, the consultor's active flow + steps, and resolves
 * `mediaOrderByStepKey` from `consultants.flow_step_media_order`.
 *
 * This module is impure (touches the DB). The engine never imports it —
 * the router does, and passes the loaded context into `runEngine`.
 *
 * Validates: Requirements 1.6, 1.7, 11.1, 11.5, 12.1, 16.1.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type {
  BotFlow,
  BotFlowStep,
  CaptureSpec,
  ChannelCapabilities,
  CustomerSnapshot,
  FallbackSpec,
  MediaOrderEntry,
  TransitionSpec,
} from "./types.ts";

export interface LoadedContext {
  state: CustomerSnapshot;
  flow: BotFlow;
  capabilities: ChannelCapabilities;
  /**
   * Avisos não-fatais detectados durante o load (ex: slot de áudio sem URL).
   * O dispatcher injeta-os em `engine_logs` junto com `result.logs`.
   */
  warnings?: import("./types.ts").StructuredLog[];
}

export interface LoadContextArgs {
  supabase: SupabaseClient;
  customerId: string;
  /** Channel adapter capabilities — passed in by the webhook entry. */
  capabilities: ChannelCapabilities;
}

/**
 * Loads the full context the engine needs for one tick. Throws when:
 *   - the customer does not exist
 *   - the customer's consultor has no active flow for the customer's variant
 *
 * The router is expected to catch and route to a 500 / fallback handler.
 */
export async function loadContext(args: LoadContextArgs): Promise<LoadedContext> {
  const { supabase, customerId, capabilities } = args;

  // ─── 1. Read customer + flow_state ─────────────────────────────────────
  const { data: customer, error: cErr } = await supabase
    .from("customers")
    .select(`
      id, consultant_id, flow_variant, name, electricity_bill_value,
      document_uploaded, otp_validated_at, phone_whatsapp,
      bot_paused, bot_paused_reason, conversation_step,
      customer_flow_state (
        current_step_id, status, pause_reason, retries,
        ai_questions_this_step,
        entered_step_at, expires_at, last_inbound_at,
        last_outbound_at, last_outbound_content_hash, flow_id, updated_at
      )
    `)
    .eq("id", customerId)
    .maybeSingle();

  if (cErr || !customer) {
    throw new Error(`v3-loader: customer ${customerId} not found: ${cErr?.message ?? "no row"}`);
  }

  const consultantId = customer.consultant_id as string;
  const variant = ((customer.flow_variant as string) || "A").toUpperCase() as "A" | "B" | "C" | "D";

  // Variant B = Vendedora V2 (IA livre). NUNCA carregar flow V3 para B —
  // o webhook deve bypassar o V3 antes de chamar o loader. Se chegou aqui,
  // é bug de roteamento e queremos falhar ruidosamente.
  if (variant === "B") {
    throw new Error("v3-loader: variant_b_should_not_reach_v3 — Fluxo B roda na Vendedora V2");
  }

  // ─── 2. Read active flow for variant ──────────────────────────────────
  // Respeita sync_mode='public': quando o consultor está em modo público,
  // lemos o flow PÚBLICO (mesma fonte que o engine legado via
  // resolveFlowId). Sem isso, este loader carregava o flow LOCAL do
  // consultor — que pode estar vazio ou desatualizado em relação ao
  // template público mantido pelo Super Admin.
  const { data: ownFlowRow } = await supabase
    .from("bot_flows")
    .select("id, strict_mode, variant, sync_mode, is_public, consultant_id")
    .eq("consultant_id", consultantId)
    .eq("variant", variant)
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  let flowRow: any = ownFlowRow;
  // mediaOwnerId determina de QUEM são as mídias (áudios/vídeos/imagens)
  // e o `flow_step_media_order`. Em sync_mode='public', tudo vem do dono
  // do flow público — assim qualquer consultor em modo público recebe
  // os MESMOS áudios/vídeos/imagens cadastrados pelo Super Admin.
  let mediaOwnerId: string = consultantId;

  const ownSyncMode = String((ownFlowRow as any)?.sync_mode ?? "public").toLowerCase();
  if (!ownFlowRow || ownSyncMode === "public") {
    const { data: pub } = await supabase
      .from("bot_flows")
      .select("id, strict_mode, variant, sync_mode, is_public, consultant_id")
      .eq("is_public", true)
      .eq("is_active", true)
      .eq("variant", variant)
      .limit(1)
      .maybeSingle();
    if (pub) {
      flowRow = pub;
      mediaOwnerId = (pub as any).consultant_id as string;
    }
  }

  if (!flowRow) {
    throw new Error(`v3-loader: no active flow for consultant=${consultantId} variant=${variant}`);
  }

  // ─── 3. Read steps ─────────────────────────────────────────────────────
  const { data: stepRows } = await supabase
    .from("bot_flow_steps")
    .select("*")
    .eq("flow_id", flowRow.id)
    .eq("is_active", true)
    .order("position", { ascending: true });

  const stepsRaw = (stepRows as any[]) || [];
  const stepIds = stepsRaw.map((s) => s.id as string);

  // ─── 4. Read media owner's flow_step_media_order ──────────────────────
  // Em sync_mode='public', mediaOwnerId = consultant dono do flow público
  // (não o caller). Garante paridade total de mídia entre consultores.
  const { data: consultantRow } = await supabase
    .from("consultants")
    .select("flow_step_media_order")
    .eq("id", mediaOwnerId)
    .maybeSingle();

  const mediaOrderJson = (consultantRow?.flow_step_media_order as Record<string, unknown>) || {};

  // ─── 4b. Read ai_media_library — media owner + public, active only ───
  // Em sync_mode='public', filtra pelo consultant dono do flow público
  // (mediaOwnerId), não pelo caller. Sem isso, consultores em modo público
  // só recebiam o subconjunto `is_public=true` (vs. o catálogo cheio do
  // Super Admin marcado como pessoal).
  const { data: mediaLib } = await supabase
    .from("ai_media_library")
    .select("id, kind, url, slot_key, send_order, duration_sec, is_public, consultant_id")
    .or(`consultant_id.eq.${mediaOwnerId},is_public.eq.true`)
    .eq("active", true);

  const mediaBySlotAndKind = new Map<string, Map<string, {
    url: string;
    durationSec: number | null;
    isPublic: boolean;
  }>>();
  for (const m of (mediaLib as any[]) || []) {
    const slot = m.slot_key as string | null;
    if (!slot) continue;
    if (!mediaBySlotAndKind.has(slot)) {
      mediaBySlotAndKind.set(slot, new Map());
    }
    const slotMap = mediaBySlotAndKind.get(slot)!;
    // Personal trumps public (we may have both).
    const existing = slotMap.get(m.kind);
    if (!existing || (existing.isPublic && !m.is_public)) {
      slotMap.set(m.kind, {
        url: m.url,
        durationSec: m.duration_sec ?? null,
        isPublic: !!m.is_public,
      });
    }
  }

  function resolveMediaForSlot(
    slotKey: string,
    kind: "audio" | "image" | "video" | "document",
  ): { url: string; durationSec: number | null } | null {
    const slotMap = mediaBySlotAndKind.get(slotKey);
    if (!slotMap) return null;
    const m = slotMap.get(kind);
    return m ? { url: m.url, durationSec: m.durationSec } : null;
  }

  // ─── 4c. Build mediaOrderByStepKey resolving each entry to real URL ───
  // For each step, look up `flow_step_media_order` using a precedence
  // chain so the consultor's configuration works regardless of how
  // they keyed it:
  //   1) step.step_key (e.g. "d_welcome")
  //   2) step.slot_key (e.g. "como_funciona")
  //   3) step.step_key without leading "d_" (welcome, como_funciona)
  //   4) step.step_key without leading "v_a_" / "v_b_" / "v_d_" prefixes
  // The slot_key for ai_media_library lookup uses the same chain.
  const warnings: import("./types.ts").StructuredLog[] = [];
  const nowIso = new Date().toISOString();
  const mediaOrderByStepKey: Record<string, MediaOrderEntry[]> = {};
  for (const stepRow of stepsRaw as any[]) {
    const stepKey = stepRow.step_key as string | null;
    if (!stepKey) continue;
    const slotKey = (stepRow.slot_key as string | null) || null;
    const stepText = (stepRow.message_text as string | null) || "";

    // Build candidate lookup keys for both the order map AND the slot match.
    const stripped = stepKey.replace(/^([a-z]_|v_[a-d]_|d_)/i, "");
    const candidates = Array.from(new Set([
      stepKey,
      slotKey,
      stripped,
    ].filter(Boolean) as string[]));

    // Find the first candidate that has an order configured.
    let entries: unknown[] | null = null;
    let resolvedSlot: string = stepKey;
    for (const c of candidates) {
      const e = mediaOrderJson[c];
      if (Array.isArray(e) && e.length > 0) {
        entries = e;
        resolvedSlot = c;
        break;
      }
    }
    if (!entries) continue;

    // Resolve each entry. Bare strings ("audio"/"image"/"video"/"text"/"document")
    // are ordering hints — look up real file in ai_media_library by
    // candidate slot keys (in same precedence). Rich objects with
    // {kind, url|media_id|text} are honored as-is.
    const resolved: MediaOrderEntry[] = [];
    for (const raw of entries) {
      // Bare string entry.
      if (typeof raw === "string") {
        if (raw === "text") {
          if (stepText) {
            resolved.push({ kind: "text", text: stepText } as MediaOrderEntry);
          }
          continue;
        }
        if (raw === "audio" || raw === "image" || raw === "video" || raw === "document") {
          // Try each candidate slot until we find a match.
          let found: { url: string; durationSec: number | null } | null = null;
          for (const c of candidates) {
            const m = resolveMediaForSlot(c, raw);
            if (m) { found = m; break; }
          }
          if (found) {
            resolved.push({
              kind: raw,
              url: found.url,
              durationSec: found.durationSec ?? undefined,
            } as MediaOrderEntry);
          } else if (raw === "audio") {
            // C3: áudio sem URL na ai_media_library. Fallback gracioso
            // para texto (se existir) e registra warning para auditoria.
            if (stepText) {
              resolved.push({ kind: "text", text: stepText } as MediaOrderEntry);
            }
            warnings.push({
              kind: "engine_audio_slot_missing",
              at: nowIso,
              customerId,
              flowId: flowRow.id as string,
              stepId: stepRow.id as string,
              payload: { slot_candidates: candidates, fell_back_to: stepText ? "text" : "skip" },
            });
          }
          continue;
        }
        continue;
      }
      // Rich object entry.
      if (raw && typeof raw === "object") {
        const o = raw as Record<string, unknown>;
        const k = typeof o.kind === "string" ? o.kind : undefined;
        if (!k) continue;
        if (typeof o.url === "string") {
          resolved.push(raw as MediaOrderEntry);
          continue;
        }
        if (typeof o.media_id === "string") {
          const found = ((mediaLib as any[]) || []).find((m) => m.id === o.media_id);
          if (found?.url) {
            resolved.push({
              kind: k as MediaOrderEntry["kind"],
              url: found.url,
              durationSec: found.duration_sec ?? undefined,
            } as MediaOrderEntry);
          }
          continue;
        }
        if (k === "text") {
          if (stepText) resolved.push({ kind: "text", text: stepText } as MediaOrderEntry);
          continue;
        }
        if (k === "audio" || k === "image" || k === "video" || k === "document") {
          let found: { url: string; durationSec: number | null } | null = null;
          for (const c of candidates) {
            const m = resolveMediaForSlot(c, k);
            if (m) { found = m; break; }
          }
          if (found) {
            resolved.push({
              kind: k,
              url: found.url,
              durationSec: found.durationSec ?? undefined,
            } as MediaOrderEntry);
          } else if (k === "audio") {
            if (stepText) {
              resolved.push({ kind: "text", text: stepText } as MediaOrderEntry);
            }
            warnings.push({
              kind: "engine_audio_slot_missing",
              at: nowIso,
              customerId,
              flowId: flowRow.id as string,
              stepId: stepRow.id as string,
              payload: { slot_candidates: candidates, fell_back_to: stepText ? "text" : "skip" },
            });
          }
        }
      }
    }

    // Index by step.step_key so variantA's
    // `flow.mediaOrderByStepKey[step.stepKey]` lookup hits.
    if (resolved.length > 0) {
      mediaOrderByStepKey[stepKey] = resolved;
    }
  }

  // ─── 5. Materialize BotFlowStep[] ──────────────────────────────────────
  const steps: BotFlowStep[] = stepsRaw.map((s) => ({
    id: s.id,
    flowId: s.flow_id,
    stepKey: s.step_key ?? null,
    stepType: s.step_type,
    position: Number(s.position) || 0,
    messageText: s.message_text ?? null,
    persuasiveText: s.persuasive_text ?? null,
    choiceOptions: extractChoiceOptions(s.captures),
    preferredChoiceKind: s.preferred_choice_kind ?? null,
    captures: parseCaptures(s.captures),
    transitions: parseTransitions(s.transitions),
    fallback: parseFallback(s.fallback),
    waitFor: (s.wait_for as BotFlowStep["waitFor"]) ?? "none",
    waitSeconds: Number(s.wait_seconds) || 0,
    pipelineKind: pipelineKindFor(s.step_type),
    slotKey: s.slot_key ?? null,
    conditionExpr: s.condition_text ? { _raw: s.condition_text } : null,
    reachableStepIds: stepIds, // closed set — every step can transition to any other
  }));

  const flow: BotFlow = {
    id: flowRow.id as string,
    consultantId,
    variant,
    strictMode: !!(flowRow as any).strict_mode,
    steps,
    mediaOrderByStepKey,
  };

  // ─── 6. Materialize CustomerSnapshot ──────────────────────────────────
  const cfs = (customer.customer_flow_state as any) || {};
  // Normalize legacy `current_step_id` values: the trigger
  // `trg_create_customer_flow_state` copies `customers.conversation_step`
  // which may be the literal string "welcome" (not a UUID). The engine
  // expects either a valid UUID step id or null (new lead). Treat any
  // non-UUID value as null so `findFirstStep` kicks in.
  let resolvedStepId: string | null = cfs.current_step_id ?? null;
  if (resolvedStepId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(resolvedStepId)) {
    resolvedStepId = null;
  }
  const state: CustomerSnapshot = {
    customerId: customer.id as string,
    consultantId,
    flowId: flowRow.id as string,
    currentStepId: resolvedStepId,
    status: (cfs.status as CustomerSnapshot["status"]) ?? "new",
    pauseReason: cfs.pause_reason ?? null,
    retries: Number(cfs.retries) || 0,
    aiQuestionsThisStep: Number(cfs.ai_questions_this_step) || 0,
    enteredStepAt: cfs.entered_step_at ?? new Date(0).toISOString(),
    expiresAt: cfs.expires_at ?? null,
    lastInboundAt: cfs.last_inbound_at ?? null,
    lastOutboundAt: cfs.last_outbound_at ?? null,
    lastOutboundContentHash: cfs.last_outbound_content_hash ?? null,
    customer: {
      name: customer.name ?? null,
      electricityBillValue: customer.electricity_bill_value ?? null,
      documentUploaded: !!customer.document_uploaded,
      otpValidatedAt: customer.otp_validated_at ?? null,
      phoneWhatsapp: customer.phone_whatsapp ?? null,
    },
  };

  return { state, flow, capabilities, warnings: warnings.length > 0 ? warnings : undefined };
}

// ─── Parsers (defensive — shape of stored JSONB varies historically) ───

function parseCaptures(raw: unknown): CaptureSpec[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c): c is Record<string, unknown> => c !== null && typeof c === "object")
    .filter((c) => c.field !== "_buttons") // _buttons is the choice-options carve-out, not a real capture
    .map((c) => ({
      field: String(c.field ?? ""),
      enabled: c.enabled !== false,
      validator: (c.validator as CaptureSpec["validator"]) ?? undefined,
      required: c.required === true ? true : undefined,
    }));
}

function extractChoiceOptions(raw: unknown): BotFlowStep["choiceOptions"] {
  if (!Array.isArray(raw)) return null;
  for (const c of raw) {
    if (c && typeof c === "object" && (c as any).field === "_buttons") {
      const value = (c as any).value;
      if (Array.isArray(value)) {
        return value
          .filter((v): v is Record<string, unknown> => v !== null && typeof v === "object")
          .map((v) => ({
            id: String(v.id ?? ""),
            title: String(v.title ?? v.id ?? ""),
            description: typeof v.description === "string" ? v.description : undefined,
          }));
      }
    }
  }
  return null;
}

function parseTransitions(raw: unknown): TransitionSpec[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t): t is Record<string, unknown> => t !== null && typeof t === "object")
    .map((t) => ({
      trigger_intent: typeof t.trigger_intent === "string" ? t.trigger_intent : null,
      trigger_phrases: Array.isArray(t.trigger_phrases) ? t.trigger_phrases as string[] : null,
      goto_step_id: typeof t.goto_step_id === "string" ? t.goto_step_id : null,
      goto_special: (t.goto_special as TransitionSpec["goto_special"]) ?? null,
    }));
}

function parseFallback(raw: unknown): FallbackSpec {
  if (!raw || typeof raw !== "object") return { mode: "repeat" };
  const r = raw as Record<string, unknown>;
  const mode = (r.mode as FallbackSpec["mode"]) ?? "repeat";
  return {
    mode,
    goto_step_id: typeof r.goto_step_id === "string" ? r.goto_step_id : null,
    ai_prompt: typeof r.ai_prompt === "string" ? r.ai_prompt : undefined,
    max_questions: typeof r.max_questions === "number" ? r.max_questions : undefined,
    max_retries: typeof r.max_retries === "number" ? r.max_retries : undefined,
    on_fail: r.on_fail as FallbackSpec["on_fail"] ?? undefined,
    handoff_reason: typeof r.handoff_reason === "string" ? r.handoff_reason : undefined,
    then: r.then as FallbackSpec["then"] ?? undefined,
  };
}

function pipelineKindFor(stepType: string): BotFlowStep["pipelineKind"] {
  if (stepType === "capture_conta") return "ocr_conta";
  if (stepType === "capture_documento") return "ocr_documento";
  if (stepType === "finalizar_cadastro") return "finalizar_cadastro";
  if (stepType === "cadastro") return "cadastro_portal";
  return null;
}


/**
 * Normalize `flow_step_media_order` entries to canonical `MediaOrderEntry`
 * shape. Historically the column stores either rich objects
 * (`{kind: "audio", media_id: "..."}`) or bare strings
 * (`["audio","image","video","text"]`) declaring only the ordering.
 *
 * Variant A's `renderMediaItem` and Variant D's overlay both expect
 * `item.kind` — passing raw strings crashes with "Cannot read properties
 * of undefined (reading 'kind')". We coerce strings to
 * `{kind: "<string>", text: undefined, media_id: undefined}` so the
 * variant builders can decide whether to skip (no media_id) or render.
 *
 * Validates: Requirements 5.1, 5.5 (media ordering across variants).
 */
function normalizeMediaOrder(entries: unknown[]): MediaOrderEntry[] {
  const out: MediaOrderEntry[] = [];
  for (const e of entries) {
    if (e === null || e === undefined) continue;
    if (typeof e === "string") {
      // Bare string — interpret as kind hint only. media_id absent
      // means the variant builder MUST fall back to synthesis from
      // step.messageText (the renderer treats this as "skip").
      out.push({ kind: e as MediaOrderEntry["kind"] });
      continue;
    }
    if (typeof e === "object") {
      const o = e as Record<string, unknown>;
      const kind = typeof o.kind === "string" ? o.kind : undefined;
      if (!kind) continue;
      out.push({
        kind: kind as MediaOrderEntry["kind"],
        text: typeof o.text === "string" ? o.text : undefined,
        media_id: typeof o.media_id === "string" ? o.media_id : undefined,
      } as MediaOrderEntry);
    }
  }
  return out;
}
