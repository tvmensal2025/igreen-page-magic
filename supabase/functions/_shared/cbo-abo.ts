/**
 * Resolução CBO → ABO.
 *
 * CBO (Campaign Budget Optimization) deixa a Meta distribuir o orçamento entre
 * os conjuntos; ABO (Ad Set Budget Optimization) fixa orçamento por conjunto.
 * Dividir por região só faz sentido quando já existe amostra suficiente e mais
 * de uma praça — antes disso, dividir mata a fase de aprendizado.
 *
 * Este módulo é PURO: recebe fatos da campanha e devolve a recomendação. Não
 * chama Graph, não escreve no banco e NUNCA migra objeto automaticamente —
 * `create_object` é human-only na policy (`ad-automation-policy.ts`). O handler
 * apenas registra uma recomendação para revisão humana.
 */

export const CBO_MIN_LEADS_FOR_SPLIT = 20;
export const CBO_MIN_CITIES_FOR_SPLIT = 2;
export const CBO_MIN_AGE_DAYS_FOR_SPLIT = 7;

export interface CboCampaignFacts {
  /** Nome da campanha, usado no título da recomendação. */
  name: string;
  /** Resultados acumulados (leads/cadastros) da campanha. */
  leadsCount: number;
  /** Quantidade de praças/cidades segmentadas. */
  cityCount: number;
  /** Idade da campanha em dias completos. */
  ageDays: number;
}

export type CboAboVerdict =
  | { action: "none"; reason: string }
  | { action: "recommend_review"; title: string; message: string };

/** Título determinístico — é a chave de deduplicação da recomendação. */
export function buildCboReviewTitle(campaignName: string): string {
  return `Avaliar divisão por região: ${campaignName}`;
}

/**
 * Decide se vale sugerir revisão da distribuição por região.
 * Conservador de propósito: na dúvida, `none`.
 */
export function evaluateCboToAbo(facts: CboCampaignFacts): CboAboVerdict {
  const cityCount = Number.isFinite(facts.cityCount) ? facts.cityCount : 0;
  const leadsCount = Number.isFinite(facts.leadsCount) ? facts.leadsCount : 0;
  const ageDays = Number.isFinite(facts.ageDays) ? facts.ageDays : 0;

  if (cityCount < CBO_MIN_CITIES_FOR_SPLIT) {
    return { action: "none", reason: "single_city" };
  }
  if (ageDays < CBO_MIN_AGE_DAYS_FOR_SPLIT) {
    return { action: "none", reason: "learning_phase" };
  }
  if (leadsCount < CBO_MIN_LEADS_FOR_SPLIT) {
    return { action: "none", reason: "insufficient_sample" };
  }

  return {
    action: "recommend_review",
    title: buildCboReviewTitle(facts.name),
    message:
      `A campanha tem ${leadsCount} resultados em ${cityCount} cidades. ` +
      `Avalie a distribuição por região no Gerenciador; nenhuma campanha nova foi criada.`,
  };
}

/** Idade em dias completos a partir de um ISO. Fora do módulo puro de decisão. */
export function ageInDays(startedAtIso: string | null, now: number): number {
  if (!startedAtIso) return 0;
  const started = new Date(startedAtIso).getTime();
  if (!Number.isFinite(started)) return 0;
  return Math.floor((now - started) / 86_400_000);
}
