/**
 * Normaliza valor médio da conta informado pelo lead (texto livre no WhatsApp).
 *
 * Aceita erros comuns: R$, reais, “uns/cerca de/mais ou menos”, faixas 400-500,
 * 500.0 / 500,0 / 1.500,00, espaços, ~, +-, /mês, O→0, l→1, etc.
 *
 * Pede correção: vazio, 350,0000 (casas demais), ambíguo demais, fora da faixa.
 */

export type BillValueParseResult =
  | { ok: true; value: number; formatted: string; raw: string; note?: string }
  | {
      ok: false;
      reason:
        | "empty"
        | "not_a_number"
        | "too_many_decimals"
        | "out_of_range"
        | "ambiguous";
      message: string;
      raw: string;
    };

export const BILL_VALUE_MIN = 80;
export const BILL_VALUE_MAX = 20000;

const CORRECT_MSG =
  "Não consegui confirmar esse valor da conta. Pode digitar de novo só com o número? Exemplo: 350 ou 350,00";

/** Limpa prefixos/sufixos que as pessoas digitam no WhatsApp. */
function scrubBillText(raw: string): string {
  let s = String(raw ?? "").trim();

  // OCR / teclado: O→0, l/I→1 entre dígitos
  s = s.replace(/(?<=\d)[oO](?=\d)/g, "0");
  s = s.replace(/(?<=\d)[lI](?=\d)/g, "1");
  s = s.replace(/^[oO](?=\d)/, "0");

  s = s
    .replace(/r\$\s*/gi, "")
    .replace(/\b(rs|brl)\b/gi, "")
    .replace(/\breais?\b/gi, "")
    .replace(/\b(por\s*)?(m[eê]s|mensal|media|média)\b/gi, "")
    .replace(
      /\b(uns|umas|cerca\s*de|mais\s*ou\s*menos|aproximadamente|aprox\.?|quase|em\s*torno\s*de|por\s*volta\s*de|tipo|tipo\s*uns)\b/gi,
      "",
    )
    .replace(/[~≈]+/g, "")
    .replace(/\+/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // "500/mes"
  s = s.replace(/\/\s*m[eê]s\b/gi, "").trim();

  return s;
}

/** Extrai candidatos numéricos de uma string já scrubada. */
function extractNumberCandidates(s: string): string[] {
  const matches = s.match(/\d{1,3}(?:[.\s]\d{3})+(?:[.,]\d{1,4})?|\d+(?:[.,]\d{1,4})?/g);
  return matches?.length ? matches : [];
}

function normalizeNumericToken(token: string): BillValueParseResult {
  let s = token.replace(/\s+/g, "").trim();
  if (!s) return { ok: false, reason: "empty", message: CORRECT_MSG, raw: token };

  s = s.replace(/[.,]+$/, "");
  if (/^[.,]/.test(s)) s = s.replace(/^[.,]+/, "");
  s = s.replace(/,{2,}/g, ",").replace(/\.{2,}/g, ".");

  if (!/^[\d.,]+$/.test(s)) {
    return { ok: false, reason: "not_a_number", message: CORRECT_MSG, raw: token };
  }

  const hasComma = s.includes(",");
  const hasDot = s.includes(".");

  if (hasComma && hasDot) {
    const lastComma = s.lastIndexOf(",");
    const lastDot = s.lastIndexOf(".");
    if (lastComma > lastDot) {
      const decimals = s.slice(lastComma + 1);
      if (decimals.length > 2) {
        return { ok: false, reason: "too_many_decimals", message: CORRECT_MSG, raw: token };
      }
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      const decimals = s.slice(lastDot + 1);
      if (decimals.length > 2) {
        return { ok: false, reason: "too_many_decimals", message: CORRECT_MSG, raw: token };
      }
      s = s.replace(/,/g, "");
    }
  } else if (hasComma) {
    const parts = s.split(",");
    if (parts.length > 2) {
      return { ok: false, reason: "ambiguous", message: CORRECT_MSG, raw: token };
    }
    const decimals = parts[1] ?? "";
    if (decimals.length > 2) {
      if (decimals.length === 3 && parts[0].length <= 2) {
        s = parts[0] + decimals; // 1,500 como milhar
      } else {
        return { ok: false, reason: "too_many_decimals", message: CORRECT_MSG, raw: token };
      }
    } else {
      s = parts[0].replace(/\./g, "") + (decimals ? `.${decimals}` : "");
    }
  } else if (hasDot) {
    const parts = s.split(".");
    if (parts.length === 2) {
      const decimals = parts[1];
      if (decimals.length > 3) {
        // 350.0000 / 500.00000 → erro de digitação
        return { ok: false, reason: "too_many_decimals", message: CORRECT_MSG, raw: token };
      }
      if (decimals.length === 3) {
        // 1.500 = milhar BR; 350.000 (só zeros) = digitação errada
        if (/^0+$/.test(decimals)) {
          return { ok: false, reason: "too_many_decimals", message: CORRECT_MSG, raw: token };
        }
        if (/^\d+$/.test(decimals)) {
          s = parts.join("");
        } else {
          return { ok: false, reason: "too_many_decimals", message: CORRECT_MSG, raw: token };
        }
      } else {
        s = `${parts[0]}.${decimals}`;
      }
    } else if (parts.length > 2) {
      const last = parts[parts.length - 1];
      if (
        last.length === 3 &&
        parts.every((p, i) => (i === 0 ? /^\d+$/.test(p) : /^\d{3}$/.test(p)))
      ) {
        s = parts.join("");
      } else if (last.length <= 2) {
        s = parts.slice(0, -1).join("") + "." + last;
      } else {
        return { ok: false, reason: "ambiguous", message: CORRECT_MSG, raw: token };
      }
    }
  }

  const value = Number(s);
  if (!Number.isFinite(value) || value <= 0) {
    return { ok: false, reason: "not_a_number", message: CORRECT_MSG, raw: token };
  }

  const rounded = Math.round(value * 100) / 100;

  if (rounded < BILL_VALUE_MIN || rounded > BILL_VALUE_MAX) {
    return {
      ok: false,
      reason: "out_of_range",
      message: `Esse valor (R$ ${formatBillBrl(rounded)}) ficou fora do esperado para simulação. Pode confirmar o valor médio mensal da conta? Exemplo: 350 ou 850,00`,
      raw: token,
    };
  }

  return {
    ok: true,
    value: rounded,
    formatted: formatBillBrl(rounded),
    raw: token,
  };
}

export function parseAverageBillValue(input: string): BillValueParseResult {
  const raw = String(input ?? "").trim();
  if (!raw) {
    return { ok: false, reason: "empty", message: CORRECT_MSG, raw };
  }

  const scrubbed = scrubBillText(raw);
  if (!scrubbed) {
    return { ok: false, reason: "empty", message: CORRECT_MSG, raw };
  }

  // Faixa "400 a 500" / "400-500" → média
  const rangeMatch = scrubbed.match(
    /(\d{1,3}(?:[.\s]\d{3})*(?:[.,]\d{1,4})?|\d+(?:[.,]\d{1,4})?)\s*(?:-|–|—|~|\/|a|até)\s*(\d{1,3}(?:[.\s]\d{3})*(?:[.,]\d{1,4})?|\d+(?:[.,]\d{1,4})?)/i,
  );
  if (rangeMatch) {
    const a = normalizeNumericToken(rangeMatch[1]);
    const b = normalizeNumericToken(rangeMatch[2]);
    if (a.ok && b.ok) {
      const mid = Math.round(((a.value + b.value) / 2) * 100) / 100;
      if (mid < BILL_VALUE_MIN || mid > BILL_VALUE_MAX) {
        return { ok: false, reason: "out_of_range", message: CORRECT_MSG, raw };
      }
      return {
        ok: true,
        value: mid,
        formatted: formatBillBrl(mid),
        raw,
        note: "range_midpoint",
      };
    }
  }

  const candidates = extractNumberCandidates(scrubbed);
  if (candidates.length === 0) {
    const alone = normalizeNumericToken(scrubbed.replace(/\s/g, ""));
    return alone.ok ? { ...alone, raw } : { ...alone, raw };
  }

  const parsed = candidates.map((c) => normalizeNumericToken(c));
  const goods = parsed.filter((p): p is Extract<BillValueParseResult, { ok: true }> => p.ok);
  if (goods.length === 1) return { ...goods[0], raw };
  if (goods.length > 1) {
    goods.sort((x, y) => y.value - x.value);
    return { ...goods[0], raw, note: "picked_largest_plausible" };
  }

  const firstFail = parsed.find((p) => !p.ok);
  if (firstFail && !firstFail.ok) return { ...firstFail, raw };
  return { ok: false, reason: "not_a_number", message: CORRECT_MSG, raw };
}

export function formatBillBrl(value: number): string {
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

export function estimateSavingsRange(billValue: number): {
  min: number;
  max: number;
  minFormatted: string;
  maxFormatted: string;
} {
  const min = Math.round(billValue * 0.08 * 100) / 100;
  const max = Math.round(billValue * 0.2 * 100) / 100;
  return {
    min,
    max,
    minFormatted: formatBillBrl(min),
    maxFormatted: formatBillBrl(max),
  };
}

/** SP pode exigir transferência de titularidade no fluxo; MG não — e no Multicanal MG cadastra direto (boleto único), sem explicar título. */
export function requiresTitleTransfer(uf: string | null | undefined): boolean {
  const u = String(uf || "")
    .trim()
    .toUpperCase();
  return u === "SP" || u === "SÃO PAULO" || u === "SAO PAULO";
}
