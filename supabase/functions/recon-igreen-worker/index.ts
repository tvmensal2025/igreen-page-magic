// recon-igreen-worker
// Consome N jobs da fila `igreen_recon_queue`. Chamado pelo pg_cron a cada 30s.
// Cada job:
//  1. claim (FOR UPDATE SKIP LOCKED via SQL RPC)
//  2. chama /recon-one-route do worker VPS
//  3. analisa via Gemini 3 Flash
//  4. persiste em igreen_recon_routes + endpoints em igreen_endpoint_discovery
//  5. marca done/error
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const JOBS_PER_INVOCATION = 3;
const MAX_ATTEMPTS = 3;

async function analyzeWithAI(job: any, capture: any): Promise<any> {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) return null;

  const context = {
    kind: job.kind,
    target: job.target,
    params: job.params,
    ...(capture.raw_response
      ? { raw_response_preview: JSON.stringify(capture.raw_response).slice(0, 6000), shape: capture.shape }
      : {
          route: capture.route,
          final_path: capture.final_path,
          dom_outline: capture.dom_outline,
          new_endpoints: (capture.new_endpoints || []).slice(0, 30),
          html_preview: (capture.html_snippet || "").slice(0, 3000),
        }),
  };

  const prompt = `Você mapeia a API/portal iGreen Energy. Analise este capture e responda em JSON estrito:
{
  "summary": "1-2 frases descrevendo o que essa rota/endpoint entrega",
  "fields": [{"name":"...", "type":"string|number|boolean|date|jsonb", "sample":"..."}],
  "suggested_table": "nome_snake_case ou null",
  "suggested_columns": [{"name":"...","type":"postgres_type","nullable":true,"note":"..."}],
  "endpoints_worth_syncing": ["/api-vo/v1/..."]
}
Contexto:
${JSON.stringify(context, null, 2)}`;

  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      }),
    });
    if (!r.ok) return { ai_error: `${r.status}: ${(await r.text()).slice(0, 200)}` };
    const j = await r.json();
    const txt = j.choices?.[0]?.message?.content || "{}";
    try { return JSON.parse(txt); } catch { return { raw_ai: txt.slice(0, 2000) }; }
  } catch (e: any) {
    return { ai_error: e.message?.slice(0, 200) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const started = Date.now();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    // Resolver credenciais + worker_url
    const { data: settings } = await supabase.from("app_settings").select("*").limit(1).maybeSingle();
    const workerUrl =
      (settings as any)?.igreen_sync_worker_url ||
      Deno.env.get("IGREEN_SYNC_WORKER_URL") ||
      "";
    if (!workerUrl) {
      return new Response(JSON.stringify({ ok: false, error: "worker_url_missing" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Pega email/senha do rafael (ou primeiro consultor com credenciais)
    const { data: cons } = await supabase
      .from("consultants")
      .select("id, igreen_portal_email, igreen_portal_password")
      .eq("igreen_portal_email", "rafael.ids@icloud.com")
      .not("igreen_portal_password", "is", null)
      .maybeSingle();
    const email = cons?.igreen_portal_email;
    const password = cons?.igreen_portal_password;
    if (!email || !password) {
      return new Response(JSON.stringify({ ok: false, error: "credentials_missing" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: any[] = [];

    for (let i = 0; i < JOBS_PER_INVOCATION; i++) {
      // Claim 1 job atomicamente
      const { data: claimed, error: claimErr } = await supabase.rpc("claim_recon_job");
      if (claimErr || !claimed || claimed.length === 0) break;
      const job: any = claimed[0];

      const jobStart = Date.now();
      try {
        const workerRes = await fetch(`${workerUrl.replace(/\/$/, "")}/recon-one-route`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            portal_email: email,
            portal_password: password,
            kind: job.kind,
            target: job.target,
            params: job.params || {},
          }),
        });
        const workerJson = await workerRes.json();

        if (!workerJson.ok) {
          throw new Error(workerJson.error || "worker_error");
        }

        const capture = workerJson.capture || {
          raw_response: workerJson.raw_response,
          shape: workerJson.shape,
        };
        const ai = await analyzeWithAI(job, { ...capture, raw_response: workerJson.raw_response });

        // Upload screenshot (se houver)
        let screenshotPath: string | null = null;
        if (capture.screenshot_b64) {
          const bytes = Uint8Array.from(atob(capture.screenshot_b64), (c) => c.charCodeAt(0));
          const path = `${job.kind}/${job.id}.png`;
          const { error: upErr } = await supabase.storage
            .from("igreen-recon")
            .upload(path, bytes, { contentType: "image/png", upsert: true });
          if (!upErr) screenshotPath = path;
        }

        // Grava resultado em igreen_recon_routes
        const { data: routeRow, error: rowErr } = await supabase
          .from("igreen_recon_routes")
          .insert({
            route: job.target,
            final_path: capture.final_path || job.target,
            kind: job.kind,
            job_id: job.id,
            title: capture.dom_outline?.title || null,
            screenshot_path: screenshotPath,
            html_length: capture.html_length || null,
            html_snippet: capture.html_snippet || null,
            dom_outline: capture.dom_outline || null,
            new_endpoints: capture.new_endpoints || null,
            raw_response: workerJson.raw_response || null,
            ai_summary: ai?.summary || null,
            ai_fields: ai?.fields || null,
            suggested_columns: ai?.suggested_columns || null,
            elapsed_ms: capture.elapsed_ms || (Date.now() - jobStart),
            error: capture.nav_error || null,
          })
          .select("id")
          .single();

        // Registra endpoints em igreen_endpoint_discovery
        if (Array.isArray(capture.new_endpoints)) {
          for (const ep of capture.new_endpoints) {
            const path = `${ep.method || "GET"} ${ep.host || ""}${ep.path_template || ""}`.slice(0, 400);
            const status = Number(Object.keys(ep.statuses || { "0": 0 })[0]) || null;
            await supabase.from("igreen_endpoint_discovery").upsert(
              {
                method: ep.method || "GET",
                path,
                status,
                bucket: "recon_v2",
                content_type: "application/json",
                is_alive: status !== null && status < 400,
                sample_body: ep.sample?.body || null,
                bytes: ep.sample?.body?.length || null,
                checked_at: new Date().toISOString(),
              },
              { onConflict: "path,method" },
            );
          }
        }

        const isRoute = job.kind === "route";
        const newEpCount = Array.isArray(capture.new_endpoints) ? capture.new_endpoints.length : 0;
        const redirected = !!capture.redirected;
        const finalStatus = isRoute && redirected && newEpCount === 0 ? "skipped" : "done";

        await supabase
          .from("igreen_recon_queue")
          .update({ status: finalStatus, done_at: new Date().toISOString(), result_id: routeRow?.id || null })
          .eq("id", job.id);

        results.push({ id: job.id, target: job.target, ok: true, ms: Date.now() - jobStart });
      } catch (e: any) {
        const attempts = (job.attempts || 0) + 1;
        const finalStatus = attempts >= MAX_ATTEMPTS ? "error" : "pending";
        await supabase
          .from("igreen_recon_queue")
          .update({
            status: finalStatus,
            attempts,
            last_error: e.message?.slice(0, 500),
            claimed_at: null,
          })
          .eq("id", job.id);
        results.push({ id: job.id, target: job.target, ok: false, error: e.message?.slice(0, 200) });
      }
    }

    const { data: progress } = await supabase.from("igreen_recon_queue_progress").select("*");

    return new Response(
      JSON.stringify({ ok: true, processed: results.length, elapsed_ms: Date.now() - started, results, progress }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
