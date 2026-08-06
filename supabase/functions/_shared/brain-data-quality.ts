/**
 * Diagnóstico de qualidade dos dados — roda ANTES de qualquer recomendação.
 *
 * O motor antigo calculava CPL e escalava sem perguntar de quando eram as
 * métricas. Se o sync da Meta falhou às 3h, às 14h o Cérebro ainda decidia
 * sobre a janela de ontem achando que era hoje. Aqui isso vira um estado
 * explícito que pode bloquear ação financeira.
 *
 * Puro: sem I/O. O chamador informa o que leu; este módulo só julga.
 */

export type DataQualityState =
  | "fresh"
  | "stale"
  | "incomplete"
  | "conflicting"
  | "unavailable";

export type BrainDataQualityInput = {
  /** Momento da avaliação (injetável para teste). */
  nowMs: number;
  /** `max(facebook_metrics_daily.updated_at)` da janela. */
  lastMetaSyncAtIso: string | null;
  /**
   * Prova de que o sync PASSOU pelas campanhas, independente de ter escrito
   * linha (`max(facebook_campaigns.updated_at)`).
   *
   * Existe porque a Meta não emite linha de insights para dia sem entrega:
   * campanha ativa que não gastou simplesmente não aparece. Sem este carimbo,
   * "não gastou" e "sync quebrado" ficam indistinguíveis, e o Cérebro acusa
   * dado indisponível quando o dado existe e diz zero.
   *
   * Ausente = comportamento antigo (só as linhas de métrica contam).
   */
  syncConfirmedAtIso?: string | null;
  /** Janela usada, em ISO date (YYYY-MM-DD). */
  windowStart: string;
  windowEnd: string;
  /** Campanhas consideradas na leitura. */
  campaignsFound: number;
  /** Linhas de métrica diária efetivamente lidas. */
  metricRowsFound: number;
  /** Linhas esperadas = campanhas × dias da janela. */
  expectedMetricRows: number;
  /** Existe algum resultado comercial atribuído na janela? */
  hasCommercialData: boolean;
  /** Linhas duplicadas descartadas na agregação. */
  duplicatesIgnored: number;
  /** Campanha ativa com budget e zero linha de métrica = lacuna. */
  activeCampaignsWithoutMetrics: number;
  /** Idade máxima tolerada para as métricas (política). */
  maxMetricsAgeHours: number;
  /** Sinais contraditórios detectados pelo chamador (ex.: conversas > cliques). */
  conflicts?: readonly string[];
};

export type BrainDataQuality = {
  state: DataQualityState;
  /** Idade das métricas em horas. `null` quando não há sync conhecido. */
  metricsAgeHours: number | null;
  lastMetaSyncAtIso: string | null;
  windowStart: string;
  windowEnd: string;
  windowDays: number;
  campaignsFound: number;
  metricRowsFound: number;
  expectedMetricRows: number;
  /** 0–100. */
  completenessPct: number;
  hasCommercialData: boolean;
  duplicatesIgnored: number;
  gapsDetected: number;
  /** Houve entrega (linha de insights) na janela? */
  hasDelivery: boolean;
  conflicts: string[];
  /** Ação que mexe em dinheiro está liberada? */
  allowsFinancialAction: boolean;
  reasons: string[];
};

/** Abaixo disso a janela é considerada incompleta. */
export const MIN_COMPLETENESS_PCT = 60;

function daysBetween(startIso: string, endIso: string): number {
  const a = Date.parse(`${startIso}T00:00:00Z`);
  const b = Date.parse(`${endIso}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(1, Math.round((b - a) / 86_400_000));
}

export function evaluateBrainDataQuality(
  input: BrainDataQualityInput,
): BrainDataQuality {
  const reasons: string[] = [];
  const conflicts = [...(input.conflicts ?? [])];
  const windowDays = daysBetween(input.windowStart, input.windowEnd);

  // O carimbo de "o sync rodou" vale mesmo sem linha escrita; o das linhas só
  // existe quando houve entrega. O mais recente dos dois é a idade real.
  const syncCandidates = [input.lastMetaSyncAtIso, input.syncConfirmedAtIso]
    .map((iso) => (iso ? Date.parse(iso) : NaN))
    .filter((ms) => Number.isFinite(ms));
  const syncMs = syncCandidates.length > 0 ? Math.max(...syncCandidates) : NaN;
  const metricsAgeHours = Number.isFinite(syncMs)
    ? Math.max(0, (input.nowMs - syncMs) / 3_600_000)
    : null;
  const syncConfirmed = Boolean(input.syncConfirmedAtIso) &&
    metricsAgeHours != null && metricsAgeHours <= input.maxMetricsAgeHours;

  const expected = Math.max(0, Math.round(input.expectedMetricRows));
  const found = Math.max(0, Math.round(input.metricRowsFound));
  const rawCompleteness = expected > 0
    ? Math.max(0, Math.min(100, Math.round((found / expected) * 100)))
    : (found > 0 ? 100 : 0);
  // Com o sync confirmado, dia sem entrega não é linha faltando: o denominador
  // "campanhas × dias" pressupõe entrega diária, o que a Meta não garante.
  const completenessPct = syncConfirmed ? 100 : rawCompleteness;

  const gapsDetected = Math.max(0, Math.round(input.activeCampaignsWithoutMetrics));

  // Duplicata é sinal de leitura errada, não de dado ruim da Meta.
  if (input.duplicatesIgnored > 0) {
    conflicts.push(`linhas_duplicadas:${input.duplicatesIgnored}`);
  }

  let state: DataQualityState;
  if (input.campaignsFound <= 0) {
    state = "unavailable";
    reasons.push("nenhuma_campanha_considerada");
  } else if (conflicts.length > 0) {
    state = "conflicting";
    reasons.push(...conflicts.map((c) => `conflito:${c}`));
  } else if (metricsAgeHours == null) {
    state = "unavailable";
    reasons.push("sem_horario_de_sincronizacao");
  } else if (metricsAgeHours > input.maxMetricsAgeHours) {
    // Idade antes de volume: sync velho é sync velho, com ou sem linha.
    state = "stale";
    reasons.push(
      `metricas_com_${metricsAgeHours.toFixed(1)}h_limite_${input.maxMetricsAgeHours}h`,
    );
  } else if (found <= 0 && expected > 0 && !syncConfirmed) {
    state = "unavailable";
    reasons.push("sem_metricas_na_janela");
  } else if (completenessPct < MIN_COMPLETENESS_PCT || gapsDetected > 0) {
    state = "incomplete";
    if (completenessPct < MIN_COMPLETENESS_PCT) {
      reasons.push(`completude_${completenessPct}pct_minimo_${MIN_COMPLETENESS_PCT}pct`);
    }
    if (gapsDetected > 0) {
      reasons.push(`campanhas_ativas_sem_metrica:${gapsDetected}`);
    }
  } else {
    state = "fresh";
    reasons.push(
      found > 0 ? "dados_atuais_e_completos" : "sem_entrega_na_janela",
    );
  }

  if (!input.hasCommercialData) reasons.push("sem_dado_comercial_na_janela");

  return {
    state,
    metricsAgeHours,
    lastMetaSyncAtIso: input.lastMetaSyncAtIso,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    windowDays,
    campaignsFound: input.campaignsFound,
    metricRowsFound: found,
    expectedMetricRows: expected,
    completenessPct,
    hasCommercialData: input.hasCommercialData,
    duplicatesIgnored: input.duplicatesIgnored,
    gapsDetected,
    hasDelivery: found > 0,
    conflicts,
    allowsFinancialAction: state === "fresh",
    reasons,
  };
}

/** Texto curto para o painel e para o motivo da decisão. */
export function describeDataQuality(quality: BrainDataQuality): string {
  switch (quality.state) {
    case "fresh":
      if (!quality.hasDelivery) {
        return "sincronização em dia, mas nenhuma campanha entregou na janela";
      }
      return `dados atuais (${quality.completenessPct}% completos, ${
        quality.metricsAgeHours?.toFixed(1) ?? "?"
      }h)`;
    case "stale":
      return `dados antigos (${quality.metricsAgeHours?.toFixed(1) ?? "?"}h desde a última sincronização)`;
    case "incomplete":
      return `dados incompletos (${quality.completenessPct}% das linhas esperadas)`;
    case "conflicting":
      return `dados conflitantes (${quality.conflicts.join(", ")})`;
    case "unavailable":
      return "sem dados na janela";
  }
}
