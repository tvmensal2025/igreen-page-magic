// Single source of truth: "humano assumiu o controle" OU "IA globalmente desligada"
// → NENHUM motor automático envia mensagem.
//
// Bloqueios verificados:
//   - do_not_contact === true  (opt-out / reclamação — nunca religar automático)
//   - bot_paused === true  (consultor clicou "Assumir")
//   - assigned_human_id IS NOT NULL  (humano vinculado)
//   - bot_paused_until > now()  (pausa programada ainda no futuro)
//   - ai_agent_config.enabled === false para o consultor (switch global desligado)

// deno-lint-ignore no-explicit-any
type SB = any;

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
  supabase: SB,
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
  supabase: SB,
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
  supabase: SB,
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

type OutboundSender = {
  sendText: (jid: string, text: string) => Promise<unknown>;
  sendButtons?: (jid: string, message: string, buttons: unknown[]) => Promise<unknown>;
  sendMedia?: (jid: string, mediaUrl: string, caption: string, mediatype: string) => Promise<unknown>;
  sendPresence?: (...args: unknown[]) => Promise<unknown>;
  downloadMedia?: (...args: unknown[]) => Promise<unknown>;
  [key: string]: unknown;
};

/**
 * Re-lê o DB antes de CADA outbound. Corta corrida: consultor mandou msg no
 * meio do bot-flow → pause grava → reply atrasado do bot NÃO sai.
 */
export function wrapSenderWithLivePauseGuard<T extends OutboundSender>(
  base: T,
  opts: {
    // Tipagem frouxa: clientes supabase do webhook vs esm.sh divergem.
    // deno-lint-ignore no-explicit-any
    supabase: any;
    phone?: string;
    getPhone?: () => string | null | undefined;
    consultantId?: string | null;
    getCustomerId?: () => string | null | undefined;
  },
): T {
  const allowSpeak = async (): Promise<boolean> => {
    const customerId = opts.getCustomerId?.() || null;
    if (customerId) {
      const { data } = await opts.supabase
        .from("customers")
        .select("bot_paused, bot_paused_reason, assigned_human_id, bot_paused_until, do_not_contact")
        .eq("id", customerId)
        .maybeSingle();
      if (isCustomerPausedByHuman(data as PausableCustomer | null)) {
        console.log(`🔇 [pause-guard] abort outbound customer=${customerId} — humano assumiu`);
        return false;
      }
      return true;
    }
    const phone = String(opts.getPhone?.() || opts.phone || "").replace(/\D/g, "");
    if (phone && await isPausedByPhone(opts.supabase, phone, opts.consultantId)) {
      console.log(`🔇 [pause-guard] abort outbound phone=${phone} — humano assumiu`);
      return false;
    }
    return true;
  };

  return {
    ...base,
    sendText: async (jid: string, text: string) => {
      if (!(await allowSpeak())) return false;
      return base.sendText(jid, text);
    },
    sendButtons: base.sendButtons
      ? async (jid: string, message: string, buttons: unknown[]) => {
          if (!(await allowSpeak())) return false;
          return base.sendButtons!(jid, message, buttons);
        }
      : undefined,
    sendMedia: base.sendMedia
      ? async (jid: string, mediaUrl: string, caption: string, mediatype: string) => {
          if (!(await allowSpeak())) return false;
          return base.sendMedia!(jid, mediaUrl, caption, mediatype);
        }
      : undefined,
  } as T;
}
