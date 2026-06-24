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
