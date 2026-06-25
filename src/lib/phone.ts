/**
 * Helpers de validação de telefone brasileiro para WhatsApp.
 * Formato esperado para envio: 55 + DDD (2 dígitos) + 9 + 8 dígitos = 13 dígitos.
 * Aceita também fixo (55 + DDD + 8 dígitos = 12 dígitos), mas WhatsApp celular precisa do 9.
 */

const VALID_DDDS = new Set<string>([
  "11","12","13","14","15","16","17","18","19",
  "21","22","24","27","28",
  "31","32","33","34","35","37","38",
  "41","42","43","44","45","46","47","48","49",
  "51","53","54","55",
  "61","62","63","64","65","66","67","68","69",
  "71","73","74","75","77","79",
  "81","82","83","84","85","86","87","88","89",
  "91","92","93","94","95","96","97","98","99",
]);

export function onlyDigits(value: string | null | undefined): string {
  return (value || "").replace(/\D/g, "");
}

/** Normaliza para o formato 55DDDNNNNNNNNN (13 dígitos, celular com 9). */
export function normalizeBrazilPhone(raw: string | null | undefined): string {
  let digits = onlyDigits(raw);
  if (!digits) return "";
  // Remove zeros iniciais comuns em export de planilhas
  digits = digits.replace(/^0+/, "");
  // Se veio sem 55, prepende
  if (digits.length === 10 || digits.length === 11) {
    digits = "55" + digits;
  }
  // Se veio com 55 + 10 dígitos (sem 9 no celular), tenta adicionar 9 no início do número local
  if (digits.length === 12 && digits.startsWith("55")) {
    const ddd = digits.slice(2, 4);
    const local = digits.slice(4);
    if (local.length === 8 && /^[6-9]/.test(local)) {
      digits = `55${ddd}9${local}`;
    }
  }
  return digits;
}

export type PhoneValidation = {
  valid: boolean;
  normalized: string;
  reason?: "empty" | "too_short" | "too_long" | "invalid_ddd" | "invalid_format";
  message?: string;
};

/** Valida WhatsApp brasileiro. Para WhatsApp exige celular (13 dígitos com 9). */
export function validateBrazilPhone(raw: string | null | undefined): PhoneValidation {
  const normalized = normalizeBrazilPhone(raw);
  if (!normalized) {
    return { valid: false, normalized: "", reason: "empty", message: "Informe o telefone" };
  }
  if (!normalized.startsWith("55")) {
    return { valid: false, normalized, reason: "invalid_format", message: "Telefone deve começar com 55 (Brasil)" };
  }
  if (normalized.length < 12) {
    return { valid: false, normalized, reason: "too_short", message: "Telefone curto demais (precisa de DDD + número)" };
  }
  if (normalized.length > 13) {
    return { valid: false, normalized, reason: "too_long", message: "Telefone com dígitos a mais" };
  }
  const ddd = normalized.slice(2, 4);
  if (!VALID_DDDS.has(ddd)) {
    return { valid: false, normalized, reason: "invalid_ddd", message: `DDD ${ddd} inválido` };
  }
  if (normalized.length === 13) {
    // Celular: o 5º dígito (após 55+DDD) deve ser 9
    if (normalized[4] !== "9") {
      return { valid: false, normalized, reason: "invalid_format", message: "Celular precisa começar com 9 após o DDD" };
    }
    return { valid: true, normalized };
  }
  // 12 dígitos = fixo. Para WhatsApp não serve.
  return { valid: false, normalized, reason: "invalid_format", message: "WhatsApp precisa ser celular (com 9 após o DDD)" };
}

/** Compara dois números pelos últimos 11 dígitos (DDD + celular). */
export function phonesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const da = onlyDigits(a);
  const db = onlyDigits(b);
  if (!da || !db) return false;
  return da.slice(-11) === db.slice(-11);
}

/** Formata para exibição: +55 (11) 99000-0650 */
export function formatBrazilPhone(raw: string | null | undefined): string {
  const d = onlyDigits(raw);
  if (!d) return "";
  const tail = d.length > 11 ? d.slice(-11) : d;
  if (tail.length === 11) {
    return `+55 (${tail.slice(0, 2)}) ${tail.slice(2, 7)}-${tail.slice(7)}`;
  }
  if (tail.length === 10) {
    return `+55 (${tail.slice(0, 2)}) ${tail.slice(2, 6)}-${tail.slice(6)}`;
  }
  return raw || "";
}
