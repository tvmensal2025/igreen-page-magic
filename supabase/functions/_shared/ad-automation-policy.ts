/**
 * Policy central de autonomia do Cérebro Meta Ads.
 *
 * Fonte única de verdade para "esta ação automática pode rodar?". Os mutadores
 * (auto-pause, balance-check, sync-metrics, rotator, rank, healthcheck,
 * realign) consultam aqui em vez de reimplementar o gate.
 *
 * Puro: recebe uma forma mínima já normalizada e devolve uma decisão. Não
 * importa `brain-config` (evita ciclo) nem faz I/O.
 *
 * ─── Assimetria fundamental ────────────────────────────────────────────────
 * Fail-closed protege quando a ação AUMENTA gasto/alcance. Quando a ação
 * REDUZ gasto (pausar por saldo, teto ou queima sem conversa), desligar é o
 * comportamento perigoso: a Meta continua gastando, a carteira fura para
 * dívida e o teto deixa de ser aplicado.
 *
 * Por isso:
 *  - Ações PROTETIVAS rodam sempre. Não dependem de `automation_mode`,
 *    `autopilot` nem `kill_switch` — são o braço de execução da cobrança, que
 *    por decisão de produto não depende do modo do Cérebro.
 *  - Ações EXPANSIVAS ficam no gate (default inerte: disabled + kill switch).
 *  - Ações HUMAN-ONLY nunca são automáticas neste hardening.
 */

export type AdsAutomationMode = "disabled" | "shadow" | "limited" | "full";

/** Forma mínima que qualquer config normalizada precisa expor. */
export interface AdsPolicyInput {
  autopilot: boolean;
  automation_mode: AdsAutomationMode;
  kill_switch: boolean;
}

export type AdsActionKind =
  // ── Protetivas: só reduzem gasto. Sempre permitidas. ──
  /** Pausar campanha/anúncio que queima sem conversa (waste guard). */
  | "pause_waste"
  /** Pausar por saldo insuficiente, dívida ou teto de gasto atingido. */
  | "pause_balance"
  /** Pausar por prazo contratado encerrado. */
  | "pause_schedule"
  // ── Expansivas: aumentam gasto/alcance. Exigem modo explícito. ──
  /** Reativar objeto pausado (volta a gastar). */
  | "activate"
  /** Subir/descer budget dentro dos limites configurados. */
  | "budget_scale"
  /** Trocar/rotacionar criativo. */
  | "creative_rotate"
  // ── Human-only: nunca automáticas. ──
  /** Reescrever segmentação/idade "por garantia" (reinicia aprendizado). */
  | "targeting_patch"
  /** Criar campanha/adset/ad novo. */
  | "create_object"
  /** Subir telefone/email para Custom Audience. */
  | "audience_sync";

export interface AdsPolicyDecision {
  allowed: boolean;
  mode: AdsAutomationMode;
  reason: string;
}

/**
 * Reduzem gasto — desligar seria o risco. Rodam independente de modo/kill.
 * Mantidas explícitas para o leitor e para os testes de regressão.
 */
const PROTECTIVE_ACTIONS: ReadonlySet<AdsActionKind> = new Set([
  "pause_waste",
  "pause_balance",
  "pause_schedule",
]);

/** Nunca automáticas neste hardening, em qualquer modo. */
const HUMAN_ONLY_ACTIONS: ReadonlySet<AdsActionKind> = new Set([
  "targeting_patch",
  "create_object",
  "audience_sync",
]);

/** Expansivas liberadas em `limited`. */
const LIMITED_ACTIONS: ReadonlySet<AdsActionKind> = new Set([
  "activate",
  "budget_scale",
]);

/** `full` adiciona rotação de criativo às de `limited`. */
const FULL_ACTIONS: ReadonlySet<AdsActionKind> = new Set([
  ...LIMITED_ACTIONS,
  "creative_rotate",
]);

export function normalizeAutomationMode(raw: unknown): AdsAutomationMode {
  return raw === "shadow" || raw === "limited" || raw === "full"
    ? raw
    : "disabled";
}

/** A ação apenas reduz gasto? */
export function isProtectiveAdsAction(action: AdsActionKind): boolean {
  return PROTECTIVE_ACTIONS.has(action);
}

/**
 * Decisão canônica para uma ação específica.
 * Protetiva → sempre permitida. Expansiva → fail-closed.
 */
export function decideAdsAction(
  input: AdsPolicyInput,
  action: AdsActionKind,
): AdsPolicyDecision {
  const mode = normalizeAutomationMode(input.automation_mode);
  const base = { mode };

  // Proteção nunca é desligada: pausar gasto não é ampliar autonomia.
  if (PROTECTIVE_ACTIONS.has(action)) {
    return { ...base, allowed: true, reason: `protective_always_on:${action}` };
  }
  if (HUMAN_ONLY_ACTIONS.has(action)) {
    return { ...base, allowed: false, reason: `human_only:${action}` };
  }
  if (input.kill_switch) {
    return { ...base, allowed: false, reason: "kill_switch_on" };
  }
  if (input.autopilot !== true) {
    return { ...base, allowed: false, reason: "autopilot_off" };
  }
  if (mode === "disabled") {
    return { ...base, allowed: false, reason: "mode_disabled" };
  }
  if (mode === "shadow") {
    return { ...base, allowed: false, reason: "mode_shadow_observe_only" };
  }

  const allowedSet = mode === "full" ? FULL_ACTIONS : LIMITED_ACTIONS;
  if (allowedSet.has(action)) {
    return { ...base, allowed: true, reason: `allowed:${mode}` };
  }
  return { ...base, allowed: false, reason: `not_in_mode:${mode}:${action}` };
}

/** Açúcar para call sites que só querem o booleano. */
export function isAdsActionAllowed(
  input: AdsPolicyInput,
  action: AdsActionKind,
): boolean {
  return decideAdsAction(input, action).allowed;
}

/**
 * Existe alguma mutação EXPANSIVA permitida? Usado por call sites que decidem
 * se vale a pena entrar num bloco de escala/rotação. Não cobre protetivas.
 */
export function anyExpansiveAdsMutationAllowed(input: AdsPolicyInput): boolean {
  if (input.kill_switch || input.autopilot !== true) return false;
  const mode = normalizeAutomationMode(input.automation_mode);
  return mode === "limited" || mode === "full";
}
