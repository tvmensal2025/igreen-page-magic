// meta-leadads-webhook
// ────────────────────
// Recebe leads do Meta Lead Ads (Facebook/Instagram) via webhook `leadgen`.
// Para cada leadgen_id, busca os dados do lead na Graph API, normaliza e grava
// via lead-ingest. Consentimento embutido (o formulário do Meta já coleta
// opt-in; gravamos o texto do form como consent_text).
//
// Segurança:
//  - GET  → verificação do webhook (hub.challenge) com META_VERIFY_TOKEN.
//  - POST → valida X-Hub-Signature-256 (HMAC-SHA256 com FACEBOOK_APP_SECRET).
//
// Atribuição do consultor: resolve via facebook_campaigns pelo ad_id/form_id
// (a campanha guarda o consultant_id). Se não achar, cai no consultor da
// plataforma como fallback configurável (META_LEADADS_FALLBACK_CONSULTANT).
//
// NOTA DE CONFIGURAÇÃO: requer os secrets META_VERIFY_TOKEN, FACEBOOK_APP_SECRET
// e um page access token (PAGE_ACCESS_TOKEN ou via platform_facebook_account)
// para ler /{leadgen_id}. Sem eles, a função responde mas não consegue buscar
// os dados do lead — por isso o connector é "ligado" só após configurar.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { ingestLead } from "../_shared/captation/lead-ingest.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VERIFY_TOKEN = Deno.env.get("META_VERIFY_TOKEN") ?? "";
const APP_SECRET = Deno.env.get("FACEBOOK_APP_SECRET") ?? "";
const FB_GRAPH = "https://graph.facebook.com/v21.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-hub-signature-256",
};

function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Valida X-Hub-Signature-256: sha256=<hex(hmac(app_secret, body))>. */
async function validSignature(rawBody: string, header: string | null): Promise<boolean> {
  if (!APP_SECRET) return false;
  if (!header?.startsWith("sha256=")) return false;
  const expected = header.slice("sha256=".length);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(APP_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const got = hex(sig);
  // comparação simples (tamanho fixo de hex)
  if (got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

// deno-lint-ignore no-explicit-any
async function pageAccessToken(_supabase: any): Promise<string | null> {
  const env = Deno.env.get("PAGE_ACCESS_TOKEN");
  if (env) return env;
  // tenta a conta única da plataforma (token criptografado → fora de escopo
  // aqui; quem decripta é fb-crypto). Deixamos o env como caminho principal.
  return null;
}

function adIdsContain(list: unknown, adId: string | null | undefined): boolean {
  if (!adId) return false;
  const needle = String(adId).trim();
  if (!needle) return false;
  if (Array.isArray(list)) return list.some((v) => String(v).trim() === needle);
  if (typeof list === "string") {
    try {
      const parsed = JSON.parse(list);
      if (Array.isArray(parsed)) return parsed.some((v) => String(v).trim() === needle);
    } catch { /* plain string fallback */ }
    return list.split(/[\s,;|]+/).some((v) => v.trim() === needle);
  }
  return false;
}

/** Mapeia os campos do Lead Ads (field_data) para o formato do lead-ingest. */
function mapFields(fieldData: Array<{ name: string; values: string[] }>) {
  const get = (...keys: string[]) => {
    for (const f of fieldData) {
      if (keys.includes(f.name.toLowerCase())) return f.values?.[0] ?? null;
    }
    return null;
  };
  return {
    fullName: get("full_name", "nome", "name", "first_name"),
    phone: get("phone_number", "telefone", "phone"),
    email: get("email", "e-mail"),
    city: get("city", "cidade"),
    companyName: get("company_name", "empresa", "razao_social"),
    cnpj: get("cnpj"),
  };
}

async function resolveConsultant(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  adId: string | null,
  formId: string | null,
): Promise<string | null> {
  if (adId) {
    const { data } = await supabase
      .from("facebook_campaigns")
      .select("consultant_id, fb_ad_ids, status, updated_at, created_at")
      .not("fb_ad_ids", "is", null)
      .limit(1000);
    const matches = ((data || []) as any[]).filter((c) => adIdsContain(c.fb_ad_ids, String(adId)));
    matches.sort((a, b) => {
      const rank = (s: string) => (s === "active" ? 0 : s === "pending_review" ? 1 : s === "paused" ? 2 : 3);
      const r = rank(String(a.status || "")) - rank(String(b.status || ""));
      if (r !== 0) return r;
      return String(b.updated_at || b.created_at || "").localeCompare(String(a.updated_at || a.created_at || ""));
    });
    if (matches[0]?.consultant_id) return matches[0].consultant_id as string;
  }
  // Fallback configurável (consultor único da plataforma).
  const fallback = Deno.env.get("META_LEADADS_FALLBACK_CONSULTANT");
  return fallback ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // ── Verificação do webhook (handshake do Meta) ──
  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token && token === VERIFY_TOKEN) {
      return new Response(challenge ?? "", { status: 200 });
    }
    return new Response("forbidden", { status: 403 });
  }

  if (req.method !== "POST") return new Response("method_not_allowed", { status: 405 });

  const rawBody = await req.text();
  const sigOk = await validSignature(rawBody, req.headers.get("x-hub-signature-256"));
  if (!sigOk) {
    return new Response(JSON.stringify({ error: "invalid_signature" }), {
      status: 401,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  const token = await pageAccessToken(supabase);
  let ingested = 0;

  // Estrutura: { entry: [ { changes: [ { field:"leadgen", value:{ leadgen_id, ad_id, form_id, ... } } ] } ] }
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const ch of changes) {
      if (ch?.field !== "leadgen") continue;
      const v = ch.value ?? {};
      const leadgenId = v.leadgen_id;
      const adId = v.ad_id ?? null;
      const formId = v.form_id ?? null;
      if (!leadgenId || !token) continue;

      // Busca os dados do lead na Graph API.
      try {
        const resp = await fetch(
          `${FB_GRAPH}/${leadgenId}?access_token=${encodeURIComponent(token)}`,
        );
        if (!resp.ok) continue;
        const lead = await resp.json();
        const fields = mapFields(lead?.field_data ?? []);
        const consultantId = await resolveConsultant(supabase, adId, formId);
        if (!consultantId) continue;

        const personType = fields.cnpj || fields.companyName ? "pj" : "pf";
        const r = await ingestLead(supabase, {
          consultantId,
          channel: "meta_leadads",
          personType,
          fullName: fields.fullName,
          phone: fields.phone,
          email: fields.email,
          city: fields.city,
          companyName: fields.companyName,
          cnpj: fields.cnpj,
          consentText: "Formulário Meta Lead Ads (opt-in nativo do Facebook/Instagram).",
          consentSource: formId ? `meta_form:${formId}` : "meta_leadads",
          sourceCampaignId: null,
          rawPayload: { leadgen_id: leadgenId, ad_id: adId, form_id: formId },
        });
        if (r.ok && !r.deduped) ingested++;
      } catch (e) {
        console.warn("[meta-leadads] erro ao processar leadgen", leadgenId, (e as Error)?.message);
      }
    }
  }

  // Meta exige 200 rápido para não reenfileirar.
  return new Response(JSON.stringify({ ok: true, ingested }), {
    status: 200,
    headers: { ...cors, "Content-Type": "application/json" },
  });
});
