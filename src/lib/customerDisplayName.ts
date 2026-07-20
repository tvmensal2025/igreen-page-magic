/**
 * Espelho frontend de supabase/functions/_shared/customer-display-name.ts
 * (só o necessário pra UI admin — identificar lead na lista).
 */

export const ADDRESSABLE_NAME_SOURCES = new Set([
  "self_introduced",
  "user_confirmed",
  "ocr_conta",
  "ocr_doc",
  "ocr_cnh",
  "ocr_rg",
  "ocr",
  "manual",
  "igreen_portal",
]);

const BAD_NAME_TOKENS = new Set([
  "ixi", "kkk", "kkkk", "haha", "rsrs", "oi", "ola", "olá", "ok", "sim", "nao", "não",
  "cliente", "lead", "teste", "whatsapp", "contato", "energia", "igreen",
  "escrevi", "digitei", "errei", "errado", "errada",
]);

export function isUsableCustomerName(raw: string | null | undefined): boolean {
  const full = String(raw || "").trim();
  if (!full) return false;
  const digits = full.replace(/\D/g, "");
  if (digits.length >= 8 && digits.length >= full.replace(/\s/g, "").length * 0.7) {
    return false;
  }
  const parts = full.split(/\s+/).filter(Boolean);
  if (parts.length === 0 || parts.length > 6) return false;
  for (const p of parts) {
    const tok = p
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    if (!tok) continue;
    if (BAD_NAME_TOKENS.has(tok)) return false;
    if (/^\d+$/.test(tok)) return false;
    if (tok.length < 2) return false;
  }
  return /[A-Za-zÀ-ÿ]/.test(full);
}

export function isAddressableNameSource(source: string | null | undefined): boolean {
  const s = String(source || "").trim().toLowerCase();
  if (!s || s === "unknown" || s === "whatsapp_profile") return false;
  return ADDRESSABLE_NAME_SOURCES.has(s);
}

function titleCase(part: string): string {
  const clean = part.replace(/[.,;:!?]+$/g, "");
  if (!clean) return "";
  return clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
}

export function formatPersonName(raw: string): string {
  return String(raw || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map(titleCase)
    .join(" ");
}

/** Nome parece telefone formatado — não usar como título. */
export function looksLikePhoneLabel(raw: string | null | undefined): boolean {
  const s = String(raw || "").trim();
  if (!s) return false;
  const digits = s.replace(/\D/g, "");
  if (digits.length >= 10 && digits.length >= s.replace(/\s/g, "").length * 0.65) {
    return true;
  }
  return /^\(?\d{2}\)?\s*\d{4,5}[-\s]?\d{4}$/.test(s);
}

export type LeadNameResolution = {
  displayName: string;
  nameSourceLabel: string | null;
};

/**
 * Melhor nome para exibir no painel (não é a guarda de envio automático).
 */
export function resolveLeadPanelDisplayName(input: {
  name?: string | null;
  nameSource?: string | null;
  billHolderName?: string | null;
  docHolderName?: string | null;
  chatNameHint?: string | null;
}): LeadNameResolution {
  const candidates: Array<{ value: string; label: string }> = [];

  for (const [value, label] of [
    [input.billHolderName, "Titular da conta"],
    [input.docHolderName, "Documento"],
    [input.chatNameHint, "Digitou no chat"],
  ] as const) {
    const v = String(value || "").trim();
    if (v && isUsableCustomerName(v) && !looksLikePhoneLabel(v)) {
      candidates.push({ value: formatPersonName(v), label });
    }
  }

  const rawName = String(input.name || "").trim();
  const src = String(input.nameSource || "").trim().toLowerCase();
  if (
    rawName &&
    isUsableCustomerName(rawName) &&
    !looksLikePhoneLabel(rawName)
  ) {
    if (isAddressableNameSource(src)) {
      candidates.unshift({ value: formatPersonName(rawName), label: "Confirmado" });
    } else if (src === "whatsapp_profile" || src === "freeform_multi") {
      candidates.push({ value: formatPersonName(rawName), label: "Perfil WhatsApp" });
    } else {
      candidates.push({ value: formatPersonName(rawName), label: "Cadastro" });
    }
  }

  if (candidates.length > 0) {
    return { displayName: candidates[0].value, nameSourceLabel: candidates[0].label };
  }
  return { displayName: "Sem nome", nameSourceLabel: null };
}

/** Tenta extrair prenome de mensagem inbound curta. */
export function guessNameFromInboundMessage(text: string | null | undefined): string | null {
  const raw = String(text || "").trim();
  if (!raw || raw.length > 40) return null;
  if (/https?:\/\//i.test(raw)) return null;
  const line = raw.split(/\n/)[0]?.trim() || "";
  if (!isUsableCustomerName(line) || looksLikePhoneLabel(line)) return null;
  return formatPersonName(line);
}
