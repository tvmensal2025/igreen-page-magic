/**
 * Desfecho das decisões em 24h, 72h e 7 dias.
 *
 * O que se mede aqui é OBSERVACIONAL: enquanto o Cérebro novo está em
 * recomendação, ele não age, então a janela seguinte mostra o que aconteceu com
 * a campanha — não o efeito de uma ação nossa. Por isso nada aqui declara
 * economia ou ganho; a classificação é sobre a métrica, não sobre mérito.
 *
 * As três janelas convivem em `outcome_metrics` (jsonb), uma chave por janela.
 * A coluna `outcome` guarda a leitura mais recente, para quem só quer o topo.
 * Não foi preciso migration: a estrutura já suportava.
 *
 * Puro: recebe números já lidos. Sem I/O, sem Meta.
 */
import type { CampaignBrainSnapshot } from "./brain-snapshot.ts";

export type OutcomeWindow = "24h" | "72h" | "7d";

export const OUTCOME_WINDOWS: readonly OutcomeWindow[] = ["24h", "72h", "7d"];

export const WINDOW_HOURS: Record<OutcomeWindow, number> = {
  "24h": 24,
  "72h": 72,
  "7d": 168,
};

export type DecisionOutcomeState =
  | "improved"
  | "worsened"
  | "neutral"
  | "inconclusive"
  | "insufficient_data";

/** Comparável mínimo de uma janela. */
export type OutcomeSample = {
  spendCents: number;
  conversations: number;
  cplCents: number | null;
  leadsTrusted: number;
  approvedTrusted: number;
};

export type OutcomeEvaluation = {
  window: OutcomeWindow;
  state: DecisionOutcomeState;
  reason: string;
  before: OutcomeSample;
  after: OutcomeSample;
  /** Variação do custo por conversa em pontos percentuais. `null` sem base. */
  cplDeltaPct: number | null;
  evaluatedAtIso: string;
};

/** Registro de desfechos por janela, como fica salvo em `outcome_metrics`. */
export type OutcomeMetricsJson = {
  [W in OutcomeWindow]?: OutcomeEvaluation;
};

export function sampleFromSnapshot(
  snapshot: CampaignBrainSnapshot,
): OutcomeSample {
  return {
    spendCents: snapshot.meta.spendCents,
    conversations: snapshot.meta.conversations,
    cplCents: snapshot.meta.cplCents,
    leadsTrusted: snapshot.commercial.leadsTrusted,
    approvedTrusted: snapshot.commercial.approvedTrusted,
  };
}

/** Amostra congelada na decisão (`ads_brain_decisions.measured`). */
export function sampleFromMeasured(
  measured: Record<string, unknown> | null | undefined,
): OutcomeSample {
  const n = (v: unknown): number => {
    const x = Number(v ?? 0);
    return Number.isFinite(x) ? x : 0;
  };
  const cpl = measured?.cplCents;
  return {
    spendCents: n(measured?.spendCents),
    conversations: n(measured?.conversations),
    cplCents: cpl == null ? null : n(cpl),
    leadsTrusted: n(measured?.leadsTrusted),
    approvedTrusted: n(measured?.approvedTrusted),
  };
}

/**
 * Próxima janela pendente de uma decisão.
 *
 * Devolve a MAIOR janela já vencida que ainda não foi avaliada, para que uma
 * fila atrasada não gaste três rodadas na mesma decisão. `null` quando nada
 * venceu ainda ou quando as três já foram registradas.
 */
export function pendingOutcomeWindow(input: {
  decidedAtIso: string;
  nowMs: number;
  existing?: OutcomeMetricsJson | null;
}): OutcomeWindow | null {
  const decidedMs = Date.parse(input.decidedAtIso);
  if (!Number.isFinite(decidedMs)) return null;
  const elapsedHours = (input.nowMs - decidedMs) / 3_600_000;
  const done = input.existing ?? {};

  let pending: OutcomeWindow | null = null;
  for (const w of OUTCOME_WINDOWS) {
    if (elapsedHours >= WINDOW_HOURS[w] && !done[w]) pending = w;
  }
  return pending;
}

/** Já avaliada? Usado para o retry não sobrescrever janela concluída. */
export function isWindowRecorded(
  existing: OutcomeMetricsJson | null | undefined,
  window: OutcomeWindow,
): boolean {
  return Boolean(existing?.[window]);
}

export function mergeOutcomeMetrics(
  existing: OutcomeMetricsJson | null | undefined,
  evaluation: OutcomeEvaluation,
): OutcomeMetricsJson {
  const base: OutcomeMetricsJson = { ...(existing ?? {}) };
  // Nunca sobrescreve: a primeira leitura da janela é a que vale.
  if (base[evaluation.window]) return base;
  base[evaluation.window] = evaluation;
  return base;
}

/** Variação relevante de custo por conversa. Abaixo disso é ruído. */
const CPL_NOISE_PCT = 10;
/** Conversas mínimas nos dois lados para o custo ser comparável. */
const MIN_CONVERSATIONS_TO_COMPARE = 3;

/**
 * Classifica o desfecho.
 *
 * Ordem deliberada: resultado comercial primeiro. Uma campanha que ficou mais
 * cara por conversa mas trouxe cliente aprovado melhorou — o contrário é o erro
 * clássico de otimizar conversa barata que não vira nada.
 */
export function evaluateOutcome(input: {
  window: OutcomeWindow;
  before: OutcomeSample;
  after: OutcomeSample;
  nowMs: number;
}): OutcomeEvaluation {
  const { before, after, window } = input;
  const evaluatedAtIso = new Date(input.nowMs).toISOString();

  const cplDeltaPct = before.cplCents != null && before.cplCents > 0 &&
      after.cplCents != null
    ? Number(
      (((after.cplCents - before.cplCents) / before.cplCents) * 100).toFixed(1),
    )
    : null;

  const done = (
    state: DecisionOutcomeState,
    reason: string,
  ): OutcomeEvaluation => ({
    window,
    state,
    reason,
    before,
    after,
    cplDeltaPct,
    evaluatedAtIso,
  });

  // Sem nada novo medido depois da decisão não há desfecho — e isso não é
  // "neutro": é ausência de informação.
  if (after.spendCents <= 0 && after.conversations <= 0) {
    return done(
      "insufficient_data",
      "nenhuma entrega medida na janela seguinte",
    );
  }

  const approvedDelta = after.approvedTrusted - before.approvedTrusted;
  if (approvedDelta > 0) {
    return done(
      "improved",
      `${approvedDelta} cliente(s) aprovado(s) a mais com atribuição confiável`,
    );
  }

  const leadsDelta = after.leadsTrusted - before.leadsTrusted;

  if (
    before.conversations < MIN_CONVERSATIONS_TO_COMPARE ||
    after.conversations < MIN_CONVERSATIONS_TO_COMPARE
  ) {
    // Poucas conversas dos dois lados: dá para ver movimento de lead, mas o
    // custo por conversa não sustenta conclusão.
    if (leadsDelta > 0) {
      return done(
        "improved",
        `${leadsDelta} lead(s) identificado(s) a mais, ainda com amostra pequena`,
      );
    }
    return done(
      "inconclusive",
      `amostra pequena nos dois lados (${before.conversations} → ${after.conversations} conversas)`,
    );
  }

  if (cplDeltaPct == null) {
    return done("inconclusive", "sem custo por conversa comparável nas duas janelas");
  }
  if (cplDeltaPct <= -CPL_NOISE_PCT) {
    return done(
      "improved",
      `custo por conversa caiu ${Math.abs(cplDeltaPct)}%`,
    );
  }
  if (cplDeltaPct >= CPL_NOISE_PCT) {
    return done("worsened", `custo por conversa subiu ${cplDeltaPct}%`);
  }
  if (leadsDelta > 0) {
    return done(
      "improved",
      `${leadsDelta} lead(s) identificado(s) a mais com custo estável`,
    );
  }
  return done(
    "neutral",
    `custo por conversa estável (${cplDeltaPct > 0 ? "+" : ""}${cplDeltaPct}%)`,
  );
}

export const OUTCOME_LABEL: Record<DecisionOutcomeState, string> = {
  improved: "melhorou",
  worsened: "piorou",
  neutral: "neutro",
  inconclusive: "inconclusivo",
  insufficient_data: "dados insuficientes",
};

export function outcomeLabel(state: DecisionOutcomeState): string {
  return OUTCOME_LABEL[state];
}
