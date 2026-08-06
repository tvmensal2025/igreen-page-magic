/**
 * Persistência do histórico de decisões do Cérebro (`ads_brain_decisions`).
 *
 * A reserva de execução é o ponto crítico: `INSERT ... ON CONFLICT DO NOTHING`
 * na coluna única `idempotency_key`. Quem conseguir inserir a linha ganhou o
 * direito de chamar a Meta; qualquer outra instância recebe zero linhas e
 * desiste. É a mesma técnica do outbox CAPI, feita no banco justamente porque
 * uma trava em memória não protege contra dois containers do cron.
 *
 * Toda escrita é tolerante a tabela ausente: enquanto a migration aditiva não
 * for aplicada, o Cérebro continua calculando e recomendando — só não guarda
 * histórico. Assim a branch não depende de migration executada.
 */
import type { BrainDecision } from "./brain-decide.ts";
import type { DecisionOutcome, MetaCallOutcome } from "./brain-execution.ts";
import { idempotencyKeyForDecision } from "./brain-execution.ts";

export const BRAIN_DECISIONS_TABLE = "ads_brain_decisions";

export type DecisionStatus =
  | "recommended"
  | "reserved"
  | "executed"
  | "failed"
  | "skipped";

type MinimalClient = {
  from: (table: string) => any;
};

/** `undefined` quando a tabela ainda não existe no banco. */
export type StoreResult<T> = { ok: boolean; data?: T; error?: string };

function isMissingTable(error: unknown): boolean {
  const message = String((error as { message?: string })?.message ?? error ?? "");
  const code = String((error as { code?: string })?.code ?? "");
  // 42P01 = undefined_table; PGRST205 = tabela fora do schema cache PostgREST.
  return code === "42P01" || code === "PGRST205" ||
    /does not exist|could not find the table/i.test(message);
}

export function decisionRowFromDecision(
  decision: BrainDecision,
  idempotencyKey: string,
  status: DecisionStatus,
) {
  return {
    consultant_id: decision.consultantId,
    campaign_id: decision.campaignId,
    snapshot_version: decision.snapshotVersion,
    action: decision.action,
    action_kind: decision.actionKind,
    mode: decision.canExecute ? "execute" : "recommend",
    waste_guard_mode: decision.wasteGuardMode,
    confidence: decision.confidence,
    sample_quality: decision.sample.quality,
    data_quality_state: decision.measured.dataQualityState,
    health: {
      data: decision.health.data.level,
      meta: decision.health.meta.level,
      commercial: decision.health.commercial.level,
      notes: {
        data: decision.health.data.notes,
        meta: decision.health.meta.notes,
        commercial: decision.health.commercial.notes,
      },
    },
    measured: decision.measured,
    blockers: decision.blockers,
    reason: decision.reason,
    next_evaluation: decision.nextEvaluation,
    from_budget_cents: decision.currentBudgetCents,
    to_budget_cents: decision.proposedBudgetCents,
    step_pct: decision.stepPct,
    status,
    idempotency_key: idempotencyKey,
    decided_at: decision.decidedAtIso,
  };
}

/** Grava a decisão como recomendação. Não reserva execução. */
export async function recordRecommendation(
  client: MinimalClient,
  decision: BrainDecision,
): Promise<StoreResult<{ id: string; idempotencyKey: string }>> {
  const idempotencyKey = await idempotencyKeyForDecision(decision);
  try {
    const { data, error } = await client
      .from(BRAIN_DECISIONS_TABLE)
      .upsert(
        decisionRowFromDecision(decision, idempotencyKey, "recommended"),
        { onConflict: "idempotency_key", ignoreDuplicates: true },
      )
      .select("id")
      .maybeSingle();
    if (error) {
      if (isMissingTable(error)) {
        return { ok: false, error: "tabela_ausente" };
      }
      return { ok: false, error: error.message };
    }
    return { ok: true, data: { id: data?.id ?? "", idempotencyKey } };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export type ExecutionReservation = {
  reserved: boolean;
  idempotencyKey: string;
  decisionId: string | null;
  reason: string;
};

/**
 * Reserva atômica do direito de executar.
 *
 * `ignoreDuplicates` faz o INSERT virar `ON CONFLICT DO NOTHING`: se a chave já
 * existe, `data` volta vazio e sabemos que outra instância (ou um retry) já
 * pegou esta execução.
 */
export async function reserveExecution(
  client: MinimalClient,
  decision: BrainDecision,
): Promise<ExecutionReservation> {
  const idempotencyKey = await idempotencyKeyForDecision(decision);
  try {
    const { data, error } = await client
      .from(BRAIN_DECISIONS_TABLE)
      .insert(decisionRowFromDecision(decision, idempotencyKey, "reserved"), {
        onConflict: "idempotency_key",
        ignoreDuplicates: true,
      })
      .select("id")
      .maybeSingle();
    if (error) {
      return {
        reserved: false,
        idempotencyKey,
        decisionId: null,
        reason: isMissingTable(error) ? "tabela_ausente" : error.message,
      };
    }
    if (!data?.id) {
      return {
        reserved: false,
        idempotencyKey,
        decisionId: null,
        reason: "ja_reservada",
      };
    }
    return {
      reserved: true,
      idempotencyKey,
      decisionId: data.id,
      reason: "reservada",
    };
  } catch (e) {
    return {
      reserved: false,
      idempotencyKey,
      decisionId: null,
      reason: (e as Error).message,
    };
  }
}

/** Marca o desfecho real da chamada. Só `success` vira `executed`. */
export async function finalizeExecution(
  client: MinimalClient,
  decisionId: string,
  outcome: MetaCallOutcome,
): Promise<StoreResult<null>> {
  const patch = outcome.status === "success"
    ? {
      status: "executed" as const,
      executed_at: new Date().toISOString(),
      meta_response: outcome.body ?? null,
      meta_error: null,
    }
    : {
      status: "failed" as const,
      executed_at: null,
      meta_response: null,
      meta_error: outcome.status === "timeout"
        ? `timeout: ${outcome.message}`
        : `http ${outcome.httpStatus ?? "?"}: ${outcome.message}`,
    };
  try {
    const { error } = await client
      .from(BRAIN_DECISIONS_TABLE)
      .update(patch)
      .eq("id", decisionId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Versões de snapshot já usadas — alimenta o bloqueio de reuso. */
export async function loadUsedSnapshotVersions(
  client: MinimalClient,
  campaignId: string,
  limit = 50,
): Promise<string[]> {
  try {
    const { data, error } = await client
      .from(BRAIN_DECISIONS_TABLE)
      .select("snapshot_version")
      .eq("campaign_id", campaignId)
      .order("decided_at", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return (data as Array<{ snapshot_version: string }>)
      .map((row) => row.snapshot_version)
      .filter(Boolean);
  } catch {
    return [];
  }
}

export async function recordDecisionOutcome(
  client: MinimalClient,
  decisionId: string,
  outcome: DecisionOutcome,
  metrics: Record<string, unknown>,
): Promise<StoreResult<null>> {
  try {
    const { error } = await client
      .from(BRAIN_DECISIONS_TABLE)
      .update({
        outcome,
        outcome_evaluated_at: new Date().toISOString(),
        outcome_metrics: metrics,
      })
      .eq("id", decisionId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
