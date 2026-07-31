// =============================================================================
// igreen-endpoint-probe
// Dispara o /probe-all no worker-igreen-sync e persiste os resultados na
// tabela public.igreen_endpoint_discovery (upsert por method+path).
//
// Body opcional:
//   { consultant_id?: string }  → se ausente, usa o primeiro consultor com
//                                  credenciais iGreen configuradas.
//
// Segurança:
//   - service_role / x-service-secret / JWT admin (has_role|is_super_admin).
//   - Só executa GETs no worker; nada é escrito na iGreen.
// =============================================================================
import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { resolveIgreenSyncWorker } from "../_shared/igreen-sync-worker.ts";
import { isServiceRoleAuth } from "../_shared/service-role-auth.ts";
import { resolveCaller } from "../_shared/caller-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-service-secret",
};

// deno-lint-ignore no-explicit-any
async function resolveWorker(supabase: any): Promise<{ url: string; secret: string } | null> {
  return resolveIgreenSyncWorker(supabase);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    if (!isServiceRoleAuth(req)) {
      const caller = await resolveCaller(req, supabase as any);
      if (caller instanceof Response) return caller;
      if (caller.mode === "jwt" && !caller.isAdmin) {
        return new Response(JSON.stringify({ ok: false, error: "forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Descobre credenciais iGreen do primeiro consultor com portal_email/portal_password.
    const body = await req.json().catch(() => ({}));
    const consultantId = (body?.consultant_id as string) || null;

    let query = supabase
      .from("igreen_consultant_credentials")
      .select("consultant_id, portal_email, portal_password")
      .not("portal_email", "is", null)
      .not("portal_password", "is", null)
      .limit(1);
    if (consultantId) query = query.eq("consultant_id", consultantId);
    const { data: creds } = await query;
    const cred = creds?.[0];

    // Fallback para variáveis globais (setup inicial)
    const email = cred?.portal_email || Deno.env.get("IGREEN_PORTAL_EMAIL") || "";
    const password = cred?.portal_password || Deno.env.get("IGREEN_PORTAL_PASSWORD") || "";

    if (!email || !password) {
      return new Response(JSON.stringify({ ok: false, error: "credenciais iGreen ausentes" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const worker = await resolveWorker(supabase);
    if (!worker) {
      return new Response(JSON.stringify({ ok: false, error: "worker iGreen não configurado" }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 240_000);
    const res = await fetch(`${worker.url}/probe-all`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Worker-Token": worker.secret },
      body: JSON.stringify({ portal_email: email, portal_password: password }),
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timeout));

    const payload = await res.json().catch(() => ({}));
    if (!res.ok || !payload?.ok) {
      return new Response(JSON.stringify({ ok: false, error: payload?.error || `worker http ${res.status}` }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results = Array.isArray(payload.results) ? payload.results : [];
    const now = new Date().toISOString();
    const rows = results.map((r: Record<string, unknown>) => ({
      method: r.method, path: r.path, category: r.category ?? null,
      status: r.status ?? null, content_type: r.content_type ?? null,
      bytes: r.bytes ?? null, ms: r.ms ?? null,
      sample_body: r.sample_body ?? null,
      is_alive: Boolean(r.is_alive),
      bucket: r.bucket ?? null, notes: r.notes ?? null,
      checked_at: now,
    }));

    if (rows.length > 0) {
      // upsert por (method, path) — mantém histórico via updated_at (trigger).
      const { error } = await supabase
        .from("igreen_endpoint_discovery")
        .upsert(rows, { onConflict: "method,path" });
      if (error) {
        return new Response(JSON.stringify({ ok: false, error: `db: ${error.message}` }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      total: payload.total, summary: payload.summary, elapsed_ms: payload.elapsed_ms,
      persisted: rows.length,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
