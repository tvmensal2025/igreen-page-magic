// Edge function: spy-igreen-spa
// Aciona /spy-spa-detail no worker (SPA-scraping) e persiste os XHR capturados
// em public.igreen_endpoint_discovery (bucket "spy_spa").
//
// Body: { consultant_id?: string, idcliente?: string, nome?: string }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { resolveIgreenSyncWorker } from "../_shared/igreen-sync-worker.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// deno-lint-ignore no-explicit-any
async function resolveWorker(supabase: any) {
  return resolveIgreenSyncWorker(supabase);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const consultantId: string | null = body.consultant_id || null;
    const idcliente: string | null = body.idcliente ? String(body.idcliente) : null;
    const nome: string | null = body.nome ? String(body.nome) : null;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const worker = await resolveWorker(supabase);
    if (!worker) {
      return new Response(
        JSON.stringify({ ok: false, error: "worker iGreen não configurado" }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Resolve consultor + credenciais
    let credQuery = supabase
      .from("consultants")
      .select("id, name, igreen_portal_email, igreen_portal_password")
      .not("igreen_portal_email", "is", null)
      .not("igreen_portal_password", "is", null)
      .limit(1);
    if (consultantId) credQuery = credQuery.eq("id", consultantId).limit(1);
    const { data: creds } = await credQuery;
    const consultant = creds?.[0];
    if (!consultant) {
      return new Response(
        JSON.stringify({ ok: false, error: "nenhum consultor com credenciais iGreen" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 300_000);
    let workerRes: Response;
    try {
      workerRes = await fetch(`${worker.url}/spy-spa-detail`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Worker-Token": worker.secret,
        },
        body: JSON.stringify({
          portal_email: consultant.igreen_portal_email,
          portal_password: consultant.igreen_portal_password,
          idcliente: idcliente || undefined,
          nome: nome || undefined,
        }),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(t);
    }

    const text = await workerRes.text();
    // deno-lint-ignore no-explicit-any
    let data: any = null;
    try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 4000) }; }

    if (!workerRes.ok || !data?.ok) {
      return new Response(
        JSON.stringify({ ok: false, error: data?.error || `worker http ${workerRes.status}`, worker_body: data }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Persistir todos os requests capturados na tabela de discovery
    const now = new Date().toISOString();
    // deno-lint-ignore no-explicit-any
    const rows = (data.requests || []).map((r: any) => {
      const u = new URL(r.url);
      return {
        method: r.method,
        path: u.pathname + (u.search || ""),
        category: "spy_spa",
        status: r.status ?? null,
        content_type: r.content_type ?? null,
        bytes: r.size ?? null,
        ms: (r.t_end && r.t_start) ? (r.t_end - r.t_start) : null,
        sample_body: (r.sample || "").slice(0, 8000),
        is_alive: r.status === 200,
        bucket: r.status === 200 ? "ok" : r.status === 404 ? "missing" : (r.status ?? 0) >= 400 ? "err" : "other",
        notes: `spy consultor=${consultant.id} alvo=${idcliente || nome || "auto"}`,
        checked_at: now,
      };
    });
    if (rows.length) {
      await supabase.from("igreen_endpoint_discovery").insert(rows);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        consultant: { id: consultant.id, name: consultant.name },
        target: data.target,
        elapsed_ms: data.elapsed_ms,
        total_requests: data.total_requests,
        persisted: rows.length,
        winners: data.winners || [],
        steps: data.steps || [],
        requests_preview: (data.requests || []).slice(0, 40).map((r: { method: string; url: string; status: number; size: number }) => ({
          method: r.method, url: r.url, status: r.status, size: r.size,
        })),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error)?.message || String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
