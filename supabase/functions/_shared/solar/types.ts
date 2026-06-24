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
}

export const SOLAR_DISCLAIMER =
  "Estimativa comercial baseada em imagens de satélite. Valores finais dependem de vistoria técnica, homologação na concessionária e medição no local. Não constitui projeto executivo.";
