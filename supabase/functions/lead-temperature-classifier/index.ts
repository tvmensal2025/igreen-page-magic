// lead-temperature-classifier
// Classifica leads com regras determinísticas (0 tokens) e IA lite só quando necessário.
//
// Modos:
//   POST { customer_id }                       → classifica 1 lead
//   POST { customer_ids: [...] }               → batch (até 25)
//   POST { consultant_id, scope: "stale_24h" } → re-classifica antigos / needs_reclassify
//   POST { consultant_id, scope: "all_unclassified" }
//   POST { customer_id, force_ai: true }       → força IA lite mesmo com regras ok

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { classifyByRules } from "../_shared/conversion/rule-classifier.ts";
import {
  resolveDraftWithOverrides,
  VALID_SHORTCUTS,
} from "../_shared/conversion/phrase-catalog.ts";
import { isLeadClassifiable } from "./origin-guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const MODEL = "google/gemini-3-flash-preview";

const RULE_CONFIDENCE_THRESHOLD = 0.85;

const TOOL_SCHEMA_LITE = {
  type: "function",
  function: {
    name: "classify_lead_lite",
    description: "Classifica lead iGreen. NÃO escreva mensagem — só escolha temperature e shortcut do catálogo.",
    parameters: {
      type: "object",
      properties: {
        temperature: {
          type: "string",
          enum: ["hot", "warm", "cold", "dead", "objection", "rescue"],
        },
        loss_reason: { type: "string", description: "Até 60 chars. null se hot." },
        main_doubt: { type: "string", description: "1 frase curta ou null." },
        main_objection: { type: "string", description: "1 frase curta ou null." },
        summary: { type: "string", description: "Resumo em 1-2 frases." },
        next_action: { type: "string", description: "Próxima ação concreta e curta." },
        next_msg_template_shortcut: {
          type: "string",
          enum: VALID_SHORTCUTS,
          description: "Atalho da frase pronta a enviar.",
        },
        conversion_chance: { type: "integer", description: "0-100." },
        signals: {
          type: "object",
          properties: {
            sent_bill: { type: "boolean" },
            mentioned_value: { type: "boolean" },
            asked_price: { type: "boolean" },
            mentioned_scam_fear: { type: "boolean" },
            asked_how_it_works: { type: "boolean" },
            said_no: { type: "boolean" },
            we_ghosted_them: { type: "boolean" },
          },
        },
      },
      required: ["temperature", "summary", "next_action", "next_msg_template_shortcut", "conversion_chance", "signals"],
    },
  },
};

async function callGeminiLite(messagesText: string, leadName: string | null) {
  const sys = `Especialista em conversão WhatsApp iGreen Energy. Escolha temperature e o shortcut de frase pronta mais adequado. NÃO invente mensagem — só classifique. PT-BR.`;
  const user = `Lead: ${leadName ?? "(sem nome)"}\n\nConversa:\n${messagesText}\n\nClassifique.`;

  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
      tools: [TOOL_SCHEMA_LITE],
      tool_choice: { type: "function", function: { name: "classify_lead_lite" } },
    }),
  });

  if (!r.ok) {
    if (r.status === 429) throw new Error("rate_limited");
    if (r.status === 402) throw new Error("no_credits");
    const t = await r.text();
    throw new Error(`gemini_${r.status}: ${t.slice(0, 200)}`);
  }
  const data = await r.json();
  const call = data?.choices?.[0]?.message?.tool_calls?.[0];
  if (!call?.function?.arguments) throw new Error("no_tool_call");
  return { args: JSON.parse(call.function.arguments), tokens: data?.usage?.total_tokens ?? null };
}

function formatMessages(msgs: any[]): string {
  return msgs
    .map((m: any) => {
      const who = m.message_direction === "outbound" ? "NÓS" : "LEAD";
      const ts = new Date(m.created_at).toLocaleString("pt-BR");
      const body = m.message_type && m.message_type !== "text"
        ? `[${m.message_type}] ${m.message_text ?? ""}`
        : (m.message_text ?? "");
      return `[${ts}] ${who}: ${body.slice(0, 400)}`;
    })
    .join("\n");
}

function hoursSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  return (Date.now() - new Date(iso).getTime()) / 3_600_000;
}

async function getConsultantName(sb: any, consultantId: string): Promise<string> {
  const { data } = await sb
    .from("consultants")
    .select("name, display_name")
    .eq("id", consultantId)
    .maybeSingle();
  return data?.display_name || data?.name || "";
}

/**
 * Carrega os overrides de frase do consultor a partir de
 * `conversion_phrase_catalog` (consultant_id = dono). Retorna um Map
 * shortcut → texto. Falha silenciosa: sem overrides o runtime cai no
 * catálogo embarcado (phrase-catalog.ts).
 */
async function loadConsultantOverrides(sb: any, consultantId: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const { data } = await sb
      .from("conversion_phrase_catalog")
      .select("shortcut, message_text")
      .eq("consultant_id", consultantId);
    for (const row of (data as Array<{ shortcut: string; message_text: string }>) ?? []) {
      if (row.shortcut && row.message_text) map.set(row.shortcut, row.message_text);
    }
  } catch (_) {
    /* tabela ausente ou erro → usa só o catálogo embarcado */
  }
  return map;
}

async function classifyOne(
  sb: any,
  customerId: string,
  opts: { forceAi?: boolean; overrides?: Map<string, string> } = {},
) {
  const { data: customer } = await sb
    .from("customers")
    .select("id, consultant_id, name, conversation_step, electricity_bill_value, last_bot_interaction_at, created_at, customer_origin")
    .eq("id", customerId)
    .maybeSingle();
  if (!customer) return { customer_id: customerId, skipped: "not_found" };

  // Clientes sincronizados do portal iGreen são carteira validada (aprovado,
  // reprovado, devolutiva) — não entram em temperatura/funil de leads. Guarda
  // única que cobre todos os caminhos (customer_id, customer_ids, scopes).
  if (!isLeadClassifiable(customer.customer_origin)) {
    return { customer_id: customerId, skipped: "igreen_sync" };
  }

  const { data: existing } = await sb
    .from("lead_insights")
    .select("messages_count_at_classify, needs_reclassify, classified_at")
    .eq("customer_id", customerId)
    .maybeSingle();

  const { data: msgs, error: msgsErr } = await sb
    .from("conversations")
    .select("message_direction, message_text, created_at, message_type")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(30);

  if (msgsErr) return { customer_id: customerId, error: `select_msgs: ${msgsErr.message}` };

  const recent = (msgs ?? []).reverse();
  if (recent.length === 0) return { customer_id: customerId, skipped: "no_messages" };

  if (
    !opts.forceAi &&
    existing?.classified_at &&
    !existing.needs_reclassify &&
    existing.messages_count_at_classify === recent.length
  ) {
    return { customer_id: customerId, skipped: "cache", source: "cache" };
  }

  const ref = customer.last_bot_interaction_at || customer.created_at;
  const hoursStuck = hoursSince(ref);
  const consultantName = await getConsultantName(sb, customer.consultant_id);

  const ruleResult = classifyByRules({
    messages: recent,
    conversationStep: customer.conversation_step ?? null,
    hoursStuck,
    billValue: customer.electricity_bill_value != null ? Number(customer.electricity_bill_value) : null,
    customerName: customer.name ?? null,
  });

  let source: "rules" | "ai_lite" = "rules";
  let tokens: number | null = 0;
  let payload: {
    temperature: string;
    loss_reason: string | null;
    main_doubt: string | null;
    main_objection: string | null;
    summary: string;
    next_action: string;
    shortcut: string;
    conversion_chance: number;
    signals: Record<string, boolean>;
  };

  if (ruleResult.confidence >= RULE_CONFIDENCE_THRESHOLD && !opts.forceAi) {
    payload = {
      temperature: ruleResult.temperature,
      loss_reason: ruleResult.loss_reason,
      main_doubt: ruleResult.main_doubt,
      main_objection: ruleResult.main_objection,
      summary: ruleResult.summary,
      next_action: ruleResult.next_action,
      shortcut: ruleResult.shortcut,
      conversion_chance: ruleResult.conversion_chance,
      signals: { ...ruleResult.signals },
    };
  } else {
    try {
      const { args, tokens: used } = await callGeminiLite(formatMessages(recent), customer.name);
      source = "ai_lite";
      tokens = used;
      const shortcut = args.next_msg_template_shortcut || ruleResult.shortcut;
      payload = {
        temperature: args.temperature || ruleResult.temperature,
        loss_reason: args.loss_reason ?? ruleResult.loss_reason,
        main_doubt: args.main_doubt ?? ruleResult.main_doubt,
        main_objection: args.main_objection ?? ruleResult.main_objection,
        summary: args.summary || ruleResult.summary,
        next_action: args.next_action || ruleResult.next_action,
        shortcut,
        conversion_chance: Math.max(0, Math.min(100, args.conversion_chance ?? ruleResult.conversion_chance)),
        signals: { ...ruleResult.signals, ...(args.signals ?? {}) },
      };
    } catch (e) {
      // Fallback rules sem gastar tokens
      payload = {
        temperature: ruleResult.temperature,
        loss_reason: ruleResult.loss_reason,
        main_doubt: ruleResult.main_doubt,
        main_objection: ruleResult.main_objection,
        summary: ruleResult.summary,
        next_action: ruleResult.next_action,
        shortcut: ruleResult.shortcut,
        conversion_chance: ruleResult.conversion_chance,
        signals: { ...ruleResult.signals },
      };
      source = "rules";
    }
  }

  const { draft } = resolveDraftWithOverrides(
    payload.shortcut,
    {
      name: customer.name,
      electricity_bill_value: customer.electricity_bill_value != null
        ? Number(customer.electricity_bill_value)
        : null,
    },
    consultantName,
    opts.overrides,
  );

  const upsert = {
    customer_id: customerId,
    consultant_id: customer.consultant_id,
    temperature: payload.temperature,
    loss_reason: payload.loss_reason,
    main_doubt: payload.main_doubt,
    main_objection: payload.main_objection,
    summary: payload.summary,
    next_action: payload.next_action,
    next_msg_draft: draft || null,
    next_msg_template_shortcut: payload.shortcut,
    conversion_chance: payload.conversion_chance,
    signals: payload.signals,
    model_used: source === "ai_lite" ? MODEL : "rules",
    tokens_used: tokens,
    classification_source: source,
    classified_at: new Date().toISOString(),
    messages_count_at_classify: recent.length,
    needs_reclassify: false,
  };

  const { error } = await sb.from("lead_insights").upsert(upsert, { onConflict: "customer_id" });
  if (error) return { customer_id: customerId, error: error.message };
  return {
    customer_id: customerId,
    temperature: payload.temperature,
    chance: payload.conversion_chance,
    source,
    shortcut: payload.shortcut,
    tokens_used: tokens,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const sb = createClient(SUPABASE_URL, SERVICE_ROLE);
    const body = await req.json().catch(() => ({}));
    const forceAi = body.force_ai === true;

    let ids: string[] = [];
    if (body.customer_id) ids = [body.customer_id];
    else if (Array.isArray(body.customer_ids)) ids = body.customer_ids.slice(0, 25);
    else if (body.consultant_id && (body.scope === "stale_24h" || body.scope === "all_unclassified")) {
      const { data } = await sb
        .from("customers")
        .select("id, lead_insights(classified_at, needs_reclassify)")
        .eq("consultant_id", body.consultant_id)
        .neq("customer_origin", "igreen_sync")
        .limit(1000);
      const cutoff = Date.now() - 24 * 3600 * 1000;
      const onlyUnclassified = body.scope === "all_unclassified";
      ids = (data ?? [])
        .filter((c: any) => {
          const li = c.lead_insights;
          if (!li || (Array.isArray(li) && li.length === 0)) return true;
          const row = Array.isArray(li) ? li[0] : li;
          if (!row.classified_at) return true;
          if (onlyUnclassified) return false;
          if (row.needs_reclassify) return true;
          return new Date(row.classified_at).getTime() < cutoff;
        })
        .map((c: any) => c.id)
        .slice(0, 25);
    } else if (body.scope === "needs_reclassify_global") {
      // Cron diário leve: varre leads marcados needs_reclassify=true em TODOS os
      // consultores. Seguro porque o caminho rules custa 0 tokens; AI lite só
      // entra em casos ambíguos. Rede de segurança — o uso real é coberto pela
      // classificação sob demanda (abertura da Central + envio).
      // Inner join com customers excluindo igreen_sync: carteira validada não
      // entra em temperatura, e isso evita repescar resíduo em loop ocioso.
      const limit = Math.min(Number(body.limit) || 100, 200);
      const { data } = await sb
        .from("lead_insights")
        .select("customer_id, customers!inner(customer_origin)")
        .eq("needs_reclassify", true)
        .neq("customers.customer_origin", "igreen_sync")
        .order("updated_at", { ascending: true })
        .limit(limit);
      ids = (data ?? []).map((r: any) => r.customer_id);
    }

    if (ids.length === 0) {
      return new Response(JSON.stringify({ processed: 0, message: "no targets" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Cache de overrides do catálogo por consultor (1 query por consultor,
    // reaproveitada entre os leads dele no mesmo request).
    const overridesByConsultant = new Map<string, Map<string, string>>();
    async function overridesFor(consultantId: string): Promise<Map<string, string>> {
      const cached = overridesByConsultant.get(consultantId);
      if (cached) return cached;
      const loaded = await loadConsultantOverrides(sb, consultantId);
      overridesByConsultant.set(consultantId, loaded);
      return loaded;
    }

    const results: any[] = [];
    for (const id of ids) {
      try {
        // Resolve o consultor do lead para carregar os overrides certos.
        const { data: own } = await sb
          .from("customers")
          .select("consultant_id")
          .eq("id", id)
          .maybeSingle();
        const overrides = own?.consultant_id
          ? await overridesFor(own.consultant_id)
          : undefined;
        results.push(await classifyOne(sb, id, { forceAi, overrides }));
      } catch (e) {
        results.push({ customer_id: id, error: (e as Error).message });
        if ((e as Error).message === "rate_limited" || (e as Error).message === "no_credits") break;
      }
    }

    const byRules = results.filter((r) => r.source === "rules").length;
    const byAi = results.filter((r) => r.source === "ai_lite").length;
    const cached = results.filter((r) => r.skipped === "cache").length;

    return new Response(JSON.stringify({
      processed: results.length,
      stats: { rules: byRules, ai_lite: byAi, cache: cached },
      results,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("classifier error", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
