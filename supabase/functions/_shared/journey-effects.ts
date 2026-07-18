/**
 * Jornada A/B/C — efeitos idempotentes, runs e orquestrador atômico.
 *
 * Autoridades (PLANO_CORRECAO_AUTOMACOES_SEM_DESLIGAR):
 * - `outbound_effects` decide se um efeito externo já foi tentado/enviado.
 * - `reserve_proactive_touch` decide se um motor pode tocar o cliente agora.
 * - `automation_runs` correlaciona tudo (run_id).
 *
 * Regra de ouro: erro de banco ANTES do provider = NÃO ENVIAR (fail-closed).
 * Timeout DEPOIS do provider = `unknown` (nunca repetir cegamente).
 */

// deno-lint-ignore no-explicit-any
type SB = any;

export type EffectStatus =
  | "reserved" | "sending" | "sent" | "delivered" | "suppressed"
  | "failed_retryable" | "failed_final" | "unknown" | "released";

export type ReserveEffectResult =
  | { canSend: true; effectId: string }
  | { canSend: false; effectId: string | null; status: EffectStatus | "error"; reason: string };

export interface ReserveEffectInput {
  idempotencyKey: string;
  engineKey: string;
  channel: "whatsapp" | "sms" | "voice" | "meta_audience" | "notification" | "email" | "system";
  customerId?: string | null;
  consultantId?: string | null;
  journeyId?: string | null;
  stage?: string | null;
  stageSequence?: number | null;
  provider?: string | null;
  templateKey?: string | null;
  runId?: string | null;
  claimId?: string | null;
  actionKey?: string | null;
}

/**
 * Reserva o efeito lógico. FAIL-CLOSED: qualquer erro → canSend=false.
 *
 * A RPC já resolve todos os casos atomicamente:
 * - novo → acquired=true (reserved);
 * - released/failed_retryable → CAS interno (attempt+1) → acquired=true p/ 1 worker;
 * - sent/delivered/sending/reserved/unknown/suppressed/failed_final → acquired=false.
 */
export async function reserveOutboundEffect(
  supabase: SB,
  input: ReserveEffectInput,
): Promise<ReserveEffectResult> {
  try {
    const { data, error } = await supabase.rpc("reserve_outbound_effect", {
      p_idempotency_key: input.idempotencyKey,
      p_engine_key: input.engineKey,
      p_channel: input.channel,
      p_customer_id: input.customerId ?? null,
      p_consultant_id: input.consultantId ?? null,
      p_journey_id: input.journeyId ?? null,
      p_stage: input.stage ?? null,
      p_stage_sequence: input.stageSequence ?? null,
      p_provider: input.provider ?? null,
      p_template_key: input.templateKey ?? null,
      p_run_id: input.runId ?? null,
      p_claim_id: input.claimId ?? null,
      p_action_key: input.actionKey ?? null,
    });
    if (error) {
      console.error("[journey-effects] reserve failed (fail-closed)", error.message);
      return { canSend: false, effectId: null, status: "error", reason: `db_error:${error.code || "?"}` };
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      return { canSend: false, effectId: null, status: "error", reason: "empty_result" };
    }
    if (row.acquired) {
      return { canSend: true, effectId: row.effect_id };
    }
    const status = String(row.current_status || "") as EffectStatus;
    return {
      canSend: false,
      effectId: row.effect_id ?? null,
      status,
      reason: `already_${status || "exists"}`,
    };
  } catch (e) {
    console.error("[journey-effects] reserve threw (fail-closed)", (e as Error).message);
    return { canSend: false, effectId: null, status: "error", reason: "exception" };
  }
}

/** Marca o efeito como sending imediatamente antes de chamar o provider. */
export async function markEffectSending(supabase: SB, effectId: string): Promise<void> {
  try {
    await supabase.rpc("finish_outbound_effect", {
      p_effect_id: effectId,
      p_to_status: "sending",
      p_from_status: ["reserved"],
    });
  } catch { /* best-effort: efeito continua reserved */ }
}

/**
 * Finaliza o efeito após a resposta do provider.
 * outcome:
 * - sent           → provider confirmou
 * - failed_retryable → falha ANTES de chegar ao provedor (pode re-tentar)
 * - failed_final   → falha definitiva
 * - unknown        → timeout/ambíguo DEPOIS do provider (não repetir)
 * - suppressed     → guard bloqueou depois da reserva
 */
export async function finishOutboundEffect(
  supabase: SB,
  effectId: string,
  outcome: "sent" | "delivered" | "failed_retryable" | "failed_final" | "unknown" | "suppressed" | "released",
  detail?: {
    providerRequestId?: string | null;
    providerMessageId?: string | null;
    providerStatus?: string | null;
    errorCode?: string | null;
  },
): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("finish_outbound_effect", {
      p_effect_id: effectId,
      p_to_status: outcome,
      p_from_status: ["reserved", "sending"],
      p_provider_request_id: detail?.providerRequestId ?? null,
      p_provider_message_id: detail?.providerMessageId ?? null,
      p_provider_status: detail?.providerStatus ?? null,
      p_error_code: detail?.errorCode ?? null,
    });
    if (error) {
      console.error("[journey-effects] finish failed", effectId, outcome, error.message);
      return false;
    }
    return Boolean(data);
  } catch (e) {
    console.error("[journey-effects] finish threw", (e as Error).message);
    return false;
  }
}

// ─── Orquestrador atômico ───────────────────────────────────────────────────

export type TouchReservation =
  | { allowed: true; reservationId: number; claimToken: string; orchestratorOff: boolean }
  | { allowed: false; blockedBy: string | null; reason: string };

/**
 * Reserva atômica do direito de tocar o cliente (substitui o par
 * gateProactiveTouch + recordProactiveTouch check-then-insert).
 * FAIL-CLOSED: erro de banco → não tocar.
 */
export async function reserveProactiveTouch(
  supabase: SB,
  customerId: string,
  sourceKey: string,
  meta: Record<string, unknown> = {},
): Promise<TouchReservation> {
  try {
    const { data, error } = await supabase.rpc("reserve_proactive_touch", {
      p_customer_id: customerId,
      p_source_key: sourceKey,
      p_meta: meta,
    });
    if (error) {
      console.error("[journey-effects] reserve_proactive_touch failed (fail-closed)", error.message);
      return { allowed: false, blockedBy: null, reason: `db_error:${error.code || "?"}` };
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return { allowed: false, blockedBy: null, reason: "empty_result" };
    if (row.allowed) {
      return {
        allowed: true,
        reservationId: Number(row.reservation_id),
        claimToken: String(row.claim_token),
        orchestratorOff: row.reason === "reserved_orchestrator_off",
      };
    }
    return { allowed: false, blockedBy: row.blocked_by ?? null, reason: String(row.reason || "blocked") };
  } catch (e) {
    console.error("[journey-effects] reserve_proactive_touch threw (fail-closed)", (e as Error).message);
    return { allowed: false, blockedBy: null, reason: "exception" };
  }
}

/** Fecha a reserva do orquestrador: done (tocou) ou released (não tocou). */
export async function finishProactiveTouch(
  supabase: SB,
  reservationId: number,
  claimToken: string,
  outcome: "done" | "released",
): Promise<void> {
  try {
    await supabase.rpc("finish_proactive_touch", {
      p_reservation_id: reservationId,
      p_claim_token: claimToken,
      p_outcome: outcome,
    });
  } catch (e) {
    console.warn("[journey-effects] finish_proactive_touch failed", (e as Error).message);
  }
}

// ─── Runs ───────────────────────────────────────────────────────────────────

/** Abre um automation_run (best-effort: nunca bloqueia o motor). */
export async function startAutomationRun(
  supabase: SB,
  engineKey: string,
  opts: { triggerKind?: string; mode?: string; authReason?: string | null } = {},
): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc("start_automation_run", {
      p_engine_key: engineKey,
      p_trigger_kind: opts.triggerKind ?? "cron",
      p_mode: opts.mode ?? "enforced",
      p_auth_reason: opts.authReason ?? null,
      p_worker_id: null,
    });
    if (error) return null;
    return (data as string) ?? null;
  } catch {
    return null;
  }
}

/** Fecha o run com contadores (best-effort). */
export async function finishAutomationRun(
  supabase: SB,
  runId: string | null,
  status: "completed" | "partial" | "failed" | "aborted",
  counters: Record<string, number> = {},
  errorCode?: string | null,
): Promise<void> {
  if (!runId) return;
  try {
    await supabase.rpc("finish_automation_run", {
      p_run_id: runId,
      p_status: status,
      p_counters: counters,
      p_error_code: errorCode ?? null,
    });
  } catch { /* best-effort */ }
}

// ─── Dead letter ────────────────────────────────────────────────────────────

export async function pushDeadLetter(
  supabase: SB,
  input: {
    engineKey: string;
    logicalKey?: string | null;
    effectId?: string | null;
    customerId?: string | null;
    reasonCode: string;
    attempts?: number;
    meta?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await supabase.from("automation_dead_letter").insert({
      engine_key: input.engineKey,
      logical_key: input.logicalKey ?? null,
      effect_id: input.effectId ?? null,
      customer_id: input.customerId ?? null,
      reason_code: input.reasonCode,
      attempts: input.attempts ?? 0,
      meta: input.meta ?? {},
    });
  } catch (e) {
    console.error("[journey-effects] dead_letter insert failed", (e as Error).message);
  }
}

// ─── Chaves lógicas canônicas ───────────────────────────────────────────────

/** Chave da cadência: jornada + estágio + sequência + canal (sem timestamps). */
export function cadenceEffectKey(
  journeyId: string,
  stage: string,
  stageSequence: number,
  channel: string,
): string {
  return `journey:${journeyId}:${stage}:${stageSequence}:${channel}`;
}

/** Chave de SMS fallback de ligação: um por target/tentativa terminal. */
export function voiceFallbackSmsKey(targetId: string, terminalAttempt: number): string {
  return `voice_fallback_sms:${targetId}:${terminalAttempt}`;
}

/** Chave de sincronização Meta: cliente + audiência + versão de associação. */
export function metaAudienceKey(
  customerId: string,
  audienceId: string,
  membershipVersion: number | string,
): string {
  return `meta_audience:${customerId}:${audienceId}:${membershipVersion}`;
}

/** Turno comercial BRT persistível (não usar Date.now() em chave). */
export function businessShiftBRT(now: Date = new Date()): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const day = `${parts.find((p) => p.type === "year")?.value}-${parts.find((p) => p.type === "month")?.value}-${parts.find((p) => p.type === "day")?.value}`;
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const shift = hour < 12 ? "manha" : "tarde";
  return `${day}:${shift}`;
}

/** Chave de ligação criada por fluxo: cliente + step + turno comercial. */
export function makeCallKey(customerId: string, stepKey: string, shift?: string): string {
  return `make_call:${customerId}:${stepKey}:${shift ?? businessShiftBRT()}`;
}
