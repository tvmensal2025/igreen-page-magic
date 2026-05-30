// Validador único usado pelo frontend (CaptureSheet/Card) e pelo edge
// finalize-capture. Cobre TODOS os campos que o Portal 2 (iGreen) exige
// no POST /customers — não só os 10 visuais antigos.
//
// Regra de ouro do cliente: nunca mandar lead "torto" pro portal e ele
// rejeitar. A maior fonte de bug era media_consumo NULL → worker recebia 0
// kWh e /bonus/rules devolvia 404. Agora bloqueamos antes.
//
// IMPORTANTE: este arquivo é espelhado em
// `supabase/functions/_shared/portalValidation.ts` (mesma lógica, Deno).
// Se mudar aqui, mude lá também.
import { isValidDistribuidora, isHoldingName, suggestDistribuidoras } from "./distribuidoras";


export type FieldKey =
  | "name" | "cpf" | "data_nascimento"
  | "phone_whatsapp" | "email"
  | "cep" | "address_street" | "address_number"
  | "address_neighborhood" | "address_city" | "address_state"
  | "distribuidora" | "numero_instalacao"
  | "electricity_bill_value" | "media_consumo"
  | "document_front_url" | "document_back_url" | "electricity_bill_photo_url";

export interface PortalCustomer {
  name?: string | null;
  cpf?: string | null;
  data_nascimento?: string | null;
  phone_whatsapp?: string | null;
  email?: string | null;
  cep?: string | null;
  address_street?: string | null;
  address_number?: string | null;
  address_neighborhood?: string | null;
  address_city?: string | null;
  address_state?: string | null;
  distribuidora?: string | null;
  numero_instalacao?: string | null;
  electricity_bill_value?: number | string | null;
  media_consumo?: number | string | null;
  document_front_url?: string | null;
  document_back_url?: string | null;
  electricity_bill_photo_url?: string | null;
  name_mismatch_flag?: boolean | null;
  name_mismatch_acknowledged_at?: string | null;
}

export interface FieldDef {
  key: FieldKey;
  label: string;
  group: "id" | "contato" | "endereco" | "conta" | "docs";
}

// Lista canônica do Portal 2 — usada também pra renderizar a ficha.
// Ordem = ordem visual recomendada.
export const PORTAL_FIELDS: FieldDef[] = [
  { key: "name", label: "Nome completo", group: "id" },
  { key: "cpf", label: "CPF", group: "id" },
  { key: "data_nascimento", label: "Nascimento", group: "id" },
  { key: "phone_whatsapp", label: "WhatsApp", group: "contato" },
  { key: "email", label: "E-mail", group: "contato" },
  { key: "cep", label: "CEP", group: "endereco" },
  { key: "address_street", label: "Rua", group: "endereco" },
  { key: "address_number", label: "Número", group: "endereco" },
  { key: "address_neighborhood", label: "Bairro", group: "endereco" },
  { key: "address_city", label: "Cidade", group: "endereco" },
  { key: "address_state", label: "UF", group: "endereco" },
  { key: "distribuidora", label: "Distribuidora", group: "conta" },
  { key: "numero_instalacao", label: "Nº instalação", group: "conta" },
  { key: "electricity_bill_value", label: "Valor da conta", group: "conta" },
  { key: "media_consumo", label: "Consumo (kWh)", group: "conta" },
  { key: "document_front_url", label: "Documento (frente)", group: "docs" },
  { key: "document_back_url", label: "Documento (verso)", group: "docs" },
  { key: "electricity_bill_photo_url", label: "Conta de luz", group: "docs" },
];

export interface InvalidIssue {
  field: FieldKey | "consumo_vs_valor" | "name_mismatch";
  label: string;
  reason: string;
  suggestion?: string | number;
}

export interface PendingItem {
  kind: "missing" | "invalid";
  field: string;
  label: string;
  reason?: string;
}

export interface ValidationResult {
  ok: boolean;
  missing: FieldDef[];
  invalid: InvalidIssue[];
  filledCount: number;
  totalFields: number;
  /** Lista unificada de pendências (faltantes + inválidos) pra UI mostrar
   *  exatamente o que está bloqueando o CADASTRAR, sem desencontro. */
  pendingItems: PendingItem[];
}

// Faixa esperada R$/kWh — regra de negócio do cliente: ≈ R$1/kWh.
// Tarifa real fica em 0,8–1,3 dependendo da distribuidora; abrimos um
// pouquinho pra evitar falso-positivo, mas mantemos apertado.
const KWH_MIN_RATIO = 0.6;
const KWH_MAX_RATIO = 1.6;

function isStrFilled(v: any): boolean {
  return v !== null && v !== undefined && typeof v === "string" && v.trim().length > 0;
}
function digits(v: any): string {
  return String(v ?? "").replace(/\D/g, "");
}

// CPF check (algoritmo padrão)
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

// data_nascimento aceita DD/MM/YYYY ou YYYY-MM-DD
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

export function validateForPortal(c: PortalCustomer | null | undefined): ValidationResult {
  const missing: FieldDef[] = [];
  const invalid: InvalidIssue[] = [];

  if (!c) {
    return {
      ok: false,
      missing: [...PORTAL_FIELDS],
      invalid: [],
      filledCount: 0,
      totalFields: PORTAL_FIELDS.length,
      pendingItems: PORTAL_FIELDS.map((f) => ({ kind: "missing" as const, field: f.key, label: f.label })),
    };
  }

  // 1) Presença — campos string
  for (const f of PORTAL_FIELDS) {
    const v = (c as any)[f.key];
    if (f.key === "electricity_bill_value" || f.key === "media_consumo") {
      if (v === null || v === undefined || Number(v) <= 0) missing.push(f);
      continue;
    }
    if (f.key === "document_back_url") {
      // CNH não precisa de verso — frontend grava "nao_aplicavel"
      if (!isStrFilled(v)) missing.push(f);
      continue;
    }
    if (!isStrFilled(v)) missing.push(f);
  }

  // 2) Sanidade de formato — só checa o que ESTÁ preenchido
  if (isStrFilled(c.name) && c.name!.trim().split(/\s+/).length < 2) {
    invalid.push({ field: "name", label: "Nome completo", reason: "Nome precisa ter pelo menos 2 palavras" });
  }
  if (isStrFilled(c.cpf) && !cpfValid(c.cpf!)) {
    invalid.push({ field: "cpf", label: "CPF", reason: "CPF inválido (dígito verificador errado)" });
  }
  if (isStrFilled(c.data_nascimento)) {
    const d = parseDob(c.data_nascimento!);
    if (!d) {
      invalid.push({ field: "data_nascimento", label: "Nascimento", reason: "Formato esperado DD/MM/AAAA" });
    } else {
      const age = (Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000);
      if (age < 18 || age > 100) {
        invalid.push({ field: "data_nascimento", label: "Nascimento", reason: `Idade ${Math.floor(age)} fora da faixa 18–100` });
      }
    }
  }
  if (isStrFilled(c.phone_whatsapp)) {
    const ph = digits(c.phone_whatsapp).replace(/^55/, "");
    if (ph.length < 10 || ph.length > 11) {
      invalid.push({ field: "phone_whatsapp", label: "WhatsApp", reason: "Telefone precisa ter DDD + 8/9 dígitos" });
    }
  }
  if (isStrFilled(c.email) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email!.trim())) {
    invalid.push({ field: "email", label: "E-mail", reason: "E-mail em formato inválido" });
  }
  if (isStrFilled(c.cep) && digits(c.cep).length !== 8) {
    invalid.push({ field: "cep", label: "CEP", reason: "CEP precisa de 8 dígitos" });
  }
  if (isStrFilled(c.address_state) && c.address_state!.trim().length !== 2) {
    invalid.push({ field: "address_state", label: "UF", reason: "UF precisa ter 2 letras (ex: SP)" });
  }
  if (isStrFilled(c.numero_instalacao) && digits(c.numero_instalacao).length < 6) {
    invalid.push({ field: "numero_instalacao", label: "Nº instalação", reason: "Número de instalação parece curto demais" });
  }

  // 3) Distribuidora — bloqueia holding genérica ("CPFL ENERGIA", "ENEL BRASIL"
  //    etc) e nome fora da allow-list da UF. É a causa #1 de lead "voltar"
  //    silencioso do Portal 2 (404 em /bonus/rules).
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

  // 4) Cruzamento crítico — R$/kWh tem que bater
  const valor = Number(c.electricity_bill_value || 0);
  const kwh = Number(c.media_consumo || 0);
  if (valor > 0 && kwh > 0) {
    const ratio = valor / kwh;
    if (ratio < KWH_MIN_RATIO || ratio > KWH_MAX_RATIO) {
      const suggestion = Math.max(50, Math.min(3000, Math.round(valor / 1.0)));
      invalid.push({
        field: "consumo_vs_valor",
        label: "Consumo vs valor",
        reason: `R$ ${valor.toFixed(2)} ÷ ${kwh} kWh = R$ ${ratio.toFixed(2)}/kWh — fora da faixa esperada (~R$1/kWh). Confirme o consumo na conta.`,
        suggestion,
      });
    }
  }

  // 5) Mismatch de titularidade não confirmado bloqueia
  if (c.name_mismatch_flag && !c.name_mismatch_acknowledged_at) {
    invalid.push({
      field: "name_mismatch",
      label: "Titularidade",
      reason: "Nome do documento difere da conta — confirme a titularidade antes de enviar",
    });
  }

  const filledCount = PORTAL_FIELDS.length - missing.length;
  const pendingItems: PendingItem[] = [
    ...missing.map((f) => ({ kind: "missing" as const, field: f.key, label: f.label })),
    ...invalid.map((i) => ({ kind: "invalid" as const, field: String(i.field), label: i.label, reason: i.reason })),
  ];
  return {
    ok: missing.length === 0 && invalid.length === 0,
    missing,
    invalid,
    filledCount,
    totalFields: PORTAL_FIELDS.length,
    pendingItems,
  };
}
  return Math.max(50, Math.min(3000, Math.round(v / 1.0)));
}
