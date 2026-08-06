/**
 * Waste Guard — mata gasto sem conversa (estilo pacing/budget da Meta/Google).
 *
 * Regras (janela rolling 48h, conversa = messaging_conversations_started):
 *  1) ZERO_CONV: spend ≥ limiar e 0 conversas → pausa campanha
 *     - exploradora / comum: R$ 10
 *     - âncora (anchor_campaign_id): R$ 40 (pista para learning Meta)
 *  2) ZERO_CLICK: spend ≥ R$ 8 e 0 cliques → pausa campanha (CTR morto)
 *  3) ZOMBIE_AD: ad com spend ≥ R$ 12 e 0 conversas → pausa só o ad
 *
 * Prefixo AUTO_PERF_PAUSE: healthcheck/cron NÃO reativam (só Play do consultor).
 */
import type { BrainDecisionPolicy } from "./brain-policy.ts";

export const AUTO_PERF_PAUSE_PREFIX = "AUTO_PERF_PAUSE:";

export const WASTE_ZERO_CONV_SPEND_CENTS = 1000; // R$ 10 — exploradora / não-âncora
/** Âncora precisa de pista (~learning); não matar com 3 cliques. */
export const WASTE_ANCHOR_ZERO_CONV_SPEND_CENTS = 4000; // R$ 40
export const WASTE_ZERO_CLICK_SPEND_CENTS = 800; // R$ 8
export const WASTE_ZOMBIE_AD_SPEND_CENTS = 1200; // R$ 12
export const WASTE_LOOKBACK_DAYS = 2;
/** Campanhas muito novas (< 2h) só entram se force=true. */
export const WASTE_MIN_AGE_MS = 2 * 60 * 60 * 1000;

/** true se a campanha ainda é nova demais para waste (sem force). */
export function isTooNewForWaste(
  createdOrStartedAt: string | Date | null | undefined,
  opts?: { force?: boolean; nowMs?: number },
): boolean {
  if (opts?.force) return false;
  if (!createdOrStartedAt) return false;
  const t = createdOrStartedAt instanceof Date
    ? createdOrStartedAt.getTime()
    : new Date(createdOrStartedAt).getTime();
  if (!Number.isFinite(t)) return false;
  const now = opts?.nowMs ?? Date.now();
  return now - t < WASTE_MIN_AGE_MS;
}

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

export function zeroConvSpendThresholdCents(isAnchor: boolean): number {
  return isAnchor ? WASTE_ANCHOR_ZERO_CONV_SPEND_CENTS : WASTE_ZERO_CONV_SPEND_CENTS;
}

export function evaluateCampaignWaste(input: {
  spendCents: number;
  conversations: number;
  clicks: number;
  /** true = brain_config.anchor_campaign_id desta campanha */
  isAnchor?: boolean;
}): WasteVerdict {
  const { spendCents, conversations, clicks, isAnchor = false } = input;
  const zeroConvThreshold = zeroConvSpendThresholdCents(isAnchor);
  if (spendCents >= zeroConvThreshold && conversations <= 0) {
    return {
      action: "pause_campaign",
      rule: "zero_conv",
      reason: formatAutoPerfReason(
        `Waste guard${isAnchor ? " âncora" : ""}: R$ ${(spendCents / 100).toFixed(2)} sem conversa Meta (${WASTE_LOOKBACK_DAYS}d)`,
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

// ───────────────────── Waste Guard adaptativo ─────────────────────
//
// As regras acima usam limiares fixos (R$ 10 / R$ 40 / R$ 8 / R$ 12) e seguem
// rodando em produção como ação protetiva — não são substituídas aqui.
//
// O problema dos limiares fixos: R$ 10 é muito para uma exploradora com CPL
// alvo de R$ 2 e pouco para uma âncora com alvo de R$ 12. E uma campanha com
// 3h de vida pode estourar R$ 10 antes da Meta terminar o aprendizado.
//
// O adaptativo abaixo escala o limiar pelo CPL-alvo, respeita maturidade e
// NUNCA devolve "pause": o máximo que ele produz é `recommend_pause`. Quem
// decide executar é a camada de decisão, conforme `waste_guard_mode`
// (default `recommend`).

export type AdaptiveWasteVerdict = {
  action: "none" | "observe" | "recommend_pause";
  rule: "zero_conv" | "zero_click" | "too_new" | "has_result" | "below_threshold";
  reason: string;
  /** Limiar de gasto calculado para esta campanha (centavos). */
  thresholdCents: number;
};

export function evaluateAdaptiveCampaignWaste(input: {
  spendCents: number;
  conversations: number;
  clicks: number;
  campaignAgeHours: number;
  targetCplCents: number;
  /** Já existe lead identificado ou cliente aprovado atribuído? */
  hasCommercialResult: boolean;
  policy: BrainDecisionPolicy;
}): AdaptiveWasteVerdict {
  const {
    spendCents,
    conversations,
    clicks,
    campaignAgeHours,
    targetCplCents,
    hasCommercialResult,
    policy,
  } = input;

  // Gastar N vezes o custo de uma conversa sem conseguir nenhuma é o sinal.
  const thresholdCents = Math.max(
    WASTE_ZERO_CLICK_SPEND_CENTS,
    Math.round(targetCplCents * policy.wasteSpendMultiplier),
  );

  // Campanha que já trouxe negócio não é desperdício, mesmo com CPL ruim.
  if (hasCommercialResult) {
    return {
      action: "none",
      rule: "has_result",
      reason: "campanha já trouxe resultado comercial atribuído",
      thresholdCents,
    };
  }

  // Campanha nova não é pausada por ter gastado pouco em poucas horas.
  if (campaignAgeHours < policy.minCampaignAgeHours) {
    return {
      action: spendCents >= thresholdCents ? "observe" : "none",
      rule: "too_new",
      reason: `campanha com ${Math.round(campaignAgeHours)}h — ainda no tempo de aprendizado (mínimo ${policy.minCampaignAgeHours}h)`,
      thresholdCents,
    };
  }

  if (spendCents < thresholdCents) {
    return {
      action: "none",
      rule: "below_threshold",
      reason: `gasto ${
        (spendCents / 100).toFixed(2)
      } abaixo do limiar de R$ ${(thresholdCents / 100).toFixed(2)}`,
      thresholdCents,
    };
  }

  if (conversations <= 0 && clicks <= 0) {
    return {
      action: "recommend_pause",
      rule: "zero_click",
      reason: `R$ ${
        (spendCents / 100).toFixed(2)
      } sem nenhum clique (limiar R$ ${(thresholdCents / 100).toFixed(2)})`,
      thresholdCents,
    };
  }
  if (conversations <= 0) {
    return {
      action: "recommend_pause",
      rule: "zero_conv",
      reason: `R$ ${
        (spendCents / 100).toFixed(2)
      } sem nenhuma conversa (limiar R$ ${(thresholdCents / 100).toFixed(2)})`,
      thresholdCents,
    };
  }

  return {
    action: "none",
    rule: "below_threshold",
    reason: `${conversations} conversa(s) na janela`,
    thresholdCents,
  };
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
