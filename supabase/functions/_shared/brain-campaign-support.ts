/**
 * Capacidade de atribuição da campanha.
 *
 * Responde uma pergunta anterior à decisão: dá para ligar o que a Meta cobrou
 * ao que o CRM recebeu? Sem isso, custo por conversa baixo vira "campanha
 * vencedora" só porque ninguém sabe se alguém virou cliente.
 *
 * Estrutura reconhecida neste produto = campanha Click-to-WhatsApp espelhada na
 * Meta (`fb_campaign_id` presente e não rejeitada). `facebook_campaigns` não
 * guarda o objetivo da Meta, então a estrutura é o sinal disponível — e é o que
 * de fato importa: sem espelho na Meta não há métrica para medir nem objeto
 * para agir.
 *
 * Puro: recebe o snapshot já montado. Sem I/O e sem Meta.
 */
import type { CampaignBrainSnapshot } from "./brain-snapshot.ts";
import type { DecisionConfidence } from "./brain-sample.ts";

export type CampaignSupport =
  /** Identificador forte (AD ID) e resultado comercial ligado sem ambiguidade. */
  | "commercial_attribution_full"
  /** Parte da cadeia identificada — resultado existe, mas não é certeza. */
  | "commercial_attribution_partial"
  /** Métrica Meta existe, ligação comercial não. Nunca declara vitória. */
  | "meta_only"
  /** Estrutura não reconhecida: não dá para medir nem agir. */
  | "unsupported";

export type CampaignSupportVerdict = {
  support: CampaignSupport;
  /** Teto de confiança que esta capacidade permite. */
  confidenceCeiling: DecisionConfidence;
  /** Pode ser chamada de vencedora comercial? */
  allowsCommercialWin: boolean;
  /** Pode receber recomendação que aumenta gasto? */
  allowsExpansive: boolean;
  /** Sinais que sustentam a classificação, para o painel explicar. */
  signals: string[];
  reason: string;
};

export const SUPPORT_LABEL: Record<CampaignSupport, string> = {
  commercial_attribution_full: "atribuição comercial completa",
  commercial_attribution_partial: "atribuição comercial parcial",
  meta_only: "somente métricas da Meta",
  unsupported: "estrutura não suportada",
};

export function supportLabel(support: CampaignSupport): string {
  return SUPPORT_LABEL[support];
}

const CONFIDENCE_RANK: Record<DecisionConfidence, number> = {
  low: 0,
  moderate: 1,
  good: 2,
  high: 3,
};

/**
 * Aplica o teto da capacidade sobre a confiança da amostra.
 * Só reduz — capacidade de atribuição nunca promove confiança.
 */
export function capConfidenceForSupport(
  confidence: DecisionConfidence,
  support: CampaignSupport,
): DecisionConfidence {
  const ceiling = CEILING_BY_SUPPORT[support];
  return CONFIDENCE_RANK[confidence] <= CONFIDENCE_RANK[ceiling]
    ? confidence
    : ceiling;
}

const CEILING_BY_SUPPORT: Record<CampaignSupport, DecisionConfidence> = {
  commercial_attribution_full: "high",
  // Cadeia incompleta: no máximo "moderada", que na política vale 5%.
  commercial_attribution_partial: "moderate",
  // `low` é o piso da escala e vale degrau 0% — sem CRM ligado não existe base
  // para autorizar aumento.
  meta_only: "low",
  unsupported: "low",
};

export type SupportInput = {
  fbCampaignId: string | null;
  rejectionReason: string | null;
  leadsHigh: number;
  leadsMedium: number;
  leadsLow: number;
  /** Duplicatas vistas na janela — ambiguidade rebaixa a classificação. */
  duplicatesIgnored: number;
  /** Houve entrega medida na janela (impressão ou gasto). */
  hasMetaDelivery: boolean;
};

export function classifyCampaignSupport(
  input: SupportInput,
): CampaignSupportVerdict {
  const build = (
    support: CampaignSupport,
    signals: string[],
    reason: string,
  ): CampaignSupportVerdict => ({
    support,
    confidenceCeiling: CEILING_BY_SUPPORT[support],
    allowsCommercialWin: support === "commercial_attribution_full" ||
      support === "commercial_attribution_partial",
    allowsExpansive: support === "commercial_attribution_full" ||
      support === "commercial_attribution_partial",
    signals,
    reason,
  });

  if (!input.fbCampaignId) {
    return build(
      "unsupported",
      [],
      "campanha sem espelho na Meta — não há o que medir nem o que ajustar",
    );
  }
  if (input.rejectionReason) {
    return build(
      "unsupported",
      ["rejection_reason"],
      `campanha recusada pela Meta: ${input.rejectionReason}`,
    );
  }

  const signals = ["fb_campaign_id"];
  const anyLead = input.leadsHigh + input.leadsMedium + input.leadsLow;

  if (anyLead === 0) {
    return build(
      "meta_only",
      signals,
      input.hasMetaDelivery
        ? "entrega medida na Meta, mas nenhum lead ligado a esta campanha no CRM"
        : "sem entrega e sem lead ligado — só o cadastro da campanha é conhecido",
    );
  }

  if (input.leadsHigh > 0 && input.duplicatesIgnored === 0) {
    signals.push("source_ad_id", "source_campaign_id");
    return build(
      "commercial_attribution_full",
      signals,
      `${input.leadsHigh} lead(s) com anúncio confirmado e sem duplicidade`,
    );
  }

  if (input.leadsHigh > 0) {
    signals.push("source_ad_id", "duplicatas_na_janela");
    return build(
      "commercial_attribution_partial",
      signals,
      `${input.leadsHigh} lead(s) com anúncio confirmado, mas ${input.duplicatesIgnored} registro(s) duplicado(s) na janela`,
    );
  }

  if (input.leadsMedium > 0) signals.push("ctwa_clid");
  if (input.leadsLow > 0) signals.push("campanha_sem_sinal_forte");
  return build(
    "commercial_attribution_partial",
    signals,
    input.leadsMedium > 0
      ? `${input.leadsMedium} lead(s) por clique CTWA, sem anúncio confirmado`
      : `${input.leadsLow} lead(s) sem sinal forte da Meta`,
  );
}

/** Classificação a partir de um snapshot já montado. */
export function supportForSnapshot(
  snapshot: CampaignBrainSnapshot,
): CampaignSupportVerdict {
  return classifyCampaignSupport({
    fbCampaignId: snapshot.campaign.fbCampaignId,
    rejectionReason: snapshot.campaign.rejectionReason,
    leadsHigh: snapshot.commercial.leadsHigh,
    leadsMedium: snapshot.commercial.leadsMedium,
    leadsLow: snapshot.commercial.leadsLow,
    duplicatesIgnored: snapshot.dataQuality.duplicatesIgnored,
    hasMetaDelivery: snapshot.meta.spendCents > 0 ||
      snapshot.meta.impressions > 0,
  });
}
