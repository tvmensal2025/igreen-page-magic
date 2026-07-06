// recon-igreen-ingest
// Recebe UMA captura por chamada do script local (scripts/recon-igreen-local.mjs)
// que roda no navegador do próprio usuário — sem sandbox, sem Tor.
// Faz: upload do screenshot no bucket `igreen-recon`, analisa via Gemini vision,
// persiste em `igreen_recon_routes` e adiciona endpoints em `igreen_endpoint_discovery`.
//
// Auth: header x-ingest-token deve bater com Deno.env RECON_INGEST_TOKEN.
//
// Body: {
//   run_id: string (uuid),
//   capture: {
//     route, final, screenshot_b64, html_snippet, html_length,
//     dom_outline, endpoints[], elapsed_ms, error?
//   }
// }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-ingest-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const token = req.headers.get("x-ingest-token") || "";
  const expected = Deno.env.get("RECON_INGEST_TOKEN") || "";
  if (!expected || token !== expected) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const runId = String(body.run_id || "");
    const cap = body.capture || {};
    if (!runId || !cap.route) {
      return new Response(JSON.stringify({ ok: false, error: "missing run_id or capture.route" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1) Upload screenshot
    let screenshotPath: string | null = null;
    if (cap.screenshot_b64) {
      try {
        const bin = Uint8Array.from(atob(cap.screenshot_b64), (c) => c.charCodeAt(0));
        const safe = String(cap.route).replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "root";
        const p = `${runId}/${safe}.png`;
        const { error } = await supabase.storage.from("igreen-recon").upload(p, bin, {
          contentType: "image/png", upsert: true,
        });
        if (!error) screenshotPath = p;
        else console.error("[upload]", error);
      } catch (e) { console.error("[decode]", (e as Error).message); }
    }

    // 2) Análise IA (Gemini vision)
    let aiSummary: string | null = null;
    let aiFields: any = null;
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    if (lovableKey && cap.screenshot_b64) {
      try {
        const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Lovable-API-Key": lovableKey },
          body: JSON.stringify({
            model: "google/gemini-3-flash-preview",
            response_format: { type: "json_object" },
            messages: [{
              role: "user",
              content: [
                {
                  type: "text",
                  text: `Você é um mapeador de APIs. Analise a tela do portal iGreen (rota ${cap.route}).
Responda em JSON:
{
  "summary": "resumo em 2 linhas do que a tela mostra",
  "purpose": "para que serve no negócio",
  "data_entities": ["entidades visíveis: clientes, faturas, comissoes..."],
  "columns_seen": ["colunas de tabela visíveis"],
  "filters_seen": ["filtros/inputs visíveis"],
  "actions_seen": ["botões: exportar, editar, ver detalhe..."],
  "suggested_db_table": "nome sugerido para tabela supabase",
  "suggested_columns": [{"name":"...","type":"text|numeric|date|jsonb|uuid|boolean","note":"..."}]
}
Contexto DOM: ${JSON.stringify(cap.dom_outline || {}).slice(0, 4000)}
Endpoints observados: ${JSON.stringify((cap.endpoints || []).map((e: any) => `${e.method} ${e.url}`)).slice(0, 1500)}`,
                },
                { type: "image_url", image_url: { url: `data:image/png;base64,${cap.screenshot_b64}` } },
              ],
            }],
          }),
        });
        if (r.ok) {
          const j = await r.json();
          const txt = j?.choices?.[0]?.message?.content || "{}";
          try {
            const parsed = JSON.parse(txt);
            aiFields = parsed;
            aiSummary = parsed.summary || parsed.purpose || null;
          } catch { aiSummary = txt.slice(0, 500); }
        } else {
          console.error("[ai]", r.status, (await r.text()).slice(0, 300));
        }
      } catch (e) { console.error("[ai err]", (e as Error).message); }
    }

    // 3) Persistir linha da rota
    const { error: rErr } = await supabase.from("igreen_recon_routes").insert({
      run_id: runId,
      route: cap.route,
      final_path: cap.final || null,
      title: cap.dom_outline?.title || null,
      screenshot_path: screenshotPath,
      html_length: cap.html_length || null,
      html_snippet: cap.html_snippet || null,
      dom_outline: cap.dom_outline || null,
      new_endpoints: (cap.endpoints || []).map((e: any) => `${e.method} ${e.url}`),
      ai_summary: aiSummary,
      ai_fields: aiFields,
      elapsed_ms: cap.elapsed_ms || null,
      error: cap.error || null,
    });
    if (rErr) console.error("[route insert]", rErr);

    // 4) Persistir endpoints (catálogo)
    const eps = Array.isArray(cap.endpoints) ? cap.endpoints : [];
    if (eps.length) {
      const rows = eps.map((e: any) => ({
        method: e.method || "GET",
        path: e.url,
        category: "recon_local",
        status: e.status || 200,
        content_type: "application/json",
        is_alive: true,
        bucket: "portal_recon_local",
        notes: `local-browser run=${runId} rota=${cap.route}`,
        sample_body: e.sample ? e.sample.slice(0, 4000) : null,
        checked_at: new Date().toISOString(),
      }));
      const { error: eErr } = await supabase.from("igreen_endpoint_discovery").insert(rows);
      if (eErr) console.error("[endpoints insert]", eErr);
    }

    return new Response(
      JSON.stringify({ ok: true, run_id: runId, route: cap.route, screenshot_path: screenshotPath, ai_summary: aiSummary, endpoints_saved: eps.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
