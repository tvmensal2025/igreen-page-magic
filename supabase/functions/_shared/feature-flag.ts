// Feature flag helper for the WhatsApp Flow Reliability v2 rollout.
//
// Reads the `consultants.flow_reliability_v2` column and exposes simple
// helpers for gating new behavior. The value is cached in-process for 30s
// so the new code paths can call it on hot paths (every webhook turn) without
// hammering Postgres. Cache is keyed by consultant_id; all callers within
// the same Edge Function instance share it.
//
// Rollout values:
//   - 'off'    → legacy path; v2 code must not run.
//   - 'dark'   → v2 path computed in parallel for logging only; legacy path emits.
//   - 'canary' → v2 path is the source of truth (small whitelist of consultants).
//   - 'on'     → v2 path is the source of truth (full rollout).
//
// Rollback is `UPDATE consultants SET flow_reliability_v2='off' WHERE id=...`.
// The 30s cache means it can take up to 30s for an instance to pick up the
// new value, which is acceptable per design §8 (rollout plan).

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type FlowReliabilityV2Flag = "off" | "dark" | "canary" | "on";

const VALID_FLAGS: ReadonlySet<FlowReliabilityV2Flag> = new Set([
  "off",
  "dark",
  "canary",
  "on",
]);

const DEFAULT_FLAG: FlowReliabilityV2Flag = "off";

/** Cache TTL in milliseconds. Exported for documentation / tests. */
export const FEATURE_FLAG_CACHE_TTL_MS = 30_000;

interface CacheEntry {
  value: FlowReliabilityV2Flag;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function isFlowReliabilityV2Flag(v: unknown): v is FlowReliabilityV2Flag {
  return typeof v === "string" && VALID_FLAGS.has(v as FlowReliabilityV2Flag);
}

/**
 * Returns the rollout flag for a consultant, caching the value in-process
 * for 30 seconds. Any error (missing row, RPC failure, invalid enum value)
 * collapses to the safe default `'off'`, which means the legacy path runs.
 *
 * The function never throws.
 */
export async function getFlowReliabilityV2(
  supabase: SupabaseClient,
  consultantId: string,
): Promise<FlowReliabilityV2Flag> {
  if (!consultantId) return DEFAULT_FLAG;

  const now = Date.now();
  const cached = cache.get(consultantId);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  let resolved: FlowReliabilityV2Flag = DEFAULT_FLAG;
  try {
    const { data, error } = await supabase
      .from("consultants")
      .select("flow_reliability_v2")
      .eq("id", consultantId)
      .single();

    if (!error && data && isFlowReliabilityV2Flag((data as any).flow_reliability_v2)) {
      resolved = (data as any).flow_reliability_v2 as FlowReliabilityV2Flag;
    }
  } catch {
    // fail-closed to 'off'; never propagate
    resolved = DEFAULT_FLAG;
  }

  cache.set(consultantId, {
    value: resolved,
    expiresAt: now + FEATURE_FLAG_CACHE_TTL_MS,
  });
  return resolved;
}

/** True when the new path should be the source of truth (canary or on). */
export function isV2Active(flag: FlowReliabilityV2Flag): boolean {
  return flag === "canary" || flag === "on";
}

/** True when the new path should compute-but-not-emit (dark launch). */
export function isV2Dark(flag: FlowReliabilityV2Flag): boolean {
  return flag === "dark";
}

/** True when the new path should run at all (dark, canary, or on). */
export function isV2Enabled(flag: FlowReliabilityV2Flag): boolean {
  return flag === "dark" || flag === "canary" || flag === "on";
}

/** Test helper: drops the in-memory cache so tests start clean. */
export function clearFeatureFlagCache(): void {
  cache.clear();
  engineV3Cache.clear();
}

// ─── flow_engine_v3 (Phase C Task 20 do whatsapp-flow-architecture-v3) ──────
//
// Mesmo padrão do `flow_reliability_v2`. Cache 30s in-process.
//
// ROLLBACK EM SEGUNDOS (Cérebro IA — Requisito 2.6 / Tarefa 14.3)
// ---------------------------------------------------------------
// A resposta real do Cérebro é gateada por esta flag (via
// `deveResponderComCerebro` → `isV2Active`). Para DESLIGAR o Cérebro a qualquer
// momento basta baixar a flag do consultor (`canary`/`on` → `dark`/`off`) — pelo
// RolloutPanel ("Rollback global", que zera todos) ou por um `UPDATE` por
// consultor. NÃO precisa de deploy: na próxima leitura não-cacheada o gate passa
// a devolver `false` e o caminho atual (vendedora) volta a responder.
//
// Propagação: o cache é in-process e dura no máximo `FEATURE_FLAG_CACHE_TTL_MS`
// (30s) por instância de Edge Function. Logo, o pior caso de propagação do
// rollback é ~30s ("em segundos"), limitado e seguro — o default em erro/ausência
// é `off`, nunca "fica ligado". Esse limite de 30s é aceito pelo design (§8,
// plano de rollout) e por isso o TTL NÃO é encurtado: encurtá-lo adicionaria um
// round-trip ao Postgres em todo turno do caminho normal (cada webhook), o que
// o cache existe justamente para evitar. Quando for preciso forçar a
// invalidação no mesmo processo (ex.: testes, ou um ponto de rollback que rode
// na mesma instância), use `clearFlowEngineV3Cache()`.

export type FlowEngineV3Flag = FlowReliabilityV2Flag;

const engineV3Cache = new Map<string, CacheEntry>();

/**
 * Invalida o cache in-process da flag `flow_engine_v3` (sem tocar no cache de
 * `flow_reliability_v2`). Útil para forçar releitura imediata da flag — por
 * exemplo, num rollback que precise valer no mesmo processo sem esperar o TTL,
 * ou em testes. O caminho normal continua usando o cache de 30s intacto.
 */
export function clearFlowEngineV3Cache(): void {
  engineV3Cache.clear();
}

export async function getFlowEngineV3(
  supabase: SupabaseClient,
  consultantId: string,
): Promise<FlowEngineV3Flag> {
  if (!consultantId) return DEFAULT_FLAG;

  const now = Date.now();
  const cached = engineV3Cache.get(consultantId);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  let resolved: FlowEngineV3Flag = DEFAULT_FLAG;
  try {
    const { data, error } = await supabase
      .from("consultants")
      .select("flow_engine_v3")
      .eq("id", consultantId)
      .single();

    if (!error && data && isFlowReliabilityV2Flag((data as any).flow_engine_v3)) {
      resolved = (data as any).flow_engine_v3 as FlowEngineV3Flag;
    }
  } catch {
    resolved = DEFAULT_FLAG;
  }

  engineV3Cache.set(consultantId, {
    value: resolved,
    expiresAt: now + FEATURE_FLAG_CACHE_TTL_MS,
  });
  return resolved;
}
