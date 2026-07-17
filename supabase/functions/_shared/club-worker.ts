/**
 * Dispatch do Worker Club — NÃO misturar com portal-worker.ts / portal2_*.
 *
 * Env / settings:
 *   club_worker_url | CLUB_WORKER_URL | WORKER_CLUB_URL
 *   club_worker_secret | CLUB_WORKER_SECRET | WORKER_CLUB_SECRET | WORKER_SECRET
 */
import { formatClubDob } from "./clubValidation.ts";
import { resolvePortalWhatsapp } from "./portal-phone.ts";

export interface ClubDispatchResult {
  ok: boolean;
  mode: "dispatched" | "not_configured" | "rejected";
  status?: number;
  error?: string;
  dryRun?: boolean;
  body?: unknown;
}

async function fetchWithTimeout(url: string, init: RequestInit & { timeout?: number } = {}) {
  const { timeout = 60_000, ...rest } = init;
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeout);
  try {
    return await fetch(url, { ...rest, signal: ctrl.signal });
  } finally {
    clearTimeout(id);
  }
}

export async function resolveClubWorker(supabase: any): Promise<{ url: string; secret: string } | null> {
  const { data: settingsRows } = await supabase.from("settings").select("*");
  const settings: Record<string, string> = {};
  settingsRows?.forEach((s: any) => {
    settings[s.key] = s.value;
  });

  const url = (
    settings.club_worker_url ||
    Deno.env.get("CLUB_WORKER_URL") ||
    Deno.env.get("WORKER_CLUB_URL") ||
    ""
  ).replace(/\/$/, "");

  const secret =
    settings.club_worker_secret ||
    Deno.env.get("CLUB_WORKER_SECRET") ||
    Deno.env.get("WORKER_CLUB_SECRET") ||
    settings.worker_secret ||
    Deno.env.get("WORKER_SECRET") ||
    "";

  if (!url || !secret) return null;
  return { url, secret };
}

/** Mesma regra do CRM: override > parceiro > consultor da página. */
export function resolveClubIdconsultor(customer: any): number | null {
  const overrideRaw = Number(customer?.portal_idconsultor_override || 0);
  if (Number.isFinite(overrideRaw) && overrideRaw > 0) return overrideRaw;

  const partner = customer?.referral_partners;
  const partnerIgreen = Number(partner?.partner_igreen_id || 0);
  const partnerCli = Number(partner?.cli || 0);
  const partnerId =
    Number.isFinite(partnerIgreen) && partnerIgreen > 0
      ? partnerIgreen
      : Number.isFinite(partnerCli) && partnerCli > 0
        ? partnerCli
        : 0;
  if (partnerId > 0) return partnerId;

  const dono = Number(customer?.consultants?.igreen_id || 0);
  if (Number.isFinite(dono) && dono > 0) return dono;
  return null;
}

export function buildClubDadosFromCustomer(customer: any, idconsultor: number) {
  const celular = resolvePortalWhatsapp(customer) || "";
  const dtnasc = formatClubDob(customer?.data_nascimento);
  return {
    idconsultor,
    cpf: String(customer?.cpf || "").replace(/\D/g, ""),
    nome: String(customer?.name || "").trim(),
    dtnasc: dtnasc || String(customer?.data_nascimento || "").trim(),
    rg: String(customer?.rg || "").trim(),
    email: String(customer?.email || "").trim(),
    celular: String(celular).replace(/\D/g, ""),
    cep: String(customer?.cep || "").replace(/\D/g, ""),
    endereco: String(customer?.address_street || "").trim(),
    numero: String(customer?.address_number || "").trim(),
    complemento: String(customer?.address_complement || "").trim(),
    bairro: String(customer?.address_neighborhood || "").trim(),
    cidade: String(customer?.address_city || "").trim(),
    uf: String(customer?.address_state || "").trim().toUpperCase(),
  };
}

/**
 * Envia lead ao Worker Club. Atualiza só club_* (o worker também grava).
 * dryRun default true (seguro). Live exige dryRun:false + ALLOW_LIVE no worker.
 */
export async function dispatchClubWorker(
  supabase: any,
  customerId: string,
  opts: { dryRun?: boolean } = {},
): Promise<ClubDispatchResult> {
  const dryRun = opts.dryRun !== false; // default true

  const resolved = await resolveClubWorker(supabase);
  if (!resolved) {
    console.warn("[club-worker] URL/secret ausentes");
    return { ok: false, mode: "not_configured", error: "Worker Club não configurado (club_worker_url)" };
  }

  const { data: customer, error } = await supabase
    .from("customers")
    .select(
      `id, name, cpf, rg, data_nascimento, email, cep,
       phone_whatsapp, portal2_celular_alt, phone_landline, phone_contact_confirmed,
       address_street, address_number, address_complement, address_neighborhood, address_city, address_state,
       portal_idconsultor_override, consultant_id,
       referral_partners:referral_partner_id(nome, cli, partner_igreen_id),
       consultants:consultant_id(igreen_id, name)`,
    )
    .eq("id", customerId)
    .maybeSingle();

  if (error || !customer) {
    return { ok: false, mode: "rejected", error: error?.message || "Cliente não encontrado" };
  }

  const idconsultor = resolveClubIdconsultor(customer);
  if (!idconsultor) {
    return { ok: false, mode: "rejected", error: "idconsultor ausente (consultor sem igreen_id)" };
  }

  const dados = buildClubDadosFromCustomer(customer, idconsultor);

  try {
    const res = await fetchWithTimeout(`${resolved.url}/submit-lead`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resolved.secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        customer_id: customerId,
        dryRun,
        dados,
      }),
      timeout: 90_000,
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (body as any)?.error || (body as any)?.message || `HTTP ${res.status}`;
      return { ok: false, mode: "rejected", status: res.status, error: String(msg), dryRun, body };
    }

    return { ok: true, mode: "dispatched", status: res.status, dryRun, body };
  } catch (e: any) {
    const msg = e?.name === "AbortError" ? "timeout" : e?.message || String(e);
    return { ok: false, mode: "rejected", error: msg, dryRun };
  }
}
