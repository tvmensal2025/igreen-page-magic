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

/**
 * Extrai o maior valor monetário plausível do texto (R$ 1.234,56 / 600 / 600,00).
 *
 * Descarta o que claramente NÃO é conta de luz: CPF, CEP, telefone, datas e
 * sequências coladas em `-` / `/` (ex.: "CEP 38400-100" virava R$ 38.400).
 */
export function parseBillValueFromText(text: string | null | undefined): number | null {
  const t = String(text || "");
  if (!t.trim()) return null;
  let best: number | null = null;
  const re = /(r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    const hasCurrency = !!m[1];
    let raw = m[2];
    const hasThousandSep = /\.\d{3}/.test(raw);
    const digitCount = raw.replace(/\D/g, "").length;
    const start = m.index + (m[1]?.length || 0);
    const end = start + raw.length;
    const before = t.slice(Math.max(0, start - 1), start);
    const after = t.slice(end, end + 1);
    // Colado em separador de CEP/data/CPF/telefone → não é valor de conta.
    if (!hasCurrency && (/[-/\d]/.test(before) || /[-/\d]/.test(after))) continue;
    // CPF/CEP/telefone digitados corridos (6+ dígitos sem R$ nem milhar).
    if (!hasCurrency && !hasThousandSep && digitCount >= 6) continue;
    if (hasThousandSep) raw = raw.replace(/\./g, "");
    raw = raw.replace(",", ".");
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) continue;
    // Teto de plausibilidade: conta de luz acima disso é erro de digitação.
    if (n > (hasCurrency || hasThousandSep ? 500_000 : 50_000)) continue;
    if (best === null || n > best) best = n;
  }
  return best;
}


export type LowBillCutoffDecision =
  | { reject: false }
  | { reject: true; value: number; reply: string; updates: Record<string, unknown> };

/**
 * Corte de entrada da esteira, aplicado no passo que PERGUNTA o valor da conta.
 *
 * Os passos legados (`qualificacao`, `pos_video`) já barravam conta abaixo do
 * mínimo, mas consultor com fluxo do construtor nunca cai neles — existe lock
 * explícito remapeando os legados. Resultado (E2E 2026-08, cenário
 * `valor_baixo`): lead de R$ 60 ouvia "economia de R$ 4 a R$ 12" e seguia até
 * documento e cadastro.
 *
 * Só decide quando o passo atual é o que pede o valor: número citado de
 * passagem noutro passo ("pago uns 50 de água") não pode desqualificar.
 * A pausa usa `low_bill_value` de propósito — é a chave que
 * `evaluateLowBillReentry` reconhece para trazer o lead de volta se a conta
 * subir, então a recusa continua reversível.
 */
export function evaluateLowBillCutoff(
  stepCapturesBillValue: boolean,
  billValue: number | null | undefined,
): LowBillCutoffDecision {
  if (!stepCapturesBillValue) return { reject: false };
  const value = Number(billValue);
  if (!Number.isFinite(value) || value <= 0 || value >= LOW_BILL_MIN_VALUE) {
    return { reject: false };
  }
  return {
    reject: true,
    value,
    reply: `Obrigada por me falar. Com conta em torno de R$ ${value.toFixed(0)}, ` +
      `normalmente a economia fica pequena e pode não compensar agora. Vou deixar ` +
      `registrado e, se seu consumo subir, a gente retoma 💚`,
    updates: {
      electricity_bill_value: value,
      status: "rejected",
      bot_paused: true,
      bot_paused_reason: "low_bill_value",
      conversation_step: "valor_baixo",
    },
  };
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
