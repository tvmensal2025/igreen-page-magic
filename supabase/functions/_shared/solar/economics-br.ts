import type { BuildingInsightsResponse, SolarMetrics, SolarPanelConfig } from "./types.ts";

// =============================================================================
// Modelo econômico de energia solar — Brasil (alta precisão para proposta)
// =============================================================================
// Objetivo: estimativa comercial confiável (não projeto executivo). Considera:
//   - Tarifa residencial por estado (UF) — varia muito entre concessionárias.
//   - Regra do Fio B (Lei 14.300/2022) sobre a energia injetada na rede.
//   - Autoconsumo instantâneo x energia injetada (compensada).
//   - CO2 evitado e payback simples do investimento.
// Todos os valores são estimativas com base em médias de mercado 2025/2026.
// =============================================================================

/** Tarifa média BR usada como fallback quando não há UF (R$/kWh, com tributos). */
export const DEFAULT_TARIFF_KWH_BRL = 0.92;

/**
 * Tarifa residencial média por UF (R$/kWh, já com tributos — referência
 * comercial 2025/2026). Usada quando o cliente tem `address_state` preenchido.
 * São médias aproximadas; a conta real do cliente sempre prevalece.
 */
export const TARIFF_BY_UF: Record<string, number> = {
  AC: 0.83, AL: 0.97, AM: 0.95, AP: 0.80, BA: 0.98, CE: 0.86, DF: 0.84,
  ES: 0.92, GO: 0.96, MA: 0.92, MG: 1.05, MS: 0.93, MT: 0.98, PA: 0.99,
  PB: 0.90, PE: 0.92, PI: 0.95, PR: 0.83, RJ: 1.04, RN: 0.90, RO: 0.88,
  RR: 0.82, RS: 0.95, SC: 0.83, SE: 0.93, SP: 0.85, TO: 0.97,
};

/** Retorna a tarifa (R$/kWh) para a UF informada, com fallback na média BR. */
export function tariffForUF(uf?: string | null): number {
  if (!uf) return DEFAULT_TARIFF_KWH_BRL;
  return TARIFF_BY_UF[uf.trim().toUpperCase()] ?? DEFAULT_TARIFF_KWH_BRL;
}

/**
 * Tarifa por distribuidora (R$/kWh, residencial B1 com tributos — referência
 * comercial 2025/2026). Mais precisa que por UF. As chaves são normalizadas
 * (maiúsculas, sem acento) e o match aceita prefixo de grupo (ex.: "CPFL").
 */
export const TARIFF_BY_DISTRIBUIDORA: Record<string, number> = {
  "CPFL PAULISTA": 0.86,
  "CPFL PIRATININGA": 0.84,
  "CPFL SANTA CRUZ": 0.88,
  "CPFL": 0.85,
  "ENEL SP": 0.83,
  "ENEL RJ": 1.04,
  "ENEL CE": 0.86,
  "ELEKTRO": 0.84,
  "EDP SP": 0.83,
  "EDP ES": 0.92,
  "LIGHT": 1.06,
  "CEMIG": 1.05,
  "CEMIG-D": 1.05,
  "COPEL": 0.83,
  "CELESC": 0.83,
  "RGE": 0.95,
  "EQUATORIAL": 0.97,
  "ENERGISA": 0.96,
  "ENERGISA SUL SUDESTE": 0.95,
  "NEOENERGIA": 0.93,
  "COELBA": 0.98,
  "CELPE": 0.92,
  "COSERN": 0.90,
};

function normalizeKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Tarifa por distribuidora com fallback inteligente: tenta match exato, depois
 * por prefixo de grupo (ex.: "CPFL ..."), e por fim cai na tarifa da UF.
 */
export function tariffForDistribuidora(distribuidora?: string | null, uf?: string | null): number {
  if (distribuidora) {
    const key = normalizeKey(distribuidora);
    if (TARIFF_BY_DISTRIBUIDORA[key]) return TARIFF_BY_DISTRIBUIDORA[key];
    const group = key.split(" ")[0];
    if (TARIFF_BY_DISTRIBUIDORA[group]) return TARIFF_BY_DISTRIBUIDORA[group];
  }
  return tariffForUF(uf);
}

/**
 * Cronograma do Fio B (Lei 14.300/2022): fração da TUSD Fio B cobrada sobre a
 * energia injetada na rede, por ano de conexão. Sobe gradualmente até 100%.
 */
export const FIO_B_SCHEDULE: Record<number, number> = {
  2023: 0.15, 2024: 0.30, 2025: 0.45, 2026: 0.60, 2027: 0.75, 2028: 0.90,
};

/** Fração do Fio B vigente no ano (1.0 = 100% a partir de 2029). */
export function fioBFractionForYear(year: number): number {
  if (year <= 2023) return 0.15;
  if (year >= 2029) return 1.0;
  return FIO_B_SCHEDULE[year] ?? 1.0;
}

/** Parcela do Fio B dentro da tarifa cheia (~28% — componente de distribuição). */
export const FIO_B_SHARE_OF_TARIFF = 0.28;

/** Fração da geração consumida na hora (não injetada) — residencial típico. */
export const SELF_CONSUMPTION_RATIO = 0.30;

/** Custo do kWp instalado (centavos) — referência de mercado p/ payback. */
export const COST_PER_KWP_CENTS = 420_000;

/** Converte conta mensal (R$) em consumo estimado (kWh) pela tarifa. */
export function monthlyKwhFromBill(monthlyBillReais: number, tariff = DEFAULT_TARIFF_KWH_BRL): number {
  if (!Number.isFinite(monthlyBillReais) || monthlyBillReais <= 0) return 0;
  return monthlyBillReais / (tariff > 0 ? tariff : DEFAULT_TARIFF_KWH_BRL);
}

export function pickPanelConfig(
  configs: SolarPanelConfig[] | undefined,
  targetPanels: number,
): SolarPanelConfig | null {
  if (!configs?.length) return null;
  const exact = configs.find((c) => c.panelsCount === targetPanels);
  if (exact) return exact;
  const below = configs.filter((c) => c.panelsCount <= targetPanels);
  return below.length ? below[below.length - 1] : configs[0];
}

export function pickPresets(
  configs: SolarPanelConfig[] | undefined,
  monthlyBillReais: number | null | undefined,
  tariff = DEFAULT_TARIFF_KWH_BRL,
): { eco: SolarPanelConfig | null; ideal: SolarPanelConfig | null } {
  if (!configs?.length) return { eco: null, ideal: null };
  const monthlyKwh = monthlyBillReais && monthlyBillReais > 0
    ? monthlyKwhFromBill(monthlyBillReais, tariff)
    : null;
  const targetYearly = monthlyKwh ? monthlyKwh * 12 * 0.85 : null;
  const ecoTarget = monthlyKwh ? monthlyKwh * 12 * 0.70 : null;

  const ideal = targetYearly
    ? configs.find((c) => c.yearlyEnergyDcKwh >= targetYearly) ?? configs[configs.length - 1]
    : configs[Math.min(14, configs.length - 1)] ?? null;
  const eco = ecoTarget
    ? configs.find((c) => c.yearlyEnergyDcKwh >= ecoTarget) ?? configs[Math.min(8, configs.length - 1)]
    : configs[Math.min(8, configs.length - 1)] ?? null;

  return { eco, ideal };
}

export interface SavingsContext {
  /** Tarifa R$/kWh. Se ausente, usa média BR. */
  tariff?: number;
  /** Consumo mensal real do cliente (kWh) — vindo da carteira/conta. */
  monthlyConsumptionKwh?: number | null;
  /** Valor da conta mensal (R$) — usado se não houver consumo em kWh. */
  monthlyBillReais?: number | null;
  /** Ano de referência para a regra do Fio B. */
  year?: number;
}

export interface SavingsBreakdown {
  monthlySavingsCents: number;
  tariffKwhBrl: number;
  monthlyGenerationKwh: number;
  monthlyConsumptionKwh: number | null;
  /** Energia efetivamente aproveitada por mês (limitada pelo consumo). */
  usefulKwh: number;
  fioBFraction: number;
}

/**
 * Estima a economia mensal (centavos) com modelo detalhado:
 *   - Não economiza mais do que o cliente consome (excedente vira crédito,
 *     mas para a conta mensal limitamos ao consumo — estimativa conservadora).
 *   - Autoconsumo não paga Fio B; a parte injetada paga Fio B conforme o ano.
 */
export function estimateMonthlySavings(ctx: SavingsContext & { yearlyEnergyKwh: number }): SavingsBreakdown {
  const tariff = ctx.tariff && ctx.tariff > 0 ? ctx.tariff : DEFAULT_TARIFF_KWH_BRL;
  const year = ctx.year ?? new Date().getUTCFullYear();
  const fioBFraction = fioBFractionForYear(year);

  const monthlyGen = Math.max(0, ctx.yearlyEnergyKwh / 12);

  let monthlyConsumption: number | null = null;
  if (ctx.monthlyConsumptionKwh && ctx.monthlyConsumptionKwh > 0) {
    monthlyConsumption = ctx.monthlyConsumptionKwh;
  } else if (ctx.monthlyBillReais && ctx.monthlyBillReais > 0) {
    monthlyConsumption = monthlyKwhFromBill(ctx.monthlyBillReais, tariff);
  }

  // Energia útil: não adianta gerar mais do que o cliente consome (na conta mês).
  const useful = monthlyConsumption != null
    ? Math.min(monthlyGen, monthlyConsumption)
    : monthlyGen;

  const selfConsumed = useful * SELF_CONSUMPTION_RATIO;
  const injected = useful - selfConsumed;

  // Autoconsumo: economiza tarifa cheia. Injetado: tarifa cheia menos Fio B.
  const fioBCostPerKwh = tariff * FIO_B_SHARE_OF_TARIFF * fioBFraction;
  const grossSavings = useful * tariff;
  const fioBCost = injected * fioBCostPerKwh;
  const monthlySavings = Math.max(0, grossSavings - fioBCost);

  return {
    monthlySavingsCents: Math.round(monthlySavings * 100),
    tariffKwhBrl: tariff,
    monthlyGenerationKwh: Math.round(monthlyGen),
    monthlyConsumptionKwh: monthlyConsumption != null ? Math.round(monthlyConsumption) : null,
    usefulKwh: Math.round(useful),
    fioBFraction,
  };
}

/**
 * Compatível com chamadas antigas. Usa o modelo detalhado com tarifa média BR
 * quando só há o valor da conta. Mantida para retrocompatibilidade.
 */
export function estimateMonthlySavingsCents(
  yearlyEnergyKwh: number,
  electricityBillValue: number | null | undefined,
  ctx?: SavingsContext,
): number {
  return estimateMonthlySavings({
    yearlyEnergyKwh,
    tariff: ctx?.tariff,
    monthlyConsumptionKwh: ctx?.monthlyConsumptionKwh,
    monthlyBillReais: electricityBillValue,
    year: ctx?.year,
  }).monthlySavingsCents;
}

export interface BuildMetricsContext {
  /** UF do cliente para tarifa regional. */
  uf?: string | null;
  /** Distribuidora do cliente (tarifa mais precisa que UF). */
  distribuidora?: string | null;
  /** Consumo mensal real (kWh). */
  monthlyConsumptionKwh?: number | null;
  /** Ano de referência (Fio B). Default: ano atual. */
  year?: number;
}

export function buildMetrics(
  insights: BuildingInsightsResponse,
  panelsCount: number,
  electricityBillValue?: number | null,
  ctx?: BuildMetricsContext,
): SolarMetrics {
  const sp = insights.solarPotential ?? {};
  const panelWatts = sp.panelCapacityWatts ?? 410;
  const maxPanels = sp.maxArrayPanelsCount ?? sp.solarPanels?.length ?? panelsCount;
  const count = Math.min(Math.max(1, panelsCount), maxPanels);
  const cfg = pickPanelConfig(sp.solarPanelConfigs, count);
  const yearly = cfg?.yearlyEnergyDcKwh ?? count * panelWatts * 1.4;
  const kwp = (count * panelWatts) / 1000;

  const tariff = tariffForDistribuidora(ctx?.distribuidora, ctx?.uf);
  const savings = estimateMonthlySavings({
    yearlyEnergyKwh: yearly,
    tariff,
    monthlyConsumptionKwh: ctx?.monthlyConsumptionKwh,
    monthlyBillReais: electricityBillValue,
    year: ctx?.year,
  });

  // CO2 evitado/ano: fator do Google (kg/MWh) × geração (MWh).
  const co2Factor = sp.carbonOffsetFactorKgPerMwh ?? 84; // média BR ~84 kg/MWh
  const yearlyCo2OffsetKg = Math.round((yearly / 1000) * co2Factor);

  // Payback simples: custo do sistema / economia anual.
  const projectCostCents = Math.round(kwp * COST_PER_KWP_CENTS);
  const yearlySavingsCents = savings.monthlySavingsCents * 12;
  const paybackYears = yearlySavingsCents > 0
    ? Math.round((projectCostCents / yearlySavingsCents) * 10) / 10
    : null;

  return {
    panelCapacityWatts: panelWatts,
    panelsCount: count,
    systemSizeKwp: Math.round(kwp * 100) / 100,
    yearlyEnergyKwh: Math.round(yearly),
    estimatedMonthlySavingsCents: savings.monthlySavingsCents,
    maxPanels,
    imageryQuality: insights.imageryQuality ?? "UNKNOWN",
    tariffKwhBrl: tariff,
    monthlyConsumptionKwh: savings.monthlyConsumptionKwh,
    fioBFraction: savings.fioBFraction,
    yearlyCo2OffsetKg,
    estimatedProjectCostCents: projectCostCents,
    paybackYears,
  };
}

export function extractPanelPositions(insights: BuildingInsightsResponse, count: number) {
  const sp = insights.solarPotential ?? {};
  const panels = sp.solarPanels ?? [];
  const segments = sp.roofSegmentStats ?? [];
  // Dimensões reais do módulo (m), vindas da Solar API.
  const panelW = sp.panelWidthMeters ?? 1.045;
  const panelH = sp.panelHeightMeters ?? 1.879;
  return panels.slice(0, count).map((p, i) => {
    const segIdx = p.segmentIndex ?? 0;
    const seg = segments[segIdx];
    return {
      index: i,
      lat: p.center?.latitude ?? null,
      lng: p.center?.longitude ?? null,
      segmentIndex: segIdx,
      yearlyKwh: p.yearlyEnergyDcKwh ?? null,
      // Orientação real do módulo no telhado.
      orientation: p.orientation ?? "LANDSCAPE",
      // Azimute do segmento de telhado (graus) — para girar o módulo no desenho.
      azimuthDegrees: seg?.azimuthDegrees ?? null,
      // Dimensão real (m) considerando a orientação.
      widthM: p.orientation === "PORTRAIT" ? panelW : panelH,
      heightM: p.orientation === "PORTRAIT" ? panelH : panelW,
    };
  });
}

export function extractRoofSegments(insights: BuildingInsightsResponse) {
  return (insights.solarPotential?.roofSegmentStats ?? []).map((s, i) => ({
    index: i,
    pitchDegrees: s.pitchDegrees ?? null,
    azimuthDegrees: s.azimuthDegrees ?? null,
    areaM2: s.stats?.areaMeters2 ?? null,
    lat: s.center?.latitude ?? null,
    lng: s.center?.longitude ?? null,
  }));
}

export function suggestProjectAmountCents(systemKwp: number): number {
  return Math.round(systemKwp * COST_PER_KWP_CENTS);
}
