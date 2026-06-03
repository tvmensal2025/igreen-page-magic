import { supabase } from "@/integrations/supabase/client";
import type { CampaignTarget } from "./types";

export interface PersistedCampaignRow {
  id: string;
  name: string;
  status: string;
  total: number;
  sent: number;
  failed: number;
  scheduled_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export async function createCampaign(input: {
  consultantId: string;
  name: string;
  messageText: string;
  mediaUrl?: string | null;
  mediaType?: string | null;
  mediaFilename?: string | null;
  config: any;
  scheduledAt: string | null;
  targets: CampaignTarget[];
}): Promise<string | null> {
  const { data, error } = await (supabase as any)
    .from("bulk_campaigns")
    .insert({
      consultant_id: input.consultantId,
      name: input.name,
      message_text: input.messageText,
      media_url: input.mediaUrl ?? null,
      media_type: input.mediaType ?? null,
      media_filename: input.mediaFilename ?? null,
      config: input.config,
      status: input.scheduledAt ? "scheduled" : "running",
      total: input.targets.length,
      scheduled_at: input.scheduledAt,
      started_at: input.scheduledAt ? null : new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !data) { console.error("createCampaign", error); return null; }
  const campaignId = data.id as string;

  // Insert targets in chunks
  const CHUNK = 500;
  for (let i = 0; i < input.targets.length; i += CHUNK) {
    const slice = input.targets.slice(i, i + CHUNK).map(t => ({
      campaign_id: campaignId,
      phone: t.phone,
      name: t.name,
      vars: { bill: t.bill ?? null, city: t.city ?? null },
      status: "queued",
    }));
    const { error: e2 } = await (supabase as any).from("bulk_campaign_targets").insert(slice);
    if (e2) console.error("insert targets", e2);
  }
  return campaignId;
}

export async function updateCampaignStatus(id: string, patch: Partial<{
  status: string; sent: number; failed: number; started_at: string; finished_at: string;
}>) {
  await (supabase as any).from("bulk_campaigns").update(patch).eq("id", id);
}

export async function updateTargetStatus(
  campaignId: string,
  phone: string,
  patch: Partial<{ status: string; final_message: string; error: string; sent_at: string }>,
) {
  await (supabase as any)
    .from("bulk_campaign_targets")
    .update(patch)
    .eq("campaign_id", campaignId)
    .eq("phone", phone);
}

export async function listCampaigns(consultantId: string, limit = 20): Promise<PersistedCampaignRow[]> {
  const { data, error } = await (supabase as any)
    .from("bulk_campaigns")
    .select("id,name,status,total,sent,failed,scheduled_at,started_at,finished_at,created_at")
    .eq("consultant_id", consultantId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) { console.error("listCampaigns", error); return []; }
  return (data as PersistedCampaignRow[]) || [];
}

export async function deleteCampaign(id: string) {
  await (supabase as any).from("bulk_campaigns").delete().eq("id", id);
}
