/**
 * Qualidade da amostra e confiança — determinístico e explicável.
 *
 * O motor legado escalava com `conv >= 5 && spend >= 517`. Cinco conversas em
 * duas horas de campanha nova não são prova de nada, e era assim que um CPL
 * ainda em aprendizado autorizava subir orçamento.
 *
 * Aqui a amostra vira uma pontuação por fatores nomeados. Não há biblioteca
 * estatística: os pesos são regras legíveis, e cada fator devolve o texto que
 * o painel mostra. As interfaces já preveem substituir o cálculo por método
 * estatístico depois (intervalo de confiança, teste sequencial) sem mexer em
 * quem consome.
 *
 * Puro: sem I/O.
 */
import type { CampaignBrainSnapshot } from "./brain-snapshot.ts";
import type { BrainDecisionPolicy } from "./brain-policy.ts";

export type SampleQuality = "insufficient" | "early" | "moderate" | "reliable";

/** Confiança derivada da amostra. Define o degrau permitido. */
export type DecisionConfidence = "low" | "moderate" | "good" | "high";

export type SampleFactor = {
  key: string;
  /** 0–1. */
  score: number;
  /** Peso relativo no total. */
  weight: number;
  note: string;
};

export type SampleAssessment = {
  quality: SampleQuality;
  confidence: DecisionConfidence;
  /** 0–1, média ponderada dos fatores. */
  score: number;
  factors: SampleFactor[];
  /** O que falta para a amostra ficar confiável. */
  missing: string[];
};

function ratio(value: number, target: number): number {
  if (target <= 0) return 1;
  return Math.max(0, Math.min(1, value / target));
}

/**
 * Avalia a amostra de UMA campanha.
 *
 * `secondWindow` é opcional: quando o chamador consegue medir uma segunda
 * janela (ex.: 7 dias além das 48h), a estabilidade entre elas entra como
 * fator. Sem ela, o fator é neutro e a nota diz isso.
 */
export function evaluateSampleQuality(
  snapshot: CampaignBrainSnapshot,
  policy: BrainDecisionPolicy,
  secondWindow?: { cplCents: number | null },
): SampleAssessment {
  const { meta, commercial, campaign, dataQuality } = snapshot;
  const factors: SampleFactor[] = [];
  const missing: string[] = [];

  // 1. Maturidade da campanha — abaixo de 72h a Meta ainda está aprendendo.
  const MATURITY_TARGET_HOURS = 72;
  const maturity = ratio(campaign.ageHours, MATURITY_TARGET_HOURS);
  factors.push({
    key: "campaign_age",
    score: maturity,
    weight: 1,
    note: maturity >= 1
      ? `campanha com ${Math.round(campaign.ageHours)}h no ar`
      : `campanha nova (${Math.round(campaign.ageHours)}h de ${MATURITY_TARGET_HOURS}h)`,
  });
  if (maturity < 1) missing.push("tempo de aprendizado da Meta");

  // 2. Gasto — precisa ter comprado audiência suficiente para o CPL significar algo.
  const spendTarget = policy.targetCplCents * policy.wasteSpendMultiplier;
  const spendScore = ratio(meta.spendCents, spendTarget);
  factors.push({
    key: "spend",
    score: spendScore,
    weight: 1,
    note: `gasto R$ ${(meta.spendCents / 100).toFixed(2)} de R$ ${
      (spendTarget / 100).toFixed(2)
    } de referência`,
  });
  if (spendScore < 1) missing.push("gasto mínimo na janela");

  // 3. Conversas Meta.
  const convScore = ratio(meta.conversations, policy.minConversationsSample);
  factors.push({
    key: "conversations",
    score: convScore,
    weight: 2,
    note: `${meta.conversations} de ${policy.minConversationsSample} conversas`,
  });
  if (convScore < 1) missing.push("conversas suficientes");

  // 4. Leads atribuídos com confiança — peso alto: é o elo com o negócio.
  const leadScore = ratio(commercial.leadsTrusted, policy.minLeadsSample);
  factors.push({
    key: "leads",
    score: leadScore,
    weight: 2,
    note: `${commercial.leadsTrusted} de ${policy.minLeadsSample} leads identificados`,
  });
  if (leadScore < 1) missing.push("leads identificados suficientes");

  // 5. Clientes aprovados — bônus; nunca obrigatório para reduzir gasto.
  const approvedScore = commercial.approvedTrusted > 0 ? 1 : 0;
  factors.push({
    key: "approved_customers",
    score: approvedScore,
    weight: 1,
    note: commercial.approvedTrusted > 0
      ? `${commercial.approvedTrusted} cliente(s) aprovado(s)`
      : "nenhum cliente aprovado ainda",
  });

  // 6. Qualidade da atribuição.
  const totalLeads = commercial.leadsHigh + commercial.leadsMedium +
    commercial.leadsLow;
  const trustRatio = totalLeads > 0
    ? (commercial.leadsHigh + commercial.leadsMedium) / totalLeads
    : 0;
  factors.push({
    key: "attribution",
    score: totalLeads > 0 ? trustRatio : 0,
    weight: 1,
    note: totalLeads > 0
      ? `${Math.round(trustRatio * 100)}% dos leads com sinal forte da Meta`
      : "sem lead atribuído",
  });
  if (totalLeads > 0 && trustRatio < 0.5) missing.push("atribuição confiável");

  // 7. Estabilidade entre janelas.
  const firstCpl = meta.cplCents;
  const secondCpl = secondWindow?.cplCents ?? null;
  let stabilityScore = 0.5;
  let stabilityNote = "sem segunda janela para comparar";
  if (firstCpl != null && secondCpl != null && secondCpl > 0) {
    const delta = Math.abs(firstCpl - secondCpl) / secondCpl;
    stabilityScore = Math.max(0, Math.min(1, 1 - delta));
    stabilityNote = `variação de ${Math.round(delta * 100)}% no custo por conversa entre janelas`;
    if (delta > 0.5) missing.push("estabilidade entre janelas");
  }
  factors.push({
    key: "stability",
    score: stabilityScore,
    weight: 1,
    note: stabilityNote,
  });

  // 8. Qualidade dos dados — sem dado confiável nenhuma amostra é confiável.
  const dataScore = dataQuality.state === "fresh"
    ? 1
    : dataQuality.state === "incomplete"
    ? 0.4
    : 0;
  factors.push({
    key: "data_quality",
    score: dataScore,
    weight: 2,
    note: `qualidade dos dados: ${dataQuality.state}`,
  });
  if (dataScore < 1) missing.push("dados atuais e completos");

  const weightSum = factors.reduce((s, f) => s + f.weight, 0);
  const score = weightSum > 0
    ? factors.reduce((s, f) => s + f.score * f.weight, 0) / weightSum
    : 0;

  // Portas duras: nenhuma soma de bônus compensa amostra ou dados ausentes.
  const hardBlocked = dataScore < 1 || convScore < 1;
  let quality: SampleQuality;
  if (hardBlocked || score < 0.4) quality = "insufficient";
  else if (score < 0.6) quality = "early";
  else if (score < 0.8) quality = "moderate";
  else quality = "reliable";

  let confidence: DecisionConfidence;
  if (quality === "insufficient" || quality === "early") confidence = "low";
  else if (quality === "moderate") confidence = "moderate";
  else confidence = score >= 0.9 ? "high" : "good";

  return {
    quality,
    confidence,
    score: Number(score.toFixed(3)),
    factors,
    missing: [...new Set(missing)],
  };
}

/**
 * Degrau máximo permitido pela confiança (%).
 * Limites iniciais da FASE 7; o teto da política ainda corta por cima.
 */
export function maxStepPctForConfidence(
  confidence: DecisionConfidence,
  policy: BrainDecisionPolicy,
): number {
  const byConfidence: Record<DecisionConfidence, number> = {
    low: 0,
    moderate: 5,
    good: 8,
    high: 10,
  };
  return Math.min(policy.maxStepPct, byConfidence[confidence]);
}

const QUALITY_LABEL: Record<SampleQuality, string> = {
  insufficient: "insuficiente",
  early: "inicial",
  moderate: "moderada",
  reliable: "confiável",
};

const CONFIDENCE_LABEL: Record<DecisionConfidence, string> = {
  low: "baixa",
  moderate: "moderada",
  good: "boa",
  high: "alta",
};

export function sampleQualityLabel(quality: SampleQuality): string {
  return QUALITY_LABEL[quality];
}

export function confidenceLabel(confidence: DecisionConfidence): string {
  return CONFIDENCE_LABEL[confidence];
}
