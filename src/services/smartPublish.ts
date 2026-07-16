// Orquestrador do fluxo "Publicar inteligente" (1 clique).
// Detecta região do consultor pelo DDD do WhatsApp conectado, escolhe a
// distribuidora compatível e a melhor cidade do preset, valida no Meta
// e publica a campanha usando o template fornecido.

import { supabase } from "@/integrations/supabase/client";
import {
  CityHit, createCampaign, preflightCampaign, searchCitiesBulk,
} from "@/services/facebookAds";
import { DISTRIBUIDORAS_PRESETS, type DistribuidoraPreset } from "@/data/distribuidoraPresets";
import { AdTemplate } from "@/services/adTemplates";
import { ufFromPhone } from "@/lib/dddToUf";

const PRESET_CACHE_VERSION = "v1";
const cacheKey = (id: string) => `ads-preset-cities-${PRESET_CACHE_VERSION}-${id}`;

function readCache(id: string): CityHit[] | null {
  try {
    const raw = localStorage.getItem(cacheKey(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.cities) && parsed.cities.length > 0) return parsed.cities as CityHit[];
  } catch {}
  return null;
}
function writeCache(id: string, cities: CityHit[]) {
  try { localStorage.setItem(cacheKey(id), JSON.stringify({ ts: Date.now(), cities })); } catch {}
}

export interface SmartPublishProgress {
  step: "region" | "city" | "validate" | "publish" | "done";
  label: string;
}
export type ProgressFn = (p: SmartPublishProgress) => void;

export interface SmartPublishResult {
  ok: true;
  preset: DistribuidoraPreset;
  cities: CityHit[];
  reach?: { lower: number; upper: number };
}

async function getConnectedPhone(consultantId: string): Promise<string | null> {
  // Mesma cascata do backend (loadConsultantAdSettings) e do hook
  // useConsultantPhone — garante que o anúncio use o número que está
  // realmente conectado em Dados e na instância WhatsApp (Evolution).
  const onlyDigits = (v: unknown) => {
    const s = String(v ?? "").replace(/\D/g, "");
    return s.length >= 10 ? s : null;
  };

  // 1) consultant_ad_settings (configurado em "Dados")
  const { data: cas } = await supabase
    .from("consultant_ad_settings")
    .select("whatsapp_destination_number")
    .eq("consultant_id", consultantId)
    .maybeSingle();
  let resolved = onlyDigits(cas?.whatsapp_destination_number);

  // 2) whatsapp_instances.connected_phone (Evolution conectado)
  if (!resolved) {
    const { data: inst } = await supabase
      .from("whatsapp_instances")
      .select("connected_phone")
      .eq("consultant_id", consultantId)
      .not("connected_phone", "is", null)
      .limit(1)
      .maybeSingle();
    resolved = onlyDigits((inst as any)?.connected_phone);
  }

  // 3) consultants.phone (cadastro)
  if (!resolved) {
    const { data: c } = await supabase
      .from("consultants").select("phone").eq("id", consultantId).maybeSingle();
    resolved = onlyDigits(c?.phone);
  }

  // 4) facebook_connections (último recurso)
  if (!resolved) {
    const { data: fb } = await supabase
      .from("facebook_connections")
      .select("whatsapp_destination_number, whatsapp_display_number")
      .eq("consultant_id", consultantId)
      .maybeSingle();
    resolved = onlyDigits(fb?.whatsapp_destination_number)
      || onlyDigits(fb?.whatsapp_display_number);
  }

  return resolved;
}

function pickPresetByUf(allowed: DistribuidoraPreset[], uf: string | null): DistribuidoraPreset | null {
  if (!allowed.length) return null;
  if (uf) {
    const match = allowed.find((p) => p.uf.split("/").includes(uf));
    if (match) return match;
  }
  // fallback: maior tier
  const tierOrder = { alto: 0, medio: 1, sem_bonus: 2 } as const;
  return [...allowed].sort((a, b) => tierOrder[a.tier] - tierOrder[b.tier])[0];
}

export async function smartPublish(opts: {
  template: AdTemplate;
  consultantId: string;
  onProgress?: ProgressFn;
}): Promise<SmartPublishResult> {
  const { template, consultantId, onProgress } = opts;
  const log = (step: SmartPublishProgress["step"], label: string) =>
    onProgress?.({ step, label });

  // 1) Região
  log("region", "Detectando sua região...");
  const phone = await getConnectedPhone(consultantId);
  const uf = ufFromPhone(phone);

  const targetIds = template.target_distribuidora_ids ?? [];
  const allowed = targetIds.length
    ? DISTRIBUIDORAS_PRESETS.filter((p) => targetIds.includes(p.id))
    : DISTRIBUIDORAS_PRESETS;
  const preset = pickPresetByUf(allowed, uf);
  if (!preset) throw new Error("Nenhuma distribuidora compatível com este modelo");

  // 2) Cidade ideal
  log("city", `Escolhendo cidade em ${preset.nome}...`);
  let hits = readCache(preset.id);
  if (!hits) {
    const ufPrimary = preset.uf.split("/")[0];
    const targetCities = template.target_cidades ?? [];
    const cityNames = targetCities.length
      ? preset.cidades.filter((c) => targetCities.includes(c))
      : preset.cidades;
    const r = await searchCitiesBulk(cityNames.map((name) => ({ name, uf: ufPrimary })));
    hits = (r.cities || []).filter((h) => h?.key);
    if (hits.length) writeCache(preset.id, hits);
  }
  if (!hits?.length) throw new Error("Não consegui carregar cidades dessa distribuidora");

  // Heurística: 1 cidade por campanha (CPL). Não expandir para 3 cidades.
  let chosen: CityHit[] = [hits[0]];

  // Preserva a sugestão do template: orçamento baixo demais pode impedir a
  // Meta de aprender. O backend valida a cobertura real da carteira.
  const suggestedBudgetCents = Math.max(2500, template.suggested_daily_budget_cents);
  const suggestedDurationDays = 7;
  log("validate", "Validando alcance no Facebook...");
  let reach: { lower: number; upper: number } | undefined;
  try {
    const pf = await preflightCampaign({
      cities: chosen.map((c) => ({ key: c.key, name: c.name })),
      daily_budget_cents: suggestedBudgetCents,
      duration_days: suggestedDurationDays,
      age_min: template.age_min,
      age_max: template.age_max,
    });
    if (!pf.ok) {
      throw new Error(pf.blockers.join(" | ") || "A pré-validação bloqueou a publicação.");
    }
    reach = pf.reach || undefined;
    if (reach && reach.upper > 2_000_000) {
      chosen = [hits[0]];
    }
    if (reach && reach.lower < 50_000) {
      throw new Error(`Audiência muito pequena (${reach.lower.toLocaleString("pt-BR")} pessoas).`);
    }
  } catch (e) {
    // Falha técnica de estimativa pode seguir; bloqueadores explícitos e
    // audiência inviável nunca são engolidos pelo atalho inteligente.
    const message = (e as Error)?.message || "";
    if (message.startsWith("Audiência muito pequena") || message.includes("pré-validação bloqueou") || message.includes("Saldo insuficiente") || message.includes("WhatsApp") || message.includes("Facebook")) {
      throw e;
    }
  }

  // 4) Publicar
  const cityLabel = chosen.length === 1 ? chosen[0].name : `${chosen.length} cidades (${chosen.map(c => c.name).join(", ")})`;
  log("publish", `Publicando em ${cityLabel} — ${preset.nome}...`);
  const creativeMode: "photo" | "video" = (template as any).creative_mode === "video" ? "video" : "photo";
  const videoUrl = (template as any).video_url as string | null | undefined;
  const videoThumb = (template as any).video_thumb_url as string | null | undefined;
  await createCampaign({
    template_id: template.id,
    name: `${template.title} — ${preset.nome} (${cityLabel})`,
    cities: chosen.map((c) => ({ key: c.key, name: c.name })),
    daily_budget_cents: suggestedBudgetCents,
    duration_days: suggestedDurationDays,
    creative_mode: creativeMode,
    photos: creativeMode === "photo" ? template.photos : undefined,
    video: creativeMode === "video" && videoUrl
      ? { url: videoUrl, thumb_url: videoThumb || undefined }
      : undefined,
    headline: template.headline,
    primary_text: template.primary_text,
    description: template.description_text || undefined,
    age_min: template.age_min ?? 30,
    age_max: Math.min(template.age_max ?? 60, 60),
    distribuidora: preset.nome,
  });

  log("done", "Pronto!");
  return { ok: true, preset, cities: chosen, reach };
}
