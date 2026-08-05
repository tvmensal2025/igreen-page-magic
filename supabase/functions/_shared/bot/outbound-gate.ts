/**
 * Gate compartilhado para outbound do bot (Evolution + Whapi).
 *
 * AUD-006 (parcial / órfão de propósito): monólitos bot-flow.ts ainda divergem
 * (~6k linhas cada). Este helper existe para novos envios proativos — NÃO está
 * wired nos monólitos (risco alto de regressão em produção). Não tratar como
 * "fix" completo até um PR dedicado plugar Evolution/Whapi bot-flow.
 *
 * E2E_STRICT_OUTBOUND (opt-in via Deno.env):
 *   Quando "1"/"true", só libera telefone sandbox (5500000…) ou números da
 *   E2E_OUTBOUND_ALLOWLIST (CSV). Produção normal: variável ausente = sem efeito.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isBotGloballyEnabled } from "./global-flag.ts";
import { assertCanContact } from "../contact-suppression.ts";
import { isTestPhone } from "../test-mode.ts";
import { isOutsideSendWindowBRT } from "../quiet-hours.ts";


const DEFAULT_E2E_ALLOWLIST = [
  "5511989000650",
  "5511973125846",
];

function normalizePhoneDigits(phone: string | null | undefined): string {
  return String(phone ?? "").replace(/\D/g, "");
}

/** Digits-only allowlist from env (CSV) or built-in E2E phones. */
export function getE2eOutboundAllowlist(): string[] {
  const raw = Deno.env.get("E2E_OUTBOUND_ALLOWLIST")?.trim();
  if (!raw) return [...DEFAULT_E2E_ALLOWLIST];
  return raw
    .split(",")
    .map((p) => normalizePhoneDigits(p))
    .filter((p) => p.length >= 10);
}

export function isE2eStrictOutboundEnabled(): boolean {
  const v = (Deno.env.get("E2E_STRICT_OUTBOUND") ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/**
 * Aceita:
 * - range sandbox 5500000…
 * - allowlist (com ou sem 55; também aceita 11 dígitos BR se allowlist tem 13)
 */
export function isPhoneAllowedForE2eStrict(phone: string | null | undefined): boolean {
  const digits = normalizePhoneDigits(phone);
  if (!digits) return false;
  if (isTestPhone(digits)) return true;

  const list = getE2eOutboundAllowlist();
  if (list.includes(digits)) return true;

  // 11989000650 ↔ 5511989000650
  if (digits.length === 11 && digits.startsWith("11")) {
    if (list.includes(`55${digits}`)) return true;
  }
  if (digits.length === 13 && digits.startsWith("55")) {
    if (list.includes(digits.slice(2))) return true;
  }
  return false;
}

/**
 * `true` enquanto o webhook está processando um turno deste lead
 * (`bot_processing_until` no futuro) ou há rajada inbound na fila.
 *
 * Auditoria 2026-08: sem isto a cadência disparava por cima da resposta que o
 * lead acabou de pedir — duas mensagens diferentes no mesmo instante. O lock
 * tem TTL curto, então o pior caso é adiar o toque para o próximo tick.
 * Nunca lança: erro de leitura libera o envio (comportamento anterior).
 */
export async function isInboundTurnInProgress(
  supabase: SupabaseClient,
  customerId: string,
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("customers")
      .select("bot_processing_until, pending_inbound_message_id")
      .eq("id", customerId)
      .maybeSingle();
    if (error || !data) return false;
    const row = data as { bot_processing_until?: string | null; pending_inbound_message_id?: string | null };
    if (String(row.pending_inbound_message_id || "").trim()) return true;
    if (row.bot_processing_until) {
      return new Date(row.bot_processing_until).getTime() > Date.now();
    }
    return false;
  } catch {
    return false;
  }
}

export async function assertBotOutboundAllowed(
  supabase: SupabaseClient,
  input: {
    customerId?: string | null;
    phone?: string | null;
    consultantId?: string | null;
    /** Transacional (OTP/cadastro em andamento) — ignora a janela 08–20. */
    allowOutsideWindow?: boolean;
    /**
     * Envio proativo (cadência/cron): não fala por cima de um turno inbound
     * em andamento. Opt-in — envio manual do consultor NUNCA usa isto.
     */
    respectInboundTurn?: boolean;
  },
): Promise<{ allowed: boolean; reason: string | null }> {
  // REGRA DURA: nenhum envio automático fora de 08:00–20:00 BRT.
  if (!input.allowOutsideWindow && isOutsideSendWindowBRT()) {
    return { allowed: false, reason: "outside_send_window_brt" };
  }

  const globalOn = await isBotGloballyEnabled(supabase);
  if (!globalOn) {
    return { allowed: false, reason: "bot_globally_disabled" };
  }

  const suppression = await assertCanContact(supabase, {
    customerId: input.customerId,
    phone: input.phone,
    consultantId: input.consultantId,
    channel: "whatsapp",
  });
  if (!suppression.allowed) {
    return { allowed: false, reason: suppression.reason };
  }

  if (input.respectInboundTurn && input.customerId) {
    const busy = await isInboundTurnInProgress(supabase, input.customerId);
    if (busy) return { allowed: false, reason: "inbound_turn_in_progress" };
  }

  if (isE2eStrictOutboundEnabled()) {
    let phone = input.phone ?? null;
    let isSandbox = false;
    if (input.customerId) {
      const { data } = await supabase
        .from("customers")
        .select("phone_whatsapp, is_sandbox")
        .eq("id", input.customerId)
        .maybeSingle();
      phone = phone || (data as { phone_whatsapp?: string | null } | null)?.phone_whatsapp || null;
      isSandbox = !!(data as { is_sandbox?: boolean | null } | null)?.is_sandbox;
    }
    // Sandbox flag sozinho NÃO libera live Whapi em modo strict — precisa allowlist
    // ou range 5500000 (mock). Leads de teste live: is_sandbox=true + fone allowlist.
    if (!isPhoneAllowedForE2eStrict(phone)) {
      return {
        allowed: false,
        reason: isSandbox
          ? "e2e_strict_phone_not_in_allowlist"
          : "e2e_strict_outbound_blocked",
      };
    }
  }

  return { allowed: true, reason: null };
}
