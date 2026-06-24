import type { BuildingInsightsResponse, SolarMetrics, SolarPanelConfig } from "./types.ts";

/** Tarifa média residencial BR (R$/kWh) — estima consumo a partir da conta. */
export const DEFAULT_TARIFF_KWH_BRL = 0.92;

export function monthlyKwhFromBill(monthlyBillReais: number): number {
  if (!Number.isFinite(monthlyBillReais) || monthlyBillReais <= 0) return 0;
  return monthlyBillReais / DEFAULT_TARIFF_KWH_BRL;
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
): { eco: SolarPanelConfig | null; ideal: SolarPanelConfig | null } {
  if (!configs?.length) return { eco: null, ideal: null };
  const monthlyKwh = monthlyBillReais && monthlyBillReais > 0
    ? monthlyKwhFromBill(monthlyBillReais)
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

export function estimateMonthlySavingsCents(
  yearlyEnergyKwh: number,
  electricityBillValue: number | null | undefined,
): number {
  const monthlyGenKwh = yearlyEnergyKwh / 12;
  const monthlyFromSolarCents = Math.round(monthlyGenKwh * DEFAULT_TARIFF_KWH_BRL * 100);
  if (!electricityBillValue || electricityBillValue <= 0) {
    return monthlyFromSolarCents;
  }
  const capFromBillCents = Math.round(electricityBillValue * 0.85 * 100);
  return Math.min(capFromBillCents, monthlyFromSolarCents);
}

export function buildMetrics(
  insights: BuildingInsightsResponse,
  panelsCount: number,
  electricityBillValue?: number | null,
): SolarMetrics {
  const sp = insights.solarPotential ?? {};
  const panelWatts = sp.panelCapacityWatts ?? 410;
  const maxPanels = sp.maxArrayPanelsCount ?? sp.solarPanels?.length ?? panelsCount;
  const count = Math.min(Math.max(1, panelsCount), maxPanels);
  const cfg = pickPanelConfig(sp.solarPanelConfigs, count);
  const yearly = cfg?.yearlyEnergyDcKwh ?? count * panelWatts * 1.4;
  const kwp = (count * panelWatts) / 1000;

  return {
    panelCapacityWatts: panelWatts,
    panelsCount: count,
    systemSizeKwp: Math.round(kwp * 100) / 100,
    yearlyEnergyKwh: Math.round(yearly),
    estimatedMonthlySavingsCents: estimateMonthlySavingsCents(yearly, electricityBillValue),
    maxPanels,
    imageryQuality: insights.imageryQuality ?? "UNKNOWN",
  };
}

export function extractPanelPositions(insights: BuildingInsightsResponse, count: number) {
  const panels = insights.solarPotential?.solarPanels ?? [];
  return panels.slice(0, count).map((p, i) => ({
    index: i,
    lat: p.center?.latitude ?? null,
    lng: p.center?.longitude ?? null,
    segmentIndex: p.segmentIndex ?? 0,
    yearlyKwh: p.yearlyEnergyDcKwh ?? null,
  }));
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
  const perKwp = 420_000;
  return Math.round(systemKwp * perKwp);
}
