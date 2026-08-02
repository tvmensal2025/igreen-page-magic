import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json(401, { error: "Não autorizado" });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const adminClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    // Cliente com o JWT do chamador — as RPCs validam is_super_admin(auth.uid())
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: { user: caller }, error: authError } = await userClient.auth.getUser(token);
    if (authError || !caller) return json(401, { error: "Token inválido" });

    const { data: isSuper } = await adminClient.rpc("is_super_admin", { _user_id: caller.id });
    if (!isSuper) return json(403, { error: "Acesso negado — só Super Admin pode resetar consultores" });

    const body = await req.json().catch(() => ({}));
    const consultantId = body?.consultant_id;
    const requireReapproval = body?.require_reapproval === true;
    const resetPassword = body?.reset_password === true;

    if (!consultantId || typeof consultantId !== "string") {
      return json(400, { error: "consultant_id é obrigatório" });
    }
    if (consultantId === caller.id) {
      return json(400, { error: "Você não pode resetar a própria conta por aqui" });
    }

    const { data: consultant } = await adminClient
      .from("consultants")
      .select("id, name, license")
      .eq("id", consultantId)
      .maybeSingle();
    if (!consultant) return json(404, { error: "Consultor não encontrado" });

    const { data: summary, error: rpcErr } = await userClient.rpc(
      "admin_reset_consultant_identity",
      { p_consultant: consultantId, p_require_reapproval: requireReapproval },
    );
    if (rpcErr) throw rpcErr;

    let passwordResetSent = false;
    if (resetPassword) {
      const { data: target } = await adminClient.auth.admin.getUserById(consultantId);
      const email = target?.user?.email;
      if (email) {
        const { error: linkErr } = await adminClient.auth.resetPasswordForEmail(email, {
          redirectTo: `${new URL(req.url).origin.replace("functions", "app")}/reset-password`,
        });
        passwordResetSent = !linkErr;
      }
    }

    return json(200, {
      success: true,
      consultant: { id: consultant.id, name: consultant.name, license: consultant.license },
      summary,
      password_reset_sent: passwordResetSent,
    });
  } catch (err) {
    return json(500, { error: (err as Error).message || "Erro ao resetar consultor" });
  }
});
