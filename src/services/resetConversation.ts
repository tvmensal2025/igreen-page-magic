import { supabase } from "@/integrations/supabase/client";

/**
 * Reseta a conversa de um lead para o estado inicial.
 * Usa RPC SECURITY DEFINER para garantir que TUDO seja apagado mesmo se a RLS
 * tentar bloquear (ex.: customer_memory de outro consultor herdado).
 *
 * Limpa:
 * - mensagens (`conversations`)
 * - logs de áudio da Camila (`ai_slot_dispatch_log`)
 * - decisões da IA (`ai_decisions`, `ai_agent_logs`, `bot_step_transitions`)
 * - memória persistente (`customer_memory`)
 * - usage / worker logs
 * - mensagens agendadas, tags, log de mensagens automáticas do CRM
 * - estado do customer (step, OCR, fases, resumo, bot_paused, etc.)
 */
export async function resetLeadConversation(opts: {
  consultantId: string;
  remoteJid?: string | null;
  customerId?: string | null;
}): Promise<{ ok: true; customerId: string | null; deleted?: Record<string, number> } | { ok: false; error: string }> {
  try {
    const { data, error } = await supabase.rpc("reset_lead_conversation", {
      _consultant_id: opts.consultantId,
      _customer_id: opts.customerId ?? null,
      _remote_jid: opts.remoteJid ?? null,
    });

    if (error) return { ok: false, error: error.message };

    const result = (data || {}) as {
      ok?: boolean;
      customer_id?: string | null;
      deleted?: Record<string, number>;
    };
    return {
      ok: true,
      customerId: result.customer_id ?? null,
      deleted: result.deleted,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Falha ao resetar" };
  }
}

/**
 * HARD RESET por telefone (admin/super-admin).
 * Apaga TODOS os rastros do número em todas as tabelas relacionadas
 * (customers, mensagens, fluxo, IA, CRM, logs, eventos).
 *
 * Use somente em manutenção; o botão no dashboard chama essa função.
 */
export async function adminHardResetPhone(
  phone: string,
): Promise<
  | { ok: true; phoneNormalized: string; deleted: Record<string, number>; customerIds: string[] }
  | { ok: false; error: string }
> {
  try {
    const { data, error } = await supabase.rpc("admin_hard_reset_phone" as any, {
      _phone: phone,
    });
    if (error) return { ok: false, error: error.message };
    const r = (data || {}) as {
      phone_normalized?: string;
      deleted?: Record<string, number>;
      customer_ids?: string[];
    };
    return {
      ok: true,
      phoneNormalized: r.phone_normalized ?? "",
      deleted: r.deleted ?? {},
      customerIds: r.customer_ids ?? [],
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Falha no reset" };
  }
}

export async function adminHardResetPhoneTraceCounts(
  phone: string,
): Promise<
  | { ok: true; phoneNormalized: string; counts: Record<string, number>; totalRemaining: number }
  | { ok: false; error: string }
> {
  try {
    const { data, error } = await supabase.rpc("admin_hard_reset_phone_trace_counts" as any, {
      _phone: phone,
    });
    if (error) return { ok: false, error: error.message };
    const r = (data || {}) as {
      phone_normalized?: string;
      counts?: Record<string, number>;
    };
    const counts = r.counts ?? {};
    const totalRemaining = Object.values(counts).reduce(
      (sum, n) => sum + (typeof n === "number" ? n : Number(n) || 0),
      0,
    );
    return {
      ok: true,
      phoneNormalized: r.phone_normalized ?? "",
      counts,
      totalRemaining,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Falha ao verificar rastros" };
  }
}
