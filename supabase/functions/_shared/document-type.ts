// ─────────────────────────────────────────────────────────────────────
// Convenção ÚNICA de tipo de documento usada em TODO o sistema.
// Sempre que o webhook ou worker receberem `document_type` em qualquer
// formato textual ("CNH", "cnh", "RG (Novo)", "rg novo", etc.) eles
// devem normalizar via `normalizeDocumentType()` antes de tomar decisões.
//
// Valores canônicos:
//   - "cnh"       → Carteira Nacional de Habilitação (sem verso)
//   - "rg_novo"   → RG novo / CIN (frente + verso; identidade = CPF, SEM nº RG estadual)
//   - "rg_antigo" → RG antigo (frente + verso; tem nº de Registro Geral)
//
// Regra de produto (2026):
//   RG novo / CIN não imprime número de RG estadual — só CPF.
//   NÃO pedir ask_rg nesse caso. Ver docs/captacao/DOCUMENTOS-RG-CNH-CIN.md
// ─────────────────────────────────────────────────────────────────────

export type DocumentTypeCanonical = "cnh" | "rg_novo" | "rg_antigo";

/**
 * Normaliza qualquer string em um dos 3 valores canônicos.
 * Default = "rg_antigo" (mais comum/seguro: força frente+verso).
 */
export function normalizeDocumentType(input: unknown): DocumentTypeCanonical {
  const raw = String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[._\-()/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw) return "rg_antigo";

  // Sprint D-B12: whitelist com word boundaries — evita "argo" virar rg, "cnhx" virar cnh, etc.
  // Ordem importa: CNH primeiro (mais específico), depois RG novo, depois RG antigo.

  // CNH: aceita "cnh", "habilitação", "carteira nacional de habilitação", "carteira de motorista"
  if (/\bcnh\b/.test(raw)) return "cnh";
  if (/\bhabilita\w*\b/.test(raw)) return "cnh";
  if (/\bcarteira\s+nacional\s+de\s+habilita/.test(raw)) return "cnh";
  if (/\bcarteira\s+nacional\b/.test(raw) && !/\bidentidade\b/.test(raw)) return "cnh";
  if (/\bcarteira\s+de\s+motorista\b/.test(raw)) return "cnh";
  if (/\bmotorista\b/.test(raw) && /\bcarteira\b/.test(raw)) return "cnh";

  // RG novo / CIN: "novo" explícito, CIN, ou Carteira de Identidade Nacional
  if (/\brg\s+novo\b/.test(raw)) return "rg_novo";
  if (/\bidentidade\s+nova\b/.test(raw)) return "rg_novo";
  if (/\bnovo\s+(rg|modelo)\b/.test(raw)) return "rg_novo";
  if (/\bcin\b/.test(raw)) return "rg_novo";
  if (/\bcarteira\s+de\s+identidade\s+nacional\b/.test(raw)) return "rg_novo";

  // RG antigo: padrão para qualquer menção a rg/identidade/registro geral
  if (/\brg\b/.test(raw)) return "rg_antigo";
  if (/\bidentidade\b/.test(raw)) return "rg_antigo";
  if (/\bregistro\s+geral\b/.test(raw)) return "rg_antigo";
  if (/\bantigo\b/.test(raw)) return "rg_antigo";

  return "rg_antigo";
}

/** True quando o tipo de documento é CNH (não tem verso). */
export function isCNH(input: unknown): boolean {
  return normalizeDocumentType(input) === "cnh";
}

/** True quando o tipo é RG novo / CIN (identidade = CPF). */
export function isRgNovo(input: unknown): boolean {
  return normalizeDocumentType(input) === "rg_novo";
}

/** True quando o tipo exige verso (todos os RGs). */
export function requiresVerso(input: unknown): boolean {
  return normalizeDocumentType(input) !== "cnh";
}

/**
 * True quando o fluxo pode/deve pedir o nº de Registro Geral (`ask_rg`).
 * - RG novo / CIN (2026+): NÃO — o documento traz só CPF (sem nº RG estadual).
 * - RG antigo: SIM.
 * - CNH: SIM se o campo RG do cadastro ainda for usado como complemento legado.
 */
export function requiresRgNumber(input: unknown): boolean {
  return normalizeDocumentType(input) !== "rg_novo";
}

/**
 * Texto exato da opção no MUI Select do portal igreen.
 * Validado live em 2026-04-17: existem 3 opções:
 *   "RG (Antigo)", "RG (Novo)", "CNH".
 */
export function portalSelectLabel(input: unknown): "RG (Antigo)" | "RG (Novo)" | "CNH" {
  switch (normalizeDocumentType(input)) {
    case "cnh":
      return "CNH";
    case "rg_novo":
      return "RG (Novo)";
    default:
      return "RG (Antigo)";
  }
}

/** Rótulo amigável para mensagens ao cliente no WhatsApp. */
export function friendlyLabel(input: unknown): string {
  switch (normalizeDocumentType(input)) {
    case "cnh":
      return "CNH";
    case "rg_novo":
      return "RG (Novo) / CIN";
    default:
      return "RG (Antigo)";
  }
}
