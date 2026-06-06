// Embed knowledge sections (FAQ + ai_winning_conversations).
// POST /embed-knowledge
//  - {} → backfill: embedda todas as linhas sem embedding (até 50 por chamada)
//  - { id, table: "ai_knowledge_sections" | "ai_winning_conversations" } → embedda 1 linha
//
// Requer auth de admin.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const GATEWAY = "https://ai.gateway.lovable.dev/v1/embeddings";

async function embed(text: string): Promise<number[]> {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) throw new Error("LOVABLE_API_KEY missing");
  const res = await fetch(GATEWAY, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-embedding-001",
      input: text.slice(0, 8000),
      dimensions: 1536,
    }),
  });
  if (!res.ok) throw new Error(`embed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const v = data?.data?.[0]?.embedding;
  if (!Array.isArray(v)) throw new Error("embedding vazio");
  return v;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Auth: aceita (a) admin via Bearer JWT do usuário OU
    //       (b) chamada interna via header x-internal-secret (trigger pg_net).
    const internalSecret = req.headers.get("x-internal-secret") || "";
    const expectedInternal = Deno.env.get("EMBED_INTERNAL_SECRET") || "";
    const isInternal = expectedInternal && internalSecret && internalSecret === expectedInternal;

    if (!isInternal) {
      const authz = req.headers.get("authorization") || "";
      const jwt = authz.replace(/^Bearer\s+/i, "");
      if (!jwt) return json({ error: "unauthorized" }, 401);
      const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
      if (userErr || !userData.user) return json({ error: "unauthorized" }, 401);
      const { data: roleRow } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userData.user.id)
        .eq("role", "admin")
        .maybeSingle();
      if (!roleRow) return json({ error: "forbidden" }, 403);
    }

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const table = body?.table || "ai_knowledge_sections";
    if (table !== "ai_knowledge_sections" && table !== "ai_winning_conversations") {
      return json({ error: "invalid table" }, 400);
    }

    if (body?.id) {
      const { data: row } = await supabase.from(table).select("*").eq("id", body.id).maybeSingle();
      if (!row) return json({ error: "row not found" }, 404);
      const text = table === "ai_knowledge_sections"
        ? `${row.title || ""}\n${row.content || ""}`
        : `${row.etapa || ""}\n${row.snippet || ""}`;
      const vec = await embed(text);
      const upd: any = { embedding: vec };
      if (table === "ai_knowledge_sections") upd.embedding_updated_at = new Date().toISOString();
      await supabase.from(table).update(upd).eq("id", row.id);
      return json({ ok: true, id: row.id, dims: vec.length });
    }

    // Backfill (até 50 sem embedding)
    const { data: rows } = await supabase
      .from(table)
      .select("*")
      .is("embedding", null)
      .limit(50);
    const results: any[] = [];
    for (const row of (rows || []) as any[]) {
      try {
        const text = table === "ai_knowledge_sections"
          ? `${row.title || ""}\n${row.content || ""}`
          : `${row.etapa || ""}\n${row.snippet || ""}`;
        if (!text.trim()) continue;
        const vec = await embed(text);
        const upd: any = { embedding: vec };
        if (table === "ai_knowledge_sections") upd.embedding_updated_at = new Date().toISOString();
        await supabase.from(table).update(upd).eq("id", row.id);
        results.push({ id: row.id, ok: true });
      } catch (e) {
        results.push({ id: row.id, ok: false, error: (e as Error).message });
      }
    }
    return json({ ok: true, processed: results.length, results });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
