// portal-offline-retry: cron 1×/min que reprocessa leads parados em worker_offline.
// Estratégia: chama dispatchPortalWorker para cada lead candidato (até MAX_PER_RUN).
// Após N tentativas sem sucesso (MAX_RETRIES), marca como automation_failed.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { dispatchPortalWorker } from "../_shared/portal-worker.ts";
import { captureError } from "../_shared/audit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_PER_RUN = 10;
const MAX_RETRIES = 30;          // 30 min de tentativas (1/min)
const LOOKBACK_HOURS = 24;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const cutoff = new Date(Date.now() - LOOKBACK_HOURS * 3600_000).toISOString();

  // 1) Leads parados em worker_offline (caminho original).
  //    NÃO retentar blocked_missing_documents — docs ilegíveis precisam de
  //    reanexo humano; loop 1/min só martela o worker e queima confiança.
  const { data: offlineLeads, error } = await supabase
    .from("customers")
    .select("id, name, portal_retry_count, finalized_at, portal_last_retry_at, portal2_status, last_portal_dispatch_error")
    .eq("status", "worker_offline")
    .gte("finalized_at", cutoff)
    .order("portal_last_retry_at", { ascending: true, nullsFirst: true })
    .limit(MAX_PER_RUN * 2);

  if (error) {
    console.error("[portal-offline-retry] query error", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 2) Leads do loop de correção do Portal 2 cujo re-despacho NÃO confirmou
  //    (portal2_status='retry_ready' parado): o cliente corrigiu o dado mas o
  //    dispatchPortalWorker falhou (worker offline no momento) e nenhum outro
  //    caminho re-tenta. Sem isto o dado corrigido fica salvo mas nunca volta
  //    ao portal. Reprocessamos do mesmo jeito (dispatchPortalWorker).
  const retryCutoff = new Date(Date.now() - 2 * 60_000).toISOString(); // 2 min de "carência" pós-correção
  const { data: retryReadyLeads } = await supabase
    .from("customers")
    .select("id, name, portal_retry_count, finalized_at, portal_last_retry_at")
    .eq("portal2_status", "retry_ready")
    .lte("updated_at", retryCutoff)
    .order("portal_last_retry_at", { ascending: true, nullsFirst: true })
    .limit(MAX_PER_RUN);

  // Une as duas listas sem duplicar (offline tem prioridade).
  const seen = new Set<string>();
  const leads: any[] = [];
  for (const l of [...(offlineLeads || []), ...(retryReadyLeads || [])]) {
    if (seen.has(l.id)) continue;
    seen.add(l.id);
    // Docs quebrados: sai do loop automático (humano reanexa).
    const p2 = String(l.portal2_status || "");
    const err = String(l.last_portal_dispatch_error || "");
    if (
      p2 === "blocked_missing_documents" ||
      err.includes("Documentos obrigatórios") ||
      err.includes("docs_unreadable") ||
      err.includes("missing_documents")
    ) {
      continue;
    }
    leads.push(l);
    if (leads.length >= MAX_PER_RUN) break;
  }

  const results: any[] = [];
  for (const lead of leads || []) {
    const tries = (lead.portal_retry_count || 0) + 1;

    if (tries > MAX_RETRIES) {
      await supabase.from("customers").update({
        status: "automation_failed",
        error_message: `Worker offline após ${MAX_RETRIES} tentativas — intervenção manual necessária`,
      }).eq("id", lead.id);
      results.push({ id: lead.id, action: "abandoned", tries });
      continue;
    }

    const dispatch = await dispatchPortalWorker(supabase, lead.id);
    // Em sucesso: marca submitting. Para leads retry_ready, limpa o marcador
    // para não reprocessar em loop (o worker agora tem o job de novo).
    // Se docs ilegíveis: trava em missing_documents (cron não retenta).
    const patch: Record<string, unknown> = {
      portal_retry_count: tries,
      portal_last_retry_at: new Date().toISOString(),
    };
    if (dispatch.ok) {
      patch.status = "portal_submitting";
      patch.portal2_status = "submitting";
    } else if (dispatch.error === "missing_documents") {
      patch.status = "awaiting_manual_submit";
      patch.portal2_status = "blocked_missing_documents";
    }
    await supabase.from("customers").update(patch).eq("id", lead.id);

    results.push({
      id: lead.id,
      name: lead.name,
      tries,
      ok: dispatch.ok,
      mode: dispatch.mode,
      error: dispatch.error,
    });
  }

  console.log(`[portal-offline-retry] processed=${results.length}`, JSON.stringify(results));

  return new Response(JSON.stringify({ ok: true, processed: results.length, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
  } catch (err: any) {
    captureError(err, { tags: { function: "portal-offline-retry" } });
    return new Response(
      JSON.stringify({ ok: false, error: String(err?.message || err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
