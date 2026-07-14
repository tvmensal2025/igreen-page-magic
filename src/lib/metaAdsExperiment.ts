export type MetaAdsExperimentStatus =
  | "reducao_confirmada"
  | "sem_evidencia"
  | "inconclusivo";

export type MetaAdsPrimaryMetric = "approved" | "crmContacts";

export interface MetaAdsDailyMetrics {
  date: string;
  spendCents: number;
  impressions: number;
  conversations: number;
  metaLeads: number;
  crmContacts: number;
  approved: number;
}

export interface MetaAdsCampaignContext {
  id: string;
  consultantId: string;
  distribuidora: string | null;
  cities: unknown;
  ageMin: number;
  ageMax: number;
  dailyBudgetCents: number;
  optimizationStrategy: string | null;
  trackingProtocol: string | null;
}

export interface MetaAdsExperimentArm {
  context: MetaAdsCampaignContext;
  dailyMetrics: MetaAdsDailyMetrics[];
}

export interface MetaAdsExperimentStage {
  key: "comparabilidade" | "janela" | "metrica" | "evidencia";
  label: string;
  passed: boolean;
  detail: string;
}

export interface MetaAdsArmSummary {
  spendCents: number;
  impressions: number;
  conversations: number;
  metaLeads: number;
  crmContacts: number;
  approved: number;
  costPerConversationCents: number | null;
  costPerMetaLeadCents: number | null;
  costPerCrmContactCents: number | null;
  costPerApprovedCents: number | null;
  maxDailySpendShare: number | null;
}

export interface MetaAdsExperimentResult {
  status: MetaAdsExperimentStatus;
  reasons: string[];
  stages: MetaAdsExperimentStage[];
  overlapDates: string[];
  primaryMetric: MetaAdsPrimaryMetric | null;
  control: MetaAdsArmSummary;
  variant: MetaAdsArmSummary;
  costRatio: number | null;
  upper95: number | null;
  pointReduction: number | null;
  minimumPointReduction: number;
  bootstrapIterations: number;
}

export interface MetaAdsExperimentOptions {
  today: string;
  minimumPointReduction?: number;
  bootstrapIterations?: number;
  seed?: number;
}

const MINIMUM_DAYS = 7;
const MINIMUM_IMPRESSIONS = 1_000;
const MINIMUM_PRIMARY_EVENTS = 20;
const DEFAULT_MINIMUM_REDUCTION = 0.1;
const DEFAULT_BOOTSTRAP_ITERATIONS = 5_000;
const DEFAULT_SEED = 0x4d455441;

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function normalizedText(value: string | null): string {
  return (value ?? "").trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
}

function normalizedCities(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((city) => {
      if (typeof city === "string") return normalizedText(city);
      if (city && typeof city === "object") {
        const item = city as Record<string, unknown>;
        const name = typeof item.name === "string" ? item.name : "";
        const key = typeof item.key === "string" ? item.key : "";
        return normalizedText(name || key);
      }
      return "";
    })
    .filter(Boolean)
    .sort();
}

function sameArray(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function relativeDifference(left: number, right: number): number {
  const maximum = Math.max(Math.abs(left), Math.abs(right));
  return maximum === 0 ? 0 : Math.abs(left - right) / maximum;
}

function addMetrics(left: MetaAdsDailyMetrics, right: MetaAdsDailyMetrics): MetaAdsDailyMetrics {
  return {
    date: left.date,
    spendCents: finiteNonNegative(left.spendCents) + finiteNonNegative(right.spendCents),
    impressions: finiteNonNegative(left.impressions) + finiteNonNegative(right.impressions),
    conversations: finiteNonNegative(left.conversations) + finiteNonNegative(right.conversations),
    metaLeads: finiteNonNegative(left.metaLeads) + finiteNonNegative(right.metaLeads),
    crmContacts: finiteNonNegative(left.crmContacts) + finiteNonNegative(right.crmContacts),
    approved: finiteNonNegative(left.approved) + finiteNonNegative(right.approved),
  };
}

function byCompleteDate(rows: MetaAdsDailyMetrics[], today: string): Map<string, MetaAdsDailyMetrics> {
  const result = new Map<string, MetaAdsDailyMetrics>();
  for (const row of rows) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || row.date >= today) continue;
    const clean = addMetrics({
      date: row.date,
      spendCents: 0,
      impressions: 0,
      conversations: 0,
      metaLeads: 0,
      crmContacts: 0,
      approved: 0,
    }, row);
    result.set(row.date, result.has(row.date) ? addMetrics(result.get(row.date)!, clean) : clean);
  }
  return result;
}

function summarize(rows: MetaAdsDailyMetrics[]): MetaAdsArmSummary {
  const totals = rows.reduce(addMetrics, {
    date: "",
    spendCents: 0,
    impressions: 0,
    conversations: 0,
    metaLeads: 0,
    crmContacts: 0,
    approved: 0,
  });
  const cost = (events: number) => events > 0 ? totals.spendCents / events : null;
  const maximumSpend = rows.reduce((maximum, row) => Math.max(maximum, row.spendCents), 0);
  return {
    spendCents: totals.spendCents,
    impressions: totals.impressions,
    conversations: totals.conversations,
    metaLeads: totals.metaLeads,
    crmContacts: totals.crmContacts,
    approved: totals.approved,
    costPerConversationCents: cost(totals.conversations),
    costPerMetaLeadCents: cost(totals.metaLeads),
    costPerCrmContactCents: cost(totals.crmContacts),
    costPerApprovedCents: cost(totals.approved),
    maxDailySpendShare: totals.spendCents > 0 ? maximumSpend / totals.spendCents : null,
  };
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function percentile(values: number[], probability: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(probability * sorted.length) - 1] ?? sorted[sorted.length - 1];
}

function pairedBootstrapUpper95(
  control: MetaAdsDailyMetrics[],
  variant: MetaAdsDailyMetrics[],
  metric: MetaAdsPrimaryMetric,
  iterations: number,
  seed: number,
): number | null {
  const random = mulberry32(seed);
  const ratios: number[] = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let controlSpend = 0;
    let variantSpend = 0;
    let controlEvents = 0;
    let variantEvents = 0;
    for (let sample = 0; sample < control.length; sample += 1) {
      const index = Math.floor(random() * control.length);
      controlSpend += control[index].spendCents;
      variantSpend += variant[index].spendCents;
      controlEvents += control[index][metric];
      variantEvents += variant[index][metric];
    }
    if (controlSpend > 0 && variantSpend > 0 && controlEvents > 0 && variantEvents > 0) {
      ratios.push((variantSpend / variantEvents) / (controlSpend / controlEvents));
    }
  }
  return percentile(ratios, 0.95);
}

export function evaluateMetaAdsExperiment(
  controlArm: MetaAdsExperimentArm,
  variantArm: MetaAdsExperimentArm,
  options: MetaAdsExperimentOptions,
): MetaAdsExperimentResult {
  const minimumReduction = options.minimumPointReduction ?? DEFAULT_MINIMUM_REDUCTION;
  const iterations = Math.max(DEFAULT_BOOTSTRAP_ITERATIONS, Math.floor(options.bootstrapIterations ?? DEFAULT_BOOTSTRAP_ITERATIONS));
  const reasons: string[] = [];
  const stages: MetaAdsExperimentStage[] = [];
  const contextIssues: string[] = [];
  const controlContext = controlArm.context;
  const variantContext = variantArm.context;

  if (controlContext.consultantId !== variantContext.consultantId) contextIssues.push("As campanhas pertencem a consultores diferentes.");
  if (controlContext.id === variantContext.id) contextIssues.push("Controle e variante precisam ser campanhas diferentes.");
  if (normalizedText(controlContext.distribuidora) !== normalizedText(variantContext.distribuidora)) contextIssues.push("As distribuidoras são diferentes.");
  if (!sameArray(normalizedCities(controlContext.cities), normalizedCities(variantContext.cities))) contextIssues.push("As cidades segmentadas são diferentes.");
  if (controlContext.ageMin !== variantContext.ageMin || controlContext.ageMax !== variantContext.ageMax) contextIssues.push("As faixas etárias são diferentes.");
  if (normalizedText(controlContext.optimizationStrategy) !== normalizedText(variantContext.optimizationStrategy)) contextIssues.push("As estratégias de otimização são diferentes.");
  if (normalizedText(controlContext.trackingProtocol) !== normalizedText(variantContext.trackingProtocol)) contextIssues.push("Os protocolos de rastreamento são diferentes.");
  if (relativeDifference(controlContext.dailyBudgetCents, variantContext.dailyBudgetCents) > 0.2) contextIssues.push("Os orçamentos diários diferem mais de 20%.");
  stages.push({ key: "comparabilidade", label: "Contexto comparável", passed: contextIssues.length === 0, detail: contextIssues.length ? contextIssues.join(" ") : "Consultor, distribuidora, cidades, idade, otimização, rastreamento e orçamento são comparáveis." });
  reasons.push(...contextIssues);

  const controlByDate = byCompleteDate(controlArm.dailyMetrics, options.today);
  const variantByDate = byCompleteDate(variantArm.dailyMetrics, options.today);
  const overlapDates = [...controlByDate.keys()].filter((date) => variantByDate.has(date)).sort();
  const controlRows = overlapDates.map((date) => controlByDate.get(date)!);
  const variantRows = overlapDates.map((date) => variantByDate.get(date)!);
  const control = summarize(controlRows);
  const variant = summarize(variantRows);
  const windowIssues: string[] = [];
  if (overlapDates.length < MINIMUM_DAYS) windowIssues.push(`Há ${overlapDates.length} dia(s) completo(s) sobreposto(s); são necessários pelo menos ${MINIMUM_DAYS}.`);
  if (control.impressions < MINIMUM_IMPRESSIONS || variant.impressions < MINIMUM_IMPRESSIONS) windowIssues.push("Cada braço precisa de pelo menos 1.000 impressões nos dias sobrepostos.");
  if (relativeDifference(control.spendCents, variant.spendCents) > 0.3) windowIssues.push("O gasto observado entre os braços difere mais de 30%.");
  if ((control.maxDailySpendShare ?? 1) > 0.4 || (variant.maxDailySpendShare ?? 1) > 0.4) windowIssues.push("Pelo menos um braço concentra mais de 40% do gasto em um único dia.");
  stages.push({ key: "janela", label: "Janela e distribuição", passed: windowIssues.length === 0, detail: windowIssues.length ? windowIssues.join(" ") : `${overlapDates.length} dias completos sobrepostos, com volume e gasto distribuído suficientes.` });
  reasons.push(...windowIssues);

  let primaryMetric: MetaAdsPrimaryMetric | null = null;
  if (control.approved >= MINIMUM_PRIMARY_EVENTS && variant.approved >= MINIMUM_PRIMARY_EVENTS) primaryMetric = "approved";
  else if (control.crmContacts >= MINIMUM_PRIMARY_EVENTS && variant.crmContacts >= MINIMUM_PRIMARY_EVENTS) primaryMetric = "crmContacts";
  const metricIssue = primaryMetric ? [] : ["Não há 20 eventos por braço em aprovados nem em contatos CRM."];
  stages.push({ key: "metrica", label: "Métrica principal", passed: Boolean(primaryMetric), detail: primaryMetric === "approved" ? "Aprovados foi escolhida: ambos os braços têm pelo menos 20 eventos." : primaryMetric === "crmContacts" ? "Contatos CRM foi escolhida: aprovados não atingiu o mínimo em ambos, mas contatos atingiu." : metricIssue[0] });
  reasons.push(...metricIssue);

  const costFor = (summary: MetaAdsArmSummary) => primaryMetric === "approved" ? summary.costPerApprovedCents : summary.costPerCrmContactCents;
  const controlCost = primaryMetric ? costFor(control) : null;
  const variantCost = primaryMetric ? costFor(variant) : null;
  const costRatio = controlCost && variantCost ? variantCost / controlCost : null;
  const pointReduction = costRatio === null ? null : 1 - costRatio;
  const prerequisitesPassed = contextIssues.length === 0 && windowIssues.length === 0 && Boolean(primaryMetric) && costRatio !== null;
  const upper95 = prerequisitesPassed
    ? pairedBootstrapUpper95(controlRows, variantRows, primaryMetric!, iterations, options.seed ?? DEFAULT_SEED)
    : null;

  let status: MetaAdsExperimentStatus = "inconclusivo";
  let evidenceDetail = "A evidência não foi calculada porque uma etapa anterior não foi atendida.";
  if (prerequisitesPassed && upper95 !== null && pointReduction !== null) {
    const minimumPassed = pointReduction >= minimumReduction;
    const confidencePassed = upper95 < 1;
    if (minimumPassed && confidencePassed) {
      status = "reducao_confirmada";
      evidenceDetail = "A redução mínima foi atingida e o limite superior unilateral de 95% ficou abaixo de 1.";
    } else {
      status = "sem_evidencia";
      if (!minimumPassed) reasons.push(`A redução pontual ficou abaixo do mínimo configurado de ${(minimumReduction * 100).toFixed(0)}%.`);
      if (!confidencePassed) reasons.push("O limite superior unilateral de 95% não ficou abaixo de 1.");
      evidenceDetail = "Os dados são analisáveis, mas não atendem simultaneamente à redução mínima e ao limite de confiança.";
    }
  } else if (prerequisitesPassed) {
    reasons.push("O bootstrap não produziu reamostragens válidas suficientes.");
    evidenceDetail = "Não foi possível estimar um limite de confiança válido.";
  }
  stages.push({ key: "evidencia", label: "Evidência estatística", passed: status === "reducao_confirmada", detail: evidenceDetail });

  return {
    status,
    reasons,
    stages,
    overlapDates,
    primaryMetric,
    control,
    variant,
    costRatio,
    upper95,
    pointReduction,
    minimumPointReduction: minimumReduction,
    bootstrapIterations: iterations,
  };
}
