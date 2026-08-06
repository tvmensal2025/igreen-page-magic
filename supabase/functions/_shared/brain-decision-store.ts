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
import type {
  OutcomeEvaluation,
  OutcomeMetricsJson,
  OutcomeWindow,
} from "./brain-outcome.ts";
import { mergeOutcomeMetrics } from "./brain-outcome.ts";

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
  /** Correlation ID do lote, quando a decisão vem do shadow agendado. */
  correlationId?: string,
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
    // `measured` é jsonb livre: capacidade de atribuição e correlation ID
    // moram aqui para não precisar de coluna nova.
    measured: {
      ...decision.measured,
      support: decision.support.support,
      supportReason: decision.support.reason,
      ...(correlationId ? { correlationId } : {}),
    },
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
  correlationId?: string,
): Promise<StoreResult<{ id: string; idempotencyKey: string; duplicate: boolean }>> {
  const idempotencyKey = await idempotencyKeyForDecision(decision);
  try {
    const { data, error } = await client
      .from(BRAIN_DECISIONS_TABLE)
      .upsert(
        decisionRowFromDecision(
          decision,
          idempotencyKey,
          "recommended",
          correlationId,
        ),
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
    // `ignoreDuplicates` devolve linha vazia quando a chave já existia: é a
    // mesma amostra chegando de novo (retry, cron sobreposto), não erro.
    return {
      ok: true,
      data: {
        id: data?.id ?? "",
        idempotencyKey,
        duplicate: !data?.id,
      },
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Caixa de entrada do consultor (`ad_recommendations`).
 *
 * O padrão antigo era SELECT + INSERT, que não protege contra dois processos
 * simultâneos. Aqui a proteção é o índice único parcial de `dedup_key`, que só
 * vale enquanto a recomendação está aberta — depois de aplicada ou descartada,
 * o mesmo assunto pode voltar.
 */
export async function recordInboxRecommendation(
  client: MinimalClient,
  input: {
    consultantId: string;
    type: string;
    title: string;
    message: string;
    severity: "info" | "success" | "warning" | "critical";
    actionLabel: string;
    actionPayload: Record<string, unknown>;
    dedupKey: string;
  },
): Promise<StoreResult<{ inserted: boolean }>> {
  try {
    const { data, error } = await client
      .from("ad_recommendations")
      .upsert({
        consultant_id: input.consultantId,
        type: input.type,
        title: input.title,
        message: input.message,
        severity: input.severity,
        action_label: input.actionLabel,
        action_payload: input.actionPayload,
        dedup_key: input.dedupKey,
      }, { onConflict: "dedup_key", ignoreDuplicates: true })
      .select("id")
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    return { ok: true, data: { inserted: Boolean(data?.id) } };
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

/** Linha mínima para avaliar desfecho. */
export type DecisionForOutcome = {
  id: string;
  consultant_id: string;
  campaign_id: string;
  action: string;
  decided_at: string;
  measured: Record<string, unknown> | null;
  outcome_metrics: OutcomeMetricsJson | null;
  outcome_evaluated_at: string | null;
};

/**
 * Decisões que já têm pelo menos a janela de 24h vencida.
 *
 * O filtro fino (qual janela falta) fica em memória: `outcome_metrics` é jsonb
 * e a fila é pequena — não vale um índice de expressão para isso agora.
 */
export async function loadDecisionsNeedingOutcome(
  client: MinimalClient,
  input: { nowMs: number; limit?: number; consultantId?: string },
): Promise<StoreResult<DecisionForOutcome[]>> {
  const cutoffIso = new Date(input.nowMs - 24 * 3_600_000).toISOString();
  // 7 dias é a maior janela; nada mais antigo que isso ainda muda de estado.
  const floorIso = new Date(input.nowMs - 10 * 86_400_000).toISOString();
  try {
    let query = client
      .from(BRAIN_DECISIONS_TABLE)
      .select(
        "id, consultant_id, campaign_id, action, decided_at, measured, outcome_metrics, outcome_evaluated_at",
      )
      .lte("decided_at", cutoffIso)
      .gte("decided_at", floorIso)
      .order("decided_at", { ascending: true })
      .limit(Math.max(1, Math.min(500, input.limit ?? 200)));
    if (input.consultantId) query = query.eq("consultant_id", input.consultantId);

    const { data, error } = await query;
    if (error) {
      return {
        ok: false,
        error: isMissingTable(error) ? "tabela_ausente" : error.message,
      };
    }
    return { ok: true, data: (data ?? []) as DecisionForOutcome[] };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Grava o desfecho de UMA janela.
 *
 * Duas proteções contra duplicidade: o merge não sobrescreve janela já escrita,
 * e o UPDATE só passa se `outcome_evaluated_at` continuar igual ao que foi
 * lido. Se outro processo gravou no meio, o update não acha a linha e o
 * chamador sabe que perdeu a corrida.
 */
export async function recordOutcomeForWindow(
  client: MinimalClient,
  decision: DecisionForOutcome,
  evaluation: OutcomeEvaluation,
): Promise<StoreResult<{ recorded: boolean; window: OutcomeWindow }>> {
  const existing = decision.outcome_metrics ?? {};
  if (existing[evaluation.window]) {
    return { ok: true, data: { recorded: false, window: evaluation.window } };
  }
  const merged = mergeOutcomeMetrics(existing, evaluation);
  try {
    let query = client
      .from(BRAIN_DECISIONS_TABLE)
      .update({
        outcome: evaluation.state,
        outcome_evaluated_at: evaluation.evaluatedAtIso,
        outcome_metrics: merged,
      })
      .eq("id", decision.id);
    query = decision.outcome_evaluated_at
      ? query.eq("outcome_evaluated_at", decision.outcome_evaluated_at)
      : query.is("outcome_evaluated_at", null);

    const { data, error } = await query.select("id").maybeSingle();
    if (error) {
      return {
        ok: false,
        error: isMissingTable(error) ? "tabela_ausente" : error.message,
      };
    }
    return {
      ok: true,
      data: { recorded: Boolean(data?.id), window: evaluation.window },
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export type BrainActivity = {
  /** Última decisão registrada, veio do cron ou do painel. */
  lastDecisionAtIso: string | null;
  /** Correlation ID do último lote automático. `null` se nunca rodou. */
  lastBatchCorrelationId: string | null;
  lastBatchAtIso: string | null;
  decisionsLast7d: number;
  lastOutcomeByWindow: Record<string, string | null>;
  /** Decisões com janela vencida e desfecho ainda não gravado. */
  pendingOutcomes: number;
  /** `true` quando a tabela de histórico ainda não existe. */
  storageMissing: boolean;
};

/** Resumo de atividade para o painel — leitura, nunca escrita. */
export async function loadBrainActivity(
  client: MinimalClient,
  consultantId: string,
  nowMs: number,
): Promise<BrainActivity> {
  const activity: BrainActivity = {
    lastDecisionAtIso: null,
    lastBatchCorrelationId: null,
    lastBatchAtIso: null,
    decisionsLast7d: 0,
    lastOutcomeByWindow: { "24h": null, "72h": null, "7d": null },
    pendingOutcomes: 0,
    storageMissing: false,
  };

  try {
    const sinceIso = new Date(nowMs - 7 * 86_400_000).toISOString();
    const { data, error } = await client
      .from(BRAIN_DECISIONS_TABLE)
      .select("decided_at, measured, outcome_metrics, outcome_evaluated_at")
      .eq("consultant_id", consultantId)
      .gte("decided_at", sinceIso)
      .order("decided_at", { ascending: false })
      .limit(200);
    if (error) {
      activity.storageMissing = isMissingTable(error);
      return activity;
    }

    const rows = (data ?? []) as Array<{
      decided_at: string;
      measured: Record<string, unknown> | null;
      outcome_metrics: OutcomeMetricsJson | null;
    }>;
    activity.decisionsLast7d = rows.length;
    activity.lastDecisionAtIso = rows[0]?.decided_at ?? null;

    for (const row of rows) {
      const corr = row.measured?.correlationId;
      if (!activity.lastBatchCorrelationId && typeof corr === "string") {
        activity.lastBatchCorrelationId = corr;
        activity.lastBatchAtIso = row.decided_at;
      }
      for (const w of ["24h", "72h", "7d"] as const) {
        const hit = row.outcome_metrics?.[w];
        if (hit && !activity.lastOutcomeByWindow[w]) {
          activity.lastOutcomeByWindow[w] = hit.state;
        }
      }
      const decidedMs = Date.parse(row.decided_at);
      if (
        Number.isFinite(decidedMs) &&
        nowMs - decidedMs >= 24 * 3_600_000 &&
        !row.outcome_metrics?.["24h"]
      ) {
        activity.pendingOutcomes++;
      }
    }
    return activity;
  } catch {
    return activity;
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
