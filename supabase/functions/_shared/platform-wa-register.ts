/**
 * Registro de número WhatsApp Cloud API na WABA da Página da plataforma.
 * Usado pela edge facebook-platform-wa-register (SuperAdmin).
 */
import { adminClient } from "./fb-graph.ts";
import { decryptToken } from "./fb-crypto.ts";

const FB_VERSION = "v21.0";
const FB_GRAPH = `https://graph.facebook.com/${FB_VERSION}`;

export type PlatformWaPhone = {
  id: string;
  display: string;
  digits: string;
  verified_name?: string;
  quality?: string;
  code_verification_status?: string;
};

export function digitsOf(s: string | null | undefined): string {
  return String(s || "").replace(/\D/g, "");
}

/** Normaliza para E.164 BR sem +: 55 + DDD + número (10–11 nacionais). */
export function normalizeBrWaDigits(raw: string): { ok: true; digits: string; national: string } | { ok: false; error: string } {
  let d = digitsOf(raw);
  if (!d) return { ok: false, error: "Informe o número com DDD." };
  if (d.startsWith("55") && d.length >= 12) {
    // ok
  } else if (d.length === 10 || d.length === 11) {
    d = `55${d}`;
  } else {
    return { ok: false, error: "Use 55 + DDD + número (12–13 dígitos)." };
  }
  if (d.length < 12 || d.length > 13) {
    return { ok: false, error: "Número BR inválido (espere 12–13 dígitos com 55)." };
  }
  const national = d.slice(2);
  return { ok: true, digits: d, national };
}

export function translateMetaWaError(body: unknown, fallback: string): string {
  const j = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const err = (j.error && typeof j.error === "object" ? j.error : j) as Record<string, unknown>;
  const msg = String(err.message || err.error_user_msg || fallback);
  const code = Number(err.code || 0);
  const sub = Number(err.error_subcode || 0);
  const lower = msg.toLowerCase();

  if (lower.includes("permission") || code === 200 || code === 10) {
    return "Token sem permissão WhatsApp Business Management. Reconecte a conta Facebook da plataforma aceitando essa permissão.";
  }
  // Erro genérico da Meta ao POST /{waba}/phone_numbers — SMS não sai.
  if (
    lower.includes("cannot add phone") ||
    lower.includes("cannot add phone number") ||
    code === 200000 ||
    sub === 2388002 ||
    sub === 2388107 ||
    sub === 3095008
  ) {
    if (sub === 2388107 || lower.includes("restriction") || lower.includes("address any restriction")) {
      return "A Meta bloqueou esta WABA/número (restrição na conta). Abra o Business Support Home da Meta, resolva o alerta e tente de novo — sem isso o SMS não é enviado.";
    }
    return "A Meta recusou incluir este número na conta WhatsApp da Página (código 200000). Causas típicas: número ainda no WhatsApp pessoal, restrição na WABA, ou a Página sem WABA Cloud vinculada. Abra o WhatsApp Manager / Business Support Home. SMS só sai depois que ela aceitar.";
  }
  if (lower.includes("already") && (lower.includes("phone") || lower.includes("number") || lower.includes("exist"))) {
    return "Este número já está em uma conta WhatsApp. Desconecte do app pessoal/Business ou use migração na Meta antes de cadastrar.";
  }
  if (
    lower.includes("(#100)") ||
    lower.includes("invalid parameter") ||
    lower.includes("unsupported post request") ||
    code === 100
  ) {
    return "A Meta rejeitou este número (parâmetro inválido). Confira se é WhatsApp Business e se o DDD/número estão certos.";
  }
  if (lower.includes("certificate") || lower.includes("display name") || lower.includes("verified_name")) {
    return "Nome verificado rejeitado pela Meta. Use um nome simples (ex.: iGreen Energy) e tente de novo.";
  }
  if (lower.includes("blocked") || lower.includes("restricted")) {
    return "Este número está bloqueado ou restrito na Meta. Use outro chip Business.";
  }
  if (lower.includes("rate") || code === 4 || code === 17 || code === 80007 || code === 80008 || sub === 133016) {
    return "A Meta limitou as chamadas desta conta WhatsApp (rate limit). Aguarde 10–30 minutos e tente de novo — sem isso o SMS não sai. Evite clicar várias vezes seguidas.";
  }
  if (lower.includes("limit") || lower.includes("maximum") || sub === 2388103) {
    return "Limite de números na WABA da Página atingido (Meta). Peça ao Rafael/suporte para liberar mais slots — sem isso o SMS não sai.";
  }
  if (lower.includes("invalid code") || lower.includes("verification") || code === 136025 || sub === 133005) {
    return "Código SMS inválido ou expirado. Peça um novo código e tente de novo.";
  }
  if (lower.includes("pin") || sub === 133005) {
    return "PIN de verificação em duas etapas inválido. Tente novamente.";
  }
  if (lower.includes("page") && lower.includes("whatsapp")) {
    return "A Página não tem WABA Cloud API vinculada. Vincule uma WABA Cloud à Página uma vez no Business Suite.";
  }
  if (lower.includes("limit") && (lower.includes("phone") || lower.includes("number"))) {
    return "Limite de números na WABA atingido (Meta). Peça ao suporte para liberar mais slots ou use um número já cadastrado.";
  }
  // Meta às vezes devolve inglês cru — não vaza pro consultor.
  if (/\b(the|and|please|unable|failed|invalid|permission|error)\b/i.test(msg) && !/[áàâãéêíóôõúç]/i.test(msg)) {
    return fallback;
  }
  return msg.slice(0, 400) || fallback;
}

async function graphGet(path: string, token: string): Promise<{ ok: boolean; status: number; body: any }> {
  const sep = path.includes("?") ? "&" : "?";
  const r = await fetch(`${FB_GRAPH}${path}${sep}access_token=${encodeURIComponent(token)}`);
  const body = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body };
}

/** Graph clássico (form + access_token no body) — ok para POST /{waba}/phone_numbers. */
async function graphPostForm(
  path: string,
  token: string,
  params: Record<string, string>,
): Promise<{ ok: boolean; status: number; body: any }> {
  const body = new URLSearchParams({ ...params, access_token: token });
  const r = await fetch(`${FB_GRAPH}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body: json };
}

/**
 * WhatsApp Cloud API (request_code / verify_code / register) — Meta recomenda
 * Bearer + JSON. Form-urlencoded costuma falhar nesses endpoints.
 */
async function graphPostJson(
  path: string,
  token: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; body: any }> {
  const r = await fetch(`${FB_GRAPH}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const json = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body: json };
}

export async function discoverPlatformWabaId(
  pageId: string,
  token: string,
  opts?: { preferredWabaId?: string | null; knownPhoneNumberId?: string | null },
): Promise<{ id: string; via: string; probe_error?: string } | null> {
  const preferred = String(opts?.preferredWabaId || "").replace(/\D/g, "");
  if (preferred) {
    // NÃO probe Graph aqui: cada status/create do modal estourava #80008.
    // A WABA gravada no banco (SuperAdmin) é a fonte da verdade.
    return { id: preferred, via: "platform.waba_id" };
  }

  const tries: Array<{ label: string; field: string }> = [
    { label: "page.whatsapp_business_account", field: "whatsapp_business_account" },
    { label: "page.connected_whatsapp_business_account", field: "connected_whatsapp_business_account" },
  ];
  // page_backed = WhatsApp App (não Cloud) — não serve para POST /phone_numbers
  for (const t of tries) {
    const r = await graphGet(`/${pageId}?fields=${t.field}`, token);
    if (r.ok) {
      const id = r.body?.[t.field]?.id;
      if (id) return { id: String(id), via: t.label };
    }
  }

  // Fallback: owned/client WABAs do Business (modelo SuperAdmin: uma WABA pra todas as campanhas).
  const me = await graphGet(`/me/businesses?fields=id,name`, token);
  if (!me.ok) {
    console.warn("[platform-wa] me/businesses failed", me.status, me.body?.error?.message);
  }
  const businesses = Array.isArray(me.body?.data) ? me.body.data : [];
  const candidates: Array<{ id: string; via: string; phoneCount: number }> = [];
  for (const b of businesses) {
    const bid = String(b?.id || "");
    if (!bid) continue;
    for (const kind of ["owned_whatsapp_business_accounts", "client_whatsapp_business_accounts"]) {
      const wr = await graphGet(`/${bid}/${kind}?fields=id,name`, token);
      const rows = Array.isArray(wr.body?.data) ? wr.body.data : [];
      for (const row of rows) {
        const wid = String(row?.id || "");
        if (!wid) continue;
        const phones = await graphGet(`/${wid}/phone_numbers?fields=id&limit=5`, token);
        const phoneCount = Array.isArray(phones.body?.data) ? phones.body.data.length : 0;
        if (phones.ok) {
          candidates.push({ id: wid, via: `business.${kind}`, phoneCount });
        }
      }
    }
  }
  // Prefere WABA que já tem número (a da plataforma em uso).
  candidates.sort((a, b) => b.phoneCount - a.phoneCount);
  if (candidates[0]?.id) {
    return { id: candidates[0].id, via: candidates[0].via };
  }

  // Último recurso: achar WABA a partir de um phone_number_id já salvo (probe nas WABAs).
  const knownPhone = String(opts?.knownPhoneNumberId || "").replace(/\D/g, "");
  if (knownPhone && businesses.length) {
    for (const b of businesses) {
      const bid = String(b?.id || "");
      if (!bid) continue;
      for (const kind of ["owned_whatsapp_business_accounts", "client_whatsapp_business_accounts"]) {
        const wr = await graphGet(`/${bid}/${kind}?fields=id`, token);
        for (const row of (Array.isArray(wr.body?.data) ? wr.body.data : [])) {
          const wid = String(row?.id || "");
          if (!wid) continue;
          const phones = await graphGet(
            `/${wid}/phone_numbers?fields=id&limit=50`,
            token,
          );
          const hit = (Array.isArray(phones.body?.data) ? phones.body.data : []).some(
            (p: { id?: string }) => String(p?.id || "") === knownPhone,
          );
          if (hit) return { id: wid, via: "phone_number_id_probe" };
        }
      }
    }
  }

  return null;
}

export async function listWabaPhones(wabaId: string, token: string): Promise<PlatformWaPhone[]> {
  const r = await graphGet(
    `/${wabaId}/phone_numbers?fields=display_phone_number,verified_name,quality_rating,code_verification_status`,
    token,
  );
  if (!r.ok) {
    const msg = String(r.body?.error?.message || "");
    if (/80008|too many calls|request limit/i.test(msg)) {
      console.warn("[platform-wa] list phones rate-limited", wabaId, msg);
    }
    return [];
  }
  return (r.body?.data || []).map((n: any) => ({
    id: String(n.id),
    display: String(n.display_phone_number || ""),
    digits: digitsOf(n.display_phone_number),
    verified_name: n.verified_name,
    quality: n.quality_rating,
    code_verification_status: n.code_verification_status,
  })).filter((n: PlatformWaPhone) => n.id && n.digits);
}

export async function loadPlatformTokenAndPage(): Promise<
  | { ok: true; token: string; pageId: string; pageName: string | null; pixelId: string | null; row: Record<string, unknown> }
  | { ok: false; error: string; status: number }
> {
  const admin = adminClient();
  const { data } = await admin
    .from("platform_facebook_account")
    .select("*")
    .eq("id", true)
    .maybeSingle();
  if (!data?.access_token_encrypted) {
    return { ok: false, error: "Conta Facebook da plataforma não configurada.", status: 400 };
  }
  if (!data.page_id) {
    return { ok: false, error: "Defina a Página principal da plataforma antes de implantar o WhatsApp.", status: 400 };
  }
  let token: string;
  try {
    token = await decryptToken(data.access_token_encrypted);
  } catch {
    return { ok: false, error: "Falha ao ler o token da plataforma. Reconecte o Facebook.", status: 400 };
  }
  return {
    ok: true,
    token,
    pageId: String(data.page_id),
    pageName: data.page_name ? String(data.page_name) : null,
    pixelId: data.pixel_id ? String(data.pixel_id) : null,
    row: data as Record<string, unknown>,
  };
}

export async function createWabaPhoneNumber(opts: {
  wabaId: string;
  token: string;
  national: string;
  verifiedName: string;
}): Promise<{ ok: true; phone_number_id: string } | { ok: false; error: string; meta?: unknown }> {
  const r = await graphPostForm(`/${opts.wabaId}/phone_numbers`, opts.token, {
    cc: "55",
    phone_number: opts.national,
    verified_name: opts.verifiedName.slice(0, 100),
  });
  if (!r.ok || !r.body?.id) {
    console.error("[platform-wa] create phone failed", JSON.stringify({
      status: r.status,
      code: r.body?.error?.code,
      subcode: r.body?.error?.error_subcode,
      message: r.body?.error?.message,
      user_msg: r.body?.error?.error_user_msg,
      user_title: r.body?.error?.error_user_title,
    })?.slice(0, 800));
    return {
      ok: false,
      error: translateMetaWaError(r.body, "A Meta recusou cadastrar este número na Página. O SMS só é enviado depois que o número for aceito."),
      meta: r.body,
    };
  }
  return { ok: true, phone_number_id: String(r.body.id) };
}

export async function requestWaVerificationCode(opts: {
  phoneNumberId: string;
  token: string;
  method?: "SMS" | "VOICE";
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const method = opts.method || "SMS";
  // Docs Meta: POST /{phone-number-id}/request_code com code_method + language
  const r = await graphPostJson(`/${opts.phoneNumberId}/request_code`, opts.token, {
    code_method: method,
    language: "pt_BR",
  });
  if (!r.ok) {
    // Fallback form (algumas apps Graph aceitam)
    const r2 = await graphPostForm(`/${opts.phoneNumberId}/request_code`, opts.token, {
      code_method: method,
      language: "pt_BR",
    });
    if (!r2.ok) {
      return { ok: false, error: translateMetaWaError(r.body?.error ? r.body : r2.body, "Falha ao pedir código SMS.") };
    }
  }
  return { ok: true };
}

export async function verifyWaCode(opts: {
  phoneNumberId: string;
  token: string;
  code: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const code = opts.code.replace(/\D/g, "");
  const r = await graphPostJson(`/${opts.phoneNumberId}/verify_code`, opts.token, { code });
  if (!r.ok) {
    const r2 = await graphPostForm(`/${opts.phoneNumberId}/verify_code`, opts.token, { code });
    if (!r2.ok) {
      return { ok: false, error: translateMetaWaError(r.body?.error ? r.body : r2.body, "Código SMS inválido.") };
    }
  }
  return { ok: true };
}

export async function registerWaPhone(opts: {
  phoneNumberId: string;
  token: string;
  pin: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const pin = opts.pin.replace(/\D/g, "").slice(0, 6);
  const payload = { messaging_product: "whatsapp", pin };
  const r = await graphPostJson(`/${opts.phoneNumberId}/register`, opts.token, payload);
  if (!r.ok) {
    const raw = JSON.stringify(r.body || {}).toLowerCase();
    if (raw.includes("already") || raw.includes("registered")) {
      return { ok: true };
    }
    const r2 = await graphPostForm(`/${opts.phoneNumberId}/register`, opts.token, {
      messaging_product: "whatsapp",
      pin,
    });
    if (!r2.ok) {
      const raw2 = JSON.stringify(r2.body || {}).toLowerCase();
      if (raw2.includes("already") || raw2.includes("registered")) {
        return { ok: true };
      }
      return { ok: false, error: translateMetaWaError(r.body?.error ? r.body : r2.body, "Falha ao registrar número na Cloud API.") };
    }
  }
  return { ok: true };
}

export function generateTwoStepPin(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function savePlatformOfficialWa(opts: {
  wabaId: string;
  phoneNumberId: string;
  digits: string;
  display: string;
}): Promise<void> {
  const admin = adminClient();
  await admin.from("platform_facebook_account").update({
    waba_id: opts.wabaId,
    whatsapp_phone_number_id: opts.phoneNumberId,
    whatsapp_destination_number: opts.digits,
    whatsapp_phone_number_display: opts.display,
    whatsapp_registered_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", true);
}

/** Grava o destino CTWA do consultor (fonte usada na publicação de campanha). */
export async function saveConsultantWa(opts: {
  consultantId: string;
  wabaId: string;
  phoneNumberId: string;
  digits: string;
}): Promise<void> {
  const admin = adminClient();
  const now = new Date().toISOString();
  await admin.from("consultant_ad_settings").upsert(
    {
      consultant_id: opts.consultantId,
      whatsapp_destination_number: opts.digits,
      whatsapp_phone_number_id: opts.phoneNumberId,
      whatsapp_last_verified_at: now,
      updated_at: now,
    },
    { onConflict: "consultant_id" },
  );
  // Mantém waba_id na plataforma se ainda estiver vazio (descoberta).
  const { data: plat } = await admin
    .from("platform_facebook_account")
    .select("waba_id, whatsapp_phone_number_id")
    .eq("id", true)
    .maybeSingle();
  if (plat && !plat.waba_id) {
    await admin.from("platform_facebook_account").update({
      waba_id: opts.wabaId,
      updated_at: now,
    }).eq("id", true);
  }
}

export async function loadConsultantWaLock(consultantId: string): Promise<{
  locked: boolean;
  digits: string | null;
  phone_number_id: string | null;
}> {
  const admin = adminClient();
  const { data } = await admin
    .from("consultant_ad_settings")
    .select("whatsapp_destination_number, whatsapp_phone_number_id")
    .eq("consultant_id", consultantId)
    .maybeSingle();
  const phoneId = data?.whatsapp_phone_number_id
    ? String(data.whatsapp_phone_number_id).replace(/\D/g, "")
    : "";
  const digits = data?.whatsapp_destination_number
    ? String(data.whatsapp_destination_number).replace(/\D/g, "")
    : null;
  return {
    locked: Boolean(phoneId && /^\d+$/.test(phoneId)),
    digits,
    phone_number_id: phoneId || null,
  };
}

export async function assertSuperAdmin(userId: string): Promise<boolean> {
  const admin = adminClient();
  const { data: roleRow } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .in("role", ["admin", "super_admin"])
    .maybeSingle();
  if (roleRow) return true;
  try {
    const { data: isSuper } = await admin.rpc("is_super_admin", { _user_id: userId });
    if (isSuper === true) return true;
  } catch { /* ignore */ }
  return false;
}
