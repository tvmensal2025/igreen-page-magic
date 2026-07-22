/**
 * Resolução canônica do chat WhatsApp (JID / wa_id) — Whapi E Evolution.
 *
 * Problema BR: `phone_whatsapp` no CRM costuma ter o 9º dígito (55+DDD+9+8),
 * mas o WhatsApp de alguns leads está registrado SEM o 9. Enviar para o JID
 * "com 9" devolve HTTP 200 e fica `pending` / não entrega (Whapi e Baileys).
 *
 * Fontes da verdade (nessa ordem de tentativa):
 *   1. Cache `customers.whatsapp_chat_id`
 *   2. Memória (TTL 7d)
 *   3. Provider do canal atual:
 *      - Whapi:  POST /contacts (check phones) → wa_id
 *      - Evolution: POST /chat/whatsappNumbers/{instance} → jid
 *   4. Fallback cruzado (se o outro provider estiver configurado)
 *
 * SMS/voz NÃO usam isto — continuam com o número da operadora (com 9).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchWithTimeout, logStructured, TIMEOUT_WHAPI, TIMEOUT_EVOLUTION } from "./utils.ts";

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const memCache = new Map<string, { digits: string; status: "valid" | "invalid"; at: number }>();

export type ResolveWhatsAppChatIdResult =
  | {
    ok: true;
    /** JID completo `digits@s.whatsapp.net` */
    chatId: string;
    /** Só dígitos do wa_id */
    digits: string;
    source:
      | "customer_cache"
      | "memory_cache"
      | "whapi_check"
      | "evolution_check";
    changed: boolean;
  }
  | {
    ok: false;
    reason: "invalid_whatsapp" | "empty_phone" | "check_failed" | "no_provider";
    detail?: string;
  };

export type ResolveWhatsAppProvider =
  | { kind: "whapi"; apiToken: string; baseUrl?: string }
  | { kind: "evolution"; apiUrl: string; apiKey: string; instanceName: string };

export function digitsOnlyPhone(raw: string): string {
  let d = String(raw || "").replace(/\D/g, "").replace(/^0+/, "");
  if (d.includes("@")) d = d.split("@")[0].replace(/\D/g, "");
  return d;
}

/** Variantes BR com/sem 9º dígito para mandar no check. */
export function brazilWhatsAppPhoneVariants(raw: string): string[] {
  const d = digitsOnlyPhone(raw);
  if (!d) return [];
  const out = new Set<string>([d]);
  if (d.startsWith("55") && d.length === 13 && d[4] === "9") {
    out.add(`${d.slice(0, 4)}${d.slice(5)}`);
  }
  if (d.startsWith("55") && d.length === 12) {
    const local = d.slice(4);
    if (/^[6-9]/.test(local)) out.add(`${d.slice(0, 4)}9${local}`);
  }
  return [...out];
}

export function toWhatsAppChatId(digitsOrJid: string): string {
  const raw = String(digitsOrJid || "").trim();
  if (!raw) return raw;
  if (raw.includes("@")) return raw;
  const d = digitsOnlyPhone(raw);
  return d ? `${d}@s.whatsapp.net` : raw;
}

function waIdToDigits(waId: string): string {
  return digitsOnlyPhone(String(waId || "").split("@")[0] || "");
}

type CheckContactRow = {
  input?: string;
  status?: string;
  wa_id?: string;
};

type EvolutionNumberRow = {
  exists?: boolean;
  jid?: string;
  number?: string;
};

/** Extrai wa_id dígitos de uma resposta Whapi check phones (puro, testável). */
export function pickWaDigitsFromCheck(
  rows: CheckContactRow[],
  preferredInput: string,
): { digits: string; status: "valid" | "invalid" } | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const pref = digitsOnlyPhone(preferredInput);
  const valid = rows.filter((r) => String(r.status || "").toLowerCase() === "valid" && r.wa_id);
  const preferHit = valid.find((r) => digitsOnlyPhone(String(r.input || "")) === pref) || valid[0];
  if (preferHit?.wa_id) {
    const digits = waIdToDigits(preferHit.wa_id);
    if (digits) return { digits, status: "valid" };
  }
  const anyInvalid = rows.every((r) => String(r.status || "").toLowerCase() === "invalid");
  if (anyInvalid) return { digits: pref, status: "invalid" };
  return null;
}

/**
 * Extrai dígitos do JID real a partir de POST /chat/whatsappNumbers/{instance}.
 * Ex.: exists=true, jid="553499772215@s.whatsapp.net" (pode vir SEM o 9).
 */
export function pickWaDigitsFromEvolutionCheck(
  rows: EvolutionNumberRow[],
  preferredInput: string,
): { digits: string; status: "valid" | "invalid" } | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const pref = digitsOnlyPhone(preferredInput);
  const variants = new Set(brazilWhatsAppPhoneVariants(pref));
  const existing = rows.filter((r) => r.exists === true && (r.jid || r.number));
  const preferHit =
    existing.find((r) => variants.has(digitsOnlyPhone(String(r.number || "")))) ||
    existing.find((r) => variants.has(waIdToDigits(String(r.jid || "")))) ||
    existing[0];
  if (preferHit) {
    const digits = waIdToDigits(String(preferHit.jid || preferHit.number || ""));
    if (digits) return { digits, status: "valid" };
  }
  if (rows.length > 0 && rows.every((r) => r.exists === false)) {
    return { digits: pref, status: "invalid" };
  }
  return null;
}

async function checkPhonesWhapi(
  apiToken: string,
  baseUrl: string,
  contacts: string[],
): Promise<{ ok: true; rows: CheckContactRow[] } | { ok: false; detail: string }> {
  const url = `${baseUrl.replace(/\/$/, "")}/contacts`;
  try {
    const res = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        blocking: "wait",
        force_check: true,
        contacts,
      }),
      timeout: Math.max(TIMEOUT_WHAPI, 25_000),
    });
    const text = await res.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text.slice(0, 200) };
    }
    if (!res.ok) {
      return { ok: false, detail: `http_${res.status}:${String(text).slice(0, 160)}` };
    }
    const rows = Array.isArray(data?.contacts) ? data.contacts as CheckContactRow[] : [];
    return { ok: true, rows };
  } catch (e) {
    return { ok: false, detail: (e as Error)?.message || String(e) };
  }
}

async function checkPhonesEvolution(
  apiUrl: string,
  apiKey: string,
  instanceName: string,
  numbers: string[],
): Promise<{ ok: true; rows: EvolutionNumberRow[] } | { ok: false; detail: string }> {
  const url = `${apiUrl.replace(/\/$/, "")}/chat/whatsappNumbers/${encodeURIComponent(instanceName)}`;
  try {
    const res = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: apiKey,
      },
      body: JSON.stringify({ numbers }),
      timeout: Math.max(TIMEOUT_EVOLUTION, 20_000),
    });
    const text = await res.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text.slice(0, 200) };
    }
    if (!res.ok) {
      return { ok: false, detail: `http_${res.status}:${String(text).slice(0, 160)}` };
    }
    const rows = Array.isArray(data) ? data as EvolutionNumberRow[] : [];
    return { ok: true, rows };
  } catch (e) {
    return { ok: false, detail: (e as Error)?.message || String(e) };
  }
}

async function readCustomerCache(
  supabase: SupabaseClient,
  customerId: string,
): Promise<{ digits: string; checkedAt: number } | null> {
  try {
    const { data } = await supabase
      .from("customers")
      .select("whatsapp_chat_id, whatsapp_chat_id_checked_at")
      .eq("id", customerId)
      .maybeSingle();
    const digits = digitsOnlyPhone(String((data as any)?.whatsapp_chat_id || ""));
    if (!digits) return null;
    const checkedAt = Date.parse(String((data as any)?.whatsapp_chat_id_checked_at || "")) || 0;
    return { digits, checkedAt };
  } catch {
    return null;
  }
}

async function writeCustomerCache(
  supabase: SupabaseClient,
  customerId: string,
  digits: string,
): Promise<void> {
  try {
    await supabase
      .from("customers")
      .update({
        whatsapp_chat_id: digits,
        whatsapp_chat_id_checked_at: new Date().toISOString(),
      })
      .eq("id", customerId);
  } catch (_) {
    /* cache best-effort */
  }
}

function normalizeProviders(opts: {
  provider?: ResolveWhatsAppProvider;
  apiToken?: string;
  baseUrl?: string;
  fallbackProviders?: ResolveWhatsAppProvider[];
}): ResolveWhatsAppProvider[] {
  const out: ResolveWhatsAppProvider[] = [];
  if (opts.provider) out.push(opts.provider);
  else if (opts.apiToken) {
    out.push({ kind: "whapi", apiToken: opts.apiToken, baseUrl: opts.baseUrl });
  }
  for (const p of opts.fallbackProviders || []) {
    if (!out.some((x) => x.kind === p.kind)) out.push(p);
  }
  return out;
}

async function runProviderCheck(
  provider: ResolveWhatsAppProvider,
  variants: string[],
  inputDigits: string,
): Promise<
  | { ok: true; picked: { digits: string; status: "valid" | "invalid" }; source: "whapi_check" | "evolution_check" }
  | { ok: false; detail: string }
> {
  if (provider.kind === "whapi") {
    const checked = await checkPhonesWhapi(
      provider.apiToken,
      provider.baseUrl || "https://gate.whapi.cloud",
      variants,
    );
    if (!checked.ok) return { ok: false, detail: checked.detail };
    const picked = pickWaDigitsFromCheck(checked.rows, inputDigits);
    if (!picked) return { ok: false, detail: "whapi_empty_result" };
    return { ok: true, picked, source: "whapi_check" };
  }

  const checked = await checkPhonesEvolution(
    provider.apiUrl,
    provider.apiKey,
    provider.instanceName,
    variants,
  );
  if (!checked.ok) return { ok: false, detail: checked.detail };
  const picked = pickWaDigitsFromEvolutionCheck(checked.rows, inputDigits);
  if (!picked) return { ok: false, detail: "evolution_empty_result" };
  return { ok: true, picked, source: "evolution_check" };
}

/**
 * Resolve o JID real antes de qualquer send (Whapi ou Evolution).
 * - Cache customer fresco (com checked_at válido) → usa
 * - Senão check do provider (variantes com/sem 9)
 * - invalid → ok:false (não enviar → evita pending eterno)
 * - falha de API / sem provider → ok:false check_failed|no_provider (fail-closed)
 */
export async function resolveWhatsAppChatId(opts: {
  phoneOrJid: string;
  /** Preferido: provider explícito do canal que vai enviar. */
  provider?: ResolveWhatsAppProvider;
  /** Legacy Whapi-only (createWhapiSender). */
  apiToken?: string;
  baseUrl?: string;
  /** Tentativas extras (ex.: Whapi global quando o send é Evolution). */
  fallbackProviders?: ResolveWhatsAppProvider[];
  supabase?: SupabaseClient;
  customerId?: string | null;
  /** Ignora TTL e reconsulta. */
  forceCheck?: boolean;
}): Promise<ResolveWhatsAppChatIdResult> {
  const inputDigits = digitsOnlyPhone(opts.phoneOrJid);
  if (!inputDigits) return { ok: false, reason: "empty_phone" };

  const now = Date.now();
  const force = !!opts.forceCheck;

  if (!force && opts.supabase && opts.customerId) {
    const cached = await readCustomerCache(opts.supabase, opts.customerId);
    // checked_at nulo/0 = expirado (não congelar JID stale para sempre)
    if (cached && cached.checkedAt > 0 && now - cached.checkedAt < CACHE_TTL_MS) {
      return {
        ok: true,
        digits: cached.digits,
        chatId: toWhatsAppChatId(cached.digits),
        source: "customer_cache",
        changed: cached.digits !== inputDigits,
      };
    }
  }

  const mem = memCache.get(inputDigits);
  if (!force && mem && now - mem.at < CACHE_TTL_MS) {
    if (mem.status === "invalid") {
      return { ok: false, reason: "invalid_whatsapp", detail: "memory_cache" };
    }
    return {
      ok: true,
      digits: mem.digits,
      chatId: toWhatsAppChatId(mem.digits),
      source: "memory_cache",
      changed: mem.digits !== inputDigits,
    };
  }

  const providers = normalizeProviders(opts);
  if (providers.length === 0) {
    logStructured("warn", "wa_chat_id_no_provider", {
      phone_suffix: inputDigits.slice(-8),
    });
    return { ok: false, reason: "no_provider", detail: "no_whatsapp_check_provider" };
  }

  const variants = brazilWhatsAppPhoneVariants(inputDigits);
  let lastDetail = "";
  for (const provider of providers) {
    const checked = await runProviderCheck(provider, variants, inputDigits);
    if (!checked.ok) {
      lastDetail = checked.detail;
      logStructured("warn", "wa_chat_id_check_failed", {
        provider: provider.kind,
        phone_suffix: inputDigits.slice(-8),
        error: checked.detail,
      });
      continue;
    }

    if (checked.picked.status === "invalid") {
      memCache.set(inputDigits, { digits: inputDigits, status: "invalid", at: now });
      logStructured("warn", "wa_chat_id_invalid", {
        provider: provider.kind,
        phone_suffix: inputDigits.slice(-8),
        variants: variants.map((v) => v.slice(-8)),
      });
      return { ok: false, reason: "invalid_whatsapp", detail: `${provider.kind}_check_invalid` };
    }

    memCache.set(inputDigits, { digits: checked.picked.digits, status: "valid", at: now });
    memCache.set(checked.picked.digits, { digits: checked.picked.digits, status: "valid", at: now });

    if (opts.supabase && opts.customerId) {
      await writeCustomerCache(opts.supabase, opts.customerId, checked.picked.digits);
    }

    const changed = checked.picked.digits !== inputDigits;
    if (changed) {
      logStructured("info", "wa_chat_id_rewritten", {
        provider: provider.kind,
        from_suffix: inputDigits.slice(-8),
        to_suffix: checked.picked.digits.slice(-8),
        customer_id: opts.customerId || undefined,
      });
    }

    return {
      ok: true,
      digits: checked.picked.digits,
      chatId: toWhatsAppChatId(checked.picked.digits),
      source: checked.source,
      changed,
    };
  }

  logStructured("warn", "wa_chat_id_all_providers_failed", {
    phone_suffix: inputDigits.slice(-8),
    error: lastDetail,
  });
  return {
    ok: false,
    reason: "check_failed",
    detail: lastDetail || "all_providers_failed",
  };
}

/** Helper síncrono só para testes / limpar cache entre casos. */
export function _clearWhatsAppChatIdMemoryCacheForTests(): void {
  memCache.clear();
}
