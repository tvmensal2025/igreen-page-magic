/**
 * Config do Cérebro / rotação MG — persistido em consultant_ad_settings.brain_config.
 * Editável na UI; rotator e brain-rank leem daqui (sem redeploy).
 */
import { pickAdCopyForCity } from "./ad-copy-bank.ts";
import {
  type AdsActionKind,
  type AdsPolicyInput,
  anyExpansiveAdsMutationAllowed,
  isAdsActionAllowed,
} from "./ad-automation-policy.ts";
import { isUuid } from "./ads-anchor.ts";

export type BrainExtraCity = {
  name: string;
  slug: string;
  ddd: number;
  key?: string;
};

export type AdsAutomationMode = "disabled" | "shadow" | "limited" | "full";

export type BrainConfig = {
  /** Compatibilidade legada. Nunca autoriza mutação sem automation_mode explícito. */
  autopilot: boolean;
  /** Perfil de estratégia legado; não é o nível de autonomia. */
  mode: "conservative" | "balanced" | "aggressive";
  /** Nível de autonomia. Ausente/legado normaliza para disabled. */
  automation_mode: AdsAutomationMode;
  /** Trava imediata de todos os efeitos automáticos Meta. */
  kill_switch: boolean;
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
  /**
   * Campanha âncora deste consultor. Substitui o UUID que estava hardcoded nas
   * edge functions. Null = sem âncora configurada (o motor não age).
   */
  anchor_campaign_id?: string | null;
  /** Criativo vencedor usado nas exploradoras (HTTPS). */
  winner_photo_url?: string | null;
};

export const DEFAULT_BRAIN_CONFIG: BrainConfig = {
  autopilot: false,
  mode: "conservative",
  automation_mode: "disabled",
  kill_switch: true,
  anchor_budget_cents: 1000,
  max_anchor_budget_cents: 50000,
  target_cpl_cents: 200,
  scale_step_pct: 10,
  explorer_budget_cents: 517,
  max_explorers: 4,
  age_min: 30,
  age_max: 65,
  min_runway_days: 2,
  preferred_slugs: ["uberaba", "contagem", "betim", "patos-de-minas"],
  extra_cities: [],
};

export function resolveAdsAutomationMode(raw: unknown): AdsAutomationMode {
  const value = raw && typeof raw === "object"
    ? (raw as Record<string, unknown>).automation_mode
    : null;
  return value === "shadow" || value === "limited" || value === "full"
    ? value
    : "disabled";
}

export function normalizeBrainConfig(raw: unknown): BrainConfig {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  const clampMoney = (n: number) =>
    Math.max(517, Math.min(50000, Math.round(n)));
  const preferred = Array.isArray(o.preferred_slugs)
    ? o.preferred_slugs.map((s) => String(s).toLowerCase().trim()).filter(
      Boolean,
    )
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

  const mode = o.mode === "balanced" || o.mode === "aggressive"
    ? o.mode
    : "conservative";
  const automationMode = resolveAdsAutomationMode(o);
  const maxExplorers = Math.max(
    1,
    Math.min(8, Number(o.max_explorers) || DEFAULT_BRAIN_CONFIG.max_explorers),
  );

  return {
    autopilot: o.autopilot === true,
    mode,
    automation_mode: automationMode,
    kill_switch: o.kill_switch !== false,
    anchor_budget_cents: clampMoney(
      Number(o.anchor_budget_cents) || DEFAULT_BRAIN_CONFIG.anchor_budget_cents,
    ),
    max_anchor_budget_cents: clampMoney(
      Number(o.max_anchor_budget_cents) ||
        DEFAULT_BRAIN_CONFIG.max_anchor_budget_cents,
    ),
    target_cpl_cents: Math.max(
      50,
      Math.min(
        2000,
        Math.round(
          Number(o.target_cpl_cents) || DEFAULT_BRAIN_CONFIG.target_cpl_cents,
        ),
      ),
    ),
    scale_step_pct: Math.max(
      1,
      Math.min(
        30,
        Math.round(
          Number(o.scale_step_pct) || DEFAULT_BRAIN_CONFIG.scale_step_pct,
        ),
      ),
    ),
    explorer_budget_cents: clampMoney(
      Number(o.explorer_budget_cents) ||
        DEFAULT_BRAIN_CONFIG.explorer_budget_cents,
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
    // Só aceita UUID válido: string solta aqui viraria query errada.
    anchor_campaign_id: isUuid(o.anchor_campaign_id)
      ? String(o.anchor_campaign_id).trim()
      : null,
    winner_photo_url: typeof o.winner_photo_url === "string" &&
        o.winner_photo_url.trim()
      ? o.winner_photo_url.trim()
      : null,
  };
}

/**
 * Adapta o `brain_config` cru para a entrada da policy central.
 * A policy (`ad-automation-policy.ts`) é a fonte única de decisão; este módulo
 * só normaliza os dados. A dependência é unidirecional (policy não importa
 * brain-config), então não há ciclo.
 */
export function adsPolicyInput(raw: unknown): AdsPolicyInput {
  const cfg = normalizeBrainConfig(raw);
  return {
    autopilot: cfg.autopilot,
    automation_mode: cfg.automation_mode,
    kill_switch: cfg.kill_switch,
  };
}

/**
 * Decide uma ação específica a partir do `brain_config` cru.
 * Protetivas (pausar por saldo/teto/prazo/waste) passam sempre; expansivas
 * exigem modo explícito. Ver a assimetria documentada na policy.
 */
export function isAdsActionAllowedForConfig(
  raw: unknown,
  action: AdsActionKind,
): boolean {
  return isAdsActionAllowed(adsPolicyInput(raw), action);
}

/**
 * Existe alguma mutação EXPANSIVA liberada para este consultor?
 * Não cobre ações protetivas — para essas use a ação específica.
 */
export function isAdsExpansiveMutationAllowed(raw: unknown): boolean {
  return anyExpansiveAdsMutationAllowed(adsPolicyInput(raw));
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
