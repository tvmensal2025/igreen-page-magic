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
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);

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

    // FKs sem ON DELETE — limpar antes de apagar o consultor via cascade do auth.users
    await adminClient
      .from("customers")
      .update({ customer_referred_by_consultant_id: null })
      .eq("customer_referred_by_consultant_id", consultant_id);

    await adminClient
      .from("consultants")
      .update({ referred_by: null })
      .eq("referred_by", consultant_id);

    await adminClient
      .from("rollout_config")
      .update({ alert_consultant_id: null })
      .eq("alert_consultant_id", consultant_id);

    const { error: deleteAuthErr } = await adminClient.auth.admin.deleteUser(consultant_id);
    if (deleteAuthErr) throw deleteAuthErr;

    return json(200, {
      success: true,
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
