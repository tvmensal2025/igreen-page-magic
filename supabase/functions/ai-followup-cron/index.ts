// AI Follow-up Cron — roda a cada 15 min via pg_cron.
// Busca leads cujo next_followup_at já venceu e aciona o ai-sales-agent
// para a IA decidir a próxima ação (mensagem de resgate, mídia, etc).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { isQuietHourBRT, logQuietSkip } from "../_shared/quiet-hours.ts";
import { isConsultantAIDisabled } from "../_shared/bot/paused.ts";
import { isBotGloballyEnabled } from "../_shared/bot/global-flag.ts";
import { filterSendableCustomers } from "../_shared/cron-pause-batch.ts";
import { executarFollowupCerebro } from "../_shared/cerebro/followup-hook.ts";
import { createWhapiSender } from "../_shared/whapi-api.ts";
import { createEvolutionSender } from "../_shared/evolution-api.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/**
 * Resolve o sender (Whapi/Evolution) do consultor pela `whatsapp_instances`,
 * espelhando a resolução de canal do `process-followups`. Devolve `null` quando
 * não há canal disponível (fail-open: o turno cai na Vendedora_Atual).
 */
async function resolverSender(
  supabase: any,
  consultantId: string,
  creds: { whapiToken: string; whapiBaseUrl: string; evolutionUrl: string; evolutionKey: string },
): Promise<{ sender: any; channel: "whapi" | "evolution" } | null> {
  const { data: inst } = await supabase
    .from("whatsapp_instances")
    .select("instance_name, status")
    .eq("consultant_id", consultantId)
    .eq("status", "connected")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (inst?.instance_name && /^whapi/i.test(inst.instance_name) && creds.whapiToken) {
    return { sender: createWhapiSender(creds.whapiToken, creds.whapiBaseUrl), channel: "whapi" };
  }
  if (inst?.instance_name && creds.evolutionUrl && creds.evolutionKey) {
    return {
      sender: createEvolutionSender(creds.evolutionUrl, creds.evolutionKey, inst.instance_name),
      channel: "evolution",
    };
  }
  if (creds.whapiToken) {
    return { sender: createWhapiSender(creds.whapiToken, creds.whapiBaseUrl), channel: "whapi" };
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (isQuietHourBRT()) {
    logQuietSkip("ai-followup-cron");
    return new Response(JSON.stringify({ skipped: "quiet_hours" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  if (!(await isBotGloballyEnabled(supabase))) {
    return new Response(JSON.stringify({ skipped: "bot_globally_disabled" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const startedAt = Date.now();
  const nowIso = new Date().toISOString();

  try {
    const { data: leads, error } = await supabase
      .from("customers")
      .select("id, consultant_id, phone_whatsapp, sales_phase, name")
      .lte("next_followup_at", nowIso)
      .not("next_followup_at", "is", null)
      .neq("sales_phase", "perdido")
      .neq("status", "completed")
      .eq("bot_paused", false)
      .is("assigned_human_id", null)
      .or("bot_paused_until.is.null,bot_paused_until.lt." + nowIso)
      .limit(50);

    if (error) throw error;

    // Semana 1 do rollout v3: também filtra por customer_flow_state.status.
    // Fail-open: sem linha em customer_flow_state, passa (legado já aprovou).
    const allowedIds = new Set(
      await filterSendableCustomers(supabase, (leads ?? []).map((l: any) => l.id), { cronName: "ai-followup-cron" }),
    );
    const filteredLeads = (leads ?? []).filter((l: any) => allowedIds.has(l.id));

    // Credenciais de canal (carregadas uma vez) — usadas apenas quando o
    // consultor está em `flow_engine_v3 = on` e o nudge vai pelo Cérebro, que
    // envia in-process. Enquanto não está em `on`, o envio continua via
    // `ai-sales-agent` (caminho atual, sem mudança).
    const { data: settingsRows } = await supabase.from("settings").select("key, value");
    const settings: Record<string, string> = {};
    (settingsRows || []).forEach((s: any) => { settings[s.key] = s.value; });
    const creds = {
      whapiToken: settings.whapi_token || Deno.env.get("WHAPI_TOKEN") || "",
      whapiBaseUrl: settings.whapi_api_url || "https://gate.whapi.cloud",
      evolutionUrl: Deno.env.get("EVOLUTION_API_URL") || "",
      evolutionKey: Deno.env.get("EVOLUTION_API_KEY") || "",
    };

    const results: Array<{ id: string; ok: boolean; error?: string; reason?: string }> = [];

    for (const lead of filteredLeads) {
      // 🛑 Gate global: se a IA do consultor está desligada, pula sem disparar
      // mensagem. Limpa o slot pra não reprocessar a cada execução.
      if (await isConsultantAIDisabled(supabase, lead.consultant_id)) {
        await supabase.from("customers").update({ next_followup_at: null }).eq("id", lead.id);
        results.push({ id: lead.id, ok: true, reason: "skipped_global_ai_off" });
        continue;
      }

      // ⚠️ REGRA: IA só atende clientes que escreveram primeiro no WhatsApp.
      // Nunca iniciamos conversa proativa. Se não houver nenhuma mensagem
      // inbound desse cliente, limpamos o slot e pulamos.
      // inbound desse cliente, limpamos o slot e pulamos.
      const { count: inboundCount } = await supabase
        .from("conversations")
        .select("id", { count: "exact", head: true })
        .eq("customer_id", lead.id)
        .eq("message_direction", "inbound")
        .limit(1);

      if (!inboundCount || inboundCount === 0) {
        await supabase.from("customers").update({ next_followup_at: null }).eq("id", lead.id);
        results.push({ id: lead.id, ok: true, reason: "skipped_no_inbound" });
        continue;
      }

      try {
        // Limpa o slot ANTES para evitar reprocessamento em caso de falha do agent.
        await supabase
          .from("customers")
          .update({ next_followup_at: null })
          .eq("id", lead.id);

        // Religação ao Cérebro (Tarefa 13 / Req 14.1, 14.2): quando o consultor
        // está com `flow_engine_v3 = on`, o nudge de reativação passa pelo
        // Cérebro (N1) com um inbound sintético `no_input`. O Cérebro gera e nós
        // enviamos in-process pelo canal do consultor. Em QUALQUER outro estágio
        // (off/dark/canary) — ou em QUALQUER erro/sem canal/sem texto —, caímos
        // no caminho atual (`ai-sales-agent`), preservando o comportamento.
        let usouCerebro = false;
        try {
          const resolved = await resolverSender(supabase, lead.consultant_id, creds);
          if (resolved) {
            const cerebro = await executarFollowupCerebro({
              supabase,
              customerId: lead.id,
              consultantId: lead.consultant_id,
              channel: resolved.channel,
            });
            if (cerebro.usouCerebro && cerebro.reply && lead.phone_whatsapp) {
              const remoteJid = `${lead.phone_whatsapp}@s.whatsapp.net`;
              const sent = await resolved.sender.sendText(remoteJid, cerebro.reply);
              if (sent !== false) {
                await supabase.from("conversations").insert({
                  customer_id: lead.id,
                  message_direction: "outbound",
                  message_text: cerebro.reply,
                  message_type: "text",
                  conversation_step: "cerebro_followup",
                });
                usouCerebro = true;
                results.push({ id: lead.id, ok: true, reason: "cerebro_on" });
              }
            }
          }
        } catch (e: any) {
          // Fail-open: erro no Cérebro NUNCA impede o follow-up — cai no agent.
          console.warn("[ai-followup-cron] cérebro falhou (fail-open → agent):", e?.message ?? e);
        }

        if (usouCerebro) continue;

        const resp = await fetch(`${SUPABASE_URL}/functions/v1/ai-sales-agent`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({
            customer_id: lead.id,
            consultant_id: lead.consultant_id,
            phone: lead.phone_whatsapp,
            user_input: "[FOLLOWUP_CRON]",
            user_input_kind: "system",
            trigger: "followup",
          }),
        });

        results.push({ id: lead.id, ok: resp.ok, error: resp.ok ? undefined : `HTTP ${resp.status}` });
      } catch (e: any) {
        results.push({ id: lead.id, ok: false, error: e?.message ?? String(e) });
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        processed: results.length,
        success: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        latency_ms: Date.now() - startedAt,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("[ai-followup-cron] erro:", e);
    return new Response(JSON.stringify({ ok: false, error: e?.message ?? String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
