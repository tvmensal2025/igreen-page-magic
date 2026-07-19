/**
 * Nome pra CHAMAR o cliente (Oi {{nome}} / "Olá, Nome" na ligação).
 *
 * Duas guardas:
 *  1) Texto parece nome de pessoa? (não meme, telefone, "Ixi Kkk"…)
 *  2) Fonte confiável? Push-name do Zap NÃO conta — a pessoa não digitou.
 *
 * Na dúvida → string vazia → mensagem/ligação só com o CORPO (sem "Olá Nome").
 */

/** Fontes em que o lead (ou OCR / portal / consultor) confirmou o nome. */
export const ADDRESSABLE_NAME_SOURCES = new Set([
  "self_introduced",
  "user_confirmed",
  "ocr_conta",
  "ocr_doc",
  "ocr_cnh",
  "ocr_rg",
  "ocr",
  "manual",
  "igreen_portal", // ficha oficial sync portal iGreen
]);

/** Nunca usar pra saudação — veio do Zap ou ainda não sabemos. */
export const NON_ADDRESSABLE_NAME_SOURCES = new Set([
  "",
  "unknown",
  "whatsapp_profile",
  "freeform_multi", // heurística de texto livre — dúvida
  "cadence", // pode herdar push-name
]);

/** Tokens que nunca são prenome (meme, lixo, saudação, domínio). */
const BAD_NAME_TOKENS = new Set([
  // meme / risada / interjeição
  "ixi", "kkk", "kkkk", "kkkkk", "haha", "hahaha", "rsrs", "rsrsrs", "hehe",
  "aff", "nossa", "caramba", "puts", "poxa", "eita", "opa", "ops",
  // saudação / confirmação
  "oi", "ola", "olá", "oie", "oii", "hey", "hi", "hello", "bom", "boa",
  "dia", "tarde", "noite", "ok", "okay", "sim", "nao", "não", "blz", "beleza",
  "valeu", "obrigado", "obrigada", "tmj", "flw", "falou",
  // placeholder / sistema
  "cliente", "lead", "teste", "test", "null", "undefined", "whatsapp", "zap",
  "contato", "user", "usuario", "usuário", "bot", "robo", "robô", "admin",
  // domínio
  "energia", "igreen", "luz", "conta", "fatura",
  // apelidos genéricos de status WA
  "meus", "netos", "tudo", "amor", "baby", "bebe", "bebê",
]);

const EMOJI_CLASS = String.raw`[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]`;
/** Olá com/sem acento + Oi / Ei. */
const GREET = String.raw`(?:Ol[aá]|Oi|Ei|E\s*a[ií])`;

export function isAddressableNameSource(source: string | null | undefined): boolean {
  const s = String(source || "").trim().toLowerCase();
  if (!s) return false;
  if (NON_ADDRESSABLE_NAME_SOURCES.has(s)) return false;
  return ADDRESSABLE_NAME_SOURCES.has(s);
}

export function isUsableCustomerName(raw: string | null | undefined): boolean {
  const full = String(raw || "").trim();
  if (!full) return false;
  // Telefone / só dígitos
  const digits = full.replace(/\D/g, "");
  if (digits.length >= 8 && digits.length >= full.replace(/\s/g, "").length * 0.7) {
    return false;
  }
  const parts = full.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return false;
  if (parts.length > 6) return false; // status Zap longo
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
  // Pelo menos uma palavra com letra
  return /[A-Za-zÀ-ÿ]/.test(full);
}

function titleCaseFirst(part: string): string {
  const clean = part.replace(/[.,;:!?]+$/g, "");
  if (!clean) return "";
  return clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
}

/**
 * Prenome seguro pra chamar no WA/SMS/ligação.
 * Sem fonte confiável → "" (nunca push do Zap).
 */
export function safeFirstNameForAddress(
  raw: string | null | undefined,
  nameSource?: string | null,
): string {
  if (!isAddressableNameSource(nameSource)) return "";
  if (!isUsableCustomerName(raw)) return "";
  const first = String(raw || "").trim().split(/\s+/)[0] || "";
  return titleCaseFirst(first);
}

/**
 * Nome completo curto (até 3 partes) pra templates que pedem nome completo.
 */
export function safeFullNameForAddress(
  raw: string | null | undefined,
  nameSource?: string | null,
): string {
  if (!isAddressableNameSource(nameSource)) return "";
  if (!isUsableCustomerName(raw)) return "";
  const parts = String(raw || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map(titleCaseFirst)
    .filter(Boolean);
  // Partículas minúsculas no meio
  return parts
    .map((p, i) => {
      if (i === 0) return p;
      const low = p.toLowerCase();
      if (["de", "da", "do", "dos", "das", "e"].includes(low)) return low;
      return p;
    })
    .join(" ");
}

/**
 * Sem prenome usável: remove "Olá, {{nome}}." / "Oi {{nome}}," e sobras,
 * deixando só o CORPO (pedido: quem não digitou nome não leva saudação nominal).
 *
 * Também limpa pós-substituição ("Olá, .", "Olaaqui", ":sua").
 */
export function scrubEmptyNameGreeting(template: string): string {
  let out = String(template || "");

  // Prefixo emoji (COLD: "💡 Oi *{{nome}}*!")
  out = out.replace(new RegExp(`^${EMOJI_CLASS}+\\s*`, "gu"), "");

  // Saudação + placeholder no início (com/sem *bold* + pontuação/vírgula + wave)
  out = out.replace(
    new RegExp(
      `^${GREET}\\s*,?\\s*\\*?\\s*\\{\\{\\s*nome\\s*\\}\\}\\s*\\*?\\s*[,.!]?\\s*${EMOJI_CLASS}?\\s*`,
      "gimsu",
    ),
    "",
  );

  // Mid-SMS: "oi {{nome}}," / "Oi {{nome}}!" (também após "iGreen: ")
  out = out.replace(
    new RegExp(
      `\\b${GREET}\\s+\\*?\\s*\\{\\{\\s*nome\\s*\\}\\}\\s*\\*?\\s*[,.!]?\s*`,
      "gi",
    ),
    "",
  );

  // "{{nome}}, resto" — preserva espaço (evita ":sua" / cola)
  out = out.replace(/^\*?\s*\{\{\s*nome\s*\}\}\s*\*?\s*,\s*/gim, "");
  out = out.replace(/(:\s*)\*?\s*\{\{\s*nome\s*\}\}\s*\*?\s*,\s*/gi, "$1");
  out = out.replace(/\*?\s*\{\{\s*nome\s*\}\}\s*\*?\s*,\s*/gi, " ");

  // ", {{nome}}" / " {{nome}}" / "*{{nome}}*" residual
  out = out.replace(/,\s*\*?\s*\{\{\s*nome\s*\}\}\s*\*?/gi, "");
  out = out.replace(/\s*\*?\s*\{\{\s*nome\s*\}\}\s*\*?/gi, " ");

  // Pós-substituição: saudação órfã
  out = out.replace(new RegExp(`^${EMOJI_CLASS}+\\s*`, "gu"), "");
  out = out.replace(
    new RegExp(`^${GREET}\\s*,?\\s*\\*?\\s*[,.!]?\\s*${EMOJI_CLASS}?\\s*`, "gimu"),
    "",
  );
  // ": !" / ": ," órfãos após tirar Oi Nome
  out = out.replace(/:\s*[,.!]\s*/g, ": ");
  // Vírgula / pontuação órfã no início
  out = out.replace(/^[,.;:\s]+/g, "");
  // "Imagina ," → "Imagina" ; "Imagina😅" ← garante espaço antes de emoji se sumiu a vírgula
  out = out.replace(/\s+,/g, ",");
  out = out.replace(/,\s*([.!?])/g, "$1");
  out = out.replace(/([A-Za-zÀ-ÿ]),\s*$/gm, "$1");
  out = out.replace(new RegExp(`([A-Za-zÀ-ÿ])(?=${EMOJI_CLASS})`, "gu"), "$1 ");
  // ":sua" → ": sua" — NÃO tocar em "https://" (próximo char é /)
  out = out.replace(/:([A-Za-zÀ-ÿ])/g, ": $1");
  out = out.replace(/\*\s*\*/g, "");
  out = out.replace(/[ \t]{2,}/g, " ");
  out = out.replace(/\n{3,}/g, "\n\n");
  return out.trim();
}
