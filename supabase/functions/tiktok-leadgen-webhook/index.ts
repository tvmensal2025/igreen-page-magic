// tiktok-leadgen-webhook
// ──────────────────────
// Recebe leads do TikTok Lead Generation. O TikTok entrega o evento e, dependendo
// da configuração, o payload do formulário já vem no corpo OU exige buscar via
// TikTok Marketing API. Esta função aceita os dois modos e grava via lead-ingest.
//
// Segurança: valida um segredo compartilhado no header `x-tiktok-secret` contra
// TIKTOK_WEBHOOK_SECRET (o TikTok permite configurar verificação por token).
//
// Atribuição do consultor: resolve por mapeamento de campanha quando disponível;
// senão usa TIKTOK_LEADGEN_FALLBACK_CONSULTANT.
//
// NOTA DE CONFIGURAÇÃO: requer TIKTOK_WEBHOOK_SECRET e (para buscar dados via
// API) TIKTOK_ACCESS_TOKEN. Sem eles o connector responde mas não grava.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { ingestLead } from "../_shared/captation/lead-ingest.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("TIKTOK_WEBHOOK_SECRET") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-tiktok-secret",
};

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Extrai campos do formulário TikTok (lista de {name,value} ou objeto). */
function mapFields(form: any) {
  const flat: Record<string, string> = {};
  if (Array.isArray(form)) {
    for (const f of form) {
      const k = String(f?.name ?? f?.field_name ?? "").toLowerCase();
      const val = f?.value ?? f?.values?.[0];
      if (k) flat[k] = String(val ?? "");
    }
  } else if (form && typeof form === "object") {
    for (const [k, v] of Object.entries(form)) flat[k.toLowerCase()] = String(v ?? "");
  }
  const get = (...keys: string[]) => {
    for (const k of keys) if (flat[k]) return flat[k];
    return null;
  };
  return {
    fullName: get("full_name", "name", "nome"),
    phone: get("phone_number", "phone", "telefone"),
    email: get("email", "e-mail"),
    city: get("city", "cidade"),
    companyName: get("company_name", "empresa", "razao_social"),
    cnpj: get("cnpj"),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  // Handshake opcional do TikTok (GET com challenge).
  if (req.method === "GET") {
    const url = new URL(req.url);
    const challenge = url.searchParams.get("challenge") ?? url.searchParams.get("hub.challenge");
    return new Response(challenge ?? "ok", { status: 200 });
  }

  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  // Verificação por segredo compartilhado.
  const secret = req.headers.get("x-tiktok-secret") ?? "";
  if (!WEBHOOK_SECRET || !timingSafeEqual(secret, WEBHOOK_SECRET)) {
    return json(401, { error: "invalid_secret" });
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json(400, { error: "invalid_json" });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  const fallback = Deno.env.get("TIKTOK_LEADGEN_FALLBACK_CONSULTANT") ?? null;

  // O TikTok pode mandar um único lead ou uma lista.
  const items: any[] = Array.isArray(payload?.leads)
    ? payload.leads
    : Array.isArray(payload?.data)
    ? payload.data
    : [payload];

  let ingested = 0;
  for (const item of items) {
    const form = item?.field_data ?? item?.form ?? item?.fields ?? item;
    const fields = mapFields(form);
    if (!fields.phone && !fields.email) continue;

    const consultantId = fallback;
    if (!consultantId) continue;

    const personType = fields.cnpj || fields.companyName ? "pj" : "pf";
    const r = await ingestLead(supabase, {
      consultantId,
      channel: "tiktok_leadgen",
      personType,
      fullName: fields.fullName,
      phone: fields.phone,
      email: fields.email,
      city: fields.city,
      companyName: fields.companyName,
      cnpj: fields.cnpj,
      consentText: "Formulário TikTok Lead Generation (opt-in nativo do TikTok).",
      consentSource: "tiktok_leadgen",
      rawPayload: typeof item === "object" ? item : {},
    });
    if (r.ok && !r.deduped) ingested++;
  }

  return json(200, { ok: true, ingested });
});
