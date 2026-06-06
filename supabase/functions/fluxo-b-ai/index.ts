// HTTP wrapper para o Fluxo B AI.
// Usado pelo painel admin (modal "Testar com lead simulado") para conversar
// com a IA sem mandar mensagens reais via Whapi.
//
// POST /functions/v1/fluxo-b-ai
// body: { customerId: string, inboundText: string, dryRun?: boolean }
// retorna: { reply, toolsApplied, conversationStepUpdate, shouldHandoff, modelUsed, latencyMs }
//
// Quando dryRun=true, NÃO persiste nada no banco — apenas roda a IA e devolve.
// Útil pro tester do painel.

import { createClient } from "npm:@supabase/supabase-js@2.50.0";
import { runFluxoBAI } from "../_shared/fluxo-b-ai.ts";

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
  if (!customerId && !consultantId) return json({ error: "missing_customerId_or_consultantId" }, 400);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("VITE_SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "supabase_env_missing" }, 500);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // Em dryRun: intercepta updates/inserts pra não persistir
  let supaForRun: any = supabase;
  // override map: tabela -> função (table) => builder; checada antes do dryRun proxy.
  const fromOverrides: Record<string, (table: string) => any> = {};
  if (dryRun) {
    const log: any[] = [];
    const origFrom = supabase.from.bind(supabase);
    supaForRun = new Proxy(supabase, {
      get(target: any, prop: string) {
        if (prop === "__dryRunLog") return log;
        if (prop === "__fromOverrides") return fromOverrides;
        if (prop === "from") {
          return (table: string) => {
            const override = fromOverrides[table];
            if (override) return override(table);
            const real = origFrom(table);
            return new Proxy(real, {
              get(t: any, p: string) {
                if (p === "update" || p === "insert" || p === "delete" || p === "upsert") {
                  return (..._args: any[]) => {
                    log.push({ table, op: p, args: _args });
                    return {
                      eq: () => ({ error: null, data: null }),
                      select: () => ({ error: null, data: null }),
                      then: (cb: any) => cb({ error: null, data: null }),
                    };
                  };
                }
                return t[p]?.bind ? t[p].bind(t) : t[p];
              },
            });
          };
        }
        return target[prop]?.bind ? target[prop].bind(target) : target[prop];
      },
    });
  }

  // Em dryRun sem customerId: monta lead/consultor sintéticos
  let syntheticCustomer: any = undefined;
  let syntheticConsultant: any = undefined;
  let effectiveCustomerId = customerId;

  if (dryRun && !customerId && consultantId) {
    const { data: cons, error: consErr } = await supabase
      .from("consultants")
      .select("id, name, ai_persona_fluxo_b, ai_persona_fluxo_b_temperature, ai_persona_fluxo_b_cascade_enabled")
      .eq("id", consultantId)
      .maybeSingle();
    if (consErr || !cons) return json({ error: `consultor não encontrado: ${consErr?.message || consultantId}` }, 400);
    syntheticConsultant = cons;
    effectiveCustomerId = "00000000-0000-0000-0000-000000000000";
    syntheticCustomer = {
      id: effectiveCustomerId,
      consultant_id: cons.id,
      name: null,
      electricity_bill_value: null,
      conversation_step: null,
      conversation_summary: null,
      bot_paused: false,
      flow_variant: "B",
      // overrides vindos do cliente (state acumulado entre turnos no tester)
      ...(body?.customerState && typeof body.customerState === "object" ? body.customerState : {}),
    };
  }

  // History override (tester mantém o histórico no front, já que dryRun não persiste em conversations)
  const syntheticHistory: Array<{ role: "user" | "assistant"; content: string }> | undefined =
    dryRun && Array.isArray(body?.history) ? body.history.slice(-40) : undefined;
  if (syntheticHistory && syntheticHistory.length > 0 && dryRun) {
    // Registra override no map — o proxy intercepta sem reatribuição recursiva.
    (supaForRun as any).__fromOverrides["conversations"] = (_table: string) => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: async () => ({
              data: syntheticHistory.map((m) => ({
                message_direction: m.role === "assistant" ? "outbound" : "inbound",
                message_text: m.content,
                message_type: "text",
                created_at: new Date().toISOString(),
              })),
              error: null,
            }),
          }),
        }),
      }),
    });
  }

  try {
    const result = await runFluxoBAI({
      supabase: supaForRun,
      customerId: effectiveCustomerId,
      inboundText,
      customer: syntheticCustomer,
      consultant: syntheticConsultant,
    });
    const dryRunLog = dryRun ? (supaForRun as any).__dryRunLog : undefined;
    return json({ ok: true, ...result, dryRun, dryRunLog });
  } catch (e) {
    console.error("[fluxo-b-ai] erro:", (e as Error).message);
    return json({ error: (e as Error).message || "unknown" }, 500);
  }
});
