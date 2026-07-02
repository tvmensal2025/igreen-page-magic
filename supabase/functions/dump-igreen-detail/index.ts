// Edge function: dump-igreen-detail
// Chama worker /sync-all com enrich_limit:1 e retorna o JSON bruto do primeiro
// customer + primeiro details[], para inspeção de campos (endereço, licenciado).
// Body: { consultant_id: string, idcliente?: string }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const consultantId = String(body.consultant_id || "");
    const idcliente = body.idcliente ? String(body.idcliente) : null;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: consultant, error: cErr } = await supabase
      .from("consultants")
      .select("id, name, igreen_portal_email, igreen_portal_password")
      .eq("id", consultantId)
      .maybeSingle();
    if (cErr || !consultant) throw new Error("consultant_not_found");
    if (!consultant.igreen_portal_email || !consultant.igreen_portal_password)
      throw new Error("missing_igreen_credentials");

    const { data: settingsRows } = await supabase.from("settings").select("key, value");
    const s: Record<string, string> = {};
    settingsRows?.forEach((r: { key: string; value: string }) => { s[r.key] = r.value; });
    const url = (s.igreen_sync_worker_url || Deno.env.get("IGREEN_SYNC_WORKER_URL") || "").replace(/\/$/, "");
    const secret = s.igreen_sync_worker_secret || Deno.env.get("IGREEN_SYNC_WORKER_SECRET") || s.worker_secret || Deno.env.get("WORKER_SECRET") || "";
    if (!url) throw new Error("worker_url_missing");

    const started = Date.now();
    const mode = String(body.mode || "customers"); // 'customers' | 'enrich'
    const r = await fetch(`${url}/sync-all`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-worker-token": secret },
      body: JSON.stringify({
        portal_email: consultant.igreen_portal_email,
        portal_password: consultant.igreen_portal_password,
        only: ["customers"],
        enrich: mode === "enrich",
        enrich_limit: mode === "enrich" ? 1 : 0,
      }),
      signal: AbortSignal.timeout(300_000),
    });

    const text = await r.text();
    let json: any = null; try { json = JSON.parse(text); } catch {}

    // If idcliente specified, find the exact match; else take first
    let sampleCustomer = null;
    let sampleDetail = null;
    if (json?.customers?.length) {
      sampleCustomer = idcliente
        ? json.customers.find((c: any) => String(c.codigo) === idcliente || String(c.idcliente) === idcliente) || json.customers[0]
        : json.customers[0];
    }
    if (json?.details?.length) {
      sampleDetail = idcliente
        ? json.details.find((d: any) => String(d.idcliente) === idcliente || String(d.codigo) === idcliente || String(d.id) === idcliente) || json.details[0]
        : json.details[0];
    }

    return new Response(JSON.stringify({
      ok: r.ok,
      worker_status: r.status,
      duration_ms: Date.now() - started,
      customers_count: json?.customers?.length || 0,
      details_count: json?.details?.length || 0,
      sample_customer: sampleCustomer,
      sample_detail: sampleDetail,
      sample_customer_keys: sampleCustomer ? Object.keys(sampleCustomer) : [],
      sample_detail_keys: sampleDetail ? Object.keys(sampleDetail) : [],
    }, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String((e as Error).message || e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
