import { supabase } from "@/integrations/supabase/client";
import type { PublicSolarDesign, SolarAnalyzeResult } from "./types";

export async function analyzeRoof(body: {
  customerId?: string | null;
  addressText?: string | null;
  lat?: number | null;
  lng?: number | null;
  panelsCount?: number | null;
  electricityBillValue?: number | null;
  forceRefresh?: boolean;
  allowExperiment?: boolean;
  uf?: string | null;
  distribuidora?: string | null;
  monthlyConsumptionKwh?: number | null;
}): Promise<SolarAnalyzeResult> {
  const { data, error } = await supabase.functions.invoke("solar-roof-analyze", { body });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data as SolarAnalyzeResult;
}

export async function updateSnapshotPanels(
  snapshotId: string,
  panelsCount: number,
): Promise<SolarAnalyzeResult["metrics"]> {
  const { data, error } = await supabase.functions.invoke("solar-roof-analyze", {
    body: { action: "updatePanels", snapshotId, panelsCount },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data.metrics;
}

export async function saveManualSketch(
  snapshotId: string,
  widthM: number,
  depthM: number,
): Promise<{ metrics: SolarAnalyzeResult["metrics"]; salesBlurb: string }> {
  const { data, error } = await supabase.functions.invoke("solar-roof-analyze", {
    body: { action: "saveManualSketch", snapshotId, widthM, depthM },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return { metrics: data.metrics, salesBlurb: data.salesBlurb };
}

export async function fetchPublicSolarByToken(token: string): Promise<PublicSolarDesign | null> {
  const { data, error } = await supabase.functions.invoke("solar-design-public", {
    body: { token },
  });
  if (error) throw error;
  return (data?.solar as PublicSolarDesign) ?? null;
}

export async function fetchPublicSolarPreview(body: {
  consultantId: string;
  addressText: string;
  electricityBillValue?: number;
}) {
  const { data, error } = await supabase.functions.invoke("solar-roof-public", { body });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

/** Lista análises persistidas no banco para um cliente (RLS do consultor). */
export async function listCustomerSolarAnalyses(customerId: string): Promise<
  Array<{
    analysisId: string;
    snapshotId: string;
    addressText: string | null;
    imageryQuality: string;
    panelsCount: number;
    systemKwp: number;
    createdAt: string;
  }>
> {
  const { data, error } = await supabase
    .from("solar_roof_analyses")
    .select(
      "id, address_text, imagery_quality, created_at, solar_design_snapshots(id, panels_count, system_kwp, is_primary, created_at)",
    )
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) throw error;

  return (data ?? []).flatMap((row) => {
    const snaps = (row.solar_design_snapshots ?? []) as Array<{
      id: string;
      panels_count: number;
      system_kwp: number;
      is_primary: boolean;
      created_at: string;
    }>;
    const snap = snaps.find((s) => s.is_primary) ?? snaps[0];
    if (!snap) return [];
    return [
      {
        analysisId: row.id,
        snapshotId: snap.id,
        addressText: row.address_text,
        imageryQuality: row.imagery_quality,
        panelsCount: snap.panels_count,
        systemKwp: Number(snap.system_kwp),
        createdAt: row.created_at,
      },
    ];
  });
}

/** Carrega snapshot salvo e monta o mesmo formato da análise ao vivo. */
export async function loadSolarSnapshot(snapshotId: string): Promise<SolarAnalyzeResult> {
  const { data, error } = await supabase.functions.invoke("solar-design-get", {
    body: { snapshotId },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);

  const snap = data.snapshot;
  const analysis = data.analysis;
  const insights = analysis?.building_insights as {
    solarPotential?: { solarPanelConfigs?: Array<{ panelsCount: number; yearlyEnergyDcKwh: number }> };
  } | null;

  const panelsCount = snap.panelsCount;
  const configs = insights?.solarPotential?.solarPanelConfigs ?? [];
  const eco = configs.find((c) => c.panelsCount <= panelsCount) ?? null;
  const ideal = configs.find((c) => c.panelsCount >= panelsCount) ?? configs[configs.length - 1] ?? null;

  return {
    ok: true,
    mock: false,
    analysisId: snap.analysisId ?? "",
    snapshotId: snap.id,
    imageryQuality: analysis?.imageryQuality ?? "UNKNOWN",
    metrics: {
      panelCapacityWatts: 410,
      panelsCount,
      systemSizeKwp: Number(snap.systemKwp),
      yearlyEnergyKwh: Number(snap.yearlyEnergyKwh),
      estimatedMonthlySavingsCents: snap.monthlySavingsCents,
      maxPanels: panelsCount,
      imageryQuality: analysis?.imageryQuality ?? "UNKNOWN",
    },
    presets: {
      eco: eco ? { panels: eco.panelsCount, kwh: eco.yearlyEnergyDcKwh } : null,
      ideal: ideal ? { panels: ideal.panelsCount, kwh: ideal.yearlyEnergyDcKwh } : null,
    },
    roofSegments: snap.roofSegments ?? [],
    panelPositions: snap.panelPositions ?? [],
    disclaimer: data.disclaimer,
    salesBlurb: snap.salesBlurb ?? "",
    imagery: analysis?.imagery ?? undefined,
  };
}

export async function listConsultantSolarAnalyses(limit = 30) {
  const { data, error } = await supabase
    .from("solar_roof_analyses")
    .select(
      "id, address_text, imagery_quality, created_at, customer_id, solar_design_snapshots(id, panels_count, system_kwp, is_primary)",
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []).map((row) => {
    const snaps = (row.solar_design_snapshots ?? []) as Array<{
      id: string;
      panels_count: number;
      system_kwp: number;
      is_primary: boolean;
    }>;
    const snap = snaps.find((s) => s.is_primary) ?? snaps[0];
    return {
      analysisId: row.id,
      snapshotId: snap?.id ?? null,
      addressText: row.address_text,
      customerId: row.customer_id,
      panelsCount: snap?.panels_count ?? 0,
      systemKwp: snap ? Number(snap.system_kwp) : 0,
      createdAt: row.created_at,
    };
  });
}

export function formatCustomerAddress(c: {
  address_street?: string | null;
  address_number?: string | null;
  address_neighborhood?: string | null;
  address_city?: string | null;
  address_state?: string | null;
  cep?: string | null;
}): string {
  const line1 = [c.address_street, c.address_number].filter(Boolean).join(", ");
  const line2 = [c.address_neighborhood, c.address_city, c.address_state].filter(Boolean).join(", ");
  const cep = c.cep ? `CEP ${c.cep}` : "";
  return [line1, line2, cep, "Brasil"].filter(Boolean).join(", ");
}
