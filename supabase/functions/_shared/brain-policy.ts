/**
 * Política do Cérebro de Campanhas — fonte única de configuração de decisão.
 *
 * Existia CPL-alvo em dois patamares conflitantes: `brain_config.target_cpl_cents`
 * já nascia 750 (R$ 7,50), mas cinco call sites caíam em `|| 200` (R$ 2,00) e a
 * coluna `facebook_campaigns.brain_scale_target_cpl_cents` tinha DEFAULT 200.
 * Com alvo R$ 2 num mercado de R$ 7–12 a escala nunca sobe e a leitura de saúde
 * fica sempre vermelha. Aqui o valor efetivo é resolvido UMA vez.
 *
 * Também concentra os números operacionais que estavam escondidos como literais
 * em `brain-budget-scale.ts` e `facebook-auto-pause`: intervalo entre execuções,
 * degrau, amostra mínima, múltiplo de desperdício, runway e idade máxima das
 * métricas.
 *
 * Puro: sem I/O, sem Meta. Recebe o `brain_config` cru e devolve números
 * validados com limites seguros.
 */
import {
  type AdsActionKind,
  type AdsAutomationMode,
  normalizeAutomationMode,
} from "./ad-automation-policy.ts";

// ─────────────────────────────── CPL alvo ───────────────────────────────

/** Alvo oficial (R$ 7,50). Ver `docs/CEREBRO-ADS-OFICIAL.md` §5.2. */
export const BRAIN_TARGET_CPL_CENTS = 750;
export const BRAIN_TARGET_CPL_MIN_CENTS = 50;
export const BRAIN_TARGET_CPL_MAX_CENTS = 2000;

/**
 * DEFAULT antigo da coluna `brain_scale_target_cpl_cents` (R$ 2,00).
 * Não é um alvo escolhido por ninguém — é o resto de uma migration. Só o
 * resolver da coluna trata este valor como "não configurado".
 */
export const LEGACY_COLUMN_TARGET_CPL_CENTS = 200;

export type TargetCplSource =
  | "brain_config"
  | "campaign_column"
  | "explicit";

/**
 * CPL-alvo efetivo em centavos.
 *
 * `source: "campaign_column"` trata o legado R$ 2 como ausência de
 * configuração, porque era o DEFAULT da coluna. Nas outras origens R$ 2 é um
 * valor digitado por alguém e continua valendo (dentro dos limites).
 */
export function resolveTargetCplCents(
  raw: unknown,
  source: TargetCplSource = "brain_config",
): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return BRAIN_TARGET_CPL_CENTS;
  if (
    source === "campaign_column" && Math.round(n) === LEGACY_COLUMN_TARGET_CPL_CENTS
  ) {
    return BRAIN_TARGET_CPL_CENTS;
  }
  return Math.max(
    BRAIN_TARGET_CPL_MIN_CENTS,
    Math.min(BRAIN_TARGET_CPL_MAX_CENTS, Math.round(n)),
  );
}

// ──────────────────────── Política de decisão ────────────────────────

export type BrainDecisionPolicy = {
  /** CPL-alvo efetivo (centavos). */
  targetCplCents: number;
  /** Avaliar pode ser frequente; EXECUTAR na mesma campanha não. */
  minHoursBetweenExecutions: number;
  /** Degrau padrão de alteração de budget (%). */
  defaultStepPct: number;
  /** Teto de alteração por execução (%). */
  maxStepPct: number;
  /** Conversas Meta mínimas para a amostra deixar de ser insuficiente. */
  minConversationsSample: number;
  /** Leads atribuídos com confiança mínimos para sinal comercial. */
  minLeadsSample: number;
  /** Gasto ≥ múltiplo × CPL-alvo sem resultado = desperdício. */
  wasteSpendMultiplier: number;
  /** Dias de saldo que precisam sobrar depois do aumento. */
  minRunwayDays: number;
  /** Métrica mais velha que isso bloqueia ação financeira. */
  maxMetricsAgeHours: number;
  /** Campanha mais nova que isso não é julgada por desperdício. */
  minCampaignAgeHours: number;
};

/**
 * Limites iniciais (§ FASE 1 da evolução). Deliberadamente conservadores:
 * 5% padrão / 10% máximo, e não os degraus de 15–30% do motor legado.
 */
export const DEFAULT_BRAIN_DECISION_POLICY: BrainDecisionPolicy = {
  targetCplCents: BRAIN_TARGET_CPL_CENTS,
  minHoursBetweenExecutions: 24,
  defaultStepPct: 5,
  maxStepPct: 10,
  minConversationsSample: 8,
  minLeadsSample: 3,
  wasteSpendMultiplier: 3,
  minRunwayDays: 2,
  maxMetricsAgeHours: 26,
  minCampaignAgeHours: 24,
};

function clampInt(raw: unknown, lo: number, hi: number, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function clampFloat(raw: unknown, lo: number, hi: number, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Lê o bloco `decision_policy` do `brain_config` (opcional) aplicando limites.
 * Sem bloco, devolve os defaults. Nunca lança: config inválida vira default.
 */
export function resolveBrainDecisionPolicy(
  rawBrainConfig: unknown,
): BrainDecisionPolicy {
  const cfg = (rawBrainConfig && typeof rawBrainConfig === "object"
    ? rawBrainConfig
    : {}) as Record<string, unknown>;
  const raw = (cfg.decision_policy && typeof cfg.decision_policy === "object"
    ? cfg.decision_policy
    : {}) as Record<string, unknown>;
  const d = DEFAULT_BRAIN_DECISION_POLICY;

  const maxStepPct = clampInt(raw.max_step_pct, 1, 10, d.maxStepPct);
  return {
    targetCplCents: resolveTargetCplCents(cfg.target_cpl_cents),
    minHoursBetweenExecutions: clampInt(
      raw.min_hours_between_executions,
      1,
      168,
      d.minHoursBetweenExecutions,
    ),
    // Degrau padrão nunca ultrapassa o teto, mesmo se configurado maior.
    defaultStepPct: Math.min(
      maxStepPct,
      clampInt(raw.default_step_pct, 1, 10, d.defaultStepPct),
    ),
    maxStepPct,
    minConversationsSample: clampInt(
      raw.min_conversations_sample,
      1,
      500,
      d.minConversationsSample,
    ),
    minLeadsSample: clampInt(raw.min_leads_sample, 1, 200, d.minLeadsSample),
    wasteSpendMultiplier: clampFloat(
      raw.waste_spend_multiplier,
      1,
      20,
      d.wasteSpendMultiplier,
    ),
    // `min_runway_days` já existe no brain_config; o bloco novo só sobrescreve.
    minRunwayDays: clampInt(
      raw.min_runway_days ?? cfg.min_runway_days,
      1,
      30,
      d.minRunwayDays,
    ),
    maxMetricsAgeHours: clampInt(
      raw.max_metrics_age_hours,
      1,
      168,
      d.maxMetricsAgeHours,
    ),
    minCampaignAgeHours: clampInt(
      raw.min_campaign_age_hours,
      1,
      336,
      d.minCampaignAgeHours,
    ),
  };
}

// ────────────────────────── Modos do Cérebro ──────────────────────────

/**
 * Modo do Cérebro na linguagem de produto. Mapeia 1:1 com o
 * `automation_mode` legado para não invalidar nenhum registro existente.
 */
export type BrainMode = "off" | "recommend" | "assisted" | "automatic";

const MODE_FROM_LEGACY: Record<AdsAutomationMode, BrainMode> = {
  disabled: "off",
  shadow: "recommend",
  limited: "assisted",
  full: "automatic",
};

const MODE_TO_LEGACY: Record<BrainMode, AdsAutomationMode> = {
  off: "disabled",
  recommend: "shadow",
  assisted: "limited",
  automatic: "full",
};

export function brainModeToLegacy(mode: BrainMode): AdsAutomationMode {
  return MODE_TO_LEGACY[mode] ?? "disabled";
}

/**
 * Modo efetivo. Aceita tanto os nomes novos (`brain_mode`) quanto o
 * `automation_mode` legado; o legado continua sendo a coluna persistida.
 */
export function resolveBrainMode(rawBrainConfig: unknown): BrainMode {
  const cfg = (rawBrainConfig && typeof rawBrainConfig === "object"
    ? rawBrainConfig
    : {}) as Record<string, unknown>;
  const direct = cfg.brain_mode;
  if (
    direct === "off" || direct === "recommend" || direct === "assisted" ||
    direct === "automatic"
  ) {
    return direct;
  }
  return MODE_FROM_LEGACY[normalizeAutomationMode(cfg.automation_mode)];
}

// ───────────────── Autorização por TIPO de ação ─────────────────

/** Tipos de ação do Cérebro na linguagem de produto. */
export type BrainActionKind =
  | "pause_waste"
  | "reduce_budget"
  | "increase_budget"
  | "resume_campaign"
  | "recommend_creative_review";

export const BRAIN_ACTION_KINDS: readonly BrainActionKind[] = [
  "pause_waste",
  "reduce_budget",
  "increase_budget",
  "resume_campaign",
  "recommend_creative_review",
];

/** Correspondência com o gate de mutação Meta (`ad-automation-policy.ts`). */
const BRAIN_ACTION_TO_ADS_ACTION: Record<BrainActionKind, AdsActionKind | null> =
  {
    pause_waste: "pause_waste",
    reduce_budget: "budget_decrease",
    increase_budget: "budget_increase",
    resume_campaign: "activate",
    // Revisão de criativo é texto para humano; não escreve na Meta.
    recommend_creative_review: null,
  };

export type BrainActionAuthorization = "off" | "recommend" | "execute";

/**
 * Autorização configurada por ação. Ausente = herda o modo.
 * Nunca PROMOVE: um valor `execute` aqui só vale se o modo também permitir.
 */
function configuredAuthorization(
  rawBrainConfig: unknown,
  action: BrainActionKind,
): BrainActionAuthorization | null {
  const cfg = (rawBrainConfig && typeof rawBrainConfig === "object"
    ? rawBrainConfig
    : {}) as Record<string, unknown>;
  const table =
    (cfg.action_authorizations && typeof cfg.action_authorizations === "object"
      ? cfg.action_authorizations
      : {}) as Record<string, unknown>;
  const value = table[action];
  return value === "off" || value === "recommend" || value === "execute"
    ? value
    : null;
}

/** Autorização máxima que cada modo consegue conceder. */
const MODE_CEILING: Record<BrainMode, BrainActionAuthorization> = {
  off: "off",
  recommend: "recommend",
  // `assisted` calcula e recomenda; quem executa é o humano no painel.
  assisted: "recommend",
  automatic: "execute",
};

const AUTHORIZATION_RANK: Record<BrainActionAuthorization, number> = {
  off: 0,
  recommend: 1,
  execute: 2,
};

export type BrainActionDecision = {
  action: BrainActionKind;
  mode: BrainMode;
  /** Autorização efetiva depois de teto do modo e kill switch. */
  authorization: BrainActionAuthorization;
  /** Pode calcular e registrar recomendação? */
  canRecommend: boolean;
  /** Pode escrever na Meta? */
  canExecute: boolean;
  reason: string;
};

/**
 * Decisão canônica de autorização.
 *
 * Kill switch bloqueia TODA escrita na Meta, mas não impede análise: com ele
 * ligado o Cérebro continua calculando e recomendando.
 */
export function resolveBrainActionAuthorization(
  rawBrainConfig: unknown,
  action: BrainActionKind,
): BrainActionDecision {
  const cfg = (rawBrainConfig && typeof rawBrainConfig === "object"
    ? rawBrainConfig
    : {}) as Record<string, unknown>;
  const mode = resolveBrainMode(cfg);
  const killSwitch = cfg.kill_switch !== false;

  const build = (
    authorization: BrainActionAuthorization,
    reason: string,
  ): BrainActionDecision => ({
    action,
    mode,
    authorization,
    canRecommend: AUTHORIZATION_RANK[authorization] >= 1,
    canExecute: authorization === "execute",
    reason,
  });

  if (mode === "off") return build("off", "brain_mode_off");

  // Recomendar revisão de criativo nunca vira escrita automática.
  if (BRAIN_ACTION_TO_ADS_ACTION[action] === null) {
    const configured = configuredAuthorization(cfg, action);
    if (configured === "off") return build("off", "action_disabled_by_config");
    return build("recommend", "recommendation_only_action");
  }

  const configured = configuredAuthorization(cfg, action);
  if (configured === "off") return build("off", "action_disabled_by_config");

  const ceiling = MODE_CEILING[mode];
  // Sem configuração explícita o default é o mais restritivo entre o teto do
  // modo e "recommend" — automação real exige opt-in por ação.
  const requested: BrainActionAuthorization = configured ?? "recommend";
  const effective = AUTHORIZATION_RANK[requested] <= AUTHORIZATION_RANK[ceiling]
    ? requested
    : ceiling;

  if (effective !== "execute") {
    return build(
      effective,
      configured === "execute" ? `mode_ceiling:${mode}` : `default_recommend:${mode}`,
    );
  }
  if (killSwitch) return build("recommend", "kill_switch_blocks_meta_write");
  if (cfg.autopilot !== true) return build("recommend", "autopilot_off");
  return build("execute", `authorized:${mode}:${action}`);
}

/** Ação correspondente no gate de mutação Meta, quando existir. */
export function adsActionForBrainAction(
  action: BrainActionKind,
): AdsActionKind | null {
  return BRAIN_ACTION_TO_ADS_ACTION[action];
}

// ─────────────────────────── Waste Guard ───────────────────────────

export type WasteGuardMode = "off" | "recommend" | "automatic";

/**
 * Modo do Waste Guard ADAPTATIVO (limiar por CPL-alvo e maturidade).
 * Default `recommend`: o guard adaptativo só sugere.
 *
 * Não confundir com o waste guard de limiar fixo (`campaign-waste-guard.ts`,
 * R$ 10 / R$ 40 / R$ 8 / R$ 12) que já roda em produção como ação protetiva e
 * segue intocado — desligá-lo deixaria campanha queimando verba sem lead.
 */
export function resolveWasteGuardMode(rawBrainConfig: unknown): WasteGuardMode {
  const cfg = (rawBrainConfig && typeof rawBrainConfig === "object"
    ? rawBrainConfig
    : {}) as Record<string, unknown>;
  const value = cfg.waste_guard_mode;
  if (value === "off" || value === "automatic") return value;
  return "recommend";
}
