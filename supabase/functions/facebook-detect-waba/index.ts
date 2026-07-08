// facebook-detect-waba
// ─────────────────────
// Detecta o número WhatsApp Business (WABA) que está conectado à Página do
// Facebook do consultor. Usa o token de longa duração já salvo em
// facebook_connections + o page_id selecionado.
//
// Fluxo:
//   1. Carrega facebook_connections do consultor logado (anon JWT → consultor)
//   2. Descriptografa o token
//   3. Pergunta à Graph qual WABA está vinculado à Página
//      GET /{page_id}?fields=connected_whatsapp_business_account
//      GET /{waba_id}/phone_numbers?fields=display_phone_number,verified_name
//   4. Se vazio em consultant_ad_settings.whatsapp_destination_number,
//      auto-preenche com o primeiro número WABA encontrado.
//   5. Devolve { ok, waba_id, numbers, current_number, matches }
//      pra UI exibir os checks ✅/❌ no HealthSummaryCard.
//
// Erros são sempre retornados com status 200 + ok:false para a UI tratar
// sem precisar de try/catch agressivo.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { decryptToken } from "../_shared/fb-crypto.ts";

const FB_VERSION = "v21.0";
const FB_GRAPH = `https://graph.facebook.com/${FB_VERSION}`;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeDigits(s: string | null | undefined): string {
  return String(s || "").replace(/\D/g, "");
}

function brPhoneVariants(raw: string | null | undefined): Set<string> {
  const digits = normalizeDigits(raw);
  const variants = new Set<string>();
  if (!digits) return variants;
  variants.add(digits);
  const national = digits.startsWith("55") ? digits.slice(2) : digits;
  if (national.length < 10) return variants;
  variants.add(national);
  variants.add(`55${national}`);
  const ddd = national.slice(0, 2);
  const local = national.slice(2);
  if (local.length === 9 && local.startsWith("9")) {
    variants.add(`${ddd}${local.slice(1)}`);
    variants.add(`55${ddd}${local.slice(1)}`);
  } else if (local.length === 8) {
    variants.add(`${ddd}9${local}`);
    variants.add(`55${ddd}9${local}`);
  }
  return variants;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization") || "";
    if (!auth.startsWith("Bearer ")) return jsonRes({ ok: false, error: "missing_auth" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { global: { headers: { Authorization: auth } } }
    );

    const { data: claims } = await supabase.auth.getUser(auth.replace("Bearer ", ""));
    const userId = claims.user?.id;
    if (!userId) return jsonRes({ ok: false, error: "invalid_token" });

    // Usa SEMPRE a conta Facebook da plataforma (compartilhada). O token do
    // consultor pode estar inválido/inexistente — não é mais usado aqui.
    const { data: platform } = await supabase
      .from("platform_facebook_account")
      .select("page_id, access_token_encrypted")
      .eq("id", true)
      .maybeSingle();

    if (!platform?.page_id) {
      return jsonRes({ ok: false, error: "no_platform_page", hint: "Conta Facebook da plataforma não configurada." });
    }
    if (!platform.access_token_encrypted) {
      return jsonRes({ ok: false, error: "no_platform_token", hint: "Token da conta plataforma ausente — peça ao admin para reconectar." });
    }

    let token: string;
    try {
      token = await decryptToken(platform.access_token_encrypted);
    } catch (e) {
      console.error("[detect-waba] decrypt failed", e);
      return jsonRes({ ok: false, error: "token_decrypt_failed" });
    }

    const pageId = platform.page_id as string;

    // Carrega o número salvo antes da descoberta WABA. Quando a Graph não expõe
    // a WABA, mas há um número configurado, marcamos como fallback validável pela
    // própria criação do AdSet (mesmo comportamento prático do Ads Manager).
    const { data: settings } = await supabase
      .from("consultant_ad_settings")
      .select("whatsapp_destination_number, whatsapp_phone_number_id, whatsapp_phone_number_display")
      .eq("consultant_id", userId)
      .maybeSingle();
    const currentDigits = normalizeDigits(settings?.whatsapp_destination_number);

    // 1) Descobre o WABA. O campo `connected_whatsapp_business_account` só
    //    existe em algumas Páginas; pedi-lo junto faz a Graph rejeitar tudo
    //    com erro (#100). Por isso tentamos cada caminho separadamente, e por
    //    último caímos no fallback de Businesses do usuário.
    let wabaId: string | null = null;

    try {
      const r = await fetch(`${FB_GRAPH}/${pageId}?fields=whatsapp_business_account&access_token=${token}`);
      const j = await r.json();
      if (r.ok && j?.whatsapp_business_account?.id) wabaId = j.whatsapp_business_account.id;
    } catch (_) { /* ignore */ }

    if (!wabaId) {
      try {
        const r = await fetch(`${FB_GRAPH}/${pageId}?fields=connected_whatsapp_business_account&access_token=${token}`);
        const j = await r.json();
        if (r.ok && j?.connected_whatsapp_business_account?.id) wabaId = j.connected_whatsapp_business_account.id;
      } catch (_) { /* ignore */ }
    }

    if (!wabaId) {
      try {
        const bizRes = await fetch(`${FB_GRAPH}/me/businesses?fields=id,name&access_token=${token}`);
        const bizJson = await bizRes.json();
        const businesses: Array<{ id: string; name?: string }> = bizJson?.data || [];
        for (const biz of businesses) {
          for (const kind of ["owned_whatsapp_business_accounts", "client_whatsapp_business_accounts"]) {
            const wr = await fetch(`${FB_GRAPH}/${biz.id}/${kind}?access_token=${token}`);
            const wj = await wr.json();
            const first = (wj?.data || [])[0];
            if (first?.id) { wabaId = first.id; break; }
          }
          if (wabaId) break;
        }
      } catch (e) {
        console.warn("[detect-waba] business fallback failed", e);
      }
    }

    if (!wabaId) {
      if (currentDigits) {
        return jsonRes({
          ok: true,
          connected: true,
          fallback: true,
          page_id: pageId,
          numbers: [],
          current_number: currentDigits,
          current_phone_number_id: settings?.whatsapp_phone_number_id || null,
          chosen: {
            id: settings?.whatsapp_phone_number_id || `saved:${currentDigits}`,
            display: settings?.whatsapp_phone_number_display || `+${currentDigits}`,
            digits: currentDigits,
            source: "saved_fallback",
          },
          matches: true,
          hint: "A Graph não expôs a WABA da Página, mas existe número WhatsApp configurado. A Meta validará esse número na criação do anúncio.",
        });
      }
      return jsonRes({
        ok: true,
        connected: false,
        hint: "A Página da plataforma ainda não tem um WhatsApp Business API (WABA) vinculado. Abra o Meta Business Suite → Configurações do Negócio → Contas do WhatsApp e vincule à Página.",
        page_id: pageId,
      });
    }

    // 2) WABA → telefones registrados (agora inclui `id` = phone_number_id, imutável)
    const phRes = await fetch(
      `${FB_GRAPH}/${wabaId}/phone_numbers?fields=display_phone_number,verified_name,quality_rating&access_token=${token}`
    );
    const phJson = await phRes.json();
    const numbers: Array<{ id: string; display: string; digits: string; verified_name?: string; quality?: string }> =
      (phJson.data || [])
        .map((n: any) => ({
          id: String(n.id || ""),
          display: n.display_phone_number,
          digits: normalizeDigits(n.display_phone_number),
          verified_name: n.verified_name,
          quality: n.quality_rating,
        }))
        .filter((n: any) => n.id && n.digits);

    // 3) Comparar com o que já está em consultant_ad_settings
    const currentVariants = brPhoneVariants(currentDigits);

    // Match preferencial: phone_number_id salvo (fonte imutável).
    // Fallback: variantes do número digitado.
    let matched = settings?.whatsapp_phone_number_id
      ? numbers.find((n) => n.id === settings.whatsapp_phone_number_id) || null
      : null;
    if (!matched) {
      matched = numbers.find((n) => {
        const numberVariants = brPhoneVariants(n.digits);
        return Array.from(numberVariants).some((v) => currentVariants.has(v));
      }) || null;
    }
    // Se WABA tem exatamente 1 número, adota ele automaticamente.
    if (!matched && numbers.length === 1) matched = numbers[0];

    // 4) Persistir id + display + digits quando temos uma escolha 1-1
    let autoFilled = false;
    if (matched) {
      const needs =
        settings?.whatsapp_phone_number_id !== matched.id ||
        normalizeDigits(settings?.whatsapp_destination_number) !== matched.digits;
      if (needs) {
        const { error: upErr } = await supabase
          .from("consultant_ad_settings")
          .upsert(
            {
              consultant_id: userId,
              whatsapp_phone_number_id: matched.id,
              whatsapp_phone_number_display: matched.display,
              whatsapp_destination_number: matched.digits,
              whatsapp_last_verified_at: new Date().toISOString(),
            },
            { onConflict: "consultant_id" }
          );
        if (!upErr) autoFilled = true;
        else console.warn("[detect-waba] upsert failed", upErr);
      } else {
        await supabase
          .from("consultant_ad_settings")
          .update({ whatsapp_last_verified_at: new Date().toISOString() })
          .eq("consultant_id", userId);
      }
    }

    return jsonRes({
      ok: true,
      connected: true,
      waba_id: wabaId,
      page_id: pageId,
      numbers,
      current_number: currentDigits || null,
      current_phone_number_id: settings?.whatsapp_phone_number_id || null,
      chosen: matched,
      matches: !!matched,
      auto_filled: autoFilled,
      needs_pick: !matched && numbers.length > 1,
    });
  } catch (e) {
    console.error("[detect-waba] exception", e);
    return jsonRes({ ok: false, error: (e as Error).message || "unexpected" });
  }
});

