/**
 * Estimativa de custo iGreen Fone (Velip) por ligação atendida.
 *
 * Regra comercial usada no painel:
 * - 1–30s  → metade do valor
 * - 30–60s → valor inteiro
 *
 * Cobrança só em atendidas (não atendeu = R$ 0).
 */

/** Valor inteiro (faixa 30–60s), em R$. */
export const VOICE_PRICE_FULL = 0.18;
/** Metade (faixa 1–30s), em R$. */
export const VOICE_PRICE_HALF = VOICE_PRICE_FULL / 2;

/** “Olá, Nome! Tudo bem?” costurado no início (~2–3s). */
export const PERSONALIZE_GREETING_PAD_SEC = 2.5;

export type VoiceCostBand = "half" | "full";

export function voiceCostBand(durationSec: number): VoiceCostBand {
  const d = Math.max(0, Number(durationSec) || 0);
  // Limite inclusivo: exatamente 30s ainda é metade.
  return d <= 30 ? "half" : "full";
}

export function voicePricePerAnswered(durationSec: number): number {
  return voiceCostBand(durationSec) === "half" ? VOICE_PRICE_HALF : VOICE_PRICE_FULL;
}

export function estimateBillableDurationSec(opts: {
  bodyDurationSec: number | null | undefined;
  personalizeName?: boolean;
  /** Limite máximo da chamada (timelimit Velip). */
  timeLimitSec?: number | null;
}): number {
  const body = Math.max(0, Number(opts.bodyDurationSec) || 0);
  const pad = opts.personalizeName ? PERSONALIZE_GREETING_PAD_SEC : 0;
  let total = body > 0 ? body + pad : opts.personalizeName ? 22 : 20;
  const cap = Number(opts.timeLimitSec);
  if (Number.isFinite(cap) && cap > 0) total = Math.min(total, cap);
  return Math.round(total * 10) / 10;
}

export function formatBrl(n: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
}

export type CampaignCostEstimate = {
  durationSec: number;
  band: VoiceCostBand;
  priceEach: number;
  contacts: number;
  /** Se 100% atenderem. */
  maxTotal: number;
  /** Cenário ~30% atendimento (histórico típico). */
  likelyTotal: number;
  bandLabel: string;
  durationKnown: boolean;
};

export function estimateCampaignCost(opts: {
  contacts: number;
  bodyDurationSec: number | null | undefined;
  personalizeName?: boolean;
  timeLimitSec?: number | null;
  answerRate?: number;
}): CampaignCostEstimate {
  const durationKnown = Number(opts.bodyDurationSec) > 0;
  const durationSec = estimateBillableDurationSec({
    bodyDurationSec: opts.bodyDurationSec,
    personalizeName: opts.personalizeName,
    timeLimitSec: opts.timeLimitSec,
  });
  const band = voiceCostBand(durationSec);
  const priceEach = voicePricePerAnswered(durationSec);
  const contacts = Math.max(0, Math.floor(opts.contacts) || 0);
  const rate = Math.min(1, Math.max(0, opts.answerRate ?? 0.3));
  return {
    durationSec,
    band,
    priceEach,
    contacts,
    maxTotal: Math.round(contacts * priceEach * 100) / 100,
    likelyTotal: Math.round(contacts * rate * priceEach * 100) / 100,
    bandLabel: band === "half" ? "até 30s · metade" : "30–60s · valor inteiro",
    durationKnown,
  };
}
