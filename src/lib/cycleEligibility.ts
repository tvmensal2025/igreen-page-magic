/**
 * Fonte única de verdade sobre "quem está no ciclo A·B·C".
 *
 * Usada por:
 *   - `ReheatCyclePizza` (pizza A/B/C do admin)
 *   - `useAgendamentosHub` (Central de Agendamentos — "Próximos envios")
 *
 * Antes: cada tela tinha a própria regra e o consultor via 143 agendados
 * enquanto a pizza mostrava só 82 — divergência que sumia com leads congelados
 * (`manual_admin_clear_sla_backlog`, `dnc`, `invalid_phone`, `handoff_humano`).
 */
import { isIgreenWalletOrigin } from "@/lib/customerOrigin";
import { isCrmCadastroEmAnalise, isNuncaMaisContatar } from "@/lib/crmVsLeadAnalysis";

/**
 * Motivos de pausa que tiram o lead do ciclo vivo (não aparecem na pizza
 * e não devem aparecer em "Próximos envios"). O motor de disparo também
 * pula esses estados, então mantê-los na UI só confunde o consultor.
 */
export const FROZEN_PAUSE_REASONS = new Set([
  "manual_admin_clear_sla_backlog",
  "dnc",
  "opt_out",
  "handoff_humano",
  "invalid_phone",
]);

/** Prefixos de motivo (ex.: `dnc:reason`, `not_lead_outside_ddd11`). */
const FROZEN_PAUSE_PREFIXES = ["dnc:", "not_lead_outside_ddd"];

export function isFrozenPauseReason(pausedReason: string | null | undefined): boolean {
  const r = String(pausedReason || "").trim().toLowerCase();
  if (!r) return false;
  if (FROZEN_PAUSE_REASONS.has(r)) return true;
  return FROZEN_PAUSE_PREFIXES.some((p) => r.startsWith(p));
}

/** Steps de conversa que não são "ciclo vivo" (fim de atendimento, avaliação). */
export const DEAD_CONVERSATION_STEPS = new Set([
  "atendimento_finalizado",
  "aguardando_avaliacao_atendimento",
]);

/** Status de customer que já saiu do funil de ciclo. */
export const EXCLUDED_CYCLE_STATUSES = new Set([
  "approved",
  "registered_igreen",
  "cadastro_concluido",
  "rejected",
  "contato_incompleto",
]);

export interface CycleEligibilityInput {
  customer_origin?: string | null;
  status?: string | null;
  conversation_step?: string | null;
  portal_submitted_at?: string | null;
  do_not_contact?: boolean | null;
  paused_reason?: string | null;
  active_cadence?: boolean | null;
}

/**
 * Retorna true se o lead **entra no ciclo A/B/C** (pizza + agendamentos).
 * Se `false`, o lead pode ainda existir em `lead_cadence_state`, mas está
 * congelado / fora do radar operacional.
 */
export function isCycleLeadEligible(c: CycleEligibilityInput): boolean {
  if (isIgreenWalletOrigin(c.customer_origin)) return false;
  const st = String(c.status || "").toLowerCase();
  if (EXCLUDED_CYCLE_STATUSES.has(st)) return false;
  if (isNuncaMaisContatar(c)) return false;
  if (isCrmCadastroEmAnalise(c)) return false;
  const step = String(c.conversation_step || "").trim().toLowerCase();
  if (DEAD_CONVERSATION_STEPS.has(step) && !c.active_cadence) return false;
  if (isFrozenPauseReason(c.paused_reason)) return false;
  return true;
}

/**
 * Detecta se `PAUSED` é do Grupo A (respondeu no chat, motor A esperando)
 * vs. retorno B/C ou bloqueado.
 */
export function isPausedGroupA(pausedReason: string | null | undefined): boolean {
  const r = String(pausedReason || "").trim();
  if (!r || r === "lead_responded") return true;
  if (isFrozenPauseReason(r)) return false;
  const m = /^lead_responded(?::(.+))?$/.exec(r);
  if (!m) return false;
  const prev = (m[1] || "").trim();
  if (!prev || prev === "PAUSED") return true;
  if (prev === "NEW" || prev === "GREETED" || prev === "AI_QUALIFYING") return true;
  if (/^(COLD_|RECALL_|SMS_|CALL_|RETARGET_)/.test(prev) || prev === "CLOSE_LOST") return false;
  return true;
}
