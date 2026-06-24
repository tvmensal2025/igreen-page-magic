export const SOLAR_DISCLAIMER =
  "Estimativa comercial baseada em imagens de satélite. Valores finais dependem de vistoria técnica e homologação na concessionária.";

export interface SolarMetrics {
  panelCapacityWatts: number;
  panelsCount: number;
  systemSizeKwp: number;
  yearlyEnergyKwh: number;
  estimatedMonthlySavingsCents: number;
  maxPanels: number;
  imageryQuality: string;
  tariffKwhBrl?: number;
  monthlyConsumptionKwh?: number | null;
  fioBFraction?: number;
  yearlyCo2OffsetKg?: number;
  estimatedProjectCostCents?: number;
  paybackYears?: number | null;
}

export interface SolarPanelPosition {
  index: number;
  lat: number | null;
  lng: number | null;
  segmentIndex: number;
  yearlyKwh: number | null;
}

export interface SolarRoofSegment {
  index: number;
  pitchDegrees: number | null;
  azimuthDegrees: number | null;
  areaM2: number | null;
  lat: number | null;
  lng: number | null;
}

export interface SolarAnalyzeResult {
  ok: true;
  mock: boolean;
  analysisId: string;
  snapshotId: string;
  imageryQuality: string;
  metrics: SolarMetrics;
  presets: {
    eco: { panels: number; kwh: number } | null;
    ideal: { panels: number; kwh: number } | null;
  };
  roofSegments: SolarRoofSegment[];
  panelPositions: SolarPanelPosition[];
  disclaimer: string;
  salesBlurb: string;
}

export interface PublicSolarDesign {
  panelsCount: number;
  systemKwp: number;
  yearlyEnergyKwh: number;
  monthlySavingsCents: number;
  roofSegments: SolarRoofSegment[];
  panelPositions: SolarPanelPosition[];
  salesBlurb: string | null;
  imageryQuality: string;
  addressCity: string | null;
  disclaimer: string;
}
