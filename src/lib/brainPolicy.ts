/**
 * Espelho UI de `supabase/functions/_shared/brain-policy.ts`.
 *
 * Mantém o CPL-alvo e os limites de degrau iguais nas duas pontas. A UI mostrava
 * R$ 2,00 como alvo sugerido enquanto o backend já usava R$ 7,50 — quem salvava
 * a tela sem pensar rebaixava o alvo e travava a escala no piso da Meta.
 *
 * Ao mudar qualquer número aqui, mude também no arquivo do backend.
 */

export const BRAIN_TARGET_CPL_CENTS = 750;
export const BRAIN_TARGET_CPL_MIN_CENTS = 50;
export const BRAIN_TARGET_CPL_MAX_CENTS = 2000;

/** DEFAULT antigo da coluna `brain_scale_target_cpl_cents` (R$ 2,00). */
export const LEGACY_COLUMN_TARGET_CPL_CENTS = 200;

export type TargetCplSource = "brain_config" | "campaign_column" | "explicit";

export function resolveTargetCplCents(
  raw: unknown,
  source: TargetCplSource = "brain_config",
): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return BRAIN_TARGET_CPL_CENTS;
  if (
    source === "campaign_column" &&
    Math.round(n) === LEGACY_COLUMN_TARGET_CPL_CENTS
  ) {
    return BRAIN_TARGET_CPL_CENTS;
  }
  return Math.max(
    BRAIN_TARGET_CPL_MIN_CENTS,
    Math.min(BRAIN_TARGET_CPL_MAX_CENTS, Math.round(n)),
  );
}

/** Degrau padrão e teto de alteração de budget por execução (%). */
export const BRAIN_DEFAULT_STEP_PCT = 5;
export const BRAIN_MAX_STEP_PCT = 10;

/** Opções de degrau oferecidas na UI, dentro do teto da política. */
export const BRAIN_STEP_OPTIONS = [3, 5, 8, 10] as const;

export function clampBrainStepPct(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return BRAIN_DEFAULT_STEP_PCT;
  return Math.max(1, Math.min(BRAIN_MAX_STEP_PCT, Math.round(n)));
}

/** Intervalo mínimo entre EXECUÇÕES na mesma campanha (horas). */
export const BRAIN_MIN_HOURS_BETWEEN_EXECUTIONS = 24;
