// Orquestrador do "Modo Express": pré-carrega top imagens, 3 packs de copy
// e defaults vindos do histórico de winners do consultor (orçamento, dias, idade).
// O usuário só precisa escolher 5 coisas (cidade/rua, imagem, copy, valor, dias).

import { supabase } from "@/integrations/supabase/client";
import { generateCopy, type CopyPackV2 } from "@/services/facebookAds";
import { DISTRIBUIDORAS_PRESETS, type DistribuidoraPreset } from "@/data/distribuidoraPresets";

export interface ExpressImage {
  id: string;
  url: string;
  format: "square" | "vertical" | "story";
  usage_count: number;
  is_top: boolean;
  source: "library" | "uploaded";
}

export interface ExpressCopy {
  framework: string;
  headline: string;
  primary_text: string;
  description: string;
}

export interface ExpressDefaults {
  budget_cents: number;
  duration_days: number | null; // null = contínuo
  age_min: number;
  age_max: number;
  distribuidora: DistribuidoraPreset | null;
  initial_message: string;
}

export interface ExpressSuggestions {
  images: ExpressImage[];
  copies: ExpressCopy[];
  defaults: ExpressDefaults;
}

const DEFAULT_DAILY_BUDGET_CENTS = 2500;

const FALLBACK: ExpressDefaults = {
  budget_cents: DEFAULT_DAILY_BUDGET_CENTS,
  duration_days: 7,
  age_min: 30,
  age_max: 60,
  distribuidora: null,
  initial_message: "Olá! Quero saber como economizar na conta de luz.",
};

export function inferDistribuidora(cities: string[]): DistribuidoraPreset | null {
  if (!cities.length) return null;
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const wanted = cities.map(norm);
  // Conta hits por preset; vence quem tiver mais cidades em comum.
  let best: { preset: DistribuidoraPreset; hits: number } | null = null;
  for (const p of DISTRIBUIDORAS_PRESETS) {
    const pcities = p.cidades.map(norm);
    const hits = wanted.filter((c) => pcities.some((pc) => pc.includes(c) || c.includes(pc))).length;
    if (hits > 0 && (!best || hits > best.hits)) best = { preset: p, hits };
  }
  return best?.preset ?? null;
}

const EXPRESS_FORMATS: ExpressImage["format"][] = ["square", "vertical", "story"];

/** 1 imagem por formato (sem repetir tamanho) e sempre com URL pública. */
async function loadTopImages(consultantId: string): Promise<ExpressImage[]> {
  const { data } = await supabase
    .from("ad_image_library")
    .select("id, url, format, usage_count")
    .eq("consultant_id", consultantId)
    .order("usage_count", { ascending: false })
    .order("last_used_at", { ascending: false, nullsFirst: false })
    .limit(60);
  const rows = (data || []) as Array<{ id: string; url: string; format: string; usage_count: number }>;

  const seenUrls = new Set<string>();
  const byFormat = new Map<ExpressImage["format"], ExpressImage>();

  for (const r of rows) {
    const url = String(r.url || "").trim();
    // Só imagem pública (Meta precisa baixar a URL sem login).
    if (!/^https?:\/\//i.test(url) || url.includes("/object/sign/")) continue;
    if (seenUrls.has(url)) continue;
    const format = (EXPRESS_FORMATS as string[]).includes(r.format)
      ? (r.format as ExpressImage["format"])
      : "square";
    if (byFormat.has(format)) continue; // já temos 1 desse tamanho
    seenUrls.add(url);
    byFormat.set(format, {
      id: r.id,
      url,
      format,
      usage_count: r.usage_count || 0,
      is_top: (r.usage_count || 0) > 0,
      source: "library" as const,
    });
  }

  return EXPRESS_FORMATS.map((f) => byFormat.get(f)).filter(
    (i): i is ExpressImage => !!i,
  );
}


async function loadWinnerDefaults(consultantId: string): Promise<Partial<ExpressDefaults>> {
  const { data } = await supabase
    .from("facebook_campaigns")
    .select("daily_budget_cents, duration_days, age_min, age_max, leads_count, status, created_at")
    .eq("consultant_id", consultantId)
    .gt("leads_count", 0)
    .order("leads_count", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(5);
  const rows = (data || []) as Array<{
    daily_budget_cents: number; duration_days: number | null;
    age_min: number | null; age_max: number | null;
  }>;
  if (!rows.length) return {};
  const avg = (xs: number[]) => xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0;
  const budgets = rows.map((r) => r.daily_budget_cents).filter(Boolean);
  const ages = rows.filter((r) => r.age_min && r.age_max);
  const suggestedBudget = budgets.length ? avg(budgets) : DEFAULT_DAILY_BUDGET_CENTS;
  const durations = rows.map((r) => r.duration_days).filter((v): v is number => Number(v) > 0);
  return {
    budget_cents: Math.max(DEFAULT_DAILY_BUDGET_CENTS, suggestedBudget),
    duration_days: durations.length ? Math.max(3, Math.min(30, avg(durations))) : 7,
    age_min: ages.length ? Math.min(...ages.map(a => a.age_min!)) : undefined,
    age_max: ages.length ? Math.min(60, Math.max(...ages.map(a => a.age_max!))) : undefined,
  };
}

function splitCopyIntoPacks(c: CopyPackV2): ExpressCopy[] {
  const frameworks = ["Direto", "Curiosidade", "Storytelling"];
  // Se vier variations com framework, usa direto
  const vh = c.variations?.headlines || [];
  const vp = c.variations?.primary_texts || [];
  if (vh.length >= 3 && vp.length >= 3) {
    return [0, 1, 2].map((i) => ({
      framework: vh[i].framework || frameworks[i],
      headline: vh[i].text,
      primary_text: vp[i].text,
      description: c.description,
    }));
  }
  // Fallback: pega 3 primeiras headlines/primary_texts; repete se faltar
  const h = c.headlines || [];
  const p = c.primary_texts || [];
  if (!h.length || !p.length) return [];
  return [0, 1, 2].map((i) => ({
    framework: frameworks[i],
    headline: h[i % h.length] || h[0],
    primary_text: p[i % p.length] || p[0],
    description: c.description,
  }));
}

export async function fetchExpressSuggestions(opts: {
  consultantId: string;
  cities: string[];
}): Promise<ExpressSuggestions> {
  const { consultantId, cities } = opts;
  const distribuidora = inferDistribuidora(cities);
  const copyCities = distribuidora
    ? [`clientes de ${distribuidora.nome}`, ...cities.slice(0, 3)]
    : (cities.length ? cities : ["sua região"]);

  const [images, winners, copy] = await Promise.all([
    loadTopImages(consultantId),
    loadWinnerDefaults(consultantId),
    generateCopy(copyCities).catch(() => null),
  ]);

  const copies = copy ? splitCopyIntoPacks(copy) : [];

  const defaults: ExpressDefaults = {
    ...FALLBACK,
    ...winners,
    distribuidora,
    initial_message: distribuidora
      ? `Olá! Quero saber como economizar na conta da ${distribuidora.nome}.`
      : FALLBACK.initial_message,
  };

  return { images, copies, defaults };
}
