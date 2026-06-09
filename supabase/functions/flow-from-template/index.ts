// Edge: flow-from-template
//
// Recebe um FlowTemplateConfig do admin e persiste o fluxo gerado em
// `bot_flows` + `bot_flow_steps`. Resolve referências (goto_step_key →
// goto_step_id) após os UUIDs serem gerados pelo Postgres.
//
// Garantias:
//  - Idempotente por (consultant_id, variant) — se já existe fluxo
//    ativo daquela variante, retorna erro pra evitar sobrescrever sem
//    intenção (admin tem que desativar o existente antes).
//  - Atômico via transação implícita do Postgres (todos os steps em 1
//    INSERT batch).
//  - Retorna `flow_id` + `step_ids` + lista de mídias necessárias.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { generateFlowFromTemplate } from "../_shared/flow-templates/engine.ts";
import type { FlowTemplateConfig } from "../_shared/flow-templates/types.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization") || "";
    if (!auth.startsWith("Bearer ")) return json({ error: "missing_auth" }, 401);

    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: auth } },
    });
    const { data: userRes } = await userClient.auth.getUser();
    const user = userRes?.user;
    if (!user) return json({ error: "unauthenticated" }, 401);

    const body: { config: FlowTemplateConfig; consultantId?: string } =
      await req.json().catch(() => ({} as any));
    if (!body?.config) return json({ error: "missing_config" }, 400);

    const svc = createClient(SUPABASE_URL, SERVICE_ROLE);
    const consultantId = String(body.consultantId || user.id);

    // Authz: consultor dono OU admin
    if (consultantId !== user.id) {
      const { data: roles } = await svc.from("user_roles").select("role").eq("user_id", user.id);
      const isAdmin = (roles || []).some((r: any) =>
        ["admin", "super_admin", "superadmin"].includes(String(r.role)),
      );
      if (!isAdmin) return json({ error: "forbidden" }, 403);
    }

    const config = body.config;
    if (!/^[A-Z]$/.test(String(config.variant || ""))) {
      return json({ error: "invalid_variant", detail: `Variant '${config.variant}' inválida (use A-Z)` }, 400);
    }

    // Verifica fluxo existente da mesma variante
    const { data: existing } = await svc
      .from("bot_flows")
      .select("id, name, is_active")
      .eq("consultant_id", consultantId)
      .eq("variant", config.variant)
      .eq("is_active", true);
    if (existing && existing.length > 0) {
      return json({
        error: "flow_already_exists",
        detail: `Já existe um fluxo ativo na variante ${config.variant}: '${(existing[0] as any).name}'. Desative ou exclua antes de criar um novo.`,
        existing_flow_id: (existing[0] as any).id,
      }, 409);
    }

    // Gera o fluxo declarativo
    const generated = generateFlowFromTemplate(config);

    // Cria bot_flow
    const { data: flow, error: flowErr } = await svc
      .from("bot_flows")
      .insert({
        consultant_id: consultantId,
        variant: config.variant,
        name: config.flowName || `Fluxo ${config.variant}`,
        is_active: true,
      })
      .select("id")
      .single();
    if (flowErr || !flow?.id) {
      return json({ error: "flow_insert_failed", detail: flowErr?.message }, 500);
    }
    const flowId = (flow as any).id as string;

    // Insere steps em batch (sem goto_step_id ainda)
    const insertRows = generated.steps.map((s) => ({
      flow_id: flowId,
      step_key: s.step_key,
      step_type: s.step_type,
      position: s.position,
      is_active: s.is_active,
      message_text: s.message_text,
      slot_key: s.slot_key,
      wait_for: s.wait_for,
      text_delay_ms: s.text_delay_ms,
      captures: s.captures,
      transitions: s.transitions, // ainda com goto_step_key (sem id)
      fallback: s.fallback,
    }));

    const { data: insertedSteps, error: stepErr } = await svc
      .from("bot_flow_steps")
      .insert(insertRows)
      .select("id, step_key, transitions, fallback");
    if (stepErr || !insertedSteps) {
      // Rollback manual
      await svc.from("bot_flows").delete().eq("id", flowId);
      return json({ error: "steps_insert_failed", detail: stepErr?.message }, 500);
    }

    // Resolve goto_step_key → goto_step_id
    const keyToId: Record<string, string> = {};
    for (const s of insertedSteps as any[]) {
      keyToId[s.step_key] = s.id;
    }

    const updates: Array<{ id: string; transitions: any; fallback: any }> = [];
    for (const s of insertedSteps as any[]) {
      const newTransitions = Array.isArray(s.transitions)
        ? s.transitions.map((t: any) => {
            if (t.goto_step_key && !t.goto_step_id) {
              const id = keyToId[t.goto_step_key];
              return { ...t, goto_step_id: id, goto_step_key: undefined };
            }
            return t;
          })
        : s.transitions;
      const newFallback = s.fallback?.goto_step_key && !s.fallback?.goto_step_id
        ? { ...s.fallback, goto_step_id: keyToId[s.fallback.goto_step_key], goto_step_key: undefined }
        : s.fallback;
      if (JSON.stringify(newTransitions) !== JSON.stringify(s.transitions)
          || JSON.stringify(newFallback) !== JSON.stringify(s.fallback)) {
        updates.push({ id: s.id, transitions: newTransitions, fallback: newFallback });
      }
    }

    // Aplica updates de resolução
    for (const u of updates) {
      await svc.from("bot_flow_steps")
        .update({ transitions: u.transitions, fallback: u.fallback })
        .eq("id", u.id);
    }

    return json({
      ok: true,
      flow_id: flowId,
      steps_inserted: insertedSteps.length,
      refs_resolved: updates.length,
      media_requirements: generated.mediaRequirements,
      warnings: generated.warnings,
    });
  } catch (e) {
    console.error("[flow-from-template] erro:", e);
    return json({ error: "internal", detail: String((e as Error)?.message || e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
