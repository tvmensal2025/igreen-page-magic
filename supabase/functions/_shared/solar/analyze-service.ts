import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { cacheKeyFromLatLng, formatCustomerAddress, geocodeAddress } from "./google-geocode.ts";
import {
  findClosestBuilding,
  getDataLayerUrls,
  getGoogleApiKey,
  useMockMode,
} from "./google-solar-client.ts";
import { mockBuildingInsights } from "./mock-fixture.ts";
import {
  buildMetrics,
  extractPanelPositions,
  extractRoofSegments,
  pickPresets,
  estimateMonthlySavingsCents,
} from "./economics-br.ts";
import { SOLAR_DISCLAIMER } from "./types.ts";
import { logApiUsage } from "./rate-limit.ts";

const CACHE_DAYS = 30;

export interface AnalyzeRoofInput {
  consultantId: string;
  customerId?: string | null;
  addressText?: string | null;
  lat?: number | null;
  lng?: number | null;
  forceRefresh?: boolean;
  panelsCount?: number | null;
  electricityBillValue?: number | null;
  includeDataLayers?: boolean;
}

export interface AnalyzeRoofResult {
  ok: true;
  mock: boolean;
  analysisId: string;
  snapshotId: string;
  imageryQuality: string;
  metrics: ReturnType<typeof buildMetrics>;
  presets: { eco: { panels: number; kwh: number } | null; ideal: { panels: number; kwh: number } | null };
  roofSegments: ReturnType<typeof extractRoofSegments>;
  panelPositions: ReturnType<typeof extractPanelPositions>;
  disclaimer: string;
  salesBlurb: string;
}

function buildSalesBlurb(metrics: ReturnType<typeof buildMetrics>): string {
  const savings = (metrics.estimatedMonthlySavingsCents / 100).toFixed(0);
  return (
    `Seu telhado comporta até ${metrics.maxPanels} módulos. Com ${metrics.panelsCount} placas ` +
    `(${metrics.systemSizeKwp} kWp), a geração estimada é de ~${metrics.yearlyEnergyKwh.toLocaleString("pt-BR")} kWh/ano, ` +
    `com economia aproximada de R$ ${savings}/mês na conta. Vistoria técnica confirma antes da instalação.`
  );
}

export async function analyzeRoof(
  admin: SupabaseClient,
  input: AnalyzeRoofInput,
): Promise<AnalyzeRoofResult> {
  const t0 = Date.now();
  let lat = input.lat ?? null;
  let lng = input.lng ?? null;
  let addressText = input.addressText ?? null;
  const mock = useMockMode();
  const apiKey = getGoogleApiKey() ?? "";

  if (input.customerId) {
    const { data: cust } = await admin
      .from("customers")
      .select(
        "address_street, address_number, address_neighborhood, address_city, address_state, cep, electricity_bill_value",
      )
      .eq("id", input.customerId)
      .maybeSingle();
    if (cust) {
      if (!addressText) addressText = formatCustomerAddress(cust as Record<string, string | null>);
      if (input.electricityBillValue == null) {
        input.electricityBillValue = (cust as { electricity_bill_value?: number }).electricity_bill_value ?? null;
      }
    }
  }

  if ((lat == null || lng == null) && addressText) {
    if (mock) {
      lat = -23.5505;
      lng = -46.6333;
    } else {
      const geo = await geocodeAddress(addressText, apiKey);
      lat = geo.lat;
      lng = geo.lng;
      addressText = geo.formattedAddress;
      await logApiUsage(admin, {
        consultantId: input.consultantId,
        endpoint: "geocode",
        cacheHit: false,
        latencyMs: Date.now() - t0,
      });
    }
  }

  if (lat == null || lng == null) {
    throw new Error("Informe endereço ou coordenadas");
  }

  const cacheKey = cacheKeyFromLatLng(lat, lng);
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + CACHE_DAYS);

  if (!input.forceRefresh) {
    const { data: cached } = await admin
      .from("solar_roof_analyses")
      .select("id, building_insights, imagery_quality, max_panels, panel_watts")
      .eq("consultant_id", input.consultantId)
      .eq("cache_key", cacheKey)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (cached) {
      if (input.customerId) {
        await admin
          .from("solar_roof_analyses")
          .update({ customer_id: input.customerId })
          .eq("id", cached.id)
          .is("customer_id", null);
      }
      const insights = cached.building_insights as import("./types.ts").BuildingInsightsResponse;
      const defaultPanels = input.panelsCount ?? Math.min(14, cached.max_panels ?? 14);
      const metrics = buildMetrics(insights, defaultPanels, input.electricityBillValue);
      const snapshot = await upsertPrimarySnapshot(admin, {
        analysisId: cached.id,
        consultantId: input.consultantId,
        insights,
        metrics,
        panelsCount: defaultPanels,
      });
      await logApiUsage(admin, {
        consultantId: input.consultantId,
        endpoint: "findClosest",
        cacheHit: true,
        latencyMs: Date.now() - t0,
      });
      const presets = pickPresets(insights.solarPotential?.solarPanelConfigs, input.electricityBillValue);
      return {
        ok: true,
        mock,
        analysisId: cached.id,
        snapshotId: snapshot.id,
        imageryQuality: cached.imagery_quality ?? metrics.imageryQuality,
        metrics,
        presets: {
          eco: presets.eco ? { panels: presets.eco.panelsCount, kwh: presets.eco.yearlyEnergyDcKwh } : null,
          ideal: presets.ideal ? { panels: presets.ideal.panelsCount, kwh: presets.ideal.yearlyEnergyDcKwh } : null,
        },
        roofSegments: extractRoofSegments(insights),
        panelPositions: extractPanelPositions(insights, metrics.panelsCount),
        disclaimer: SOLAR_DISCLAIMER,
        salesBlurb: buildSalesBlurb(metrics),
      };
    }
  }

  let insights: import("./types.ts").BuildingInsightsResponse;
  let dataLayers = null;
  if (mock) {
    insights = mockBuildingInsights(lat, lng);
  } else {
    try {
      insights = await findClosestBuilding(lat, lng, apiKey);
      if (input.includeDataLayers) {
        try {
          dataLayers = await getDataLayerUrls(lat, lng, 50, apiKey);
        } catch {
          /* optional */
        }
      }
    } catch (e) {
      await logApiUsage(admin, {
        consultantId: input.consultantId,
        endpoint: "findClosest",
        cacheHit: false,
        latencyMs: Date.now() - t0,
        errorCode: String((e as { error?: { status?: string } })?.error?.status ?? "error"),
      });
      throw e;
    }
    await logApiUsage(admin, {
      consultantId: input.consultantId,
      endpoint: "findClosest",
      cacheHit: false,
      latencyMs: Date.now() - t0,
    });
  }

  const sp = insights.solarPotential ?? {};
  const defaultPanels = input.panelsCount ?? Math.min(14, sp.maxArrayPanelsCount ?? 14);
  const metrics = buildMetrics(insights, defaultPanels, input.electricityBillValue);

  const imageryDate = insights.imageryDate
    ? `${insights.imageryDate.year}-${String(insights.imageryDate.month).padStart(2, "0")}-${String(insights.imageryDate.day).padStart(2, "0")}`
    : null;

  const { data: analysis, error: insErr } = await admin
    .from("solar_roof_analyses")
    .insert({
      consultant_id: input.consultantId,
      customer_id: input.customerId ?? null,
      address_text: addressText,
      latitude: lat,
      longitude: lng,
      cache_key: cacheKey,
      building_insights: insights,
      data_layers: dataLayers,
      imagery_quality: metrics.imageryQuality,
      imagery_date: imageryDate,
      max_panels: metrics.maxPanels,
      panel_watts: metrics.panelCapacityWatts,
      max_yearly_kwh: metrics.yearlyEnergyKwh,
      expires_at: expiresAt.toISOString(),
    })
    .select("id")
    .single();

  if (insErr || !analysis) throw new Error(insErr?.message ?? "Falha ao salvar análise");

  const snapshot = await upsertPrimarySnapshot(admin, {
    analysisId: analysis.id,
    consultantId: input.consultantId,
    insights,
    metrics,
    panelsCount: defaultPanels,
  });

  const presets = pickPresets(sp.solarPanelConfigs, input.electricityBillValue);

  return {
    ok: true,
    mock,
    analysisId: analysis.id,
    snapshotId: snapshot.id,
    imageryQuality: metrics.imageryQuality,
    metrics,
    presets: {
      eco: presets.eco ? { panels: presets.eco.panelsCount, kwh: presets.eco.yearlyEnergyDcKwh } : null,
      ideal: presets.ideal ? { panels: presets.ideal.panelsCount, kwh: presets.ideal.yearlyEnergyDcKwh } : null,
    },
    roofSegments: extractRoofSegments(insights),
    panelPositions: extractPanelPositions(insights, metrics.panelsCount),
    disclaimer: SOLAR_DISCLAIMER,
    salesBlurb: buildSalesBlurb(metrics),
  };
}

async function upsertPrimarySnapshot(
  admin: SupabaseClient,
  opts: {
    analysisId: string;
    consultantId: string;
    insights: import("./types.ts").BuildingInsightsResponse;
    metrics: ReturnType<typeof buildMetrics>;
    panelsCount: number;
  },
) {
  const blurb = buildSalesBlurb(opts.metrics);
  const payload = {
    panels_count: opts.metrics.panelsCount,
    system_kwp: opts.metrics.systemSizeKwp,
    yearly_energy_kwh: opts.metrics.yearlyEnergyKwh,
    monthly_savings_cents: opts.metrics.estimatedMonthlySavingsCents,
    roof_segments: extractRoofSegments(opts.insights),
    panel_positions: extractPanelPositions(opts.insights, opts.metrics.panelsCount),
    sales_blurb: blurb,
    label: "Ideal",
    is_primary: true,
    updated_at: new Date().toISOString(),
  };

  const { data: existing } = await admin
    .from("solar_design_snapshots")
    .select("id")
    .eq("analysis_id", opts.analysisId)
    .eq("is_primary", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    const { data, error } = await admin
      .from("solar_design_snapshots")
      .update(payload)
      .eq("id", existing.id)
      .select("id")
      .single();
    if (error || !data) throw new Error(error?.message ?? "Falha ao atualizar snapshot");
    return data as { id: string };
  }

  const { data, error } = await admin
    .from("solar_design_snapshots")
    .insert({
      analysis_id: opts.analysisId,
      consultant_id: opts.consultantId,
      ...payload,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Falha ao salvar snapshot");
  return data as { id: string };
}

/** Contexto curto para vendedora / bot. */
export async function getSolarContextForCustomer(
  admin: SupabaseClient,
  customerId: string,
): Promise<string | null> {
  const { data: analysis } = await admin
    .from("solar_roof_analyses")
    .select("id")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!analysis) return null;

  const { data: snap } = await admin
    .from("solar_design_snapshots")
    .select("panels_count, system_kwp, yearly_energy_kwh, monthly_savings_cents, sales_blurb")
    .eq("analysis_id", analysis.id)
    .eq("is_primary", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!snap) return null;
  const s = snap as {
    panels_count: number;
    system_kwp: number;
    yearly_energy_kwh: number;
    monthly_savings_cents: number;
    sales_blurb: string | null;
  };
  return (
    `[Análise solar do telhado] ${s.sales_blurb ?? ""} ` +
    `(${s.panels_count} módulos, ${s.system_kwp} kWp, ~${s.yearly_energy_kwh} kWh/ano, ` +
    `economia ~R$ ${(s.monthly_savings_cents / 100).toFixed(0)}/mês — estimativa).`
  );
}

export async function updateSnapshotPanels(
  admin: SupabaseClient,
  snapshotId: string,
  consultantId: string,
  panelsCount: number,
): Promise<AnalyzeRoofResult["metrics"]> {
  const { data: snap } = await admin
    .from("solar_design_snapshots")
    .select("analysis_id, consultant_id")
    .eq("id", snapshotId)
    .maybeSingle();
  if (!snap || snap.consultant_id !== consultantId) throw new Error("Snapshot não encontrado");

  const { data: analysis } = await admin
    .from("solar_roof_analyses")
    .select("building_insights, customer_id")
    .eq("id", snap.analysis_id)
    .maybeSingle();
  if (!analysis) throw new Error("Análise não encontrada");

  let bill: number | null = null;
  if (analysis.customer_id) {
    const { data: c } = await admin
      .from("customers")
      .select("electricity_bill_value")
      .eq("id", analysis.customer_id)
      .maybeSingle();
    bill = (c as { electricity_bill_value?: number } | null)?.electricity_bill_value ?? null;
  }

  const insights = analysis.building_insights as import("./types.ts").BuildingInsightsResponse;
  const metrics = buildMetrics(insights, panelsCount, bill);

  await admin
    .from("solar_design_snapshots")
    .update({
      panels_count: metrics.panelsCount,
      system_kwp: metrics.systemSizeKwp,
      yearly_energy_kwh: metrics.yearlyEnergyKwh,
      monthly_savings_cents: metrics.estimatedMonthlySavingsCents,
      panel_positions: extractPanelPositions(insights, metrics.panelsCount),
      sales_blurb: buildSalesBlurb(metrics),
      updated_at: new Date().toISOString(),
    })
    .eq("id", snapshotId);

  return metrics;
}

const PANEL_AREA_M2 = 2;
const PANEL_WATTS_MANUAL = 410;
const YIELD_KWH_PER_KWP = 1400;

function buildManualPanelPositions(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    index: i,
    lat: null,
    lng: null,
    segmentIndex: 0,
    yearlyKwh: null,
  }));
}

/** Persiste sketch manual (imagem BASE / sem cobertura) e recalcula dimensionamento. */
export async function saveManualSketch(
  admin: SupabaseClient,
  snapshotId: string,
  consultantId: string,
  sketch: { widthM: number; depthM: number },
): Promise<{ metrics: AnalyzeRoofResult["metrics"]; salesBlurb: string }> {
  const { data: snap } = await admin
    .from("solar_design_snapshots")
    .select("analysis_id, consultant_id")
    .eq("id", snapshotId)
    .maybeSingle();
  if (!snap || snap.consultant_id !== consultantId) throw new Error("Snapshot não encontrado");

  const widthM = Math.max(1, sketch.widthM);
  const depthM = Math.max(1, sketch.depthM);
  const areaM2 = widthM * depthM;
  const panelsCount = Math.max(4, Math.min(48, Math.floor(areaM2 / PANEL_AREA_M2)));
  const systemKwp = Math.round((panelsCount * PANEL_WATTS_MANUAL) / 1000 * 100) / 100;
  const yearlyEnergyKwh = Math.round(systemKwp * YIELD_KWH_PER_KWP);

  let bill: number | null = null;
  const { data: analysis } = await admin
    .from("solar_roof_analyses")
    .select("customer_id")
    .eq("id", snap.analysis_id)
    .maybeSingle();
  if (analysis?.customer_id) {
    const { data: c } = await admin
      .from("customers")
      .select("electricity_bill_value")
      .eq("id", analysis.customer_id)
      .maybeSingle();
    bill = (c as { electricity_bill_value?: number } | null)?.electricity_bill_value ?? null;
  }

  const monthlySavingsCents = estimateMonthlySavingsCents(yearlyEnergyKwh, bill);
  const metrics: AnalyzeRoofResult["metrics"] = {
    panelCapacityWatts: PANEL_WATTS_MANUAL,
    panelsCount,
    systemSizeKwp: systemKwp,
    yearlyEnergyKwh,
    estimatedMonthlySavingsCents: monthlySavingsCents,
    maxPanels: panelsCount,
    imageryQuality: "BASE",
  };

  const roofSegments = [
    {
      index: 0,
      pitchDegrees: 20,
      azimuthDegrees: 180,
      areaM2,
      lat: null,
      lng: null,
    },
  ];

  const salesBlurb = buildSalesBlurb(metrics);

  await admin
    .from("solar_design_snapshots")
    .update({
      panels_count: panelsCount,
      system_kwp: systemKwp,
      yearly_energy_kwh: yearlyEnergyKwh,
      monthly_savings_cents: monthlySavingsCents,
      roof_segments: roofSegments,
      panel_positions: buildManualPanelPositions(panelsCount),
      manual_sketch: { widthM, depthM, areaM2, source: "manual_fallback" },
      sales_blurb: salesBlurb,
      updated_at: new Date().toISOString(),
    })
    .eq("id", snapshotId);

  return { metrics, salesBlurb };
}
