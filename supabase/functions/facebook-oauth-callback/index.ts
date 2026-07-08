// Recebe redirect do Facebook após o usuário autorizar.
// Troca code por token de longa duração, lista assets e salva.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { encryptToken, verifyState } from "../_shared/fb-crypto.ts";

const FB_VERSION = "v21.0";
const FB_GRAPH = `https://graph.facebook.com/${FB_VERSION}`;

function appOrigin(req: Request): string {
  const ref = req.headers.get("referer");
  if (ref) {
    try { return new URL(ref).origin; } catch { /* ignore */ }
  }
  return "https://igreen.institutodossonhos.com.br";
}

function redirect(origin: string, params: Record<string, string>): Response {
  const u = new URL("/admin", origin);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return new Response(null, { status: 302, headers: { Location: u.toString() } });
}

async function firstBusiness(accessToken: string): Promise<{ id: string; name: string | null } | null> {
  try {
    const res = await fetch(`${FB_GRAPH}/me/businesses?fields=id,name&limit=10&access_token=${accessToken}`);
    const json = await res.json().catch(() => ({}));
    const businesses = Array.isArray(json?.data) ? json.data : [];
    if (businesses.length === 1) return { id: String(businesses[0].id), name: businesses[0].name ?? null };
    return null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const origin = appOrigin(req);

  try {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const fbError = url.searchParams.get("error_description") || url.searchParams.get("error");

    console.log("[fb-cb] start", { hasCode: !!code, hasState: !!state, fbError });

    if (!code || !state) return redirect(origin, { fb: "err", msg: "Faltou código ou state do Facebook." });

    const verified = await verifyState(state);
    if (!verified) {
      console.warn("[fb-cb] invalid state");
      return redirect(origin, { fb: "err", msg: "State inválido ou expirado. Tente conectar novamente." });
    }
    const consultantId = verified.consultantId;
    const redirectOrigin = verified.returnOrigin || origin;
    const scope = verified.scope; // "user" | "platform"

    if (fbError) {
      console.warn("[fb-cb] facebook returned error", fbError);
      return redirect(redirectOrigin, { fb: "err", msg: `Facebook: ${fbError}` });
    }

    const appId = Deno.env.get("FACEBOOK_APP_ID")!;
    const appSecret = Deno.env.get("FACEBOOK_APP_SECRET")!;
    const redirectUri = `${Deno.env.get("SUPABASE_URL")}/functions/v1/facebook-oauth-callback`;

    // 1) Troca code por token curto
    const shortRes = await fetch(`${FB_GRAPH}/oauth/access_token?` + new URLSearchParams({
      client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code,
    }));
    const shortJson = await shortRes.json();
    if (!shortRes.ok || !shortJson.access_token) {
      console.error("[fb-cb] short token error", shortJson);
      const msg = shortJson?.error?.message || "Falha ao trocar code por token.";
        return redirect(redirectOrigin, { fb: "err", msg });
    }
    const shortToken = shortJson.access_token as string;

    // 2) Troca por long-lived (60 dias)
    const longRes = await fetch(`${FB_GRAPH}/oauth/access_token?` + new URLSearchParams({
      grant_type: "fb_exchange_token", client_id: appId, client_secret: appSecret, fb_exchange_token: shortToken,
    }));
    const longJson = await longRes.json();
    const accessToken = (longJson.access_token as string) || shortToken;
    const expiresIn = (longJson.expires_in as number) || 60 * 24 * 3600;
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    // 3) Identidade do usuário
    const meRes = await fetch(`${FB_GRAPH}/me?fields=id,name,email&access_token=${accessToken}`);
    const me = await meRes.json();
    if (!me.id) {
      console.error("[fb-cb] /me failed", me);
      return redirect(redirectOrigin, { fb: "err", msg: me?.error?.message || "Não foi possível identificar a conta Facebook." });
    }
    console.log("[fb-cb] /me ok", { fb_user_id: me.id, fb_user_name: me.name });

    // 4) Primeiro asset disponível. Mantém chamadas tolerantes para não falhar
    // quando o app ainda não tem permissões avançadas aprovadas pelo Meta.
    const [accRes, pageRes] = await Promise.all([
      fetch(`${FB_GRAPH}/me/adaccounts?fields=id,account_id,name,currency,account_status&limit=25&access_token=${accessToken}`),
      fetch(`${FB_GRAPH}/me/accounts?fields=id,name&limit=25&access_token=${accessToken}`),
    ]);
    const accJson = await accRes.json().catch(() => ({}));
    const pageJson = await pageRes.json().catch(() => ({}));
    const accounts = accJson.data || [];
    const pages = pageJson.data || [];
    console.log("[fb-cb] assets", { accounts: accounts.length, pages: pages.length });
    // Não escolhemos automaticamente — o usuário seleciona pelo painel depois.
    // Mas mantemos o primeiro como sugestão inicial caso só exista 1.
    const acc = accounts.length === 1 ? accounts[0] : null;
    const page = pages.length === 1 ? pages[0] : null;

    let pixelId: string | null = null;
    let pixelName: string | null = null;
    if (acc?.id) {
      const pxRes = await fetch(`${FB_GRAPH}/${acc.id}/adspixels?fields=id,name&limit=5&access_token=${accessToken}`);
      const pxJson = await pxRes.json();
      const px = pxJson.data?.[0];
      if (px) { pixelId = px.id; pixelName = px.name; }
    }

    const business = await firstBusiness(accessToken);

    // 5) Persiste com service role (RLS bypass)
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const encrypted = await encryptToken(accessToken);

    if (scope === "platform") {
      // Conta única da plataforma. Singleton com id=true.
      const { error: upErr } = await admin.from("platform_facebook_account").upsert({
        id: true,
        fb_user_id: me.id,
        fb_user_name: me.name,
        access_token_encrypted: encrypted,
        token_expires_at: expiresAt,
        business_id: business?.id ?? null,
        business_name: business?.name ?? null,
        ad_account_id: acc?.id ?? null,
        ad_account_name: acc?.name ?? null,
        ad_account_currency: acc?.currency ?? null,
        page_id: page?.id ?? null,
        page_name: page?.name ?? null,
        pixel_id: pixelId,
        pixel_name: pixelName,
        status: "active",
        last_validated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "id" });
      if (upErr) {
        console.error("[fb-cb] platform upsert error", upErr);
        return redirect(redirectOrigin, { fb: "err", msg: `Falha ao salvar conta da plataforma: ${upErr.message}` });
      }
      console.log("[fb-cb] platform connection saved", { fb_user_id: me.id, business: business?.id, ad_account: acc?.id, page: page?.id });
      // Limpa SESSION_INVALIDATED de TODAS as campanhas — agora o token da plataforma está novo.
      try {
        await admin.from("facebook_campaigns")
          .update({ rejection_reason: null })
          .like("rejection_reason", "SESSION_INVALIDATED%");
      } catch (e) { console.warn("[fb-cb] clear rejection_reason failed", e); }
      return redirect(redirectOrigin, { fb: "ok", tab: "plataforma-fb" });
    }

    const { error: upErr } = await admin.from("facebook_connections").upsert({
      consultant_id: consultantId,
      fb_user_id: me.id,
      fb_user_name: me.name,
      access_token_encrypted: encrypted,
      token_expires_at: expiresAt,
      business_id: business?.id ?? null,
      business_name: business?.name ?? null,
      ad_account_id: acc?.id ?? null,
      ad_account_name: acc?.name ?? null,
      ad_account_currency: acc?.currency ?? null,
      page_id: page?.id ?? null,
      page_name: page?.name ?? null,
      ig_account_id: null,
      ig_account_username: null,
      pixel_id: pixelId,
      pixel_name: pixelName,
      status: "active",
      last_validated_at: new Date().toISOString(),
    }, { onConflict: "consultant_id" });

    if (upErr) {
      console.error("[fb-cb] upsert error", upErr);
      return redirect(redirectOrigin, { fb: "err", msg: `Falha ao salvar conexão: ${upErr.message}` });
    }
    console.log("[fb-cb] connection saved", { consultantId, fb_user_id: me.id });

    return redirect(redirectOrigin, { fb: "ok", tab: "anuncios" });
  } catch (err) {
    console.error("[fb-cb] exception", err);
    return redirect(origin, { fb: "err", msg: (err as Error).message || "Erro inesperado." });
  }
});
