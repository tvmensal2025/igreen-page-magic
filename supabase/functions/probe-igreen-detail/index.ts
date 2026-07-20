// Edge function: probe-igreen-detail
// Descobre automaticamente qual endpoint da API do escritório iGreen
// (api-vo.igreenenergy.com.br) devolve o DETALHE completo de um cliente.
//
// Fluxo:
//   1. Resolve worker URL + secret (igual sync-igreen-customers).
//   2. Resolve consultor aprovado (do body ou primeiro com credenciais).
//   3. Chama worker /probe-customer-detail (que já testa 12 candidatos).
//   4. Persiste resultados em public.igreen_endpoint_discovery.
//   5. Devolve JSON { winners, results, sample_idcliente }.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { resolveIgreenSyncWorker } from "../_shared/igreen-sync-worker.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ProbeResult {
  path: string;
  status: number;
  size: number;
  duration_ms: number;
  bucket: string;
  sample: string;
}

async function resolveWorker(supabase: any) {
  return resolveIgreenSyncWorker(supabase);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const consultantId: string | null = body.consultant_id || null;
    const sampleIdcliente: string | null =
      body.sample_idcliente ? String(body.sample_idcliente) : null;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const worker = await resolveWorker(supabase);
    if (!worker) {
      return new Response(
        JSON.stringify({
          ok: false,
          error:
            "Worker de sync iGreen não configurado. Defina IGREEN_SYNC_WORKER_URL.",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
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
    const { data: creds, error: credErr } = await credQuery;
    if (credErr || !creds || creds.length === 0) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: consultantId
            ? "Consultor não possui credenciais iGreen cadastradas."
            : "Nenhum consultor aprovado com credenciais iGreen encontrado.",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    const consultant = creds[0];

    // Chama worker /probe-customer-detail
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 300_000); // 5 min
    let workerRes: Response;
    try {
      workerRes = await fetch(`${worker.url}/probe-customer-detail`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Worker-Token": worker.secret,
        },
        body: JSON.stringify({
          portal_email: consultant.igreen_portal_email,
          portal_password: consultant.igreen_portal_password,
          idcliente: sampleIdcliente || undefined,
        }),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(t);
    }

    const text = await workerRes.text();
    let data: any = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    if (!workerRes.ok || !data?.ok) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: data?.error || `Worker retornou HTTP ${workerRes.status}`,
          worker_status: workerRes.status,
          worker_body: data,
        }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const results: ProbeResult[] = data.results || [];

    // Persistir na tabela de discovery
    const rows = results.map((r) => ({
      method: "GET",
      path: r.path,
      category: "customer_detail",
      status: r.status,
      content_type: null,
      bytes: r.size,
      ms: r.duration_ms,
      sample_body: (r.sample || "").slice(0, 8000),
      is_alive: r.status === 200,
      bucket: r.bucket,
      notes: `probe consultor=${consultant.id} sample_idcliente=${data.sample_idcliente}`,
      checked_at: new Date().toISOString(),
    }));
    if (rows.length) {
      await supabase.from("igreen_endpoint_discovery").insert(rows);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        consultant: { id: consultant.id, name: consultant.name },
        sample_idcliente: data.sample_idcliente,
        api_base: data.api_base,
        winners: data.winners || [],
        results,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error)?.message || String(e) }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
