/**
 * Config do Cérebro / rotação MG — persistido em consultant_ad_settings.brain_config.
 * Editável na UI; rotator e brain-rank leem daqui (sem redeploy).
 */
import { pickAdCopyForCity } from "./ad-copy-bank.ts";

export type BrainExtraCity = {
  name: string;
  slug: string;
  ddd: number;
  key?: string;
};

export type BrainConfig = {
  autopilot: boolean;
  mode: "conservative" | "balanced" | "aggressive";
  /** Budget diário da âncora Uberlândia (centavos). */
  anchor_budget_cents: number;
  /** Teto de escala da âncora (centavos). Default R$ 500. */
  max_anchor_budget_cents: number;
  /** CPL Meta alvo em centavos (ex.: 200 = R$ 2). Escala sobe só abaixo disso. */
  target_cpl_cents: number;
  /** % de aumento/redução por ciclo de escala. */
  scale_step_pct: number;
  /** Budget diário de cada exploradora (centavos). */
  explorer_budget_cents: number;
  /** Quantas exploradoras ativas além da âncora. Total no ar = 1 + max_explorers. */
  max_explorers: number;
  /** Preferência de idade (Meta Advantage+: hard age_min fica 25; sugestão = este valor). */
  age_min: number;
  age_max: number;
  min_runway_days: number;
  preferred_slugs: string[];
  extra_cities: BrainExtraCity[];
  /** ISO da última escala da âncora (anti-spam do cron; não é trava de 48h). */
  last_anchor_scale_at?: string | null;
};

export const DEFAULT_BRAIN_CONFIG: BrainConfig = {
  autopilot: true,
  mode: "conservative",
  anchor_budget_cents: 1000,
  max_anchor_budget_cents: 50000,
  target_cpl_cents: 200,
  scale_step_pct: 15,
  explorer_budget_cents: 517,
  max_explorers: 4,
  age_min: 30,
  age_max: 65,
  min_runway_days: 2,
  preferred_slugs: ["uberaba", "contagem", "betim", "patos-de-minas"],
  extra_cities: [],
};

export function normalizeBrainConfig(raw: unknown): BrainConfig {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const clampMoney = (n: number) => Math.max(517, Math.min(50000, Math.round(n)));
  const preferred = Array.isArray(o.preferred_slugs)
    ? o.preferred_slugs.map((s) => String(s).toLowerCase().trim()).filter(Boolean)
    : DEFAULT_BRAIN_CONFIG.preferred_slugs;
  const extra = Array.isArray(o.extra_cities)
    ? (o.extra_cities as any[])
        .map((c) => ({
          name: String(c?.name || "").trim(),
          slug: String(c?.slug || "")
            .toLowerCase()
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, ""),
          ddd: Number(c?.ddd) || 31,
          key: c?.key ? String(c.key) : undefined,
        }))
        .filter((c) => c.name && c.slug)
    : [];

  const mode = o.mode === "balanced" || o.mode === "aggressive" ? o.mode : "conservative";
  const maxExplorers = Math.max(1, Math.min(8, Number(o.max_explorers) || DEFAULT_BRAIN_CONFIG.max_explorers));

  return {
    autopilot: o.autopilot !== false,
    mode,
    anchor_budget_cents: clampMoney(Number(o.anchor_budget_cents) || DEFAULT_BRAIN_CONFIG.anchor_budget_cents),
    max_anchor_budget_cents: clampMoney(
      Number(o.max_anchor_budget_cents) || DEFAULT_BRAIN_CONFIG.max_anchor_budget_cents,
    ),
    target_cpl_cents: Math.max(
      50,
      Math.min(2000, Math.round(Number(o.target_cpl_cents) || DEFAULT_BRAIN_CONFIG.target_cpl_cents)),
    ),
    scale_step_pct: Math.max(
      8,
      Math.min(30, Math.round(Number(o.scale_step_pct) || DEFAULT_BRAIN_CONFIG.scale_step_pct)),
    ),
    explorer_budget_cents: clampMoney(
      Number(o.explorer_budget_cents) || DEFAULT_BRAIN_CONFIG.explorer_budget_cents,
    ),
    max_explorers: maxExplorers,
    age_min: Math.max(18, Math.min(65, Number(o.age_min) || 30)),
    age_max: Math.max(18, Math.min(65, Number(o.age_max) || 65)),
    min_runway_days: Math.max(1, Math.min(30, Number(o.min_runway_days) || 2)),
    preferred_slugs: preferred.length
      ? preferred.slice(0, maxExplorers)
      : DEFAULT_BRAIN_CONFIG.preferred_slugs.slice(0, maxExplorers),
    extra_cities: extra,
    last_anchor_scale_at: o.last_anchor_scale_at
      ? String(o.last_anchor_scale_at)
      : null,
  };
}

export function slugifyCityName(name: string): string {
  return name
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Frases CTWA — sempre GENÉRICAS (sem nome de cidade; confunde o lead).
 * Rotação por slug escolhe variante do banco; atribuição = AD ID.
 */
export function ctwaMessageForCity(cityName: string, slug?: string): string {
  return pickAdCopyForCity({
    slug: slug || cityName || "mg",
    cityName: cityName || "",
  }).initial_message;
}
