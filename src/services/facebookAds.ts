import { supabase } from "@/integrations/supabase/client";

async function throwFunctionError(error: any): Promise<never> {
  const response = error?.context as Response | undefined;
  if (response && typeof response.clone === "function") {
    // 546 = CPU Time exceeded no Supabase Edge Runtime
    if (response.status === 546) {
      throw new Error(
        "A publicação demorou demais no servidor (limite de processamento). Tente novamente em alguns segundos — o sistema já está otimizado para responder rápido."
      );
    }
    if (response.status === 504) {
      throw new Error("Timeout do servidor ao publicar. Tente novamente em alguns segundos.");
    }
    try {
      const payload = await response.clone().json();
      if (payload?.error) throw new Error(payload.error);
    } catch (parsed) {
      if (parsed instanceof Error && parsed.message) throw parsed;
    }
  }
  throw error;
}

export interface OAuthStartResult { url: string; logout_url?: string; mode: "connect" | "switch" | "rerequest"; scope: "user" | "platform" }
export type OAuthStartOptions = { mode?: "connect" | "switch" | "rerequest"; scope?: "user" | "platform" };
export async function startFacebookOAuth(opts: OAuthStartOptions | "connect" | "switch" | "rerequest" = {}): Promise<OAuthStartResult> {
  const o: OAuthStartOptions = typeof opts === "string" ? { mode: opts } : opts;
  const mode = o.mode ?? "connect";
  const scope = o.scope ?? "user";
  const { data, error } = await supabase.functions.invoke("facebook-oauth-start", {
    body: { mode, scope, return_origin: window.location.origin },
  });
  if (error) throw error;
  if (!data?.url) throw new Error("URL de autorização não recebida");
  return data as OAuthStartResult;
}

export interface FbAdAccount { id: string; name: string; currency: string; status: number }
export interface FbPage { id: string; name: string; instagram_id: string | null; instagram_username: string | null }
export interface FbPixel { id: string; name: string }
export interface FbAssets {
  ad_accounts: FbAdAccount[];
  pages: FbPage[];
  pixels_by_ad_account: Record<string, FbPixel[]>;
  errors?: { ad_accounts: string | null; pages: string | null };
}
export async function listFacebookAssets(opts: { scope?: "user" | "platform" } = {}): Promise<FbAssets> {
  const { data, error } = await supabase.functions.invoke("facebook-list-assets", { body: opts });
  if (error) throw error;
  return data as FbAssets;
}
export async function selectFacebookAssets(payload: {
  ad_account_id?: string | null;
  page_id?: string | null;
  pixel_id?: string | null;
  whatsapp_destination_number?: string | null;
  scope?: "user" | "platform";
}) {
  const { data, error } = await supabase.functions.invoke("facebook-select-assets", { body: payload });
  if (error) throw error;
  return data as { ok: boolean; updated: boolean; fields?: string[] };
}

export interface ValidateResult { ok: boolean; issues: string[] }
export async function validateAccount(): Promise<ValidateResult> {
  const { data, error } = await supabase.functions.invoke("facebook-validate-account", { body: {} });
  if (error) throw error;
  return data as ValidateResult;
}

export interface SyncAudiencesResult {
  ok: boolean;
  custom_audience_id: string | null;
  lookalike_audience_id: string | null;
  uploaded: number;
  lal_status: "created" | "pending_or_failed";
}
export async function syncAudiences(): Promise<SyncAudiencesResult> {
  const { data, error } = await supabase.functions.invoke("facebook-sync-audiences", { body: {} });
  if (error) throw error;
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as SyncAudiencesResult;
}

export interface CityHit { key: string; name: string; region?: string; region_id?: number; type?: string; country_code?: string }
export interface CitySearchResult { cities: CityHit[]; needsReconnect?: boolean }
export async function searchCities(q: string): Promise<CitySearchResult> {
  const { data, error } = await supabase.functions.invoke("facebook-search-cities", { body: { q } });
  if (error) throw error;
  return { cities: (data?.cities || []) as CityHit[], needsReconnect: !!data?.needs_reconnect };
}

// Resolve várias cidades de uma vez (cache no banco).
export interface UnresolvedCity { name: string; uf: string; reason: string }
export interface BulkCityResult { cities: CityHit[]; unresolved: UnresolvedCity[]; needsReconnect?: boolean }
export async function searchCitiesBulk(items: { name: string; uf: string }[]): Promise<BulkCityResult> {
  const { data, error } = await supabase.functions.invoke("facebook-search-cities", { body: { bulk: items } });
  if (error) throw error;
  return {
    cities: (data?.cities || []) as CityHit[],
    unresolved: (data?.unresolved || []) as UnresolvedCity[],
    needsReconnect: !!data?.needs_reconnect,
  };
}

export interface CopyPack { headlines: string[]; primary_texts: string[]; description: string }
export interface CopyVariation { text: string; framework: string; score: number }
export interface CopyPackV2 extends CopyPack { variations?: { headlines: CopyVariation[]; primary_texts: CopyVariation[] } }
export async function generateCopy(cities: string[]): Promise<CopyPack> {
  const { data, error } = await supabase.functions.invoke("ad-creative-builder", { body: { cities } });
  if (error) throw error;
  return data as CopyPackV2;
}

// Primeira mensagem do WhatsApp (CTWA): checagem de duplicidade + variação por IA.
export interface InitialMessageCheck { ok: boolean; duplicate: boolean; reason: string | null; suggestion: string | null }
export async function checkInitialMessage(message: string, distribuidora?: string | null, excludeCampaignId?: string | null): Promise<InitialMessageCheck> {
  const { data, error } = await supabase.functions.invoke("ad-initial-message", {
    body: { action: "check", message, distribuidora, exclude_campaign_id: excludeCampaignId },
  });
  if (error) throw error;
  return data as InitialMessageCheck;
}
export async function varyInitialMessage(message: string, distribuidora?: string | null, excludeCampaignId?: string | null): Promise<{ message: string; duplicate: boolean }> {
  const { data, error } = await supabase.functions.invoke("ad-initial-message", {
    body: { action: "vary", message, distribuidora, exclude_campaign_id: excludeCampaignId },
  });
  if (error) throw error;
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as { message: string; duplicate: boolean };
}

export interface CustomLocation {
  latitude: number;
  longitude: number;
  radius: number; // em km
  address_string?: string;
  name?: string;
}

export interface PreflightResult {
  ok: boolean;
  blockers: string[];
  warnings: string[];
  reach: { lower: number; upper: number; daily_min: number; daily_max: number } | null;
}
export async function preflightCampaign(input: {
  cities?: { key: string; name: string }[];
  custom_locations?: CustomLocation[];
  daily_budget_cents: number;
}): Promise<PreflightResult> {
  const { data, error } = await supabase.functions.invoke("facebook-preflight-check", { body: input });
  if (error) throw error;
  return data as PreflightResult;
}

export interface CreateCampaignBody {
  name: string;
  // Use cities OU custom_locations. Quando custom_locations vem preenchido,
  // ele substitui as cidades no targeting (segmentação por raio/endereço).
  cities: { key: string; name: string }[];
  custom_locations?: CustomLocation[];
  daily_budget_cents: number;
  duration_days?: number | null;
  age_min?: number;
  age_max?: number;
  // Modo do criativo: foto (até 5 imagens) ou vídeo (1 vídeo vertical p/ Reels).
  creative_mode?: "photo" | "video";
  // Foto: cada imagem traz seu formato (square/vertical/story) p/ asset_feed_spec.
  photos?: { url: string; format: "square" | "vertical" | "story" }[];
  // Vídeo: 1 vídeo + capa opcional. Quando presente, ignora photos.
  video?: { url: string; thumb_url?: string; captions_srt?: string };
  headline: string;
  primary_text: string;
  description?: string;
  distribuidora?: string;
  // Galeria pública de templates do Super Admin → consultor publica em 1 toque.
  template_id?: string | null;
  // "auto" (Advantage+ Placements — recomendação Meta) ou "manual" com lista.
  placement_mode?: "auto" | "manual";
  // Quando manual: lista no formato "fb:feed", "fb:reels", "ig:story"...
  placements?: string[];
  // Primeira mensagem que abre no WhatsApp ao clicar no anúncio. Max 160 chars.
  initial_message?: string;
}
export async function createCampaign(body: CreateCampaignBody) {
  const { data, error } = await supabase.functions.invoke("facebook-create-campaign", { body });
  if (error) await throwFunctionError(error);
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as { ok: true; campaign_id: string; adset_id: string; ad_ids: string[]; ads_count: number };
}

// Upload de vídeo do anúncio (modo Reels/Stories). Aceita mp4/mov até ~100 MB.
// Vai pro mesmo bucket das fotos sob `{consultantId}/ads/video-...`.
export async function uploadAdVideo(
  consultantId: string,
  file: File
): Promise<{ url: string; path: string | null }> {
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${consultantId}/ads/video-${Date.now()}-${safe}`;
  const contentType = file.type || "video/mp4";
  const { error } = await supabase.storage
    .from("consultant-photos")
    .upload(path, file, { upsert: true, contentType });
  if (error) throw error;
  const { data } = supabase.storage.from("consultant-photos").getPublicUrl(path);
  return { url: data.publicUrl, path };
}

// Lê o File para um ArrayBuffer em memória. Se a referência do arquivo do
// usuário ficou stale (NotReadableError — comum quando o arquivo passou tempo
// no input ou foi alterado no disco), damos uma mensagem clara em PT.
async function readFileBytes(f: File): Promise<ArrayBuffer> {
  try {
    return await f.arrayBuffer();
  } catch (err: any) {
    const name = err?.name || "";
    if (name === "NotReadableError" || /could not be read|permission/i.test(String(err?.message || ""))) {
      throw new Error(
        `Não consegui ler "${f.name}". O arquivo perdeu a referência (acontece quando ele fica parado por muito tempo ou é movido). Remova e selecione novamente.`
      );
    }
    throw err;
  }
}

async function uploadOne(consultantId: string, f: File): Promise<{ url: string; path: string | null }> {
  const safe = f.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${consultantId}/ads/${Date.now()}-${safe}`;
  const contentType = f.type || "image/jpeg";
  // Lê os bytes UMA vez para uma cópia em memória. Isso evita o
  // NotReadableError quando o handle do File do usuário ficou inválido,
  // e permite reusar os mesmos bytes no fallback via edge function.
  const bytes = await readFileBytes(f);
  const blob = new Blob([bytes], { type: contentType });
  try {
    const { error } = await supabase.storage
      .from("consultant-photos")
      .upload(path, blob, { upsert: true, contentType });
    if (error) throw error;
    const { data } = supabase.storage.from("consultant-photos").getPublicUrl(path);
    return { url: data.publicUrl, path };
  } catch (directUploadError) {
    // Fallback: manda base64 pra edge function. Convertendo a partir dos bytes
    // já lidos (não tocamos mais no File original).
    const base64 = arrayBufferToBase64(bytes);
    const dataUrl = `data:${contentType};base64,${base64}`;
    const { data, error } = await supabase.functions.invoke("upload-ad-photo", {
      body: { consultant_id: consultantId, filename: f.name, content_type: contentType, data_base64: dataUrl },
    });
    if (error) await throwFunctionError(error);
    if ((data as any)?.error || !(data as any)?.url) {
      throw new Error((data as any)?.error || (directUploadError as Error)?.message || "Falha ao enviar imagem.");
    }
    return { url: (data as any).url, path: (data as any).path || null };
  }
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as any);
  }
  return btoa(binary);
}

function readDim(f: File): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const u = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => { resolve({ w: img.naturalWidth, h: img.naturalHeight }); URL.revokeObjectURL(u); };
    img.onerror = () => { reject(new Error("Imagem inválida")); URL.revokeObjectURL(u); };
    img.src = u;
  });
}

function detectFormat(w: number, h: number): "square" | "vertical" | "story" {
  const r = w / h;
  if (Math.abs(r - 1) < 0.06) return "square";
  if (Math.abs(r - 0.5625) < 0.06) return "story";
  return "vertical";
}

export async function uploadAdPhotos(
  consultantId: string,
  files: File[],
  opts?: { formats?: ("square" | "vertical" | "story")[] }
): Promise<string[]> {
  const urls: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const { url, path } = await uploadOne(consultantId, f);
    urls.push(url);
    // Registra na biblioteca de imagens reutilizáveis (best-effort).
    try {
      const dim = await readDim(f).catch(() => ({ w: 0, h: 0 }));
      const format = opts?.formats?.[i] || (dim.w && dim.h ? detectFormat(dim.w, dim.h) : "square");
      const { addToAdImageLibrary } = await import("@/services/adImageLibrary");
      await addToAdImageLibrary({
        consultant_id: consultantId,
        url, storage_path: path,
        format, width: dim.w || null, height: dim.h || null,
        file_size: f.size, content_type: f.type, filename: f.name,
      });
    } catch (e) { console.warn("[uploadAdPhotos] library save falhou:", e); }
  }
  return urls;
}

// =============== Wallet (carteira pré-paga compartilhada) ===============
export interface WalletBalance {
  balance_cents: number;
  total_topped_up_cents: number;
  total_spent_cents: number;
  auto_pause_at_cents: number;
  debt_cents: number;
}
export async function getWalletBalance(consultantId: string): Promise<WalletBalance> {
  const { data, error } = await supabase
    .from("consultant_wallet")
    .select("balance_cents,total_topped_up_cents,total_spent_cents,auto_pause_at_cents,debt_cents")
    .eq("consultant_id", consultantId)
    .maybeSingle();
  if (error && (error as any).code !== "PGRST116") throw error;
  return {
    balance_cents: Number(data?.balance_cents ?? 0),
    total_topped_up_cents: Number(data?.total_topped_up_cents ?? 0),
    total_spent_cents: Number(data?.total_spent_cents ?? 0),
    auto_pause_at_cents: Number(data?.auto_pause_at_cents ?? 500),
    debt_cents: Number((data as any)?.debt_cents ?? 0),
  };
}

export interface WalletTransaction {
  id: string;
  type: "topup" | "spend" | "refund" | "adjustment";
  amount_cents: number;
  balance_after_cents: number | null;
  description: string | null;
  created_at: string;
  campaign_id?: string | null;
  metadata?: any;
  gross_spend_cents?: number | null;
}
export async function getWalletTransactions(consultantId: string, limit = 30): Promise<WalletTransaction[]> {
  const { data, error } = await supabase
    .from("wallet_transactions")
    .select("id,type,amount_cents,balance_after_cents,description,created_at,campaign_id,metadata,gross_spend_cents")
    .eq("consultant_id", consultantId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []) as WalletTransaction[];
}

export interface WalletGroup {
  key: string;
  date: string;
  campaign_id: string | null;
  campaign_name: string;
  distribuidora: string | null;
  total_amount_cents: number;
  total_gross_meta_cents: number;
  impressions: number;
  clicks: number;
  leads: number;
  cpl_cents: number;
  items: WalletTransaction[];
}
export interface WalletFeed {
  groups: WalletGroup[];
  others: WalletTransaction[];
}
export async function getWalletFeed(consultantId: string, limit = 80): Promise<WalletFeed> {
  const tx = await getWalletTransactions(consultantId, limit);
  const spends = tx.filter((t) => t.type === "spend");
  const others = tx.filter((t) => t.type !== "spend");

  const campaignIds = Array.from(new Set(spends.map((s) => s.campaign_id).filter(Boolean))) as string[];
  const campaignMap: Record<string, { name: string; distribuidora: string | null }> = {};
  if (campaignIds.length) {
    const { data: campaigns } = await supabase
      .from("facebook_campaigns")
      .select("id,name,distribuidora")
      .in("id", campaignIds);
    for (const c of campaigns || []) campaignMap[c.id] = { name: c.name, distribuidora: (c as any).distribuidora ?? null };
  }

  const pairKey = (cid: string, date: string) => `${cid}__${date}`;
  const dailyMap: Record<string, { impressions: number; clicks: number; leads: number }> = {};
  if (campaignIds.length) {
    const dates = Array.from(new Set(spends.map((s) => s.metadata?.date).filter(Boolean))) as string[];
    if (dates.length) {
      const { data: daily } = await supabase
        .from("facebook_metrics_daily")
        .select("campaign_id,date,impressions,clicks,leads")
        .in("campaign_id", campaignIds)
        .in("date", dates);
      for (const d of daily || []) {
        dailyMap[pairKey(d.campaign_id as string, d.date as string)] = {
          impressions: Number(d.impressions || 0),
          clicks: Number(d.clicks || 0),
          leads: Number(d.leads || 0),
        };
      }
    }
  }

  const groupsMap: Record<string, WalletGroup> = {};
  for (const t of spends) {
    const date = String(t.metadata?.date || t.created_at.slice(0, 10));
    const cid = t.campaign_id || "_unknown_";
    const key = `${date}__${cid}`;
    if (!groupsMap[key]) {
      const camp = (t.campaign_id && campaignMap[t.campaign_id]) || null;
      const daily = (t.campaign_id && dailyMap[pairKey(t.campaign_id, date)]) || { impressions: 0, clicks: 0, leads: 0 };
      groupsMap[key] = {
        key, date, campaign_id: t.campaign_id || null,
        campaign_name: camp?.name || "Campanha removida",
        distribuidora: camp?.distribuidora || null,
        total_amount_cents: 0, total_gross_meta_cents: 0,
        impressions: daily.impressions, clicks: daily.clicks, leads: daily.leads,
        cpl_cents: 0, items: [],
      };
    }
    groupsMap[key].total_amount_cents += t.amount_cents;
    groupsMap[key].total_gross_meta_cents += Number(t.gross_spend_cents ?? t.metadata?.gross_meta_cents ?? 0);
    groupsMap[key].items.push(t);
  }
  const groups = Object.values(groupsMap)
    .map((g) => ({ ...g, cpl_cents: g.leads > 0 ? Math.round(g.total_amount_cents / g.leads) : 0 }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  return { groups, others };
}

export async function createTopupSession(amountCents: number): Promise<{ url: string }> {
  const { data, error } = await supabase.functions.invoke("wallet-create-topup", { body: { amount_cents: amountCents } });
  if (error) await throwFunctionError(error);
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as { url: string };
}

// =============== Configurações de anúncio do consultor ===============
export interface ConsultantAdSettings {
  whatsapp_destination_number: string | null;
  cities: { key: string; name: string; uf?: string }[];
  distribuidora_default: string | null;
  display_name: string | null;
  age_min: number;
  age_max: number;
}
export async function getConsultantAdSettings(consultantId: string): Promise<ConsultantAdSettings> {
  const { data, error } = await supabase
    .from("consultant_ad_settings")
    .select("*")
    .eq("consultant_id", consultantId)
    .maybeSingle();
  if (error && (error as any).code !== "PGRST116") throw error;
  return {
    whatsapp_destination_number: data?.whatsapp_destination_number ?? null,
    cities: ((data?.cities as any) || []) as ConsultantAdSettings["cities"],
    distribuidora_default: data?.distribuidora_default ?? null,
    display_name: data?.display_name ?? null,
    age_min: data?.age_min ?? 28,
    age_max: data?.age_max ?? 60,
  };
}
export async function saveConsultantAdSettings(consultantId: string, patch: Partial<ConsultantAdSettings>) {
  const { error } = await supabase
    .from("consultant_ad_settings")
    .upsert({ consultant_id: consultantId, ...patch, updated_at: new Date().toISOString() } as any, { onConflict: "consultant_id" });
  if (error) throw error;
}

// =============== Plataforma (Super Admin) ===============
export interface PlatformFacebookStatus {
  connected: boolean;
  configured: boolean;
  ad_account_id: string | null;
  ad_account_name: string | null;
  page_id: string | null;
  page_name: string | null;
  pixel_id: string | null;
  fb_user_name: string | null;
  token_expires_at: string | null;
}
export async function getPlatformFacebookStatus(): Promise<PlatformFacebookStatus> {
  const { data, error } = await supabase
    .from("platform_facebook_account")
    .select("fb_user_id,ad_account_id,ad_account_name,page_id,page_name,pixel_id,fb_user_name,token_expires_at")
    .eq("id", true)
    .maybeSingle();
  if (error && (error as any).code !== "PGRST116") throw error;
  const configured = !!data?.ad_account_id && !!data?.page_id;
  return {
    connected: !!data?.fb_user_id || !!data?.fb_user_name || configured,
    configured,
    ad_account_id: data?.ad_account_id ?? null,
    ad_account_name: data?.ad_account_name ?? null,
    page_id: data?.page_id ?? null,
    page_name: data?.page_name ?? null,
    pixel_id: data?.pixel_id ?? null,
    fb_user_name: data?.fb_user_name ?? null,
    token_expires_at: data?.token_expires_at ?? null,
  };
}
