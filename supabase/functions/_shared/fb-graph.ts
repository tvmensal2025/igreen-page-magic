// Helpers compartilhados pra Marketing API + decrypt de token + load da conexão.
import {
  createClient,
  SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { decryptToken } from "./fb-crypto.ts";

export const FB_VERSION = "v21.0";
export const FB_GRAPH = `https://graph.facebook.com/${FB_VERSION}`;

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

export function adminClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

export async function authConsultant(
  req: Request,
): Promise<{ id: string; supabase: SupabaseClient } | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const token = authHeader.replace("Bearer ", "");
  // Tenta primeiro getClaims (mais resiliente com signing keys); fallback para getUser.
  try {
    // @ts-ignore - getClaims existe em versões recentes
    if (typeof supabase.auth.getClaims === "function") {
      // @ts-ignore
      const { data, error } = await supabase.auth.getClaims(token);
      const sub = (data as any)?.claims?.sub;
      if (!error && sub) return { id: sub, supabase };
    }
  } catch (_) { /* fallback */ }
  const { data } = await supabase.auth.getUser();
  if (!data?.user?.id) return null;
  return { id: data.user.id, supabase };
}

export async function loadConnection(consultantId: string): Promise<
  {
    token: string;
    ad_account_id: string;
    page_id: string;
    pixel_id: string | null;
    ig_account_id: string | null;
    whatsapp_phone_number_id: string | null;
    whatsapp_destination_number: string | null;
  } | null
> {
  const admin = adminClient();
  const { data } = await admin.from("facebook_connections").select("*").eq(
    "consultant_id",
    consultantId,
  ).maybeSingle();
  if (data && data.access_token_encrypted) {
    const token = await decryptToken(data.access_token_encrypted);
    return {
      token,
      ad_account_id: data.ad_account_id,
      page_id: data.page_id,
      pixel_id: data.pixel_id,
      ig_account_id: data.ig_account_id,
      whatsapp_phone_number_id: data.whatsapp_phone_number_id,
      whatsapp_destination_number: data.whatsapp_destination_number ?? null,
    };
  }
  // Fallback: usa a conta da plataforma (compartilhada) + número WA do consultor.
  const platform = await loadPlatformAccount();
  if (!platform) return null;
  const settings = await loadConsultantAdSettings(consultantId);
  return {
    token: platform.token,
    ad_account_id: platform.ad_account_id,
    page_id: platform.page_id,
    pixel_id: platform.pixel_id,
    ig_account_id: platform.ig_account_id,
    whatsapp_phone_number_id: null,
    whatsapp_destination_number: settings?.whatsapp_destination_number ?? null,
  };
}

/**
 * Carrega a conta Facebook ÚNICA da plataforma (admin), compartilhada por todos os consultores.
 * Substitui loadConnection() para fluxos de criação/sync de campanha.
 */
export async function loadPlatformAccount(): Promise<
  {
    token: string;
    ad_account_id: string;
    page_id: string;
    pixel_id: string | null;
    ig_account_id: string | null;
    business_id: string | null;
    token_expires_at: string | null;
  } | null
> {
  const admin = adminClient();
  const { data } = await admin.from("platform_facebook_account").select("*").eq(
    "id",
    true,
  ).maybeSingle();
  if (!data || !data.access_token_encrypted) return null;
  const token = await decryptToken(data.access_token_encrypted);
  return {
    token,
    ad_account_id: data.ad_account_id,
    page_id: data.page_id,
    pixel_id: data.pixel_id ?? null,
    ig_account_id: data.ig_account_id ?? null,
    business_id: data.business_id ?? null,
    token_expires_at: data.token_expires_at ?? null,
  };
}

/**
 * Carrega as configurações de ads do consultor (telefone WhatsApp + cidades).
 * Fallback: tenta pegar telefone da whatsapp_instances se não tiver setting.
 */
export async function loadConsultantAdSettings(consultantId: string): Promise<
  {
    whatsapp_destination_number: string | null;
    cities: { key: string; name: string }[];
    distribuidora_default: string | null;
    display_name: string | null;
    age_min: number;
    age_max: number;
  } | null
> {
  const admin = adminClient();
  const { data } = await admin.from("consultant_ad_settings").select("*").eq(
    "consultant_id",
    consultantId,
  ).maybeSingle();
  let phone = data?.whatsapp_destination_number ?? null;
  if (!phone) {
    const { data: inst } = await admin
      .from("whatsapp_instances")
      .select("connected_phone")
      .eq("consultant_id", consultantId)
      .not("connected_phone", "is", null)
      .limit(1)
      .maybeSingle();
    phone = (inst as any)?.connected_phone ?? null;
  }
  if (!phone) {
    const { data: c } = await admin
      .from("consultants")
      .select("phone")
      .eq("id", consultantId)
      .maybeSingle();
    phone = (c as any)?.phone ?? null;
  }
  // Normaliza apenas dígitos
  if (phone) phone = String(phone).replace(/\D/g, "") || null;
  // Auto-provision: persiste o resolvido em consultant_ad_settings pra próximas execuções
  if (phone && !data?.whatsapp_destination_number) {
    await admin.from("consultant_ad_settings").upsert(
      { consultant_id: consultantId, whatsapp_destination_number: phone },
      { onConflict: "consultant_id" },
    );
  }
  return {
    whatsapp_destination_number: phone,
    cities: (data?.cities as any) || [],
    distribuidora_default: data?.distribuidora_default ?? null,
    display_name: data?.display_name ?? null,
    age_min: data?.age_min ?? 30,
    age_max: data?.age_max ?? 60,
  };
}

/**
 * Conexão usada por campanhas e métricas: sempre usa a conta principal da
 * plataforma, mesmo quando o consultor tem uma conexão Facebook pessoal parcial.
 */
export async function loadCampaignConnection(consultantId: string): Promise<
  {
    token: string;
    ad_account_id: string;
    page_id: string;
    pixel_id: string | null;
    ig_account_id: string | null;
    whatsapp_phone_number_id: string | null;
    whatsapp_destination_number: string | null;
  } | null
> {
  const platform = await loadPlatformAccount();
  if (!platform?.ad_account_id || !platform.page_id) return null;
  const settings = await loadConsultantAdSettings(consultantId);
  return {
    token: platform.token,
    ad_account_id: platform.ad_account_id,
    page_id: platform.page_id,
    pixel_id: platform.pixel_id,
    ig_account_id: platform.ig_account_id,
    whatsapp_phone_number_id: null,
    whatsapp_destination_number: settings?.whatsapp_destination_number ?? null,
  };
}

/**
 * Garante que existe wallet pro consultor e retorna o saldo atual.
 */
export async function getOrCreateWallet(consultantId: string): Promise<{
  balance_cents: number;
  total_topped_up_cents: number;
  total_spent_cents: number;
  auto_pause_at_cents: number;
}> {
  const admin = adminClient();
  // Welcome R$1,00 só na 1ª criação (RPC ensure_consultant_wallet).
  try {
    await admin.rpc("ensure_consultant_wallet", { _consultant_id: consultantId });
  } catch (_e) {
    /* fallback abaixo */
  }
  const { data } = await admin.from("consultant_wallet").select("*").eq(
    "consultant_id",
    consultantId,
  ).maybeSingle();
  if (data) {
    return {
      balance_cents: Number(data.balance_cents),
      total_topped_up_cents: Number(data.total_topped_up_cents),
      total_spent_cents: Number(data.total_spent_cents),
      auto_pause_at_cents: Number(data.auto_pause_at_cents),
    };
  }
  // Fallback se RPC ainda não existir no ambiente.
  await admin.from("consultant_wallet").insert({
    consultant_id: consultantId,
    balance_cents: 100,
    total_topped_up_cents: 100,
  }).select().maybeSingle();
  const { data: re } = await admin.from("consultant_wallet").select("*").eq(
    "consultant_id",
    consultantId,
  ).maybeSingle();
  return {
    balance_cents: Number(re?.balance_cents ?? 0),
    total_topped_up_cents: Number(re?.total_topped_up_cents ?? 0),
    total_spent_cents: Number(re?.total_spent_cents ?? 0),
    auto_pause_at_cents: Number(re?.auto_pause_at_cents ?? 500),
  };
}

// Códigos transientes Meta que merecem retry em operações seguras.
// Ref: https://developers.facebook.com/docs/marketing-api/error-reference
const TRANSIENT_FB_CODES = new Set([1, 2, 4, 17, 32, 341, 613]);

export class FbGraphError extends Error {
  readonly status: number;
  readonly code: number | null;
  readonly subcode: number | null;
  readonly retryable: boolean;

  constructor(input: {
    message: string;
    status: number;
    code?: number | null;
    subcode?: number | null;
    retryable?: boolean;
  }) {
    super(input.message);
    this.name = "FbGraphError";
    this.status = input.status;
    this.code = input.code ?? null;
    this.subcode = input.subcode ?? null;
    this.retryable = input.retryable === true;
  }
}

// Erro tipado quando o token Facebook está inválido/expirado (code 190).
export class FbAuthError extends Error {
  readonly isFbAuthError = true;
  readonly code = 190;
  readonly subcode: number | null;
  readonly needsReconnect = true;
  constructor(message: string, subcode: number | null) {
    super(message);
    this.name = "FbAuthError";
    this.subcode = subcode;
  }
}

function graphUrl(path: string): string {
  return path.startsWith("http")
    ? path
    : `${FB_GRAPH}${path.startsWith("/") ? path : "/" + path}`;
}

async function executeFbFetch(
  path: string,
  init: RequestInit | undefined,
  attempts: number,
): Promise<any> {
  const url = graphUrl(path);
  let lastErr: unknown = new Error("Falha desconhecida ao chamar a Meta");
  const maxAttempts = Math.max(1, Math.floor(attempts));

  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(url, init);
      const json = await res.json().catch(() => ({}));
      if (res.ok && !json?.error) return json;

      const e = json?.error || {};
      const parts = [
        e.message,
        e.error_user_title,
        e.error_user_msg,
        e.error_subcode ? `subcode=${e.error_subcode}` : null,
        e.code ? `code=${e.code}` : null,
      ].filter(Boolean);
      const msg = parts.length ? parts.join(" | ") : `HTTP ${res.status}`;
      try {
        console.error("[fbFetch]", url.split("?")[0], JSON.stringify(e));
      } catch (_) {}

      if (Number(e.code) === 190) {
        throw new FbAuthError(msg, Number(e.error_subcode) || null);
      }

      const retryable = res.status >= 500 || res.status === 429 ||
        TRANSIENT_FB_CODES.has(Number(e.code));
      throw new FbGraphError({
        message: msg,
        status: res.status,
        code: Number(e.code) || null,
        subcode: Number(e.error_subcode) || null,
        retryable,
      });
    } catch (error) {
      if (error instanceof FbAuthError) throw error;
      if (error instanceof FbGraphError && !error.retryable) throw error;
      lastErr = error;
    }

    if (i + 1 < maxAttempts) {
      const delay = 500 * Math.pow(2, i) + Math.random() * 250;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastErr;
}

/**
 * Compatibilidade com os call sites existentes. Leituras podem retentar;
 * qualquer método mutável faz uma única tentativa. Updates que forem
 * comprovadamente idempotentes devem usar fbWriteIdempotent explicitamente.
 */
export async function fbFetch(
  path: string,
  init?: RequestInit,
  retries?: number,
): Promise<any> {
  const method = String(init?.method || "GET").toUpperCase();
  const readOnly = method === "GET" || method === "HEAD";
  return executeFbFetch(path, init, readOnly ? (retries ?? 4) : 1);
}

export function fbRead(
  path: string,
  init?: RequestInit,
  retries = 4,
): Promise<any> {
  return executeFbFetch(path, { ...init, method: "GET" }, retries);
}

export function fbWriteIdempotent(
  path: string,
  init?: RequestInit,
  retries = 4,
): Promise<any> {
  return executeFbFetch(
    path,
    { ...init, method: init?.method || "POST" },
    retries,
  );
}

/** POST de criação nunca é repetido automaticamente. */
export function fbCreate(path: string, init?: RequestInit): Promise<any> {
  return executeFbFetch(path, { ...init, method: "POST" }, 1);
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input.trim().toLowerCase());
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map((b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}
