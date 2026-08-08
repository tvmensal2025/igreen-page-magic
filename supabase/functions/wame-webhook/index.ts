/**
 * WAME Webhook — canal PILOTO (api-wa.me), paralelo ao Whapi.
 *
 * Fase 1 (observação): só RECEBE. Grava o lead e a mensagem em
 * `conversations` e para por aí. NÃO chama bot-flow, NÃO chama Cérebro,
 * NÃO dispara cadência. O consultor responde pelo CRM.
 *
 * Por que o lead nasce com `bot_paused = true`:
 *   `cadence-tick` e o bot varrem `customers` por status/step, não por canal.
 *   Sem a pausa, um lead do piloto entraria na cadência A/B/C e o número novo
 *   começaria a disparar sozinho — exatamente o que o piloto não pode fazer.
 *   Para ligar o funil no WAME depois, é só remover a pausa (e aí sim rotear
 *   para o motor), sem tocar em nada do Whapi.
 *
 * Configuração (settings, todas opcionais — sem elas o endpoint só loga):
 *   wame_server              https://us.api-wa.me
 *   wame_api_key             chave da instância (vai no path da URL)
 *   wame_instance_name       default `wame-piloto`
 *   wame_pilot_consultant_id dono dos leads; default superadmin_consultant_id
 *
 * Endpoint: POST /wame-webhook   (verify_jwt = false; provedor externo)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAdapter } from "../_shared/channels/index.ts";
import { checkAndMarkProcessed } from "../_shared/audit.ts";
import { verifyWebhookOrigin } from "../_shared/webhook-auth.ts";
import { summarizeWebhookBody } from "../_shared/log-redact.ts";
import { logStructured } from "../_shared/utils.ts";
import { findCustomerForInboundPhone } from "../_shared/inbound-customer-resolve.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_INSTANCE = "wame-piloto";

function ok(body: Record<string, unknown>) {
  return new Response(JSON.stringify({ ok: true, ...body }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function loadWameSettings(supabase: any) {
  const { data: rows } = await supabase
    .from("settings")
    .select("key, value")
    .in("key", [
      "wame_server",
      "wame_api_key",
      "wame_instance_name",
      "wame_pilot_consultant_id",
      "superadmin_consultant_id",
    ]);
  const s: Record<string, string> = {};
  for (const r of (rows as Array<{ key: string; value: unknown }> | null) || []) {
    const raw = r.value;
    s[r.key] = (typeof raw === "string" ? raw : String(raw ?? "")).replace(/^"|"$/g, "");
  }
  return {
    server: s.wame_server || Deno.env.get("WAME_SERVER") || "",
    apiKey: s.wame_api_key || Deno.env.get("WAME_API_KEY") || "",
    instanceName: s.wame_instance_name || DEFAULT_INSTANCE,
    consultantId: s.wame_pilot_consultant_id || s.superadmin_consultant_id || null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Mesmo contrato do whapi-webhook: fail-open enquanto o provedor não manda
  // o secret; 401 só depois de ENFORCE_WEBHOOK_ORIGIN=true.
  const originAuth = verifyWebhookOrigin(req, "WAME_WEBHOOK_SECRET");
  if (!originAuth.ok) {
    const enforce =
      (Deno.env.get("ENFORCE_WEBHOOK_ORIGIN") || "").trim().toLowerCase() === "true";
    console.warn(
      `[wame-webhook] origem sem secret (${enforce ? "ENFORCE → 401" : "grace/log-only"}):`,
      originAuth.reason,
    );
    if (enforce) {
      return new Response(
        JSON.stringify({ ok: false, error: "unauthorized_webhook", reason: originAuth.reason }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
  }

  try {
    // `any` como no resto dos shared: os helpers tipam o client com uma
    // versão travada do supabase-js e o esm.sh `@2` resolve para outra.
    // deno-lint-ignore no-explicit-any
    const supabase: any = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => null);
    if (!body) return ok({ skipped: "invalid_json" });

    const cfg = await loadWameSettings(supabase);
    const adapter = getAdapter({
      kind: "wame",
      input: {
        server: cfg.server,
        apiKey: cfg.apiKey,
        instanceName: cfg.instanceName,
      },
    });

    const parsed = adapter.parseInbound(body, cfg.instanceName);
    if (!parsed) {
      console.log("[wame-webhook] evento sem mensagem:", summarizeWebhookBody(body));
      return ok({ skipped: "no_message" });
    }
    if (parsed.ignored) {
      return ok({ skipped: "ignored", from_me: parsed.isFromMe });
    }
    if (!parsed.phone) {
      // Instagram/Messenger chegam sem telefone. O piloto é só WhatsApp — o
      // dia que abrir IG/FB, esses leads precisam de outra chave de identidade.
      logStructured("info", "wame_inbound_sem_telefone", { message_id: parsed.messageId });
      return ok({ skipped: "no_phone" });
    }

    // Config antes do dedupe: sem consultor a mensagem seria marcada como
    // processada e a reentrega da WAME não recuperaria o lead.
    if (!cfg.consultantId) {
      logStructured("error", "wame_sem_consultor_piloto", { phone: parsed.phone });
      return ok({ skipped: "no_pilot_consultant" });
    }

    // Dedupe por (message_id, instance_name) — WAME reentrega em falha de ACK.
    const duplicate = await checkAndMarkProcessed(
      supabase,
      parsed.messageId,
      cfg.instanceName,
    );
    if (duplicate) return ok({ skipped: "duplicate", message_id: parsed.messageId });

    // ── Customer: helper canônico (trata 9º dígito e colisão de sufixo) ────
    const existing = await findCustomerForInboundPhone(
      supabase,
      cfg.consultantId,
      parsed.phone,
    );

    if (existing && existing.origin_channel && existing.origin_channel !== "wame") {
      // O número já conversa com a gente por Whapi/Evolution. Responder pelo
      // WAME trocaria a identidade no meio da conversa — o piloto para aqui.
      logStructured("warn", "wame_inbound_lead_de_outro_canal", {
        customer_id: existing.id,
        origin_channel: existing.origin_channel,
      });
      return ok({ skipped: "lead_owned_by_other_channel", origin: existing.origin_channel });
    }

    let customerId: string = existing?.id ?? "";
    let conversationStep: string | null = existing?.conversation_step ?? null;

    if (!customerId) {
      const { data: created, error } = await supabase
        .from("customers")
        .insert({
          phone_whatsapp: parsed.phone,
          consultant_id: cfg.consultantId,
          status: "pending",
          conversation_step: "welcome",
          origin_channel: "wame",
          origin_instance_name: cfg.instanceName,
          origin_consultant_id: cfg.consultantId,
          // Fase 1: só observação. Sem isso a cadência adotaria o lead.
          // bot_paused_until no futuro longe: cadência libera pausa comum
          // após ~48h; com until ativo o bloqueio continua (ver cadence-tick).
          bot_paused: true,
          bot_paused_reason: "wame_pilot",
          bot_paused_at: new Date().toISOString(),
          bot_paused_until: "2099-01-01T00:00:00.000Z",
        })
        .select("id, conversation_step")
        .single();
      if (error) {
        logStructured("error", "wame_insert_customer_falhou", {
          phone: parsed.phone,
          error: error.message,
        });
        return ok({ skipped: "customer_insert_failed" });
      }
      customerId = created.id;
      conversationStep = created.conversation_step;
      logStructured("info", "wame_lead_novo", { customer_id: customerId, phone: parsed.phone });
    } else if (!existing?.origin_channel) {
      // Lead legado sem origem que escreveu no número do piloto: grava a
      // origem agora, senão o resolver devolve `no_origin_recorded` depois.
      await supabase
        .from("customers")
        .update({
          origin_channel: "wame",
          origin_instance_name: cfg.instanceName,
          origin_consultant_id: cfg.consultantId,
        })
        .eq("id", customerId);
    }

    const messageType = parsed.buttonId
      ? "button"
      : parsed.mediaKind ?? "text";
    const messageText = parsed.messageText ||
      (parsed.mediaKind ? `[${parsed.mediaKind}]` : "");

    const { error: convErr } = await supabase.from("conversations").insert({
      customer_id: customerId,
      message_direction: "inbound",
      message_text: messageText.slice(0, 2000),
      message_type: messageType,
      conversation_step: conversationStep,
      external_message_id: parsed.messageId || null,
    });
    if (convErr) {
      logStructured("error", "wame_insert_conversation_falhou", {
        customer_id: customerId,
        error: convErr.message,
      });
    }

    logStructured("info", "wame_inbound_gravado", {
      customer_id: customerId,
      message_id: parsed.messageId,
      type: messageType,
      button_id: parsed.buttonId ?? undefined,
    });

    return ok({ customer_id: customerId, mode: "observe_only" });
  } catch (e) {
    // Nunca devolve 5xx: a WAME reentregaria em loop.
    console.error("[wame-webhook] erro inesperado:", (e as Error)?.message ?? e);
    return ok({ skipped: "unexpected_error" });
  }
});
