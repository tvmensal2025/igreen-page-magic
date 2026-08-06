/**
 * Atribuição comercial com nível de confiança.
 *
 * `meta-campaign-proof.ts` responde "tem prova Meta?" (sim/não) e continua
 * sendo o critério canônico de elegibilidade. Aqui a resposta vira uma escala,
 * porque o Cérebro precisa distinguir "6 clientes aprovados vindos de ad_id
 * confirmado" de "6 clientes que caíram nessa campanha por fallback de texto".
 * Tratar os dois como certeza é o caminho mais curto para escalar uma campanha
 * que não gerou nada.
 *
 * Ordem de força dos sinais (mesma da rule `campanha-uuid-nao-texto`):
 * AD ID → fb_campaign_id → ctwa_clid → fallback de texto.
 *
 * Puro: sem I/O. Recebe as linhas de `customers` já lidas.
 */
import { hasMetaCampaignProof } from "./meta-campaign-proof.ts";

export type AttributionConfidence = "high" | "medium" | "low" | "unattributed";

/** Forma mínima de `customers` necessária para classificar. */
export type AttributableCustomer = {
  id: string;
  source_campaign_id?: string | null;
  source_ad_id?: string | null;
  ctwa_clid?: string | null;
  source_ctwa_clid?: string | null;
  lead_source?: string | null;
  status?: string | null;
  conversation_step?: string | null;
  portal_submitted_at?: string | null;
  created_at?: string | null;
};

export type AttributionVerdict = {
  confidence: AttributionConfidence;
  campaignId: string | null;
  /** Sinais que sustentam a classificação, para o painel explicar. */
  signals: string[];
  reason: string;
};

function nonEmpty(v: unknown): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Confiança da atribuição de UM lead.
 *
 * - `high`: campanha + AD ID confirmado (o anúncio exato é conhecido).
 * - `medium`: campanha + identificador de clique CTWA, sem AD ID.
 * - `low`: campanha gravada sem nenhum sinal forte da Meta (protocolo/frase).
 * - `unattributed`: sem campanha.
 */
export function classifyAttribution(
  customer: AttributableCustomer | null | undefined,
): AttributionVerdict {
  if (!customer || !nonEmpty(customer.source_campaign_id)) {
    return {
      confidence: "unattributed",
      campaignId: null,
      signals: [],
      reason: "sem_campanha_de_origem",
    };
  }
  const campaignId = String(customer.source_campaign_id).trim();
  const signals: string[] = ["source_campaign_id"];

  if (nonEmpty(customer.source_ad_id)) {
    signals.push("source_ad_id");
    return {
      confidence: "high",
      campaignId,
      signals,
      reason: "ad_id_confirmado",
    };
  }
  if (nonEmpty(customer.ctwa_clid) || nonEmpty(customer.source_ctwa_clid)) {
    signals.push("ctwa_clid");
    return {
      confidence: "medium",
      campaignId,
      signals,
      reason: "ctwa_clid_sem_ad_id",
    };
  }
  if (customer.lead_source === "meta_ads") signals.push("lead_source_meta_ads");
  return {
    confidence: "low",
    campaignId,
    signals,
    reason: "campanha_sem_sinal_forte_meta",
  };
}

/** Compatibilidade: continua valendo o critério binário canônico. */
export function hasStrongMetaProof(customer: AttributableCustomer): boolean {
  return hasMetaCampaignProof(customer);
}

// ─────────────────────── Agregação por campanha ───────────────────────

export type CommercialStatusRules = {
  /** `customers.status` que contam como cliente aprovado. */
  approvedStatuses: readonly string[];
  /** `customers.status` que contam como cadastro em análise/enviado. */
  submittedStatuses: readonly string[];
};

export const DEFAULT_COMMERCIAL_STATUS_RULES: CommercialStatusRules = {
  approvedStatuses: ["approved", "active"],
  submittedStatuses: ["pending", "cadastro_em_analise", "approved", "active"],
};

export type CampaignAttributionTotals = {
  campaignId: string;
  /** Leads por nível de confiança (cada cliente conta uma vez só). */
  leadsHigh: number;
  leadsMedium: number;
  leadsLow: number;
  /** Soma de `high + medium` — a base considerada confiável. */
  leadsTrusted: number;
  /** Cadastros enviados ao portal, só com atribuição confiável. */
  registrationsTrusted: number;
  /** Clientes aprovados/ativos, só com atribuição confiável. */
  approvedTrusted: number;
  /** Aprovados com atribuição fraca — mostrados à parte, nunca somados. */
  approvedLowConfidence: number;
};

export type AttributionAggregate = {
  byCampaign: Map<string, CampaignAttributionTotals>;
  /** Leads sem campanha de origem. */
  unattributed: number;
  /** Ids repetidos na entrada que foram ignorados. */
  duplicatesIgnored: number;
  totalConsidered: number;
};

function emptyTotals(campaignId: string): CampaignAttributionTotals {
  return {
    campaignId,
    leadsHigh: 0,
    leadsMedium: 0,
    leadsLow: 0,
    leadsTrusted: 0,
    registrationsTrusted: 0,
    approvedTrusted: 0,
    approvedLowConfidence: 0,
  };
}

/**
 * Agrega resultados comerciais por campanha sem contar o mesmo cliente
 * duas vezes: a chave de deduplicação é `customers.id`. Linhas repetidas na
 * entrada (join duplicado, paginação sobreposta) são descartadas e contadas
 * em `duplicatesIgnored` para o diagnóstico de dados enxergar o problema.
 */
export function aggregateAttribution(
  customers: readonly AttributableCustomer[],
  rules: CommercialStatusRules = DEFAULT_COMMERCIAL_STATUS_RULES,
): AttributionAggregate {
  const byCampaign = new Map<string, CampaignAttributionTotals>();
  const seen = new Set<string>();
  let unattributed = 0;
  let duplicatesIgnored = 0;
  let totalConsidered = 0;

  const approved = new Set(rules.approvedStatuses);
  const submitted = new Set(rules.submittedStatuses);

  for (const customer of customers) {
    const id = customer?.id ? String(customer.id) : "";
    if (!id) continue;
    if (seen.has(id)) {
      duplicatesIgnored++;
      continue;
    }
    seen.add(id);
    totalConsidered++;

    const verdict = classifyAttribution(customer);
    if (verdict.confidence === "unattributed" || !verdict.campaignId) {
      unattributed++;
      continue;
    }

    const totals = byCampaign.get(verdict.campaignId) ??
      emptyTotals(verdict.campaignId);
    const isApproved = approved.has(String(customer.status || ""));

    if (verdict.confidence === "high") totals.leadsHigh++;
    else if (verdict.confidence === "medium") totals.leadsMedium++;
    else totals.leadsLow++;

    if (verdict.confidence === "low") {
      // Resultado comercial com atribuição fraca fica visível, mas fora da
      // base que autoriza escalar.
      if (isApproved) totals.approvedLowConfidence++;
    } else {
      totals.leadsTrusted++;
      if (isApproved) totals.approvedTrusted++;
      const hasSubmitted = Boolean(customer.portal_submitted_at) ||
        submitted.has(String(customer.status || ""));
      if (hasSubmitted) totals.registrationsTrusted++;
    }

    byCampaign.set(verdict.campaignId, totals);
  }

  return { byCampaign, unattributed, duplicatesIgnored, totalConsidered };
}

/** Totais de uma campanha que não apareceu na agregação. */
export function totalsForCampaign(
  aggregate: AttributionAggregate,
  campaignId: string,
): CampaignAttributionTotals {
  return aggregate.byCampaign.get(campaignId) ?? emptyTotals(campaignId);
}
