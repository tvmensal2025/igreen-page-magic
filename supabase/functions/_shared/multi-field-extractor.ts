// Multi-field extractor — corre todos os extractors em paralelo numa mensagem livre
// e devolve só os campos que casaram. Usado pra capturar dados extras quando o lead
// despeja várias infos numa única mensagem (ex: "sou João, CEP 01310-100, conta 450").
//
// Política: NÃO sobrescreve campos já preenchidos com source forte (manual / OCR).
// Só preenche slots vazios — `source=freeform_multi`.

import { extractCPF, extractNome, extractTelefone, extractValor } from "./captureExtractors.ts";

export interface MultiFieldResult {
  nome?: string;
  cep?: string;
  valor_conta?: number;
  cpf?: string;
  rg?: string;
  data_nascimento?: string;
  email?: string;
  telefone?: string;
}

const CEP_RX = /\b(\d{5})-?(\d{3})\b/;
const EMAIL_RX = /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/;
const DATE_RX = /\b(\d{2})\/(\d{2})\/(\d{4})\b/;
const RG_RX = /\b(?:rg|registro(?:\s+geral)?|identidade|registro\s+da\s+cnh)\s*[:\-]?\s*([0-9.\-]{7,14}[xX]?)\b/i;

export function extractCEP(text: string): string | null {
  if (!text) return null;
  const m = text.match(CEP_RX);
  if (!m) return null;
  const digits = `${m[1]}${m[2]}`;
  // descarta sequências triviais (00000000, 12345678 puro)
  if (/^(\d)\1+$/.test(digits)) return null;
  return `${m[1]}-${m[2]}`;
}

export function extractEmail(text: string): string | null {
  if (!text) return null;
  const m = text.match(EMAIL_RX);
  return m ? m[0].toLowerCase() : null;
}

export function extractRG(text: string): string | null {
  if (!text) return null;
  const m = text.match(RG_RX);
  if (!m) return null;
  const clean = m[1].replace(/[^\dXx]/g, "").toUpperCase();
  return clean.length >= 7 && clean.length <= 12 ? clean : null;
}

export function extractBirthDate(text: string): string | null {
  if (!text) return null;
  const m = text.match(DATE_RX);
  if (!m) return null;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yy = Number(m[3]);
  const max = new Date().getFullYear() - 17;
  if (dd < 1 || dd > 31 || mm < 1 || mm > 12 || yy < 1920 || yy > max) return null;
  return `${m[1]}/${m[2]}/${m[3]}`;
}

export function extractMultiField(text: string, opts?: { allowSingleWordName?: boolean }): MultiFieldResult {
  const out: MultiFieldResult = {};
  if (!text || typeof text !== "string") return out;

  try { const v = extractNome(text, { allowSingleWord: !!opts?.allowSingleWordName }); if (v) out.nome = v; } catch {}
  try { const v = extractCEP(text); if (v) out.cep = v; } catch {}
  try { const v = extractValor(text); if (v != null) out.valor_conta = v; } catch {}
  try { const v = extractCPF(text); if (v) out.cpf = v; } catch {}
  try { const v = extractRG(text); if (v) out.rg = v; } catch {}
  try { const v = extractBirthDate(text); if (v) out.data_nascimento = v; } catch {}
  try { const v = extractEmail(text); if (v) out.email = v; } catch {}
  try { const v = extractTelefone(text); if (v) out.telefone = v; } catch {}

  return out;
}

/**
 * Aplica resultado do multi-extractor ao customer, respeitando hierarquia.
 * Retorna o patch a ser persistido (vazio = nada a fazer).
 *
 * Regras:
 * - `name`: só preenche se vazio OU se source atual for `whatsapp_profile`/`freeform`
 *   (NÃO sobrescreve OCR, manual, confirmação explícita ou freeform anterior).
 * - Outros campos: só preenche se estiverem vazios/null.
 */
export function buildMultiFieldPatch(
  customer: Record<string, any>,
  multi: MultiFieldResult,
): Record<string, any> {
  const patch: Record<string, any> = {};
  // freeform_multi entra como FORTE: depois que o lead se introduziu uma vez via
  // mensagem livre, novas mensagens livres não sobrescrevem mais o nome.
  const strongNameSources = new Set([
    "manual", "ocr_cnh", "ocr_rg", "ocr_doc", "ocr_conta",
    "self_introduced", "user_confirmed", "freeform_multi",
  ]);
  if (multi.nome && (!customer.name || !strongNameSources.has(String(customer.name_source || "")))) {
    const cur = String(customer.name || "").trim().toLowerCase();
    if (cur !== multi.nome.toLowerCase()) {
      patch.name = multi.nome;
      patch.name_source = "freeform_multi";
      try {
        console.log("[name-overwrite]", JSON.stringify({
          customer_id: customer.id,
          old_name: customer.name ?? null,
          old_source: customer.name_source ?? null,
          new_name: multi.nome,
          new_source: "freeform_multi",
          name_ask_sent_at: customer.name_ask_sent_at ?? null,
        }));
      } catch {}
    }
  }
  if (multi.cep && !customer.cep) patch.cep = multi.cep;
  if (multi.valor_conta != null && customer.electricity_bill_value == null) {
    patch.electricity_bill_value = multi.valor_conta;
  }
  if (multi.cpf && !customer.cpf) patch.cpf = multi.cpf;
  if (multi.rg && !customer.rg) patch.rg = multi.rg;
  if (multi.data_nascimento && !customer.data_nascimento) patch.data_nascimento = multi.data_nascimento;
  if (multi.email && !customer.email) patch.email = multi.email;
  if (multi.telefone && !customer.phone_landline && customer.phone_whatsapp) {
    const wDigits = String(customer.phone_whatsapp).replace(/\D/g, "");
    if (!wDigits.endsWith(multi.telefone)) patch.phone_landline = multi.telefone;
  }

  return patch;
}
