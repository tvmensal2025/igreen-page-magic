// Espelho Deno de src/lib/captacao/portalValidation.ts — mantém finalize-capture
// rejeitando o lead com EXATAMENTE a mesma régua que o frontend mostra ao consultor.
// Se mudar a lógica aqui, atualize o arquivo do src também.
import { isValidDistribuidora, isHoldingName, suggestDistribuidoras } from "./distribuidoras.ts";



export type FieldKey =
  | "name" | "cpf" | "data_nascimento"
  | "phone_whatsapp" | "email"
  | "cep" | "address_street" | "address_number"
  | "address_neighborhood" | "address_city" | "address_state"
  | "distribuidora" | "numero_instalacao"
  | "electricity_bill_value" | "media_consumo"
  | "document_front_url" | "document_back_url" | "electricity_bill_photo_url";

export interface FieldDef { key: FieldKey; label: string; }

export const PORTAL_FIELDS: FieldDef[] = [
  { key: "name", label: "Nome completo" },
  { key: "cpf", label: "CPF" },
  { key: "data_nascimento", label: "Nascimento" },
  { key: "phone_whatsapp", label: "WhatsApp" },
  { key: "email", label: "E-mail" },
  { key: "cep", label: "CEP" },
  { key: "address_street", label: "Rua" },
  { key: "address_number", label: "Número" },
  { key: "address_neighborhood", label: "Bairro" },
  { key: "address_city", label: "Cidade" },
  { key: "address_state", label: "UF" },
  { key: "distribuidora", label: "Distribuidora" },
  { key: "numero_instalacao", label: "Nº instalação" },
  { key: "electricity_bill_value", label: "Valor da conta" },
  { key: "media_consumo", label: "Consumo (kWh)" },
  { key: "document_front_url", label: "Documento (frente)" },
  { key: "document_back_url", label: "Documento (verso)" },
  { key: "electricity_bill_photo_url", label: "Conta de luz" },
];

export interface InvalidIssue {
  field: string;
  label: string;
  reason: string;
  suggestion?: string | number;
}

export interface ValidationResult {
  ok: boolean;
  missing: { key: string; label: string }[];
  invalid: InvalidIssue[];
}

const KWH_MIN_RATIO = 0.6;
const KWH_MAX_RATIO = 1.6;

const isStrFilled = (v: any) => v !== null && v !== undefined && typeof v === "string" && v.trim().length > 0;
const digits = (v: any) => String(v ?? "").replace(/\D/g, "");

function cpfValid(raw: string): boolean {
  const cpf = digits(raw);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(cpf[i]) * (10 - i);
  let r = (sum * 10) % 11; if (r === 10) r = 0;
  if (r !== parseInt(cpf[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(cpf[i]) * (11 - i);
  r = (sum * 10) % 11; if (r === 10) r = 0;
  return r === parseInt(cpf[10]);
}

function parseDob(raw: string): Date | null {
  const s = String(raw || "").trim();
  let d: Date | null = null;
  let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) d = new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00`);
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00`);
  if (!d || isNaN(d.getTime())) return null;
  return d;
}

export function validateForPortal(c: Record<string, any> | null | undefined): ValidationResult {
  const missing: { key: string; label: string }[] = [];
  const invalid: InvalidIssue[] = [];

  if (!c) {
    return { ok: false, missing: PORTAL_FIELDS.map((f) => ({ key: f.key, label: f.label })), invalid: [] };
  }

  for (const f of PORTAL_FIELDS) {
    const v = (c as any)[f.key];
    if (f.key === "electricity_bill_value" || f.key === "media_consumo") {
      if (v === null || v === undefined || Number(v) <= 0) missing.push({ key: f.key, label: f.label });
      continue;
    }
    if (!isStrFilled(v)) missing.push({ key: f.key, label: f.label });
  }

  if (isStrFilled(c.name) && String(c.name).trim().split(/\s+/).length < 2) {
    invalid.push({ field: "name", label: "Nome completo", reason: "Nome precisa ter pelo menos 2 palavras" });
  }
  if (isStrFilled(c.cpf) && !cpfValid(c.cpf)) {
    invalid.push({ field: "cpf", label: "CPF", reason: "CPF inválido" });
  }
  if (isStrFilled(c.data_nascimento)) {
    const d = parseDob(c.data_nascimento);
    if (!d) invalid.push({ field: "data_nascimento", label: "Nascimento", reason: "Formato esperado DD/MM/AAAA" });
    else {
      const age = (Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000);
      if (age < 18 || age > 100) invalid.push({ field: "data_nascimento", label: "Nascimento", reason: `Idade ${Math.floor(age)} fora da faixa 18–100` });
    }
  }
  if (isStrFilled(c.phone_whatsapp)) {
    const ph = digits(c.phone_whatsapp).replace(/^55/, "");
    if (ph.length < 10 || ph.length > 11) invalid.push({ field: "phone_whatsapp", label: "WhatsApp", reason: "Telefone com DDD precisa de 10–11 dígitos" });
  }
  if (isStrFilled(c.email) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(c.email).trim())) {
    invalid.push({ field: "email", label: "E-mail", reason: "E-mail em formato inválido" });
  }
  if (isStrFilled(c.cep) && digits(c.cep).length !== 8) {
    invalid.push({ field: "cep", label: "CEP", reason: "CEP precisa de 8 dígitos" });
  }
  if (isStrFilled(c.address_state) && String(c.address_state).trim().length !== 2) {
    invalid.push({ field: "address_state", label: "UF", reason: "UF precisa ter 2 letras" });
  }
  if (isStrFilled(c.numero_instalacao) && digits(c.numero_instalacao).length < 6) {
    invalid.push({ field: "numero_instalacao", label: "Nº instalação", reason: "Número de instalação parece curto demais" });
  }

  // Distribuidora — bloqueia holding genérica + nome fora da allow-list por UF
  if (isStrFilled(c.distribuidora)) {
    if (isHoldingName(c.distribuidora)) {
      const opts = suggestDistribuidoras(c.address_state).slice(0, 5).join(", ");
      invalid.push({
        field: "distribuidora",
        label: "Distribuidora",
        reason: `"${c.distribuidora}" é o grupo holding, não a concessionária. Use a regional${opts ? `: ${opts}` : ""}.`,
        suggestion: opts || undefined,
      });
    } else if (!isValidDistribuidora(c.distribuidora, c.address_state)) {
      const opts = suggestDistribuidoras(c.address_state).slice(0, 5).join(", ");
      if (opts) {
        invalid.push({
          field: "distribuidora",
          label: "Distribuidora",
          reason: `"${c.distribuidora}" não é uma concessionária válida em ${c.address_state}. Opções: ${opts}.`,
          suggestion: opts,
        });
      }
    }
  }

  const valor = Number(c.electricity_bill_value || 0);
  const kwh = Number(c.media_consumo || 0);
  if (valor > 0 && kwh > 0) {
    const ratio = valor / kwh;
    if (ratio < KWH_MIN_RATIO || ratio > KWH_MAX_RATIO) {
      const suggestion = Math.max(50, Math.min(3000, Math.round(valor / 1.0)));
      invalid.push({
        field: "consumo_vs_valor",
        label: "Consumo vs valor",
        reason: `R$ ${valor.toFixed(2)} ÷ ${kwh} kWh = R$ ${ratio.toFixed(2)}/kWh — fora da faixa esperada (~R$1/kWh).`,
        suggestion,
      });
    }
  }

  if (c.name_mismatch_flag && !c.name_mismatch_acknowledged_at) {
    invalid.push({ field: "name_mismatch", label: "Titularidade", reason: "Nome do documento difere da conta — confirme antes de enviar" });
  }

  return { ok: missing.length === 0 && invalid.length === 0, missing, invalid };
}
