// Single source of truth: "humano assumiu o controle" OU "IA globalmente desligada"
// → NENHUM motor automático envia mensagem.
//
// Bloqueios verificados:
//   - do_not_contact === true  (opt-out / reclamação — nunca religar automático)
//   - bot_paused === true  (consultor clicou "Assumir")
//   - assigned_human_id IS NOT NULL  (humano vinculado)
//   - bot_paused_until > now()  (pausa programada ainda no futuro)
//   - ai_agent_config.enabled === false para o consultor (switch global desligado)

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

export interface PausableCustomer {
  bot_paused?: boolean | null;
  bot_paused_reason?: string | null;
  assigned_human_id?: string | null;
  bot_paused_until?: string | null;
  do_not_contact?: boolean | null;
}

export function isCustomerPausedByHuman(c: PausableCustomer | null | undefined): boolean {
  if (!c) return false;
  // Opt-out / reclamação: nunca responder automático (mesmo se bot_paused foi zerado por engano).
  if (c.do_not_contact === true) return true;
  // Humano vinculado SEMPRE silencia.
  if (c.assigned_human_id) return true;
  // Modo Captação assistido NÃO silencia o bot — OCR/capture handlers precisam rodar.
  const reason = String(c.bot_paused_reason || "").toLowerCase();
  if (c.bot_paused === true && reason !== "manual_capture") return true;
  if (c.bot_paused_until) {
    try {
      if (new Date(c.bot_paused_until).getTime() > Date.now()) return true;
    } catch { /* ignore */ }
  }
  return false;
}

/**
 * Verifica diretamente no DB se o customer está pausado por humano.
 * Usar em loops/scheduled jobs onde só se tem phone+consultant_id.
 */
export async function isPausedByPhone(
  supabase: SupabaseClient,
  phone: string,
  consultantId?: string | null,
): Promise<boolean> {
  if (!phone) return false;
  const digits = String(phone).replace(/\D/g, "");
  if (!digits) return false;
  let q = supabase
    .from("customers")
    .select("bot_paused, bot_paused_reason, assigned_human_id, bot_paused_until, do_not_contact")
    .eq("phone_whatsapp", digits)
    .limit(1);
  if (consultantId) q = q.eq("consultant_id", consultantId);
  const { data } = await q.maybeSingle();
  return isCustomerPausedByHuman(data as PausableCustomer | null);
}

// Cache leve em memória do estado global do consultor (5s) — evita uma query
// extra em cada inbound. O switch desligar/religar reflete em até 5s.
const _aiEnabledCache = new Map<string, { v: boolean; t: number }>();
const AI_ENABLED_TTL_MS = 5_000;

/**
 * Retorna true quando a IA do consultor está GLOBALMENTE desligada.
 * Lê `ai_agent_config.enabled` do consultor (sem fallback global — desligar é
 * decisão explícita do dono dos leads).
 */
export async function isConsultantAIDisabled(
  supabase: SupabaseClient,
  consultantId: string | null | undefined,
): Promise<boolean> {
  if (!consultantId) return false;
  const cached = _aiEnabledCache.get(consultantId);
  if (cached && Date.now() - cached.t < AI_ENABLED_TTL_MS) {
    return cached.v === false;
  }
  const { data } = await supabase
    .from("ai_agent_config")
    .select("enabled")
    .eq("consultant_id", consultantId)
    .maybeSingle();
  // Se o consultor nunca configurou, considera ATIVO (default histórico).
  const enabled = data ? !!(data as any).enabled : true;
  _aiEnabledCache.set(consultantId, { v: enabled, t: Date.now() });
  return enabled === false;
}

/**
 * Bloqueio total: humano assumiu OU IA globalmente desligada.
 */
export async function isAutomationBlocked(
  supabase: SupabaseClient,
  customer: PausableCustomer | null | undefined,
  consultantId: string | null | undefined,
): Promise<{ blocked: boolean; reason: string | null }> {
  if (isCustomerPausedByHuman(customer)) {
    return { blocked: true, reason: "human_takeover" };
  }
  if (await isConsultantAIDisabled(supabase, consultantId)) {
    return { blocked: true, reason: "global_ai_disabled" };
  }
  return { blocked: false, reason: null };
}
