// HTTP wrapper repurpose pro Cérebro IA — tester admin "Testar lead simulado".
//
// POST /functions/v1/fluxo-b-ai
// body: { customerId: string, consultantId?: string, inboundText: string, dryRun?: boolean }
//
// Quando dryRun=true, intercepta writes (insert/update/upsert/delete) num proxy
// para o Cérebro rodar sem persistir nada — usado pelo modal admin.
//
// A edge mantém o nome "fluxo-b-ai" por compatibilidade com o painel
// (FluxoBEditor). Internamente roda 100% via Cérebro IA (processarTurno).

import { createClient } from "npm:@supabase/supabase-js@2.50.0";
import { processarTurno } from "../_shared/cerebro/index.ts";
import type { ChannelCapabilities } from "../_shared/cerebro/tipos.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function defaultCapabilities(): ChannelCapabilities {
  return {
    channel: "whapi",
    supportsButtons: true,
    maxButtons: 3,
    supportsList: true,
    supportsAudio: true,
    supportsVideo: true,
    supportsTypingPresence: true,
    supportsReactions: false,
    inboundIdField: "wa_id",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: any;
  try { body = await req.json(); } catch (_) { return json({ error: "invalid_json" }, 400); }

  const customerId = String(body?.customerId || "").trim();
  const consultantId = String(body?.consultantId || "").trim();
  const inboundText = String(body?.inboundText || "").trim();
  const dryRun = Boolean(body?.dryRun);

  if (!inboundText) return json({ error: "missing_inboundText" }, 400);
  if (!customerId) return json({ error: "missing_customerId" }, 400);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("VITE_SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "supabase_env_missing" }, 500);

  const realSupabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // Proxy fail-open de dryRun (intercepta writes para não persistir).
  let supabase: any = realSupabase;
  const dryLog: any[] = [];
  if (dryRun) {
    const origFrom = realSupabase.from.bind(realSupabase);
    supabase = new Proxy(realSupabase, {
      get(target: any, prop: string) {
        if (prop === "__dryRunLog") return dryLog;
        if (prop === "from") {
          return (table: string) => {
            const real = origFrom(table);
            return new Proxy(real, {
              get(t: any, p: string) {
                if (p === "update" || p === "insert" || p === "delete" || p === "upsert") {
                  return (..._args: any[]) => {
                    dryLog.push({ table, op: p, args: _args });
                    const noop: any = { error: null, data: null };
                    noop.eq = () => noop;
                    noop.select = () => noop;
                    noop.maybeSingle = () => Promise.resolve({ error: null, data: null });
                    noop.single = () => Promise.resolve({ error: null, data: null });
                    noop.then = (cb: any) => cb({ error: null, data: null });
                    return noop;
                  };
                }
                return typeof t[p] === "function" ? t[p].bind(t) : t[p];
              },
            });
          };
        }
        return typeof target[prop] === "function" ? target[prop].bind(target) : target[prop];
      },
    });
  }

  const started = Date.now();
  try {
    // Resolve consultantId se não veio
    let resolvedConsultantId = consultantId;
    if (!resolvedConsultantId) {
      const { data: c } = await realSupabase
        .from("customers").select("consultant_id").eq("id", customerId).maybeSingle();
      resolvedConsultantId = String((c as any)?.consultant_id || "").trim();
    }
    if (!resolvedConsultantId) return json({ error: "consultant_not_found" }, 400);

    const resultado = await processarTurno({
      supabase,
      customerId,
      consultantId: resolvedConsultantId,
      inbound: { kind: "text", text: inboundText },
      canalCapabilities: defaultCapabilities(),
    });

    return json({
      reply: resultado.reply || "",
      toolsApplied: resultado.acoesCadastro?.map((a: any) => a.tipo) || [],
      conversationStepUpdate: null,
      shouldHandoff: !!resultado.shouldHandoff,
      modelUsed: "cerebro.processarTurno",
      latencyMs: Date.now() - started,
      customerUpdates: {},
      variantId: dryRun ? "dryRun" : "live",
      debug: dryRun ? { dryRunLog: dryLog, resultado } : { resultado },
    });
  } catch (e: any) {
    return json({
      error: "cerebro_error",
      message: String(e?.message || e).slice(0, 500),
      latencyMs: Date.now() - started,
    }, 500);
  }
});
