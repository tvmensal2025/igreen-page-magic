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
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const anonClient = createClient(supabaseUrl, anonKey);
    // Cliente com o JWT do chamador — a RPC de transferência valida is_super_admin(auth.uid())
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: { user: caller }, error: authError } = await anonClient.auth.getUser(token);
    if (authError || !caller) return json(401, { error: "Token inválido" });

    const { data: isSuper } = await adminClient.rpc("is_super_admin", {
      _user_id: caller.id,
    });
    if (!isSuper) return json(403, { error: "Acesso negado — só Super Admin pode excluir usuários" });

    const { consultant_id } = await req.json();
    if (!consultant_id || typeof consultant_id !== "string") {
      return json(400, { error: "consultant_id é obrigatório" });
    }

    if (consultant_id === caller.id) {
      return json(400, { error: "Você não pode excluir a própria conta por aqui" });
    }

    // Nunca excluir outro super admin (protege a conta do superadmin da plataforma)
    const { data: targetIsSuper } = await adminClient.rpc("is_super_admin", {
      _user_id: consultant_id,
    });
    if (targetIsSuper) {
      return json(400, { error: "Não é possível excluir um Super Admin" });
    }

    const { data: consultant, error: consErr } = await adminClient
      .from("consultants")
      .select("id, name, license, phone, approved")
      .eq("id", consultant_id)
      .maybeSingle();

    if (consErr) throw consErr;
    if (!consultant) return json(404, { error: "Consultor não encontrado" });

    const { data: { user: targetUser }, error: getUserError } =
      await adminClient.auth.admin.getUserById(consultant_id);
    if (getUserError || !targetUser) {
      return json(404, { error: "Usuário de autenticação não encontrado" });
    }

    // CRÍTICO: várias FKs para consultants são ON DELETE CASCADE (captured_leads,
    // sales, proposals, igreen_*, rodizio_assignments) e customers é SET NULL.
    // Transferimos tudo para o super admin que está excluindo, para não perder
    // histórico nem deixar cliente órfão.
    const { data: transferred, error: transferErr } = await userClient.rpc(
      "admin_transfer_consultant_assets",
      { p_from: consultant_id, p_to: caller.id },
    );
    if (transferErr) throw transferErr;

    await adminClient
      .from("rollout_config")
      .update({ alert_consultant_id: null })
      .eq("alert_consultant_id", consultant_id);

    const { error: deleteAuthErr } = await adminClient.auth.admin.deleteUser(consultant_id);
    if (deleteAuthErr) throw deleteAuthErr;

    return json(200, {
      success: true,
      transferred_to: caller.id,
      transferred,
      deleted: {
        id: consultant.id,
        name: consultant.name,
        license: consultant.license,
        email: targetUser.email ?? null,
      },
    });

  } catch (err) {
    return json(500, { error: (err as Error).message || "Erro ao excluir usuário" });
  }
});
