// marcar-conversa-vencedora: cria um snippet vencedor em ai_winning_conversations
// e dispara embedding em background. Auth: admin OU consultor (qualquer um marca
// suas próprias conversas como exemplo).
//
// POST { customerId, etapa, outcome?, msgIds?, snippet? }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const ETAPAS_OK = new Set(["interesse", "nome", "valor", "simulacao", "foto_conta", "doc", "email", "finalizando", "objecao", "fechamento"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const authz = req.headers.get("authorization") || "";
    const jwt = authz.replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "unauthorized" }, 401);
    const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
    if (userErr || !userData.user) return json({ error: "unauthorized" }, 401);
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const customerId = String(body?.customerId || "").trim();
    const etapa = String(body?.etapa || "").trim().toLowerCase();
    const outcome = body?.outcome ? String(body.outcome).slice(0, 240) : null;
    const explicitSnippet = body?.snippet ? String(body.snippet) : null;
    const msgIds: string[] = Array.isArray(body?.msgIds) ? body.msgIds.map(String) : [];

    if (!customerId) return json({ error: "customerId obrigatório" }, 400);
    if (!ETAPAS_OK.has(etapa)) return json({ error: `etapa inválida (use: ${[...ETAPAS_OK].join(",")})` }, 400);

    // Pega consultant_id do customer e valida que o usuário é dono OU admin
    const { data: customer } = await supabase
      .from("customers")
      .select("consultant_id")
      .eq("id", customerId)
      .maybeSingle();
    if (!customer) return json({ error: "customer não encontrado" }, 404);

    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin && customer.consultant_id !== userId) {
      return json({ error: "forbidden — não é admin nem dono do lead" }, 403);
    }

    // Monta snippet: se msgIds vier, busca essas; senão pega últimas 8
    let snippet = explicitSnippet || "";
    if (!snippet) {
      let q = supabase
        .from("conversations")
        .select("message_direction, message_text, created_at, id")
        .eq("customer_id", customerId)
        .order("created_at", { ascending: false })
        .limit(msgIds.length ? 80 : 8);
      const { data: rows } = await q;
      let msgs = ((rows || []) as any[]).reverse();
      if (msgIds.length) msgs = msgs.filter((m: any) => msgIds.includes(m.id));
      snippet = msgs.map((m: any) => `${m.message_direction === "outbound" ? "Bot" : "Lead"}: ${String(m.message_text || "").trim()}`).filter(Boolean).join("\n").slice(0, 4000);
    }
    if (!snippet.trim()) return json({ error: "snippet vazio" }, 400);

    const { data: inserted, error: insErr } = await supabase
      .from("ai_winning_conversations")
      .insert({
        consultant_id: customer.consultant_id,
        etapa,
        snippet,
        outcome,
        created_by: userId,
      })
      .select("id")
      .maybeSingle();
    if (insErr) return json({ error: insErr.message }, 500);

    // Dispara embedding em background — best effort
    try {
      const internalSecret = (await supabase.from("settings").select("value").eq("key", "embed_internal_token").maybeSingle()).data?.value;
      if (internalSecret) {
        void fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/embed-knowledge`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-secret": internalSecret,
          },
          body: JSON.stringify({ id: inserted?.id, table: "ai_winning_conversations" }),
        }).catch(() => undefined);
      }
    } catch (_) { /* ignore */ }

    return json({ ok: true, id: inserted?.id });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
