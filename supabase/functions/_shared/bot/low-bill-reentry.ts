/**
 * Reentrada de lead pausado por "conta baixa" (`low_bill_value`).
 *
 * Regra de produto: o foco é sempre transformar lead em cliente. Um lead que
 * ficou fora por conta baixa e volta dizendo "agora minha conta subiu para 600"
 * ou "quero cadastrar" precisa ser reconduzido ao Grupo A — hoje ele ficava
 * mudo para sempre porque `bot_paused=true`.
 *
 * Conservador de propósito:
 *   - só reage à pausa automática `low_bill_value`;
 *   - nunca despausa handoff humano (`assigned_human_id`) nem bloqueado (DNC);
 *   - exige sinal explícito: valor ≥ mínimo OU intenção clara de cadastro.
 */

/** Valor mínimo de conta aceito pela esteira. */
export const LOW_BILL_MIN_VALUE = 100;

const INTENT_RE =
  /(conta\s+(aument|subi|mud|nova)|aument(ou|ei)|subiu|mudei\s+de\s+casa|agora\s+(minha\s+)?conta|quero\s+(cadastr|ativar|tentar|participar)|posso\s+cadastr|d[áa]\s+para\s+(fazer|cadastr)|voltei|vamos\s+cadastr)/i;

/** Extrai o maior valor monetário plausível do texto (R$ 1.234,56 / 600 / 600,00). */
export function parseBillValueFromText(text: string | null | undefined): number | null {
  const t = String(text || "");
  if (!t.trim()) return null;
  let best: number | null = null;
  const re = /(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    let raw = m[1];
    if (/\.\d{3}/.test(raw)) raw = raw.replace(/\./g, "");
    raw = raw.replace(",", ".");
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0 || n > 500_000) continue;
    if (best === null || n > best) best = n;
  }
  return best;
}

export type LowBillReentrySignals = {
  bot_paused_reason?: string | null;
  assigned_human_id?: string | null;
  do_not_contact?: boolean | null;
};

export type LowBillReentryDecision = {
  reactivate: boolean;
  /** Novo valor detectado, quando o lead informou. */
  billValue: number | null;
  reason: "new_bill_value" | "cadastro_intent" | null;
};

export function evaluateLowBillReentry(
  customer: LowBillReentrySignals | null | undefined,
  messageText: string | null | undefined,
): LowBillReentryDecision {
  const none: LowBillReentryDecision = { reactivate: false, billValue: null, reason: null };
  if (!customer) return none;
  if (customer.do_not_contact === true) return none;
  if (customer.assigned_human_id) return none;
  const reason = String(customer.bot_paused_reason || "").trim().toLowerCase();
  if (reason !== "low_bill_value") return none;

  const text = String(messageText || "").trim();
  if (!text) return none;

  const value = parseBillValueFromText(text);
  if (value != null && value >= LOW_BILL_MIN_VALUE) {
    return { reactivate: true, billValue: value, reason: "new_bill_value" };
  }
  if (INTENT_RE.test(text)) {
    return { reactivate: true, billValue: null, reason: "cadastro_intent" };
  }
  return none;
}
