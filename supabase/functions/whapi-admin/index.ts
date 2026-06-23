/**
 * Whapi Admin — endpoint restrito ao super admin para reconectar o canal
 * Whapi SEM precisar editar código ou tocar no banco direto.
 *
 * Actions:
 *   - update_token { token } : grava settings.whapi_token
 *   - set_superadmin { consultant_id } : grava settings.superadmin_consultant_id
 *   - read_status : retorna { has_token, phone, superadmin_consultant_id }
 */
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json(401, { error: "Unauthorized" });

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claims?.claims?.sub) return json(401, { error: "Unauthorized" });
    const userId = claims.claims.sub as string;
    const userEmail = (claims.claims.email as string | undefined)?.toLowerCase() || "";

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Autorização: super admin por settings, por RPC, ou pelo e-mail fixo.
    let isAuthorized = userEmail === "rafael.ids@icloud.com";
    if (!isAuthorized) {
      try {
        const { data: isSuper } = await admin.rpc("is_super_admin", { _user_id: userId });
        if (isSuper === true) isAuthorized = true;
      } catch (_) { /* ignora */ }
    }
    if (!isAuthorized) {
      const { data: row } = await admin
        .from("settings")
        .select("value")
        .eq("key", "superadmin_consultant_id")
        .maybeSingle();
      if (row?.value === userId) isAuthorized = true;
    }
    if (!isAuthorized) return json(403, { error: "Acesso restrito ao super admin" });

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");

    if (action === "read_status") {
      const { data } = await admin
        .from("settings")
        .select("key, value")
        .in("key", ["whapi_token", "whapi_connected_phone", "superadmin_consultant_id"]);
      const map: Record<string, string> = {};
      data?.forEach((r: any) => { map[r.key] = r.value; });
      return json(200, {
        has_token: !!map.whapi_token,
        token_preview: map.whapi_token ? `${map.whapi_token.slice(0, 6)}…${map.whapi_token.slice(-4)}` : null,
        phone: map.whapi_connected_phone || null,
        superadmin_consultant_id: map.superadmin_consultant_id || null,
      });
    }

    if (action === "update_token") {
      const newToken = String(body?.token || "").trim();
      if (newToken.length < 16) return json(400, { error: "Token inválido" });
      const { error } = await admin
        .from("settings")
        .upsert({ key: "whapi_token", value: newToken }, { onConflict: "key" });
      if (error) return json(500, { error: error.message });
      // Auto-promove o usuário como super admin se ainda não estiver definido
      try {
        await admin
          .from("settings")
          .upsert({ key: "superadmin_consultant_id", value: userId }, { onConflict: "key" });
      } catch (_) { /* ignora */ }
      return json(200, { ok: true });
    }

    if (action === "set_superadmin") {
      const consultantId = String(body?.consultant_id || "").trim();
      if (!consultantId) return json(400, { error: "consultant_id obrigatório" });
      const { error } = await admin
        .from("settings")
        .upsert({ key: "superadmin_consultant_id", value: consultantId }, { onConflict: "key" });
      if (error) return json(500, { error: error.message });
      return json(200, { ok: true });
    }

    return json(400, { error: `Ação desconhecida: ${action}` });
  } catch (err: any) {
    console.error("[whapi-admin] erro:", err?.message || err);
    return json(500, { error: err?.message || "Erro interno" });
  }
});
