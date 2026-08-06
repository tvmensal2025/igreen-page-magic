/**
 * Três saúdes separadas — nunca um único score verde.
 *
 * O `health_score` do `campaign-brain-rank` mistura runway, dinheiro em risco e
 * score de praça num número só. Quando ele fica verde ninguém sabe se é porque
 * a campanha vende ou porque a carteira está cheia; quando fica vermelho não se
 * sabe o que consertar.
 *
 * Aqui as dimensões respondem perguntas diferentes:
 *  - DADOS: dá para confiar no que estou lendo?
 *  - META: o anúncio está entregando barato?
 *  - COMERCIAL: isso virou cliente?
 *
 * Meta boa com comercial insuficiente NÃO é campanha vencedora — é campanha
 * que ainda não provou nada.
 *
 * Puro: recebe o snapshot e devolve leitura. Não decide, não executa.
 */
import type { CampaignBrainSnapshot } from "./brain-snapshot.ts";
import type { BrainDecisionPolicy } from "./brain-policy.ts";

export type HealthLevel =
  | "unknown"
  | "insufficient"
  | "poor"
  | "fair"
  | "good"
  | "excellent";

export type HealthDimension = {
  level: HealthLevel;
  /** Frases curtas em pt-BR para o painel mostrar como cada peça pesou. */
  notes: string[];
};

export type DataHealth = HealthDimension & {
  freshnessState: string;
  completenessPct: number;
  /** Fração 0–1 dos leads com atribuição alta ou média. */
  attributionTrustRatio: number;
};

export type MetaHealth = HealthDimension & {
  spendCents: number;
  conversations: number;
  cplCents: number | null;
  /** CPL como % do alvo. 100 = exatamente no alvo. `null` sem conversa. */
  cplVsTargetPct: number | null;
  ctrBps: number;
  cpmCents: number;
  frequencyX100: number;
};

export type CommercialHealth = HealthDimension & {
  leadsTrusted: number;
  registrationsTrusted: number;
  approvedTrusted: number;
  approvedLowConfidence: number;
  /** Aprovados / leads confiáveis, em %. `null` sem leads. */
  conversionRatePct: number | null;
  /** Gasto / leads confiáveis. `null` sem leads. */
  costPerLeadCents: number | null;
  /** Gasto / aprovados confiáveis. `null` sem aprovados. */
  cacCents: number | null;
  /** Há base suficiente para declarar vencedor comercial? */
  hasEnoughData: boolean;
};

export type BrainHealth = {
  data: DataHealth;
  meta: MetaHealth;
  commercial: CommercialHealth;
};

export function evaluateDataHealth(snapshot: CampaignBrainSnapshot): DataHealth {
  const q = snapshot.dataQuality;
  const c = snapshot.commercial;
  const totalLeads = c.leadsHigh + c.leadsMedium + c.leadsLow;
  const attributionTrustRatio = totalLeads > 0
    ? (c.leadsHigh + c.leadsMedium) / totalLeads
    : 1;

  const notes: string[] = [];
  let level: HealthLevel;

  switch (q.state) {
    case "unavailable":
      level = "unknown";
      notes.push("sem métricas na janela");
      break;
    case "conflicting":
      level = "poor";
      notes.push(`sinais contraditórios: ${q.conflicts.join(", ")}`);
      break;
    case "stale":
      level = "poor";
      notes.push(
        `última sincronização há ${q.metricsAgeHours?.toFixed(1) ?? "?"}h`,
      );
      break;
    case "incomplete":
      level = "fair";
      notes.push(`${q.completenessPct}% das linhas esperadas`);
      break;
    case "fresh":
      level = attributionTrustRatio >= 0.8 ? "excellent" : "good";
      notes.push(`dados atuais, ${q.completenessPct}% completos`);
      break;
  }

  if (totalLeads > 0 && attributionTrustRatio < 0.5) {
    // Métrica fresca não salva atribuição ruim: metade dos leads sem sinal
    // Meta significa que o número comercial pode ser de outra campanha.
    level = level === "excellent" || level === "good" ? "fair" : level;
    notes.push(
      `só ${Math.round(attributionTrustRatio * 100)}% dos leads têm sinal forte da Meta`,
    );
  }
  if (q.duplicatesIgnored > 0) {
    notes.push(`${q.duplicatesIgnored} linha(s) duplicada(s) descartada(s)`);
  }

  return {
    level,
    notes,
    freshnessState: q.state,
    completenessPct: q.completenessPct,
    attributionTrustRatio: Number(attributionTrustRatio.toFixed(3)),
  };
}

export function evaluateMetaHealth(
  snapshot: CampaignBrainSnapshot,
): MetaHealth {
  const m = snapshot.meta;
  const target = snapshot.targetCplCents;
  const cplVsTargetPct = m.cplCents != null && target > 0
    ? Math.round((m.cplCents / target) * 100)
    : null;

  const notes: string[] = [];
  let level: HealthLevel;

  if (m.spendCents <= 0) {
    level = "unknown";
    notes.push("sem gasto na janela");
  } else if (m.conversations <= 0) {
    level = "poor";
    notes.push(`R$ ${(m.spendCents / 100).toFixed(2)} sem nenhuma conversa`);
  } else if (cplVsTargetPct == null) {
    level = "unknown";
    notes.push("custo por conversa indisponível");
  } else if (cplVsTargetPct <= 70) {
    level = "excellent";
    notes.push(`custo por conversa ${100 - cplVsTargetPct}% abaixo do alvo`);
  } else if (cplVsTargetPct <= 100) {
    level = "good";
    notes.push("custo por conversa dentro do alvo");
  } else if (cplVsTargetPct <= 135) {
    level = "fair";
    notes.push(`custo por conversa ${cplVsTargetPct - 100}% acima do alvo`);
  } else {
    level = "poor";
    notes.push(`custo por conversa ${cplVsTargetPct - 100}% acima do alvo`);
  }

  // CTR morto encarece o leilão mesmo com CPL momentaneamente ok.
  if (m.impressions >= 1000 && m.ctrBps < 60) {
    notes.push(`CTR baixo (${(m.ctrBps / 100).toFixed(2)}%)`);
    if (level === "excellent") level = "good";
    else if (level === "good") level = "fair";
  }
  // Acima de 3 exibições por pessoa a audiência está saturando.
  if (m.frequencyX100 >= 300) {
    notes.push(`frequência ${(m.frequencyX100 / 100).toFixed(1)}× por pessoa`);
    if (level === "excellent") level = "good";
  }

  return {
    level,
    notes,
    spendCents: m.spendCents,
    conversations: m.conversations,
    cplCents: m.cplCents,
    cplVsTargetPct,
    ctrBps: m.ctrBps,
    cpmCents: m.cpmCents,
    frequencyX100: m.frequencyX100,
  };
}

export function evaluateCommercialHealth(
  snapshot: CampaignBrainSnapshot,
  policy: BrainDecisionPolicy,
): CommercialHealth {
  const c = snapshot.commercial;
  const spend = snapshot.meta.spendCents;
  const notes: string[] = [];

  const conversionRatePct = c.leadsTrusted > 0
    ? Number(((c.approvedTrusted / c.leadsTrusted) * 100).toFixed(1))
    : null;
  const costPerLeadCents = c.leadsTrusted > 0
    ? Math.round(spend / c.leadsTrusted)
    : null;
  const cacCents = c.approvedTrusted > 0
    ? Math.round(spend / c.approvedTrusted)
    : null;

  const hasEnoughData = c.leadsTrusted >= policy.minLeadsSample;

  let level: HealthLevel;
  if (!hasEnoughData) {
    level = "insufficient";
    notes.push(
      `${c.leadsTrusted} lead(s) identificado(s) — mínimo ${policy.minLeadsSample} para julgar`,
    );
  } else if (c.approvedTrusted <= 0) {
    level = "poor";
    notes.push(`${c.leadsTrusted} lead(s), nenhum cliente aprovado ainda`);
  } else if (cacCents != null && cacCents <= policy.targetCplCents * 10) {
    level = "excellent";
    notes.push(
      `${c.approvedTrusted} cliente(s) aprovado(s), CAC R$ ${(cacCents / 100).toFixed(2)}`,
    );
  } else {
    level = "good";
    notes.push(`${c.approvedTrusted} cliente(s) aprovado(s)`);
  }

  if (c.approvedLowConfidence > 0) {
    notes.push(
      `${c.approvedLowConfidence} aprovado(s) com atribuição fraca não entram na conta`,
    );
  }
  if (c.registrationsTrusted > 0) {
    notes.push(`${c.registrationsTrusted} cadastro(s) enviado(s)`);
  }

  return {
    level,
    notes,
    leadsTrusted: c.leadsTrusted,
    registrationsTrusted: c.registrationsTrusted,
    approvedTrusted: c.approvedTrusted,
    approvedLowConfidence: c.approvedLowConfidence,
    conversionRatePct,
    costPerLeadCents,
    cacCents,
    hasEnoughData,
  };
}

export function evaluateBrainHealth(
  snapshot: CampaignBrainSnapshot,
  policy: BrainDecisionPolicy,
): BrainHealth {
  return {
    data: evaluateDataHealth(snapshot),
    meta: evaluateMetaHealth(snapshot),
    commercial: evaluateCommercialHealth(snapshot, policy),
  };
}

const LEVEL_LABEL: Record<HealthLevel, string> = {
  unknown: "sem dados",
  insufficient: "insuficiente",
  poor: "ruim",
  fair: "regular",
  good: "boa",
  excellent: "excelente",
};

export function healthLabel(level: HealthLevel): string {
  return LEVEL_LABEL[level];
}
