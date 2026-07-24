/**
 * Quem entra na discagem em massa “aprovados / licenciados na plataforma”.
 * Inclui telefone “não validado” (só exige dígitos suficientes para discar).
 */
import type { BulkContact } from "@/types/whatsapp";
import { normalizeBrazilPhone } from "@/lib/phone";
import type { VozCustomer } from "./VozContactPickerDialog";

const APPROVED_STATUS = new Set([
  "approved",
  "active",
  "registered_igreen",
  "complete",
  "data_complete",
]);

const ANDAMENTO_OK = new Set([
  "ativo",
  "aprovado",
  "validado",
  "licenciada",
  "licenciado",
]);

const POS_VENDA_OK = new Set(["aprovado", "d30", "d60", "d90", "d120", "d150", "d180", "d210"]);

function norm(s: string | null | undefined): string {
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

/** Cliente aprovado na carteira OU andamento licenciado/aprovado OU pós-venda aprovada. */
export function isApprovedOrLicensedCustomer(c: {
  status?: string | null;
  andamento_igreen?: string | null;
  pos_venda_stage?: string | null;
}): boolean {
  if (APPROVED_STATUS.has(norm(c.status))) return true;
  if (ANDAMENTO_OK.has(norm(c.andamento_igreen))) return true;
  if (POS_VENDA_OK.has(norm(c.pos_venda_stage))) return true;
  return false;
}

/**
 * Telefone discável (frouxo): aceita números “não validados” pelo WhatsApp,
 * desde que tenham dígitos. Bloqueia vazio / “sem_celular”.
 */
export function isDialablePhoneLoose(raw: string | null | undefined): boolean {
  if (!raw) return false;
  if (/sem_celular/i.test(raw)) return false;
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 8;
}

/** Normaliza para discagem; se falhar o normalizador BR, usa dígitos crus. */
export function phoneForDialLoose(raw: string | null | undefined): string | null {
  if (!isDialablePhoneLoose(raw)) return null;
  const normalized = normalizeBrazilPhone(String(raw));
  if (normalized) return normalized;
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length >= 10 && digits.length <= 11) return `55${digits}`;
  return digits.length >= 8 ? digits : null;
}

export function customersToDialContacts(list: VozCustomer[]): BulkContact[] {
  const seen = new Set<string>();
  const out: BulkContact[] = [];
  for (const c of list) {
    if (!isApprovedOrLicensedCustomer(c)) continue;
    const phone = phoneForDialLoose(c.phone_whatsapp);
    if (!phone) continue;
    const key = phone.replace(/\D/g, "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: c.id,
      name: c.name?.trim() || phone,
      phone,
      electricity_bill_value: c.electricity_bill_value ?? undefined,
      source: "database",
    });
  }
  return out;
}
