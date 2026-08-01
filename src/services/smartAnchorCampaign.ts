/**
 * Cérebro Inteligente (1-clique) — molde vencedor cidade sede + bootstrap Cérebro.
 * Foto ou vídeo; título do anúncio editável.
 * Ver docs/CEREBRO-ADS-OFICIAL.md §5.7.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  checkInitialMessage,
  createCampaign,
  getWalletBalance,
  searchCities,
  uploadAdPhotos,
  uploadAdVideo,
  type CityHit,
  type CreateCampaignResult,
} from "@/services/facebookAds";
import { listAdImageLibrary } from "@/services/adImageLibrary";
import { listAdVideoLibrary } from "@/services/adVideoLibrary";
import { dddsFromCampaignGeo } from "@/lib/cityToDdd";

export const SMART_ANCHOR_MIN_BUDGET_CENTS = 3000; // R$ 30 — início recomendado
/** Piso Meta (centavos). */
export const SMART_META_FLOOR_CENTS = 517; // R$ 5,17
/** Teto máximo permitido na UI (centavos). */
export const SMART_ANCHOR_HARD_MAX_CENTS = 50000; // R$ 500
export const SMART_TARGET_CPL_CENTS = 750; // R$ 7,50
export const SMART_SCALE_STEP_PCT = 15;

export const SMART_CREATIVE = {
  headline: "Pague 28% mais barato na conta de luz",
  primary_text: "Simule no zap e veja quanto você economiza com a energia solar por assinatura.",
  description: "Economia real na conta de luz",
  initial_message: "Oi! Quero saber como consigo pagar menos na conta de luz.",
} as const;

export type SmartCreativeMode = "photo" | "video";

export type SmartLibraryItem = {
  id: string;
  url: string;
  thumbUrl?: string | null;
  label: string;
  kind: SmartCreativeMode;
  /** Foto/vídeo oficial da plataforma (compartilhado). */
  isPlatformShared?: boolean;
  /** Formato da foto na biblioteca (inteligente usa só square). */
  format?: "square" | "vertical" | "story";
};

export type SmartAnchorPreview = {
  city: CityHit;
  /** Orçamento diário inicial (o Cérebro sobe/desce a partir daqui). */
  budgetCents: number;
  /** Teto diário — o Cérebro não passa desse valor ao subir. */
  maxBudgetCents: number;
  sedeLabel: string;
  photoUrl: string | null;
  videoUrl: string | null;
  videoThumbUrl: string | null;
  creativeMode: SmartCreativeMode;
  headline: string;
  primaryText: string;
  description: string;
  initialMessage: string;
  libraryPhotos: SmartLibraryItem[];
  libraryVideos: SmartLibraryItem[];
  walletHint: string | null;
  /** Saldo líquido da carteira (centavos). null = não consultado. */
  walletLiquidCents: number | null;
  /** Pré-requisitos já ok no load (sede). */
  hasSede: boolean;
};

function cityQueryFromSede(bc: Record<string, unknown>): string {
  const name = typeof bc.sede_name === "string" ? bc.sede_name.trim() : "";
  const address = typeof bc.sede_address === "string" ? bc.sede_address.trim() : "";
  const raw = name || address || "Uberlândia";
  if (/uberl[aá]ndia|udi\b/i.test(raw)) return "Uberlândia";
  const first = raw.split(/[,/·—–-]/)[0]?.trim() || raw;
  return first.slice(0, 60) || "Uberlândia";
}

async function resolveSedeCity(bc: Record<string, unknown>): Promise<CityHit> {
  const q = cityQueryFromSede(bc);
  const { cities } = await searchCities(q);
  const hit = cities.find((c) => /uberl/i.test(c.name)) || cities[0];
  if (hit?.key) return hit;
  return { key: "273173", name: "Uberlândia", region: "Minas Gerais", country_code: "BR" };
}

/** Próprias + oficiais — só square (o inteligente publica 1 foto 1:1, sem 3 formatos). */
async function loadPhotoLibrary(consultantId: string): Promise<SmartLibraryItem[]> {
  const items = await listAdImageLibrary(consultantId);
  const squares = items.filter((r) => r.format === "square" && /^https:\/\//i.test(r.url));
  const sorted = [...squares].sort((a, b) => {
    const sa = a.is_platform_shared ? 1 : 0;
    const sb = b.is_platform_shared ? 1 : 0;
    if (sb !== sa) return sb - sa;
    return (b.usage_count || 0) - (a.usage_count || 0);
  });
  return sorted.slice(0, 24).map((r) => ({
    id: r.id,
    url: r.url,
    thumbUrl: r.url,
    label: r.is_platform_shared ? "Oficial" : r.filename || "Foto",
    kind: "photo" as const,
    isPlatformShared: !!r.is_platform_shared,
    format: "square" as const,
  }));
}

async function loadVideoLibrary(consultantId: string): Promise<SmartLibraryItem[]> {
  const items = await listAdVideoLibrary(consultantId);
  const sorted = [...items].sort((a, b) => {
    const sa = a.is_platform_shared ? 1 : 0;
    const sb = b.is_platform_shared ? 1 : 0;
    if (sb !== sa) return sb - sa;
    return (b.usage_count || 0) - (a.usage_count || 0);
  });
  return sorted
    .filter((r) => /^https:\/\//i.test(r.url))
    .slice(0, 12)
    .map((r) => ({
      id: r.id,
      url: r.url,
      thumbUrl: r.thumb_url,
      label: r.is_platform_shared
        ? r.filename?.replace(/\.(mp4|mov)$/i, "") || "Oficial"
        : r.filename || "Vídeo",
      kind: "video" as const,
      isPlatformShared: !!r.is_platform_shared,
    }));
}

export async function loadSmartAnchorPreview(consultantId: string): Promise<SmartAnchorPreview> {
  const { data: settings } = await supabase
    .from("consultant_ad_settings")
    .select("brain_config")
    .eq("consultant_id", consultantId)
    .maybeSingle();
  const bc = ((settings as { brain_config?: Record<string, unknown> } | null)?.brain_config ||
    {}) as Record<string, unknown>;

  const lat = Number(bc.sede_latitude);
  const lng = Number(bc.sede_longitude);
  const hasSede = Number.isFinite(lat) && Number.isFinite(lng);

  const [libraryPhotos, libraryVideos] = await Promise.all([
    loadPhotoLibrary(consultantId),
    loadVideoLibrary(consultantId),
  ]);

  const winner = typeof bc.winner_photo_url === "string" && /^https:\/\//i.test(bc.winner_photo_url)
    ? bc.winner_photo_url
    : null;
  const photoUrl = winner || libraryPhotos[0]?.url || null;
  const videoUrl = libraryVideos[0]?.url || null;
  const videoThumbUrl = libraryVideos[0]?.thumbUrl || null;
  const creativeMode: SmartCreativeMode = photoUrl ? "photo" : videoUrl ? "video" : "photo";

  const savedBudget = Number(bc.anchor_budget_cents) || 0;
  const savedMax = Number(bc.max_anchor_budget_cents) || 0;
  const budgetCents = Math.max(
    SMART_ANCHOR_MIN_BUDGET_CENTS,
    Math.min(SMART_ANCHOR_HARD_MAX_CENTS, savedBudget || SMART_ANCHOR_MIN_BUDGET_CENTS),
  );
  const maxBudgetCents = Math.max(
    budgetCents,
    Math.min(
      SMART_ANCHOR_HARD_MAX_CENTS,
      savedMax >= budgetCents ? savedMax : Math.max(budgetCents * 3, 15000),
    ),
  );

  let initialMessage: string = SMART_CREATIVE.initial_message;
  try {
    const check = await checkInitialMessage(initialMessage);
    if (check.duplicate && check.suggestion) {
      initialMessage = check.suggestion.slice(0, 160);
    } else if (check.duplicate) {
      initialMessage = `${SMART_CREATIVE.initial_message} Quero simular agora.`.slice(0, 160);
    }
  } catch {
    /* segue com default */
  }

  let walletLiquidCents: number | null = null;
  let walletHint: string | null = null;
  try {
    const w = await getWalletBalance(consultantId);
    walletLiquidCents = Math.max(0, w.balance_cents - w.debt_cents);
    if (walletLiquidCents < budgetCents) {
      walletHint = `Saldo na carteira: R$ ${(walletLiquidCents / 100).toFixed(2)}. Recarregue para cobrir pelo menos o valor do dia (R$ ${(budgetCents / 100).toFixed(2)}).`;
    }
  } catch {
    walletHint = null;
  }

  // Sem sede: devolve preview parcial (UI explica e deixa escolher a cidade).
  if (!hasSede) {
    return {
      city: { key: "", name: "Sua cidade", region: "", country_code: "BR" },
      budgetCents,
      maxBudgetCents,
      sedeLabel: "Ainda não informada",
      photoUrl,
      videoUrl,
      videoThumbUrl,
      creativeMode,
      headline: SMART_CREATIVE.headline,
      primaryText: SMART_CREATIVE.primary_text,
      description: SMART_CREATIVE.description,
      initialMessage,
      libraryPhotos,
      libraryVideos,
      walletHint,
      walletLiquidCents,
      hasSede: false,
    };
  }

  const city = await resolveSedeCity(bc);
  const sedeLabel =
    (typeof bc.sede_name === "string" && bc.sede_name.trim()) ||
    (typeof bc.sede_address === "string" && bc.sede_address.trim()) ||
    city.name;

  return {
    city,
    budgetCents,
    maxBudgetCents,
    sedeLabel,
    photoUrl,
    videoUrl,
    videoThumbUrl,
    creativeMode,
    headline: SMART_CREATIVE.headline,
    primaryText: SMART_CREATIVE.primary_text,
    description: SMART_CREATIVE.description,
    initialMessage,
    libraryPhotos,
    libraryVideos,
    walletHint,
    walletLiquidCents,
    hasSede: true,
  };
}

/** Salva cidade/endereço da sede no Cérebro (usado pelo diálogo Inteligente). */
export async function saveSmartSedeLocation(
  consultantId: string,
  opts: {
    name: string;
    address: string;
    latitude: number;
    longitude: number;
    radiusKm?: number;
  },
): Promise<void> {
  const lat = Number(opts.latitude);
  const lng = Number(opts.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error("Não encontramos esse endereço. Digite a cidade ou o bairro de novo.");
  }
  const { data: settings } = await supabase
    .from("consultant_ad_settings")
    .select("brain_config")
    .eq("consultant_id", consultantId)
    .maybeSingle();
  const prev = ((settings as { brain_config?: Record<string, unknown> } | null)?.brain_config ||
    {}) as Record<string, unknown>;
  const radius = Math.max(1, Math.min(50, Number(opts.radiusKm) || Number(prev.sede_radius_km) || 50));
  const next = {
    ...prev,
    geo_mode: "radius_sede",
    sede_name: String(opts.name || "").trim().slice(0, 120) || "Minha sede",
    sede_address: String(opts.address || "").trim().slice(0, 240),
    sede_latitude: lat,
    sede_longitude: lng,
    sede_radius_km: radius,
  };
  const { error } = await supabase
    .from("consultant_ad_settings")
    .upsert(
      { consultant_id: consultantId, brain_config: next, updated_at: new Date().toISOString() },
      { onConflict: "consultant_id" },
    );
  if (error) throw error;
}

/** Persiste âncora + política de escala no brain_config do consultor. */
export async function bootstrapSmartAnchorBrain(
  consultantId: string,
  portalCampaignId: string,
  budgetCents: number,
  maxBudgetCents: number,
): Promise<void> {
  const { data: settings } = await supabase
    .from("consultant_ad_settings")
    .select("brain_config")
    .eq("consultant_id", consultantId)
    .maybeSingle();
  const prev = ((settings as { brain_config?: Record<string, unknown> } | null)?.brain_config ||
    {}) as Record<string, unknown>;
  const wasFull = prev.automation_mode === "full" && prev.kill_switch === false;
  const start = Math.max(SMART_META_FLOOR_CENTS, Math.min(SMART_ANCHOR_HARD_MAX_CENTS, budgetCents));
  const ceiling = Math.max(start, Math.min(SMART_ANCHOR_HARD_MAX_CENTS, maxBudgetCents));
  const next = {
    ...prev,
    anchor_campaign_id: portalCampaignId,
    target_cpl_cents: SMART_TARGET_CPL_CENTS,
    max_explorers: 0,
    preferred_slugs: [],
    geo_mode: "radius_sede",
    anchor_budget_cents: start,
    max_anchor_budget_cents: ceiling,
    scale_step_pct: SMART_SCALE_STEP_PCT,
    autopilot: true,
    kill_switch: false,
    automation_mode: wasFull ? "full" : "limited",
    require_initial_message: true,
  };
  const { error } = await supabase
    .from("consultant_ad_settings")
    .upsert(
      { consultant_id: consultantId, brain_config: next, updated_at: new Date().toISOString() },
      { onConflict: "consultant_id" },
    );
  if (error) throw error;
}

/** Checklist do que falta para o consultor poder publicar. */
export function smartPublishGaps(preview: SmartAnchorPreview): string[] {
  const gaps: string[] = [];
  if (!preview.hasSede) {
    gaps.push("Informe a cidade da sua sede (onde você atende) para o anúncio aparecer na região certa.");
  }
  if (preview.headline.trim().length < 3) gaps.push("Digite o título do anúncio.");
  if (preview.creativeMode === "photo" && !preview.photoUrl) gaps.push("Escolha ou envie uma foto.");
  if (preview.creativeMode === "video" && !preview.videoUrl) gaps.push("Escolha ou envie um vídeo.");
  if (preview.budgetCents < SMART_META_FLOOR_CENTS) {
    gaps.push(`Valor do dia mínimo: R$ ${(SMART_META_FLOOR_CENTS / 100).toFixed(2)}.`);
  }
  if (preview.maxBudgetCents < preview.budgetCents) {
    gaps.push("O teto máximo precisa ser maior ou igual ao valor do dia.");
  }
  if (preview.maxBudgetCents > SMART_ANCHOR_HARD_MAX_CENTS) {
    gaps.push(`Teto máximo permitido: R$ ${(SMART_ANCHOR_HARD_MAX_CENTS / 100).toFixed(0)}.`);
  }
  if (
    preview.walletLiquidCents != null &&
    preview.walletLiquidCents < preview.budgetCents
  ) {
    gaps.push(
      `Saldo insuficiente na carteira (R$ ${(preview.walletLiquidCents / 100).toFixed(2)}). Recarregue antes de publicar.`,
    );
  }
  return gaps;
}

export async function uploadSmartPhoto(
  consultantId: string,
  file: File,
): Promise<string> {
  const [url] = await uploadAdPhotos(consultantId, [file], { formats: ["square"] });
  return url;
}

export async function uploadSmartVideo(
  consultantId: string,
  file: File,
): Promise<{ url: string; thumbUrl: string | null }> {
  const { url, path } = await uploadAdVideo(consultantId, file);
  await supabase.from("ad_video_library").insert({
    consultant_id: consultantId,
    url,
    storage_path: path,
    filename: file.name,
    content_type: file.type || "video/mp4",
    file_size: file.size,
  });
  return { url, thumbUrl: null };
}

export async function publishSmartAnchorCampaign(
  consultantId: string,
  preview: SmartAnchorPreview,
): Promise<CreateCampaignResult & { portal_campaign_id?: string }> {
  const mode = preview.creativeMode;
  if (mode === "photo" && !preview.photoUrl) {
    throw new Error("Escolha ou envie uma imagem para o Cérebro Inteligente.");
  }
  if (mode === "video" && !preview.videoUrl) {
    throw new Error("Escolha ou envie um vídeo para o Cérebro Inteligente.");
  }
  const headline = preview.headline.trim();
  if (headline.length < 3) {
    throw new Error("Digite o título do anúncio (pelo menos 3 caracteres).");
  }
  const gaps = smartPublishGaps(preview);
  if (gaps.length) {
    throw new Error(gaps[0]);
  }

  const retargetDdds = dddsFromCampaignGeo({
    cities: [{ key: preview.city.key, name: preview.city.name }],
  });

  const startBudget = Math.max(
    SMART_META_FLOOR_CENTS,
    Math.min(SMART_ANCHOR_HARD_MAX_CENTS, preview.budgetCents),
  );
  const maxBudget = Math.max(
    startBudget,
    Math.min(SMART_ANCHOR_HARD_MAX_CENTS, preview.maxBudgetCents),
  );

  const result = await createCampaign({
    name: `IGREEN-ANCORA-${preview.city.name}`,
    cities: [{ key: preview.city.key, name: preview.city.name }],
    daily_budget_cents: startBudget,
    duration_days: null,
    age_min: 25,
    age_max: 65,
    creative_mode: mode,
    photos: mode === "photo" && preview.photoUrl
      ? [{ url: preview.photoUrl, format: "square" }]
      : undefined,
    video: mode === "video" && preview.videoUrl
      ? { url: preview.videoUrl, thumb_url: preview.videoThumbUrl || undefined }
      : undefined,
    headline,
    primary_text: preview.primaryText.trim() || SMART_CREATIVE.primary_text,
    description: preview.description.trim() || SMART_CREATIVE.description,
    placement_mode: "auto",
    initial_message: preview.initialMessage,
    is_remarketing: true,
    retarget_ddds: retargetDdds.length ? retargetDdds : undefined,
    smart_anchor: true,
    max_anchor_budget_cents: maxBudget,
  });

  const portalId = result.portal_campaign_id;
  if (portalId) {
    try {
      await bootstrapSmartAnchorBrain(consultantId, portalId, startBudget, maxBudget);
    } catch (e) {
      console.warn("[smart-anchor] bootstrap brain falhou (edge pode ter feito):", e);
    }
  }
  return result;
}
