/**
 * Espelho de src/lib/captacao/clubValidation.ts — usado por finalize-club.
 * Se mudar um, mude o outro.
 */
import { resolvePortalWhatsapp } from "./portal-phone.ts";

export type ClubFieldKey =
  | "name"
  | "cpf"
  | "data_nascimento"
  | "rg"
  | "phone_whatsapp"
  | "email"
  | "cep"
  | "address_street"
  | "address_number"
  | "address_neighborhood"
  | "address_city"
  | "address_state"
  | "address_complement";

export interface ClubFieldDef {
  key: ClubFieldKey;
  label: string;
  group: "id" | "contato" | "endereco";
  required: boolean;
}

export interface ClubCustomer {
  name?: string | null;
  cpf?: string | null;
  data_nascimento?: string | null;
  rg?: string | null;
  phone_whatsapp?: string | null;
  portal2_celular_alt?: string | null;
  phone_landline?: string | null;
  phone_contact_confirmed?: boolean | null;
  email?: string | null;
  cep?: string | null;
  address_street?: string | null;
  address_number?: string | null;
  address_complement?: string | null;
  address_neighborhood?: string | null;
  address_city?: string | null;
  address_state?: string | null;
}

export interface ClubPendingItem {
  kind: "missing" | "invalid";
  field: string;
  label: string;
  reason?: string;
}

export interface ClubValidationResult {
  ok: boolean;
  missing: ClubFieldDef[];
  invalid: Array<{ field: ClubFieldKey; label: string; reason: string }>;
  filledCount: number;
  totalFields: number;
  pendingItems: ClubPendingItem[];
}

export const CLUB_FIELDS: ClubFieldDef[] = [
  { key: "name", label: "Nome completo", group: "id", required: true },
  { key: "cpf", label: "CPF", group: "id", required: true },
  { key: "data_nascimento", label: "Nascimento", group: "id", required: true },
  { key: "rg", label: "RG", group: "id", required: true },
  { key: "phone_whatsapp", label: "Celular", group: "contato", required: true },
  { key: "email", label: "E-mail", group: "contato", required: true },
  { key: "cep", label: "CEP", group: "endereco", required: true },
  { key: "address_number", label: "Número", group: "endereco", required: true },
  { key: "address_street", label: "Rua", group: "endereco", required: true },
  { key: "address_neighborhood", label: "Bairro", group: "endereco", required: true },
  { key: "address_city", label: "Cidade", group: "endereco", required: true },
  { key: "address_state", label: "UF", group: "endereco", required: true },
  { key: "address_complement", label: "Complemento", group: "endereco", required: false },
];

export const CLUB_REQUIRED_FIELDS = CLUB_FIELDS.filter((f) => f.required);

function isStrFilled(v: unknown): boolean {
  return v !== null && v !== undefined && typeof v === "string" && v.trim().length > 0;
}

function digits(v: unknown): string {
  return String(v ?? "").replace(/\D/g, "");
}

function cpfValid(raw: string): boolean {
  const cpf = digits(raw);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(cpf[i], 10) * (10 - i);
  let r = (sum * 10) % 11;
  if (r === 10) r = 0;
  if (r !== parseInt(cpf[9], 10)) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(cpf[i], 10) * (11 - i);
  r = (sum * 10) % 11;
  if (r === 10) r = 0;
  return r === parseInt(cpf[10], 10);
}

function parseDob(raw: string): Date | null {
  const s = String(raw || "").trim();
  let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) {
    const d = new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00`);
    return isNaN(d.getTime()) ? null : d;
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00`);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function formatClubDob(raw: string | null | undefined): string | null {
  const d = parseDob(String(raw || ""));
  if (!d) return null;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export function validateForClub(c: ClubCustomer | null | undefined): ClubValidationResult {
  const required = CLUB_REQUIRED_FIELDS;
  const totalFields = required.length;

  if (!c) {
    return {
      ok: false,
      missing: [...required],
      invalid: [],
      filledCount: 0,
      totalFields,
      pendingItems: required.map((f) => ({ kind: "missing" as const, field: f.key, label: f.label })),
    };
  }

  const missing: ClubFieldDef[] = [];
  const invalid: Array<{ field: ClubFieldKey; label: string; reason: string }> = [];

  for (const f of required) {
    if (f.key === "phone_whatsapp") {
      if (!resolvePortalWhatsapp(c)) missing.push(f);
      continue;
    }
    const v = (c as Record<string, unknown>)[f.key];
    if (!isStrFilled(v)) missing.push(f);
  }

  if (isStrFilled(c.name)) {
    const n = c.name!.trim();
    if (n.length < 5 || n.split(/\s+/).length < 2) {
      invalid.push({ field: "name", label: "Nome completo", reason: "Nome completo (mín. 2 palavras)" });
    }
  }
  if (isStrFilled(c.cpf) && !cpfValid(c.cpf!)) {
    invalid.push({ field: "cpf", label: "CPF", reason: "CPF inválido" });
  }
  if (isStrFilled(c.data_nascimento)) {
    const d = parseDob(c.data_nascimento!);
    if (!d) {
      invalid.push({ field: "data_nascimento", label: "Nascimento", reason: "Formato DD/MM/AAAA ou AAAA-MM-DD" });
    } else {
      const age = (Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000);
      if (age < 18 || age > 100) {
        invalid.push({
          field: "data_nascimento",
          label: "Nascimento",
          reason: `Idade ${Math.floor(age)} fora da faixa 18–100`,
        });
      }
    }
  }
  if (isStrFilled(c.rg) && String(c.rg).trim().length < 5) {
    invalid.push({ field: "rg", label: "RG", reason: "RG precisa ter ao menos 5 caracteres" });
  }
  {
    const portalPhone = resolvePortalWhatsapp(c);
    if (portalPhone) {
      const ph = digits(portalPhone).replace(/^55/, "");
      if (ph.length < 10 || ph.length > 11) {
        invalid.push({ field: "phone_whatsapp", label: "Celular", reason: "DDD + 8/9 dígitos" });
      }
    }
  }
  if (isStrFilled(c.email) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email!.trim())) {
    invalid.push({ field: "email", label: "E-mail", reason: "E-mail inválido" });
    const emailField = required.find((f) => f.key === "email");
    if (emailField && !missing.includes(emailField)) missing.push(emailField);
  }
  if (isStrFilled(c.cep) && digits(c.cep).length !== 8) {
    invalid.push({ field: "cep", label: "CEP", reason: "CEP precisa de 8 dígitos" });
  }
  if (isStrFilled(c.address_state) && c.address_state!.trim().length !== 2) {
    invalid.push({ field: "address_state", label: "UF", reason: "UF com 2 letras (ex: SP)" });
  }

  const pendingItems: ClubPendingItem[] = [
    ...missing.map((f) => ({ kind: "missing" as const, field: f.key, label: f.label })),
    ...invalid.map((i) => ({
      kind: "invalid" as const,
      field: i.field,
      label: i.label,
      reason: i.reason,
    })),
  ];

  return {
    ok: missing.length === 0 && invalid.length === 0,
    missing,
    invalid,
    filledCount: Math.max(0, totalFields - missing.length),
    totalFields,
    pendingItems,
  };
}
