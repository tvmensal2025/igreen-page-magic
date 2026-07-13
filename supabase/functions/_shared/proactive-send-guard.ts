// Trava de envio proativo (bulk / reativação / cron) quando o telefone
// cadastrado do consultor não bate com o connected_phone da instância
// WhatsApp. Evita disparar mensagens do número errado e ser banido.
//
// Usado por:
//   - bulk-scheduler
//   - reactivation-send
//   - outbound-media-flush-cron
//
// NÃO usar em evolution-webhook (respostas a clientes ativos).

// Tipo estrutural relaxado (padrão do automation-gate): chamadores criam o
// client com versões diferentes do supabase-js (esm.sh 2.x / npm 2.49) e a
// tipagem nominal do SupabaseClient conflita entre elas em deno check.
// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

export type ProactiveSendGuardResult =
  | { allowed: true; reason: "verified" | "match" }
  | { allowed: false; reason: "phone_missing" | "phone_mismatch" | "not_verified" | "lookup_failed"; detail?: string };

function digits(v: string | null | undefined): string {
  return (v || "").replace(/\D/g, "");
}

function tail11(v: string | null | undefined): string {
  return digits(v).slice(-11);
}

/**
 * Verifica se o consultor pode enviar mensagens proativas.
 * Regra: phone do consultor confere com connected_phone da instância,
 * OU phone_verified_at é recente (≤ 7 dias).
 */
export async function canSendProactive(
  supabase: SupabaseClient,
  opts: { consultantId: string; instanceName?: string | null; verifyTtlDays?: number },
): Promise<ProactiveSendGuardResult> {
  const ttlDays = opts.verifyTtlDays ?? 7;

  let consultant: { phone: string | null; phone_verified_at: string | null } | null = null;
  try {
    const { data, error } = await supabase
      .from("consultants")
      .select("phone, phone_verified_at")
      .eq("id", opts.consultantId)
      .maybeSingle();
    if (error) return { allowed: false, reason: "lookup_failed", detail: error.message };
    consultant = data;
  } catch (e) {
    return { allowed: false, reason: "lookup_failed", detail: (e as Error).message };
  }

  if (!consultant || !consultant.phone || !digits(consultant.phone)) {
    return { allowed: false, reason: "phone_missing" };
  }

  // Verificado recentemente?
  if (consultant.phone_verified_at) {
    const ageMs = Date.now() - new Date(consultant.phone_verified_at).getTime();
    if (ageMs < ttlDays * 24 * 3600 * 1000) {
      return { allowed: true, reason: "verified" };
    }
  }

  // Compara com connected_phone
  try {
    let query = supabase
      .from("whatsapp_instances")
      .select("instance_name, connected_phone, updated_at")
      .eq("consultant_id", opts.consultantId)
      .not("connected_phone", "is", null)
      .order("updated_at", { ascending: false })
      .limit(5);
    if (opts.instanceName) query = query.eq("instance_name", opts.instanceName);
    const { data: instances, error } = await query;
    if (error) return { allowed: false, reason: "lookup_failed", detail: error.message };
    if (!instances || instances.length === 0) {
      return { allowed: false, reason: "not_verified", detail: "Nenhuma instância conectada" };
    }
    const consultantTail = tail11(consultant.phone);
    const rows = instances as Array<{ instance_name: string; connected_phone: string | null }>;
    const matchInstance = rows.find((i) => tail11(i.connected_phone) === consultantTail);
    if (matchInstance) {
      // Atualiza marca de verificado para próximas chamadas
      void supabase.from("consultants").update({ phone_verified_at: new Date().toISOString() }).eq("id", opts.consultantId);
      return { allowed: true, reason: "match" };
    }
    return {
      allowed: false,
      reason: "phone_mismatch",
      detail: `phone=${consultantTail} vs connected=${rows.map((i) => tail11(i.connected_phone)).join(",")}`,
    };
  } catch (e) {
    return { allowed: false, reason: "lookup_failed", detail: (e as Error).message };
  }
}

/** Grava o bloqueio em outbound_blocked_log. Falhas são silenciosas. */
export async function logProactiveBlock(
  supabase: SupabaseClient,
  opts: { consultantId: string; instanceName?: string | null; reason: string; context?: Record<string, unknown> },
): Promise<void> {
  try {
    await supabase.from("outbound_blocked_log").insert({
      consultant_id: opts.consultantId,
      instance_name: opts.instanceName ?? null,
      reason: opts.reason,
      context: opts.context ?? {},
    });
  } catch (e) {
    console.warn("[proactive-send-guard] log insert failed:", (e as Error).message);
  }
}
