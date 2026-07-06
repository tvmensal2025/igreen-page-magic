// recon-igreen-endpoints
// Dispara o /recon-endpoints do worker-igreen-sync (v19+) para descobrir
// automaticamente TODAS as rotas reais da API iGreen (api-vo/v1/*) a partir
// de um consultor com dados densos. Persiste o catálogo em
// public.igreen_endpoint_discovery (uma linha por endpoint descoberto).
//
// Body: {
//   consultant_id?: string,     // se omitido, usa primeiro com credenciais
//   portal_email?: string,      // override manual (ex.: rafael.ids)
//   portal_password?: string,
// }
//
// Retorna: { ok, worker_version, endpoints_discovered, catalog[], persisted }
//
// IMPORTANTE: se o worker ainda estiver na v18, /recon-endpoints devolve 404.
// Nesse caso retornamos erro com instrução de redeploy.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1) Resolver credenciais
    let email = body.portal_email ? String(body.portal_email) : "";
    let password = body.portal_password ? String(body.portal_password) : "";
    let consultantId = body.consultant_id ? String(body.consultant_id) : null;
    let consultantName: string | null = null;

    if (!email || !password) {
      let q = supabase
        .from("consultants")
        .select("id, name, igreen_portal_email, igreen_portal_password")
        .not("igreen_portal_email", "is", null)
        .not("igreen_portal_password", "is", null)
        .limit(1);
      if (consultantId) q = q.eq("id", consultantId).limit(1);
      const { data, error } = await q;
      if (error || !data || data.length === 0) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: consultantId
              ? "Consultor sem credenciais iGreen cadastradas."
              : "Nenhum consultor com credenciais iGreen encontrado.",
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const c = data[0] as any;
      email = c.igreen_portal_email;
      password = c.igreen_portal_password;
      consultantId = c.id;
      consultantName = c.name;
    }

    // 2) Resolver worker
    const { data: settingsRows } = await supabase.from("settings").select("key, value");
    const s: Record<string, string> = {};
    settingsRows?.forEach((r: any) => { s[r.key] = r.value; });
    const url = (
      s.igreen_sync_worker_url ||
      Deno.env.get("IGREEN_SYNC_WORKER_URL") ||
      ""
    ).replace(/\/$/, "");
    const secret =
      s.igreen_sync_worker_secret ||
      Deno.env.get("IGREEN_SYNC_WORKER_SECRET") ||
      s.worker_secret ||
      Deno.env.get("WORKER_SECRET") ||
      "";
    if (!url) {
      return new Response(
        JSON.stringify({ ok: false, error: "worker_url_missing" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 3) Disparar recon (timeout longo — recon navega ~40 rotas + 12 meses)
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 540_000);
    let workerRes: Response;
    try {
      workerRes = await fetch(`${url}/recon-endpoints`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-worker-token": secret,
        },
        body: JSON.stringify({ portal_email: email, portal_password: password }),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(t);
    }

    const text = await workerRes.text();
    let data: any = null;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (workerRes.status === 404) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "worker_outdated",
          message:
            "Worker rodando ainda é v18 — /recon-endpoints só existe na v19. Faça o redeploy do container (docker build/run) no VPS.",
          worker_status: 404,
        }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!workerRes.ok || !data?.ok) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: data?.error || `Worker HTTP ${workerRes.status}`,
          worker_status: workerRes.status,
          worker_body: typeof data === "string" ? data.slice(0, 2000) : data,
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const catalog: any[] = Array.isArray(data.catalog) ? data.catalog : [];

    // 4) Persistir catálogo — uma linha por endpoint
    const rows = catalog.map((e) => ({
      method: e.method || "GET",
      path: e.path_template,
      category: "recon_v19",
      status: 200,
      content_type: "application/json",
      bytes: null,
      ms: null,
      sample_body: (() => {
        try {
          return JSON.stringify({
            shape: e.shape,
            first_total: e.first_total,
            statuses: e.statuses,
            hits: e.hits,
            seen_query: e.seen_query,
            samples: (e.samples || []).map((x: any) => ({
              url: x.url, status: x.status, body: (x.body || "").slice(0, 2000),
            })),
          }).slice(0, 8000);
        } catch { return null; }
      })(),
      is_alive: true,
      bucket: "portal_recon",
      notes: `recon consultor=${consultantId} (${consultantName || "?"}) worker=${data.worker_version || "v19"}`,
      checked_at: new Date().toISOString(),
    }));

    let persisted = 0;
    if (rows.length) {
      const { error: insErr, count } = await supabase
        .from("igreen_endpoint_discovery")
        .insert(rows, { count: "exact" });
      if (insErr) console.error("[recon] insert err", insErr);
      else persisted = count || rows.length;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        worker_version: data.worker_version,
        consultor_id: data.consultor_id,
        consultant_id: consultantId,
        consultant_name: consultantName,
        elapsed_ms: data.elapsed_ms,
        routes_navigated: data.routes_navigated,
        endpoints_discovered: catalog.length,
        persisted,
        catalog,
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
