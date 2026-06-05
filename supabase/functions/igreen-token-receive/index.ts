// Public edge function — receives the iGreen accessToken captured by the
// bookmarklet from the consultant's logged-in browser session and stores it
// on the consultant record so sync-igreen-customers can use it without
// going through the captcha/Cloudflare-protected login endpoint.

import { createClient } from "npm:@supabase/supabase-js@2.49.4";

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

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    const decoded = atob(padded);
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  let body: { connect_code?: unknown; access_token?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "JSON inválido" });
  }

  const connectCode = typeof body.connect_code === "string" ? body.connect_code.trim() : "";
  const accessToken = typeof body.access_token === "string" ? body.access_token.trim() : "";

  if (!connectCode || connectCode.length < 6 || connectCode.length > 64) {
    return json(400, { error: "connect_code inválido" });
  }
  if (!/^[A-Za-z0-9_-]+$/.test(connectCode)) {
    return json(400, { error: "connect_code com caracteres inválidos" });
  }
  if (!accessToken || accessToken.length < 20 || accessToken.length > 8192) {
    return json(400, { error: "access_token inválido" });
  }

  // Validate JWT shape (header.payload.signature, all base64url)
  const payload = decodeJwtPayload(accessToken);
  if (!payload) {
    return json(400, { error: "access_token não é um JWT válido" });
  }

  let expiresAt: string | null = null;
  if (typeof payload.exp === "number") {
    expiresAt = new Date(payload.exp * 1000).toISOString();
    if (payload.exp * 1000 < Date.now()) {
      return json(400, { error: "Token já está expirado — faça login novamente no iGreen" });
    }
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: consultant, error: lookupErr } = await supabase
    .from("consultants")
    .select("id, name")
    .eq("igreen_connect_code", connectCode)
    .maybeSingle();

  if (lookupErr) {
    console.error("Lookup error:", lookupErr);
    return json(500, { error: "Erro ao buscar consultor" });
  }
  if (!consultant) {
    return json(404, { error: "Código de conexão não encontrado" });
  }

  const { error: updateErr } = await supabase
    .from("consultants")
    .update({
      igreen_access_token: accessToken,
      igreen_token_updated_at: new Date().toISOString(),
      igreen_token_expires_at: expiresAt,
      igreen_token_expired: false,
    })
    .eq("id", consultant.id);

  if (updateErr) {
    console.error("Update error:", updateErr);
    return json(500, { error: "Erro ao salvar token" });
  }

  console.log(`Token iGreen atualizado para consultor ${consultant.id} (${consultant.name})`);

  return json(200, {
    success: true,
    consultant_name: consultant.name,
    expires_at: expiresAt,
  });
});
