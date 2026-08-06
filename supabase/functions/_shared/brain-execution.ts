/**
 * Camada de EXECUÇÃO — parte pura.
 *
 * Recebe uma decisão já calculada e responde: ainda pode escrever na Meta?
 * A revalidação é obrigatória porque entre a medição e a execução podem passar
 * minutos: alguém pausou a campanha no Ads Manager, outro tick já subiu o
 * orçamento, a carteira secou.
 *
 * Também define a chave de idempotência. Sem ela, um retry de cron, um timeout
 * seguido de nova tentativa ou duas instâncias simultâneas aumentam o mesmo
 * orçamento duas vezes.
 *
 * Puro: sem I/O e sem Meta. A persistência fica em `brain-decision-store.ts`.
 */
import { canonicalHash } from "./canonical-json.ts";
import type { BrainDecision } from "./brain-decide.ts";
import type { BrainDecisionPolicy } from "./brain-policy.ts";

export type IdempotencyInput = {
  consultantId: string;
  campaignId: string;
  actionKind: string;
  snapshotVersion: string;
  fromBudgetCents: number | null;
  toBudgetCents: number | null;
};

/**
 * Chave estável da tentativa de execução.
 *
 * Inclui origem e destino do orçamento: repetir a MESMA transição é a operação
 * que precisa ser bloqueada; uma transição diferente (3000 → 3300 depois de
 * 3300 → 3600) é legítima e tem chave própria.
 *
 * O consultor entra na chave porque `idempotency_key` é única na tabela
 * inteira: sem o tenant, qualquer futuro identificador de campanha que não seja
 * globalmente único faria a reserva de um consultor negar a execução de outro.
 */
export function buildIdempotencyKey(
  input: IdempotencyInput,
): Promise<string> {
  return canonicalHash({
    consultant_id: input.consultantId,
    campaign_id: input.campaignId,
    action: input.actionKind,
    snapshot_version: input.snapshotVersion,
    from: input.fromBudgetCents,
    to: input.toBudgetCents,
  });
}

export function idempotencyKeyForDecision(
  decision: BrainDecision,
): Promise<string> {
  return buildIdempotencyKey({
    consultantId: decision.consultantId,
    campaignId: decision.campaignId,
    actionKind: decision.actionKind ?? decision.action,
    snapshotVersion: decision.snapshotVersion,
    fromBudgetCents: decision.currentBudgetCents,
    toBudgetCents: decision.proposedBudgetCents,
  });
}

/** Estado lido de novo, imediatamente antes de escrever. */
export type LiveCampaignState = {
  status: string;
  dailyBudgetCents: number;
  fbCampaignId: string | null;
  /** ISO da última execução registrada para esta campanha. */
  lastExecutionAtIso: string | null;
};

export type RevalidationResult =
  | { ok: true }
  | { ok: false; code: string; message: string };

const ACTIVE_STATUSES = new Set(["active", "pending_review"]);

/**
 * Última porta antes da Meta.
 *
 * Compara o estado atual com o estado que a decisão assumiu. Qualquer
 * divergência derruba a execução: a decisão precisa ser recalculada com dados
 * novos, não forçada sobre uma realidade diferente.
 */
export function revalidateBeforeExecution(input: {
  decision: BrainDecision;
  live: LiveCampaignState;
  policy: BrainDecisionPolicy;
  nowMs: number;
  /** Idade máxima da decisão até virar velha demais para executar. */
  maxDecisionAgeMinutes?: number;
}): RevalidationResult {
  const { decision, live, policy, nowMs } = input;

  if (!decision.canExecute) {
    return {
      ok: false,
      code: "decisao_nao_autorizada",
      message: "a decisão não autoriza escrita na Meta",
    };
  }
  if (decision.blockers.length > 0) {
    return {
      ok: false,
      code: "decisao_bloqueada",
      message: decision.blockers.map((b) => b.code).join(","),
    };
  }
  if (!live.fbCampaignId) {
    return {
      ok: false,
      code: "sem_id_meta",
      message: "campanha sem id na Meta",
    };
  }

  const decidedAtMs = Date.parse(decision.decidedAtIso);
  const maxAgeMin = input.maxDecisionAgeMinutes ?? 60;
  if (
    Number.isFinite(decidedAtMs) &&
    (nowMs - decidedAtMs) / 60_000 > maxAgeMin
  ) {
    return {
      ok: false,
      code: "decisao_velha",
      message: `decisão tomada há mais de ${maxAgeMin} min`,
    };
  }

  // Alguém mexeu no orçamento entre medir e executar.
  if (live.dailyBudgetCents !== decision.currentBudgetCents) {
    return {
      ok: false,
      code: "orcamento_divergente",
      message:
        `orçamento atual ${live.dailyBudgetCents} difere do medido ${decision.currentBudgetCents}`,
    };
  }

  if (decision.action === "pause_waste") {
    if (!ACTIVE_STATUSES.has(live.status)) {
      return {
        ok: false,
        code: "ja_pausada",
        message: `campanha já está ${live.status}`,
      };
    }
    return { ok: true };
  }

  if (!ACTIVE_STATUSES.has(live.status)) {
    return {
      ok: false,
      code: "campanha_nao_ativa",
      message: `campanha está ${live.status}`,
    };
  }

  const hoursSinceExecution = live.lastExecutionAtIso
    ? (nowMs - Date.parse(live.lastExecutionAtIso)) / 3_600_000
    : null;
  if (
    hoursSinceExecution != null &&
    Number.isFinite(hoursSinceExecution) &&
    hoursSinceExecution < policy.minHoursBetweenExecutions
  ) {
    return {
      ok: false,
      code: "intervalo_minimo",
      message: `última execução há ${hoursSinceExecution.toFixed(1)}h`,
    };
  }

  if (
    (decision.action === "increase_budget" ||
      decision.action === "reduce_budget") &&
    decision.proposedBudgetCents == null
  ) {
    return {
      ok: false,
      code: "sem_orcamento_proposto",
      message: "decisão de orçamento sem valor proposto",
    };
  }

  return { ok: true };
}

// ───────────────────── Resposta da Meta ─────────────────────

export type MetaCallOutcome =
  | { status: "success"; body: unknown }
  | { status: "error"; httpStatus: number | null; message: string; retryable: boolean }
  | { status: "timeout"; message: string; retryable: true };

/**
 * Traduz o resultado da chamada.
 *
 * Regra dura: erro e timeout NUNCA viram sucesso local. Depois de um timeout o
 * estado na Meta é desconhecido — o orçamento local não pode ser atualizado
 * como se tivesse funcionado, senão a reconciliação seguinte encontra dois
 * números diferentes e não sabe qual é o certo.
 */
export function interpretMetaCall(input: {
  ok: boolean;
  httpStatus?: number | null;
  body?: unknown;
  error?: unknown;
}): MetaCallOutcome {
  if (input.error) {
    const message = input.error instanceof Error
      ? input.error.message
      : String(input.error);
    if (/timeout|timed out|aborted|network/i.test(message)) {
      return { status: "timeout", message, retryable: true };
    }
    return {
      status: "error",
      httpStatus: input.httpStatus ?? null,
      message,
      retryable: false,
    };
  }
  if (!input.ok) {
    const status = input.httpStatus ?? null;
    // 429 e 5xx são transitórios; 4xx de negócio não deve ser repetido.
    const retryable = status != null && (status === 429 || status >= 500);
    return {
      status: "error",
      httpStatus: status,
      message: typeof input.body === "string"
        ? input.body.slice(0, 500)
        : JSON.stringify(input.body ?? {}).slice(0, 500),
      retryable,
    };
  }
  return { status: "success", body: input.body ?? null };
}

/** Só marca executado com sucesso confirmado. */
export function shouldMarkExecuted(outcome: MetaCallOutcome): boolean {
  return outcome.status === "success";
}

/** Só permite nova tentativa quando a chave de idempotência protege. */
export function shouldRetry(outcome: MetaCallOutcome): boolean {
  return outcome.status === "timeout" ||
    (outcome.status === "error" && outcome.retryable);
}

// ───────────────────── Resultado posterior ─────────────────────

export type DecisionOutcome =
  | "improved"
  | "worsened"
  | "neutral"
  | "inconclusive"
  | "insufficient_data";

/** Marcos de reavaliação de uma decisão executada. */
export const OUTCOME_CHECKPOINT_HOURS = [24, 72, 168] as const;

/**
 * Compara a janela antes com a janela depois.
 *
 * Sem amostra mínima nas DUAS janelas o veredito é `insufficient_data` — não
 * existe "economizamos R$ X" sem base mensurável.
 */
export function classifyDecisionOutcome(input: {
  before: { cplCents: number | null; conversations: number; approved: number };
  after: { cplCents: number | null; conversations: number; approved: number };
  minConversations: number;
  /** Variação relativa que deixa de ser ruído. */
  significantDeltaPct?: number;
}): { outcome: DecisionOutcome; deltaPct: number | null; reason: string } {
  const minConv = Math.max(1, input.minConversations);
  const threshold = (input.significantDeltaPct ?? 10) / 100;

  if (
    input.before.conversations < minConv || input.after.conversations < minConv
  ) {
    return {
      outcome: "insufficient_data",
      deltaPct: null,
      reason:
        `amostra curta (${input.before.conversations} antes / ${input.after.conversations} depois, mínimo ${minConv})`,
    };
  }
  const before = input.before.cplCents;
  const after = input.after.cplCents;
  if (before == null || after == null || before <= 0) {
    return {
      outcome: "inconclusive",
      deltaPct: null,
      reason: "custo por conversa indisponível em uma das janelas",
    };
  }

  // CPL menor é melhor; variação negativa é melhora.
  const delta = (after - before) / before;
  const deltaPct = Number((delta * 100).toFixed(1));

  if (Math.abs(delta) < threshold) {
    return {
      outcome: "neutral",
      deltaPct,
      reason: `custo por conversa variou ${deltaPct}% — dentro do ruído`,
    };
  }
  if (delta < 0) {
    return {
      outcome: "improved",
      deltaPct,
      reason: `custo por conversa caiu ${Math.abs(deltaPct)}%`,
    };
  }
  // Mais clientes aprovados compensam CPL maior: o objetivo é negócio.
  if (input.after.approved > input.before.approved) {
    return {
      outcome: "neutral",
      deltaPct,
      reason:
        `custo por conversa subiu ${deltaPct}%, mas clientes aprovados foram de ${input.before.approved} para ${input.after.approved}`,
    };
  }
  return {
    outcome: "worsened",
    deltaPct,
    reason: `custo por conversa subiu ${deltaPct}%`,
  };
}
