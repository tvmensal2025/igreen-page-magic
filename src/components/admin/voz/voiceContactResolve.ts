/**
 * Resolve nome do contato a partir do telefone (base do consultor).
 */
import { normalizeBrazilPhone } from "@/lib/phone";
import type { VozCustomer } from "./VozContactPickerDialog";

function digitsOnly(raw: string | null | undefined): string {
  return String(raw || "").replace(/\D/g, "");
}

/** Compara E.164 BR / local com flexibilidade no final (10–13 dígitos). */
export function phonesMatch(a: string, b: string): boolean {
  const da = digitsOnly(a);
  const db = digitsOnly(b);
  if (!da || !db) return false;
  if (da === db) return true;
  const ta = da.startsWith("55") && da.length >= 12 ? da.slice(2) : da;
  const tb = db.startsWith("55") && db.length >= 12 ? db.slice(2) : db;
  if (ta === tb) return true;
  const min = Math.min(ta.length, tb.length);
  if (min >= 10 && (ta.endsWith(tb) || tb.endsWith(ta))) return true;
  return false;
}

export function resolveCustomerByPhone(
  phone: string,
  customers: VozCustomer[],
): VozCustomer | null {
  const normalized = normalizeBrazilPhone(phone) || digitsOnly(phone);
  if (!normalized || normalized.length < 10) return null;
  return (
    customers.find((c) => phonesMatch(c.phone_whatsapp, normalized)) ?? null
  );
}

export function resolveNameByPhone(
  phone: string,
  customers: VozCustomer[],
): string | null {
  const c = resolveCustomerByPhone(phone, customers);
  const name = String(c?.name || "").trim();
  return name || null;
}

export function firstName(name: string | null | undefined): string {
  const n = String(name || "").trim();
  if (!n) return "";
  return n.split(/\s+/)[0] || "";
}
