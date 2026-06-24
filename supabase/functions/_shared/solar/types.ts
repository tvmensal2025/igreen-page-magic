export type ImageryQuality = "HIGH" | "MEDIUM" | "BASE" | "UNKNOWN";

export interface SolarPanelConfig {
  panelsCount: number;
  yearlyEnergyDcKwh: number;
}

export interface RoofSegmentStat {
  pitchDegrees?: number;
  azimuthDegrees?: number;
  stats?: { areaMeters2?: number; sunshineQuantiles?: number[] };
  center?: { latitude: number; longitude: number };
}

export interface SolarPanelSlot {
  center?: { latitude: number; longitude: number };
  segmentIndex?: number;
  yearlyEnergyDcKwh?: number;
}

export interface BuildingInsightsResponse {
  name?: string;
  center?: { latitude: number; longitude: number };
  imageryDate?: { year: number; month: number; day: number };
  imageryQuality?: ImageryQuality;
  solarPotential?: {
    maxArrayPanelsCount?: number;
    maxSunshineHoursPerYear?: number;
    panelCapacityWatts?: number;
    carbonOffsetFactorKgPerMwh?: number;
    solarPanelConfigs?: SolarPanelConfig[];
    solarPanels?: SolarPanelSlot[];
    roofSegmentStats?: RoofSegmentStat[];
  };
}

export interface DataLayersResponse {
  imageryQuality?: ImageryQuality;
  imageryDate?: { year: number; month: number; day: number };
  dsmUrl?: string;
  rgbUrl?: string;
  maskUrl?: string;
  annualFluxUrl?: string;
  monthlyFluxUrl?: string;
  hourlyShadeUrls?: string[];
}

export interface SolarMetrics {
  panelCapacityWatts: number;
  panelsCount: number;
  systemSizeKwp: number;
  yearlyEnergyKwh: number;
  estimatedMonthlySavingsCents: number;
  maxPanels: number;
  imageryQuality: ImageryQuality;
  /** Tarifa R$/kWh usada no cálculo (regional por UF quando disponível). */
  tariffKwhBrl?: number;
  /** Consumo mensal considerado (kWh), quando conhecido. */
  monthlyConsumptionKwh?: number | null;
  /** Fração do Fio B (Lei 14.300) aplicada no ano de referência. */
  fioBFraction?: number;
  /** CO2 evitado por ano (kg). */
  yearlyCo2OffsetKg?: number;
  /** Custo estimado do sistema (centavos) para cálculo de payback. */
  estimatedProjectCostCents?: number;
  /** Payback simples estimado (anos). */
  paybackYears?: number | null;
}

/**
 * Enquadramento da imagem de satélite real do telhado. Permite ao frontend
 * projetar lat/lng dos painéis sobre a imagem (mesma projeção Web Mercator).
 */
export interface SolarImageryView {
  centerLat: number;
  centerLng: number;
  zoom: number;
  sizePx: number;
  scale: number;
}

export const SOLAR_DISCLAIMER =
  "Estimativa comercial baseada em imagens de satélite. Valores finais dependem de vistoria técnica, homologação na concessionária e medição no local. Não constitui projeto executivo.";
