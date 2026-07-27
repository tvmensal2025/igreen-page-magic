/**
 * Espelho UI da cobrança iGreen Fone (SMS + ligação).
 * Regra: SMS R$ 0,10 · voz R$ 0,10 a cada 30s atendida (ceil).
 * Cobrança só em atendidas (não atendeu = R$ 0).
 */

export const PLATFORM_SMS_PRICE = 0.1;
export const PLATFORM_VOICE_BLOCK_SEC = 30;
export const PLATFORM_VOICE_BLOCK_PRICE = 0.1;
/** @deprecated use PLATFORM_VOICE_BLOCK_PRICE — mantido p/ imports antigos */
export const VOICE_PRICE_FULL = PLATFORM_VOICE_BLOCK_PRICE;
/** @deprecated */
export const VOICE_PRICE_HALF = PLATFORM_VOICE_BLOCK_PRICE;

/** “Olá, Nome! Tudo bem?” costurado no início (~2–3s). */
export const PERSONALIZE_GREETING_PAD_SEC = 2.5;

export type VoiceCostBand = "block";

export function voiceBillableBlocks(durationSec: number): number {
  const d = Math.max(0, Number(durationSec) || 0);
  if (d <= 0) return 1;
  return Math.max(1, Math.ceil(d / PLATFORM_VOICE_BLOCK_SEC));
}

export function voiceCostBand(_durationSec: number): VoiceCostBand {
  return "block";
}

export function voicePricePerAnswered(durationSec: number): number {
  return voiceBillableBlocks(durationSec) * PLATFORM_VOICE_BLOCK_PRICE;
}

export function estimateBillableDurationSec(opts: {
  bodyDurationSec: number | null | undefined;
  personalizeName?: boolean;
  /** Limite máximo da chamada (timelimit). */
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
  blocks: number;
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
  const blocks = voiceBillableBlocks(durationSec);
  const priceEach = blocks * PLATFORM_VOICE_BLOCK_PRICE;
  const contacts = Math.max(0, Math.floor(opts.contacts) || 0);
  const rate = Math.min(1, Math.max(0, opts.answerRate ?? 0.3));
  return {
    durationSec,
    band: "block",
    priceEach,
    blocks,
    contacts,
    maxTotal: Math.round(contacts * priceEach * 100) / 100,
    likelyTotal: Math.round(contacts * rate * priceEach * 100) / 100,
    bandLabel: `${blocks}× R$ 0,10 / 30s`,
    durationKnown,
  };
}

/** Contagens máx. do motor A/B/C (silêncio total) — card do consultor. */
export const CADENCE_BILLING_SUMMARY = {
  smsPrice: PLATFORM_SMS_PRICE,
  voiceBlockPrice: PLATFORM_VOICE_BLOCK_PRICE,
  voiceBlockSec: PLATFORM_VOICE_BLOCK_SEC,
  groups: {
    A: { sms: 1, calls: 2, smsCost: 0.1 },
    B: { sms: 4, calls: 3, smsCost: 0.4 },
    C: { sms: 6, calls: 6, smsCost: 0.6 },
  },
  maxSms: 11,
  maxCalls: 11,
  maxSmsCost: 1.1,
} as const;
