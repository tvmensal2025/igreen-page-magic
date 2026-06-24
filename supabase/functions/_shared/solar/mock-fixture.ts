import type { BuildingInsightsResponse } from "./types.ts";

/** Fixture para dev sem GOOGLE_SOLAR_API_KEY (São Paulo — região Paulista). */
export function mockBuildingInsights(lat: number, lng: number): BuildingInsightsResponse {
  const configs = Array.from({ length: 30 }, (_, i) => ({
    panelsCount: i + 1,
    yearlyEnergyDcKwh: Math.round((i + 1) * 410 * 1.45),
  }));

  const panels = Array.from({ length: 24 }, (_, i) => ({
    center: {
      latitude: lat + (i % 6) * 0.000008 - 0.00002,
      longitude: lng + Math.floor(i / 6) * 0.00001 - 0.000015,
    },
    segmentIndex: i % 2,
    yearlyEnergyDcKwh: 410 * 1.45,
  }));

  return {
    name: "buildings/mock-sp",
    center: { latitude: lat, longitude: lng },
    imageryDate: { year: 2023, month: 6, day: 15 },
    imageryQuality: "MEDIUM",
    solarPotential: {
      maxArrayPanelsCount: 24,
      maxSunshineHoursPerYear: 1680,
      panelCapacityWatts: 410,
      carbonOffsetFactorKgPerMwh: 420,
      solarPanelConfigs: configs,
      solarPanels: panels,
      roofSegmentStats: [
        {
          pitchDegrees: 22,
          azimuthDegrees: 180,
          stats: { areaMeters2: 48, sunshineQuantiles: [1200, 1400, 1600] },
          center: { latitude: lat, longitude: lng },
        },
        {
          pitchDegrees: 18,
          azimuthDegrees: 0,
          stats: { areaMeters2: 32, sunshineQuantiles: [900, 1100, 1300] },
          center: { latitude: lat + 0.00002, longitude: lng },
        },
      ],
    },
  };
}
