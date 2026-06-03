import { supabase } from "@/integrations/supabase/client";

export type AdPhotoFormat = "square" | "vertical" | "story";
export interface AdTemplatePhoto { url: string; format: AdPhotoFormat }

export interface AdTemplate {
  id: string;
  title: string;
  description: string | null;
  photos: AdTemplatePhoto[];
  // Vídeo (alternativa a photos quando creative_mode = "video").
  video_url: string | null;
  video_thumb_url: string | null;
  creative_mode: "photo" | "video";
  headline: string;
  primary_text: string;
  description_text: string;
  headline_variants: string[];
  primary_text_variants: string[];
  age_min: number;
  age_max: number;
  genders: string[];
  suggested_daily_budget_cents: number;
  status: "draft" | "published" | "archived";
  usage_count: number;
  avg_cpl_cents: number | null;
  created_at: string;
  updated_at: string;
  target_distribuidora_ids: string[];
  target_cidades: string[];
}

function row(r: any): AdTemplate {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    photos: Array.isArray(r.photos) ? r.photos : [],
    video_url: r.video_url ?? null,
    video_thumb_url: r.video_thumb_url ?? null,
    creative_mode: (r.creative_mode === "video" ? "video" : "photo"),
    headline: r.headline ?? "",
    primary_text: r.primary_text ?? "",
    description_text: r.description_text ?? "",
    headline_variants: Array.isArray(r.headline_variants) ? r.headline_variants : [],
    primary_text_variants: Array.isArray(r.primary_text_variants) ? r.primary_text_variants : [],
    age_min: r.age_min ?? 28,
    age_max: r.age_max ?? 60,
    genders: r.genders ?? [],
    suggested_daily_budget_cents: r.suggested_daily_budget_cents ?? 3000,
    status: r.status ?? "draft",
    usage_count: r.usage_count ?? 0,
    avg_cpl_cents: r.avg_cpl_cents ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
    target_distribuidora_ids: Array.isArray(r.target_distribuidora_ids) ? r.target_distribuidora_ids : [],
    target_cidades: Array.isArray(r.target_cidades) ? r.target_cidades : [],
  };
}


export async function listAdTemplates(opts?: { onlyPublished?: boolean }): Promise<AdTemplate[]> {
  let q = supabase.from("ad_templates").select("*").order("updated_at", { ascending: false });
  if (opts?.onlyPublished) q = q.eq("status", "published");
  const { data, error } = await q;
  if (error) throw error;
  return (data || []).map(row);
}

export async function upsertAdTemplate(t: Partial<AdTemplate> & { id?: string }) {
  const payload: any = {
    title: t.title,
    description: t.description ?? null,
    photos: t.photos ?? [],
    video_url: t.video_url ?? null,
    video_thumb_url: t.video_thumb_url ?? null,
    creative_mode: t.creative_mode ?? "photo",
    headline: t.headline ?? "",
    primary_text: t.primary_text ?? "",
    description_text: t.description_text ?? "",
    headline_variants: (t.headline_variants ?? []).filter(Boolean),
    primary_text_variants: (t.primary_text_variants ?? []).filter(Boolean),
    age_min: t.age_min ?? 28,
    age_max: t.age_max ?? 60,
    genders: t.genders ?? [],
    suggested_daily_budget_cents: t.suggested_daily_budget_cents ?? 3000,
    status: t.status ?? "draft",
    updated_at: new Date().toISOString(),
    target_distribuidora_ids: t.target_distribuidora_ids ?? [],
    target_cidades: t.target_cidades ?? [],
  };
  if (t.id) payload.id = t.id;
  const { data, error } = await supabase
    .from("ad_templates")
    .upsert(payload, { onConflict: "id" })
    .select()
    .single();
  if (error) throw error;
  return row(data);
}

export async function deleteAdTemplate(id: string) {
  const { error } = await supabase.from("ad_templates").delete().eq("id", id);
  if (error) throw error;
}

export async function uploadAdTemplateImage(file: File, templateId: string): Promise<string> {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `ad-templates/${templateId}/${Date.now()}-${safeName}`;
  const { error } = await supabase.storage.from("IMAGE").upload(path, file, {
    upsert: true, contentType: file.type,
  });
  if (error) throw error;
  const { data } = supabase.storage.from("IMAGE").getPublicUrl(path);
  return data.publicUrl;
}

export interface TemplateAggregatedMetrics {
  campaigns_count: number;
  active_campaigns: number;
  spend_cents: number;
  impressions: number;
  clicks: number;
  ctr_pct: number;
  conversations: number;
  leads: number;
  registrations: number;
  customers_acquired: number;
  cpl_cents: number;
  cpm_cents: number;
  frequency_avg: number;
  has_data: boolean;
  daily: Array<{ date: string; spend: number; conversations: number; clicks: number }>;
}

const EMPTY_METRICS: TemplateAggregatedMetrics = {
  campaigns_count: 0,
  active_campaigns: 0,
  spend_cents: 0,
  impressions: 0,
  clicks: 0,
  ctr_pct: 0,
  conversations: 0,
  leads: 0,
  registrations: 0,
  customers_acquired: 0,
  cpl_cents: 0,
  cpm_cents: 0,
  frequency_avg: 0,
  has_data: false,
  daily: [],
};

/**
 * Agrega métricas reais (facebook_metrics_daily) das campanhas criadas a partir deste template,
 * usando a tabela de junção `ad_template_usages`. Se `consultantId` for passado,
 * filtra só campanhas daquele consultor (modo galeria).
 */
export async function getTemplateAggregatedMetrics(
  templateId: string,
  opts?: { consultantId?: string; days?: number },
): Promise<TemplateAggregatedMetrics> {
  const days = opts?.days ?? 30;
  const sinceDate = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);

  // 1. Pega campanhas vinculadas ao template via ad_template_usages
  let usageQ = supabase
    .from("ad_template_usages")
    .select("campaign_id, consultant_id")
    .eq("template_id", templateId)
    .not("campaign_id", "is", null);
  if (opts?.consultantId) usageQ = usageQ.eq("consultant_id", opts.consultantId);
  const { data: usages } = await usageQ;
  const campaignIds = Array.from(new Set(((usages as any[]) || []).map((u) => u.campaign_id))).filter(Boolean);
  if (campaignIds.length === 0) return EMPTY_METRICS;

  // 2. Status das campanhas (active count)
  const { data: camps } = await supabase
    .from("facebook_campaigns")
    .select("id, status")
    .in("id", campaignIds);
  const activeCount = ((camps as any[]) || []).filter((c) => c.status === "active").length;

  // 3. Métricas diárias agregadas
  const { data: rows } = await supabase
    .from("facebook_metrics_daily")
    .select("date, spend_cents, impressions, clicks, leads, messaging_conversations_started, complete_registrations, customers_acquired, frequency_x100, cpm_cents")
    .in("campaign_id", campaignIds)
    .gte("date", sinceDate);

  const byDate = new Map<string, { date: string; spend: number; conversations: number; clicks: number }>();
  let spend = 0, impr = 0, clicks = 0, conv = 0, leads = 0, regs = 0, cust = 0;
  let freqSum = 0, freqN = 0, cpmSum = 0, cpmN = 0;
  for (const r of (rows as any[]) || []) {
    spend += r.spend_cents || 0;
    impr += r.impressions || 0;
    clicks += r.clicks || 0;
    conv += r.messaging_conversations_started || 0;
    leads += r.leads || 0;
    regs += r.complete_registrations || 0;
    cust += r.customers_acquired || 0;
    if (r.frequency_x100) { freqSum += r.frequency_x100; freqN++; }
    if (r.cpm_cents) { cpmSum += r.cpm_cents; cpmN++; }
    const cur = byDate.get(r.date) || { date: r.date, spend: 0, conversations: 0, clicks: 0 };
    cur.spend += r.spend_cents || 0;
    cur.conversations += r.messaging_conversations_started || 0;
    cur.clicks += r.clicks || 0;
    byDate.set(r.date, cur);
  }
  // Para CTWA, conversa iniciada vira denominador do CPL quando não há "lead" direto.
  const cplBase = leads > 0 ? leads : conv;
  const cpl = cplBase > 0 ? Math.round(spend / cplBase) : 0;
  const ctr = impr > 0 ? (clicks / impr) * 100 : 0;

  return {
    campaigns_count: campaignIds.length,
    active_campaigns: activeCount,
    spend_cents: spend,
    impressions: impr,
    clicks,
    ctr_pct: Math.round(ctr * 100) / 100,
    conversations: conv,
    leads,
    registrations: regs,
    customers_acquired: cust,
    cpl_cents: cpl,
    cpm_cents: cpmN > 0 ? Math.round(cpmSum / cpmN) : 0,
    frequency_avg: freqN > 0 ? Math.round(freqSum / freqN) / 100 : 0,
    has_data: spend > 0 || impr > 0 || conv > 0,
    daily: Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date)),
  };
}

export async function duplicateAdTemplate(t: AdTemplate): Promise<AdTemplate> {
  const copy: Partial<AdTemplate> = {
    title: `${t.title} (cópia)`,
    description: t.description,
    photos: t.photos,
    headline: t.headline,
    primary_text: t.primary_text,
    description_text: t.description_text,
    headline_variants: t.headline_variants,
    primary_text_variants: t.primary_text_variants,
    age_min: t.age_min,
    age_max: t.age_max,
    genders: t.genders,
    suggested_daily_budget_cents: t.suggested_daily_budget_cents,
    target_distribuidora_ids: t.target_distribuidora_ids,
    target_cidades: t.target_cidades,
    status: "draft",
  };
  return upsertAdTemplate(copy);
}
