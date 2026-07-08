// Gera URL de autorização do Facebook para o consultor logado.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { signState } from "../_shared/fb-crypto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FB_VERSION = "v21.0";
const SCOPES = [
  "ads_management",
  "ads_read",
  "business_management",
  "leads_retrieval",
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_metadata",
  "pages_manage_ads",
  "whatsapp_business_management",
  "whatsapp_business_messaging",
  "instagram_basic",
  "instagram_manage_insights",
  "read_insights",
  "email",
  "public_profile",
].join(",");

function allowedReturnOrigin(req: Request, requested?: string | null): string {
  const candidates = [
    requested,
    req.headers.get("origin"),
    req.headers.get("referer") ? (() => {
      try { return new URL(req.headers.get("referer")!).origin; } catch { return null; }
    })() : null,
  ].filter(Boolean) as string[];

  for (const value of candidates) {
    try {
      const origin = new URL(value).origin;
      if (
        origin.endsWith(".lovable.app") ||
        origin === "https://igreen.institutodossonhos.com.br" ||
        origin === "https://igreen.cloud" ||
        origin === "https://www.igreen.cloud"
      ) return origin;
    } catch { /* ignore */ }
  }
  return "https://igreen.cloud";
}

function decodeJwtSub(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=");
    const json = JSON.parse(atob(b64));
    return json?.sub || null;
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const token = authHeader.replace("Bearer ", "");
    // Decodifica JWT localmente pra evitar round-trip de rede (que estava travando em 150s).
    const consultantId = decodeJwtSub(token);
    if (!consultantId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Modo: 'connect' (padrão), 'switch' (forçar troca de conta) ou 'rerequest' (re-pedir permissões negadas)
    // Escopo: 'user' (consultor) ou 'platform' (conta única da plataforma — só super admin).
    let mode: "connect" | "switch" | "rerequest" = "connect";
    let scope: "user" | "platform" = "user";
    let body: any = {};
    try {
      body = await req.json().catch(() => ({}));
      if (body?.mode === "switch") mode = "switch";
      else if (body?.mode === "rerequest") mode = "rerequest";
      if (body?.scope === "platform") scope = "platform";
    } catch (_) { /* sem body */ }

    // Gate: somente admin pode iniciar OAuth de plataforma. Usa service role
    // pra evitar RLS/anon lento (a checagem em si é do próprio user id do JWT).
    if (scope === "platform") {
      const admin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      // Aceita: role admin/super_admin em user_roles OU is_super_admin RPC (rafael.ids@icloud.com etc).
      let allowed = false;
      const { data: roleRow } = await admin
        .from("user_roles")
        .select("role")
        .eq("user_id", consultantId)
        .in("role", ["admin", "super_admin"])
        .maybeSingle();
      if (roleRow) allowed = true;
      if (!allowed) {
        try {
          const { data: isSuper } = await admin.rpc("is_super_admin", { _user_id: consultantId });
          if (isSuper === true) allowed = true;
        } catch (_) { /* ignore */ }
      }
      if (!allowed) {
        // Fallback final: checa email do usuário para whitelist do super admin fundador.
        try {
          const { data: userRes } = await admin.auth.admin.getUserById(consultantId);
          const email = (userRes?.user?.email || "").toLowerCase();
          if (email === "rafael.ids@icloud.com") allowed = true;
        } catch (_) { /* ignore */ }
      }
      if (!allowed) {
        return new Response(JSON.stringify({ error: "Apenas Super Admin pode conectar a conta da plataforma." }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const appId = Deno.env.get("FACEBOOK_APP_ID");
    if (!appId) throw new Error("FACEBOOK_APP_ID not configured");

    const projectUrl = Deno.env.get("SUPABASE_URL")!;
    const redirectUri = `${projectUrl}/functions/v1/facebook-oauth-callback`;
    const returnOrigin = allowedReturnOrigin(req, body?.return_origin);
    const state = await signState(consultantId, returnOrigin, scope);

    const url = new URL(`https://www.facebook.com/${FB_VERSION}/dialog/oauth`);
    url.searchParams.set("client_id", appId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("scope", SCOPES);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", state);
    if (mode === "switch") {
      // Solicita ao Facebook reautenticar/permitir trocar conta.
      url.searchParams.set("auth_type", "reauthenticate");
      url.searchParams.set("prompt", "login");
      url.searchParams.set("force_authentication", "1");
    } else if (mode === "rerequest") {
      // Re-pede permissões que o usuário negou antes — sem isso, scopes negados não voltam a aparecer.
      url.searchParams.set("auth_type", "rerequest");
    }

    // URL auxiliar de logout do Facebook (para casos em que o usuário queira garantir troca de conta)
    const fbLogoutUrl = `https://www.facebook.com/logout.php?next=${encodeURIComponent(url.toString())}&access_token=`;

    console.log("[fb-oauth-start]", { consultantId, mode, scope, returnOrigin });

    return new Response(JSON.stringify({ url: url.toString(), logout_url: fbLogoutUrl, mode, scope }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[facebook-oauth-start]", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
