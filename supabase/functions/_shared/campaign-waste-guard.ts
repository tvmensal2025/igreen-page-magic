/**
 * Waste Guard — mata gasto sem conversa (estilo pacing/budget da Meta/Google).
 *
 * Regras (janela rolling 48h, conversa = messaging_conversations_started):
 *  1) ZERO_CONV: spend ≥ R$ 10 e 0 conversas → pausa campanha
 *  2) ZERO_CLICK: spend ≥ R$ 8 e 0 cliques → pausa campanha (CTR morto)
 *  3) ZOMBIE_AD: ad com spend ≥ R$ 12 e 0 conversas → pausa só o ad
 *
 * Prefixo AUTO_PERF_PAUSE: healthcheck/cron NÃO reativam (só Play do consultor).
 */

export const AUTO_PERF_PAUSE_PREFIX = "AUTO_PERF_PAUSE:";

export const WASTE_ZERO_CONV_SPEND_CENTS = 1000; // R$ 10
export const WASTE_ZERO_CLICK_SPEND_CENTS = 800; // R$ 8
export const WASTE_ZOMBIE_AD_SPEND_CENTS = 1200; // R$ 12
export const WASTE_LOOKBACK_DAYS = 2;
/** Campanhas muito novas (< 2h) só entram se force=true. */
export const WASTE_MIN_AGE_MS = 2 * 60 * 60 * 1000;

export type WasteVerdict =
  | { action: "none" }
  | { action: "pause_campaign"; rule: "zero_conv" | "zero_click"; reason: string }
  | { action: "pause_ad"; rule: "zombie_ad"; reason: string; fbAdId: string };

export function isAutoPerfPause(reason: string | null | undefined): boolean {
  if (!reason) return false;
  return String(reason).startsWith(AUTO_PERF_PAUSE_PREFIX);
}

export function formatAutoPerfReason(detail: string): string {
  return `${AUTO_PERF_PAUSE_PREFIX} ${detail} — só reativa no Play`;
}

export function evaluateCampaignWaste(input: {
  spendCents: number;
  conversations: number;
  clicks: number;
}): WasteVerdict {
  const { spendCents, conversations, clicks } = input;
  if (spendCents >= WASTE_ZERO_CONV_SPEND_CENTS && conversations <= 0) {
    return {
      action: "pause_campaign",
      rule: "zero_conv",
      reason: formatAutoPerfReason(
        `Waste guard: R$ ${(spendCents / 100).toFixed(2)} sem conversa Meta (${WASTE_LOOKBACK_DAYS}d)`,
      ),
    };
  }
  if (spendCents >= WASTE_ZERO_CLICK_SPEND_CENTS && clicks <= 0) {
    return {
      action: "pause_campaign",
      rule: "zero_click",
      reason: formatAutoPerfReason(
        `Waste guard: R$ ${(spendCents / 100).toFixed(2)} sem clique (${WASTE_LOOKBACK_DAYS}d)`,
      ),
    };
  }
  return { action: "none" };
}

export function evaluateAdWaste(input: {
  fbAdId: string;
  spendCents: number;
  conversations: number;
}): WasteVerdict {
  const { fbAdId, spendCents, conversations } = input;
  if (spendCents >= WASTE_ZOMBIE_AD_SPEND_CENTS && conversations <= 0) {
    return {
      action: "pause_ad",
      rule: "zombie_ad",
      fbAdId,
      reason: formatAutoPerfReason(
        `Waste guard ad ${fbAdId}: R$ ${(spendCents / 100).toFixed(2)} sem conversa`,
      ),
    };
  }
  return { action: "none" };
}
