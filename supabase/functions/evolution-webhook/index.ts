// Evolution WhatsApp webhook — orchestrator.
// All bot-flow logic lives in ./handlers/. This file is responsible for:
//   1. CORS + parsing the incoming event
//   2. Routing CONNECTION_UPDATE events to handlers/connection.ts
//   3. Looking up the instance/consultant + creating Evolution sender
//   4. Deduplication, rate-limiting, OTP intercept
//   5. Loading/creating the customer + downloading any attached media
//   6. Delegating to handlers/bot-flow.ts and persisting its result
//
// Behavior is identical to the previous monolithic version.

declare const EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void };

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizePhone } from "../_shared/utils.ts";
import { createEvolutionSender, parseEvolutionMessage, extractMediaUrl } from "../_shared/evolution-api.ts";
import { resolveInboundConversationMeta } from "../_shared/whapi-api.ts";
import { computeIdempotencyKey } from "../_shared/idempotency.ts";
import { computeMessageTextHash } from "../_shared/text-hash.ts";
import { checkAndMarkProcessed, logStepTransition, jsonLog } from "../_shared/audit.ts";
import { safeFirstNameForAddress } from "../_shared/customer-display-name.ts";
import {
  isRateLimited,
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW_MS,
  recordRiskSignal,
} from "./_helpers.ts";
import { handleConnectionUpdate } from "./handlers/connection.ts";
import { tryInterceptOtp } from "./handlers/otp-intercept.ts";
import { runBotFlow } from "./handlers/bot-flow.ts";
import { runConversationalFlow, CADASTRO_STEPS } from "./handlers/conversational/index.ts";
import { normalizeOutgoing, stripPrefix } from "./handlers/step-namespace.ts";
import { markManualReview, logRodizioOutcome } from "../_shared/rodizio-cas.ts";
import { assignRodizioLead, bindCustomerCampaign } from "../_shared/rodizio-assign.ts";
import {
  resolveCanonicalFlowVariant,
} from "../_shared/bot/canonical-flow-variant.ts";
import { isActiveConversationalFunnelStep } from "../_shared/bot/cadastro-fixes.ts";
import { resolveFlowId } from "../_shared/resolve-flow.ts";

import { routeEngine as routeEngineV2 } from "../_shared/flow-router.ts";
import { captureError } from "../_shared/sentry.ts";
import { notifyNewLead, notifyPartnerNewLead, notifySuperAdminUnmatchedLead, notifyOwnerManualReview } from "../_shared/notify-consultant.ts";
import { mirrorCustomerToCaptation } from "../_shared/captation/mirror-customer.ts";
import { matchesMetaCtwaPhrase } from "../_shared/meta-ctwa-fallback.ts";
import {
  campaignContainsAdId,
  extractMetaReferralFields,
  resolveCampaignByProtocolOnly,
  resolveCampaignFromStrongMeta,
} from "../_shared/deterministic-campaign-resolver.ts";
import { reconcileStrongMetaCampaign } from "../_shared/reconcile-strong-meta.ts";

import { syncCustomerStage } from "../_shared/conversion/crm-sync.ts";
import { isConsultantAIDisabled, isCustomerPausedByHuman, wrapSenderWithLivePauseGuard } from "../_shared/bot/paused.ts";
import { evaluateLowBillReentry } from "../_shared/bot/low-bill-reentry.ts";
import { isBotGloballyEnabled } from "../_shared/bot/global-flag.ts";
import { matchKeyword, type PartnerKeywords } from "../_shared/keyword-matcher.ts";
import { extractShortCodeMarker } from "../_shared/qr-phrase.ts";
import { makeIdempotentEnviarTexto } from "../_shared/bot/conversational-send-idempotency.ts";
import { extractMultiField, buildMultiFieldPatch } from "../_shared/multi-field-extractor.ts";
import { summarizeWebhookBody } from "../_shared/log-redact.ts";
import { verifyWebhookOrigin } from "../_shared/webhook-auth.ts";
import {
  getFlowReliabilityV2,
  isV2Active,
  isV2Dark,
  isV2Enabled,
} from "../_shared/feature-flag.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-instance-name",
};

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_AI_API_KEY") || "";
const EVOLUTION_API_URL = Deno.env.get("EVOLUTION_API_URL") || "";
const EVOLUTION_API_KEY = Deno.env.get("EVOLUTION_API_KEY") || "";
// Segredo de serviço para chamadas internas entre edge functions (header `x-service-secret`).
// A guarda IDOR do `ai-agent-router` (REQ 5) resolve este header como `mode: "service"` e
// dispensa a verificação de posse para a invocação interna do webhook.
const SERVICE_SHARED_SECRET = Deno.env.get("SERVICE_SHARED_SECRET") || "";

type DeliveryStatus = "queued" | "sent" | "delivered" | "read" | "played" | "failed";

function mapEvolutionDeliveryStatus(raw: unknown): { status: DeliveryStatus | null; error?: string } {
  const stNum = Number(raw);
  if (Number.isFinite(stNum)) {
    if (stNum >= 5) return { status: "played" };
    if (stNum >= 4) return { status: "read" };
    if (stNum === 3) return { status: "delivered" };
    if (stNum === 2) return { status: "sent" };
    if (stNum === 1) return { status: "queued" };
    return { status: null };
  }

  if (typeof raw !== "string") return { status: null };
  const s = raw.toUpperCase();
  if (["ERROR", "FAILED", "FAILURE", "SEND_ERROR", "UNDELIVERED"].includes(s)) {
    return { status: "failed", error: `Evolution returned ${s} ack` };
  }
  if (s === "PLAYED") return { status: "played" };
  if (s === "READ") return { status: "read" };
  if (s === "DELIVERY_ACK" || s === "DELIVERED") return { status: "delivered" };
  if (s === "SERVER_ACK" || s === "SENT") return { status: "sent" };
  if (s === "PENDING") return { status: "queued" };
  return { status: null };
}

function extractMessageIdCandidates(item: any): string[] {
  return Array.from(new Set([
    item?.key?.id,
    item?.keyId,
    item?.id,
    item?.messageId,
  ].filter((v) => typeof v === "string" && v.trim())));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Validação de origem: por padrão GRACE (log-only), igual Whapi.
  // Enforce só com ENFORCE_WEBHOOK_ORIGIN=true — evita derrubar inbound se
  // EVOLUTION_WEBHOOK_SECRET existir no Edge mas a URL ainda não manda ?secret=.
  const originAuth = verifyWebhookOrigin(req, "EVOLUTION_WEBHOOK_SECRET");
  if (!originAuth.ok) {
    const enforce =
      (Deno.env.get("ENFORCE_WEBHOOK_ORIGIN") || "").trim().toLowerCase() === "true";
    console.warn(
      `[evolution-webhook] origem sem secret (${enforce ? "ENFORCE → 401" : "grace/log-only, NÃO bloqueia"}):`,
      originAuth.reason,
    );
    if (enforce) {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized_webhook", reason: originAuth.reason }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  // Lock state hoisted to function scope so the outer `finally` can guarantee
  // a release on every exit path (early-return, exception, normal completion).
  // `customer-lock.ts` intentionally lives behind direct RPC calls here
  // (instead of `withCustomerLock`) so we can release the lock *before* the
  // slow outbound Evolution HTTP call without restructuring the whole
  // function into a closure. The semantics are identical: the v2 RPC pair
  // `try_acquire_customer_lock` / `release_customer_lock` enforces TTL safety
  // (the holder cannot block forever — see migration §4.12 for the contract).
  let lockSupabaseRef: any = null;
  let lockToken: string | null = null;
  let lockCustomerId: string | null = null;

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    lockSupabaseRef = supabase;

    const body = await req.json();
    // LGPD: nunca logar o corpo cru (contém telefone e texto do cliente).
    // `summarizeWebhookBody` retorna apenas metadados estruturais.
    console.log("Evolution webhook received:", JSON.stringify(summarizeWebhookBody(body)));

    // ─── 1) CONNECTION_UPDATE — handled by separate module ─────────────
    const fallbackInstance = req.headers.get("x-instance-name");
    const handledConnection = await handleConnectionUpdate({
      supabase,
      body,
      fallbackInstance,
      evolutionApiUrl: EVOLUTION_API_URL,
      evolutionApiKey: EVOLUTION_API_KEY,
    });
    if (handledConnection) {
      return new Response(JSON.stringify({ ok: true, event: "connection_update" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── 1b) MESSAGES_UPDATE / message status ACK ──────────────────────
    // Evolution envia MESSAGES_UPDATE quando o WhatsApp confirma entrega/leitura.
    // Status numérico Baileys: 1=PENDING, 2=SERVER_ACK(enviado),
    // 3=DELIVERY_ACK(entregue ao aparelho), 4=READ(lido), 5=PLAYED.
    // Também pode enviar status="ERROR"; isso é falha real de entrega e não
    // pode ser promovido para "sent" pela verificação de histórico.
    // Atualizamos `conversations.delivery_status` pelo external_message_id.
    const evtRaw = String(body?.event || "").toLowerCase().replace(/\./g, "_");
    if (evtRaw === "messages_update" || evtRaw === "message_update") {
      try {
        const items = Array.isArray(body?.data) ? body.data : [body?.data].filter(Boolean);
        const instNameForAck = body?.instance || fallbackInstance;
        // Resolve instance + consultant for fallback matching (when external_message_id missing)
        let ackInstanceId: string | null = null;
        let ackConsultantId: string | null = null;
        if (instNameForAck) {
          const { data: instAck } = await supabase
            .from("whatsapp_instances")
            .select("id, consultant_id")
            .eq("instance_name", instNameForAck)
            .maybeSingle();
          ackInstanceId = instAck?.id ?? null;
          ackConsultantId = instAck?.consultant_id ?? null;
        }

        // Hierarchy used to prevent regression: never downgrade from a stronger ack.
        const rank: Record<string, number> = { failed: 0, queued: 1, sent: 2, delivered: 3, read: 4, played: 5 };

        for (const it of items) {
          const mids = extractMessageIdCandidates(it);
          const stRaw = it?.status ?? it?.update?.status;
          const remoteJidAck: string = it?.key?.remoteJid || it?.remoteJid || "";
          if (mids.length === 0 && !remoteJidAck) continue;
          const mapped = mapEvolutionDeliveryStatus(stRaw);
          if (!mapped.status) continue;
          const newRank = rank[mapped.status] ?? -1;

          // Find target conversation(s)
          let targets: Array<{ id: string; delivery_status: string | null }> = [];
          if (mids.length > 0) {
            const { data: rows } = await supabase
              .from("conversations")
              .select("id, delivery_status")
              .in("external_message_id", mids);
            targets = (rows || []) as any;
          }
          // Fallback matching: ACK arrived but conversation has no external_message_id yet.
          if (targets.length === 0 && remoteJidAck && ackConsultantId) {
            const phoneDigits = String(remoteJidAck).split("@")[0].replace(/\D/g, "");
            if (phoneDigits) {
              const { data: cust } = await supabase
                .from("customers")
                .select("id")
                .eq("consultant_id", ackConsultantId)
                .eq("phone_whatsapp", phoneDigits)
                .maybeSingle();
              if (cust?.id) {
                const cutoff = new Date(Date.now() - 90_000).toISOString();
                const { data: rows } = await supabase
                  .from("conversations")
                  .select("id, delivery_status")
                  .eq("customer_id", cust.id)
                  .eq("message_direction", "outbound")
                  .is("external_message_id", null)
                  .gte("created_at", cutoff)
                  .order("created_at", { ascending: false })
                  .limit(1);
                targets = (rows || []) as any;
                // Link the Evolution id for future matching
                if (targets.length > 0 && mids[0]) {
                  await supabase
                    .from("conversations")
                    .update({ external_message_id: mids[0] })
                    .eq("id", targets[0].id);
                }
              }
            }
          }

          // Filter out conversations that already reached a stronger status (prevent regression).
          const updatable = targets.filter(t => {
            const curRank = rank[t.delivery_status ?? ""] ?? -1;
            return newRank >= curRank;
          });

          if (updatable.length > 0) {
            await supabase.from("conversations")
              .update({
                delivery_status: mapped.status,
                delivery_checked_at: new Date().toISOString(),
                delivery_error: mapped.status === "failed" ? (mapped.error || "Evolution delivery failed") : null,
              })
              .in("id", updatable.map(t => t.id));
          }
          if (mids.length > 0) {
            await supabase.from("outbound_message_log")
              .update({
                result_status: mapped.status === "failed"
                  ? "failed"
                  : mapped.status === "queued"
                  ? "queued"
                  : mapped.status === "delivered" || mapped.status === "read"
                  ? "delivered"
                  : "sent",
              })
              .in("evolution_message_id", mids);
          }

          // Anti-ban: real ERROR acks feed the existing circuit breaker.
          if (mapped.status === "failed" && instNameForAck) {
            await recordRiskSignal(supabase, instNameForAck, "send_failure", "medium", {
              source: "messages_update_ack",
              raw_status: String(stRaw ?? ""),
              message_ids: mids,
              remote_jid: remoteJidAck || null,
            });
          }

          jsonLog(mapped.status === "failed" ? "warn" : "info", "messages_update_delivery_status", {
            message_ids: mids,
            raw_status: stRaw,
            delivery_status: mapped.status,
            matched: updatable.length,
            instance_id: ackInstanceId,
          });
        }
      } catch (e: any) {
        console.warn("[messages_update] handler error:", e?.message);
      }
      return new Response(JSON.stringify({ ok: true, event: "messages_update" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Kill switch global: OFF = não fala, MAS continua o pipeline (grava inbound + avisa).
    // Status/ACK e conexão já foram tratados acima.
    const botGlobalOutboundEnabled = await isBotGloballyEnabled(supabase as any);
    if (!botGlobalOutboundEnabled) {
      console.log("[evolution-webhook] bot_global_enabled=false → inbound OK, outbound automático bloqueado");
    }

    // ─── 2) Identify instance ──────────────────────────────────────────
    const instanceName = body.instance || fallbackInstance;
    if (!instanceName) {
      console.error("❌ Instance name not found in body or header");
      return new Response(JSON.stringify({ error: "Instance name required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: instanceData, error: instanceError } = await supabase
      .from("whatsapp_instances")
      .select("id, instance_name, consultant_id, connected_phone, manual_review_required, fatal_lock_until, fatal_disconnect_reason")
      .eq("instance_name", instanceName)
      .single();

    if (instanceError || !instanceData) {
      console.error(`❌ Instance not found: ${instanceName}`, instanceError);
      return new Response(JSON.stringify({ error: "Instance not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── HARD-LOCK ANTI-BAN ──────────────────────────────────────────────
    // Se a instância está em revisão manual (após uma desconexão fatal)
    // ou dentro da janela `fatal_lock_until`, BLOQUEIA QUALQUER resposta
    // automática do bot. Eventos de entrada continuam sendo ack-ados (200)
    // para o Evolution não re-entregar, mas o bot-flow é pulado.
    // Só sai deste estado via admin_clear_fatal_lock (super_admin).
    const _fatalActive =
      !!(instanceData as any).manual_review_required ||
      (!!(instanceData as any).fatal_lock_until &&
        new Date((instanceData as any).fatal_lock_until) > new Date());
    if (_fatalActive) {
      console.warn(
        `🛑 [hard-lock] Bot-flow bloqueado para ${instanceName} ` +
        `(reason=${(instanceData as any).fatal_disconnect_reason ?? "?"}, ` +
        `lock_until=${(instanceData as any).fatal_lock_until ?? "manual"}). ` +
        `Inbound ignorado para não acelerar ban.`,
      );
      return new Response(
        JSON.stringify({
          ok: true,
          mode: "hard_lock_skip",
          reason: "manual_review_required",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }


    const { data: consultantData } = await supabase
      .from("consultants")
      .select("id, name, display_name, assistant_name, gender, igreen_id, conversational_flow_enabled")
      .eq("id", instanceData.consultant_id)
      .single();

    console.log(`✅ Instance found: ${instanceName} (consultant: ${consultantData?.display_name || consultantData?.name || "unknown"})`);
    // Nome humano só — slug/login (silviaclaudiaalmeida) NUNCA vai pro lead.
    // Presentation label: NUNCA devolve "sua consultora"/"consultor" (bug abertura).
    const { resolveConsultantPresentationLabel, resolveAssistantDisplayName, resolveConsultantRoleGender } = await import("../_shared/consultant-public-label.ts");
    const _fullName = resolveConsultantPresentationLabel(
      consultantData?.name,
      consultantData?.display_name,
      consultantData?.gender,
    );
    const nomeRepresentante = _fullName.split(/\s+/)[0] || "";
    const nomeAssistente = resolveAssistantDisplayName(consultantData?.assistant_name);
    const consultorGender: "consultor" | "consultora" = resolveConsultantRoleGender(
      consultantData?.gender,
      nomeRepresentante || consultantData?.name || consultantData?.display_name,
    );
    const consultorId = consultantData?.igreen_id || "124170";

    if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY) {
      console.error("❌ EVOLUTION_API_URL ou EVOLUTION_API_KEY não configurados");
      return new Response(JSON.stringify({ error: "Evolution API not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const rawSender = createEvolutionSender(EVOLUTION_API_URL, EVOLUTION_API_KEY, instanceName);
    // Etapa 3 anti-ban: TODO envio originado do bot passa por check_send_quota
    // + register_send. Se a instância estiver em recovery/fatal_lock/warmup
    // estourado, sender.sendX() retorna `false` SEM enviar — handlers que já
    // checam o retorno (`if (await sender.sendText(...))`) não avançam step.
    const { wrapSenderWithGuard } = await import("../_shared/sender-guard.ts");
    const antiBanSender = wrapSenderWithGuard(rawSender, { supabase, instanceName });
    // Corta reply atrasado se o consultor mandou msg no meio do turno.
    const pauseGuardCtx: { phone: string | null; customerId: string | null } = {
      phone: null,
      customerId: null,
    };
    const sender = wrapSenderWithLivePauseGuard(antiBanSender as any, {
      supabase: supabase as any,
      consultantId: instanceData.consultant_id,
      getPhone: () => pauseGuardCtx.phone,
      getCustomerId: () => pauseGuardCtx.customerId,
    });

    // Phase A — Task 8 (whatsapp-flow-architecture-v3): instancia o adapter
    // em paralelo SEM trocar o sender legado. Apenas confirma que `getAdapter`
    // expõe `capabilities` e que poderia ser usado pelos motores. O wiring real
    // (passar o adapter para handlers) acontece nas próximas phases. Isso evita
    // qualquer regressão neste passo.
    try {
      const { getAdapter } = await import("../_shared/channels/index.ts");
      const adapter = getAdapter({
        kind: "evolution",
        input: {
          apiUrl: EVOLUTION_API_URL,
          apiKey: EVOLUTION_API_KEY,
          instanceName,
          connectedPhone: instanceData.connected_phone,
        },
      });
      jsonLog("debug", "channel_adapter_ready", {
        channel: adapter.capabilities.channel,
        instance_name: instanceName,
        supports_buttons: adapter.capabilities.supportsButtons,
        max_buttons: adapter.capabilities.maxButtons,
        supports_list: adapter.capabilities.supportsList,
      });
    } catch (e: any) {
      console.warn("[channel-adapter] smoke wiring falhou (não bloqueante):", e?.message);
    }

    // ─── Feature flag: WhatsApp Flow Reliability v2 (per-consultant) ───
    // Controls the new dedup/rate-limit/customer-lock ordering described in
    // bugfix.md §2.6/§2.11/§2.33/§2.37 and design.md §5. Values:
    //   - 'off'   : legacy path runs unchanged.
    //   - 'dark'  : v2 code runs in parallel for logging, legacy still drives.
    //   - 'canary'/'on' : v2 path is the source of truth.
    // Read fails closed to 'off'. The cached value lives ~30 s per instance.
    const v2Flag = await getFlowReliabilityV2(supabase, instanceData.consultant_id);

    // ─── 🛑 IA GLOBALMENTE DESLIGADA — não fala, mas NÃO descarta inbound ──
    // Decisão de produto: sempre criar/atualizar lead e gravar mensagem.
    // O gate de outbound fica depois que o customer existe (abaixo).
    // `as any`: tipagem cruzada supabase-js (mesmo padrão whapi).
    let consultantAiDisabled = await isConsultantAIDisabled(supabase as any, instanceData.consultant_id);
    let forceBotForLeadEarly = false;
    if (consultantAiDisabled) {
      const rawJid: string = body?.data?.key?.remoteJid || "";
      const phoneDigits = String(rawJid).split("@")[0].replace(/\D/g, "");
      if (phoneDigits) {
        const [{ data: pending }, { data: cust }] = await Promise.all([
          supabase.from("force_bot_phones").select("phone_digits")
            .eq("consultant_id", instanceData.consultant_id)
            .eq("phone_digits", phoneDigits).maybeSingle(),
          supabase.from("customers").select("bot_force_enabled")
            .eq("consultant_id", instanceData.consultant_id)
            .eq("phone_whatsapp", phoneDigits)
            .eq("bot_force_enabled", true).maybeSingle(),
        ]);
        forceBotForLeadEarly = !!pending || !!cust;
      }
      if (forceBotForLeadEarly) {
        console.log(`✅ [force-bot-active] IA global off, mas lead tem override → bot pode responder`);
        consultantAiDisabled = false;
      } else {
        console.log(`🛑 [global-off] IA do consultor ${instanceData.consultant_id} desligada — inbound será salvo sem auto-reply`);
      }
    }

    // ─── 3) Parse + dedupe + filter ────────────────────────────────────
    const parsed = parseEvolutionMessage(body, instanceData.connected_phone);
    if (!parsed) {
      console.log("⏭️ Mensagem ignorada (from_me, grupo, ou auto-mensagem da instância)");
      return new Response(JSON.stringify({ ok: true, msg: "ignored" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── Outbound humano (consultor digitou no app oficial) ─
    if ((parsed as any).outboundHuman) {
      const outChatId: string = (parsed as any).chatId || "";
      const outSource: string = (parsed as any).source || "";
      const outMessageId: string = (parsed as any).messageId || "";
      const outText: string = String((parsed as any).messageText || "").trim();
      const outType: string = String((parsed as any).messageType || "text").toLowerCase() || "text";
      const outTs = Number((parsed as any).messageTimestamp || 0);
      const outPhone = String(outChatId).replace(/@s\.whatsapp\.net$/, "").replace(/@c\.us$/, "").replace(/\D/g, "");
      console.log(`👤 [evolution] Outbound humano (source=${outSource}) → verificando antes de pausar bot para ${outPhone}`);
      try {
        if (outMessageId) {
          const { data: echo } = await supabase
            .from("outbound_message_log")
            .select("idempotency_key")
            .eq("evolution_message_id", outMessageId)
            .gte("created_at", new Date(Date.now() - 120_000).toISOString())
            .limit(1)
            .maybeSingle();
          if (echo) {
            console.log(`↩️ [evolution] ignored_self_echo messageId=${outMessageId}`);
            return new Response(JSON.stringify({ ok: true, msg: "ignored_self_echo" }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        }
        const { data: cust } = await supabase
          .from("customers")
          .select("id, bot_paused, assigned_human_id, consultant_id, last_bot_reply_at")
          .eq("phone_whatsapp", outPhone)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        // Eco do bot já é filtrado (ignored_self_echo / source). Consultor no app
        // precisa pausar mesmo com bot ativo — não pular por last_bot_reply_at.
        if (cust && (!cust.bot_paused || !cust.assigned_human_id)) {
          await supabase
            .from("customers")
            .update({
              bot_paused: true,
              bot_paused_reason: "humano_assumiu",
              bot_paused_at: new Date().toISOString(),
              bot_paused_until: null,
              assigned_human_id: cust.consultant_id ?? cust.assigned_human_id ?? null,
              bot_processing_until: null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", cust.id);
          console.log(`✅ [evolution] Bot pausado para ${outPhone} (customer ${cust.id}, reason=humano_assumiu)`);
          await supabase
            .from("lead_cadence_state")
            .update({
              paused_reason: "handoff_humano",
              next_action_at: null,
            })
            .eq("customer_id", cust.id)
            .neq("stage", "WON");
        } else if (cust?.bot_paused && cust.assigned_human_id) {
          await supabase
            .from("customers")
            .update({ bot_processing_until: null, bot_paused_at: new Date().toISOString() })
            .eq("id", cust.id);
          await supabase
            .from("lead_cadence_state")
            .update({
              paused_reason: "handoff_humano",
              next_action_at: null,
            })
            .eq("customer_id", cust.id)
            .neq("stage", "WON");
        }

        if (cust?.id && (outText || outType !== "text")) {
          const emid = outMessageId ? `evo_human:${outMessageId}` : null;
          let already = false;
          if (emid) {
            const { data: dup } = await supabase
              .from("conversations")
              .select("id")
              .eq("external_message_id", emid)
              .limit(1)
              .maybeSingle();
            already = !!dup?.id;
          }
          if (!already) {
            const createdAt = outTs > 1_000_000_000_000
              ? new Date(outTs).toISOString()
              : outTs > 0
                ? new Date(outTs * 1000).toISOString()
                : new Date().toISOString();
            const { error: insErr } = await supabase.from("conversations").insert({
              customer_id: cust.id,
              message_direction: "outbound",
              message_text: (outText || `[${outType}]`).slice(0, 2000),
              message_type: outType,
              conversation_step: "human_app",
              origin: "human_app",
              external_message_id: emid,
              created_at: createdAt,
            });
            if (insErr) console.error("⚠️ [evolution] insert conversations (outboundHuman):", insErr);
            else console.log(`💬 [evolution] Outbound humano gravado customer=${cust.id} type=${outType}`);
          }
        }
      } catch (e) {
        console.error("⚠️ [evolution] Falha ao pausar bot via outbound humano:", e);
      }
      return new Response(JSON.stringify({ ok: true, msg: "outbound_human_takeover" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }


    let {
      remoteJid, buttonId, hasImage, hasDocument, hasAudio, hasVideo, isButton, mediaKind,
      imageMessage, documentMessage, audioMessage, key, message,
    } = parsed;
    // isFile pode virar false após STT bem-sucedida (paridade Whapi).
    let isFile = parsed.isFile;
    // messageText pode ser sobrescrito pela transcrição automática quando o
    // inbound é áudio (Task 17). Por isso vai como `let` e não destructured.
    let messageText: string = parsed.messageText;
    let messageId = String(key?.id || parsed.messageId || body.data?.key?.id || "");
    // Type cast: dedupe.ts pins @supabase/supabase-js@2.49.4 while this file
    // pins @2; the runtime is identical but TS sees two protected-property
    // shapes. Same workaround used elsewhere in this file (line 141).
    if (await checkAndMarkProcessed(supabase as any, messageId, instanceName)) {
      jsonLog("info", "duplicate message ignored", { instance_name: instanceName, message_id: messageId });
      return new Response(JSON.stringify({ ok: true, msg: "duplicate" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    jsonLog("debug", "dedup_checked", {
      instance_name: instanceName,
      consultant_id: instanceData.consultant_id,
      message_id: messageId,
      v2_flag: v2Flag,
    });
    const inboundConvMeta = () => resolveInboundConversationMeta({
      hasAudio,
      hasImage,
      hasDocument,
      hasVideo: !!hasVideo,
      isFile,
      messageText,
      // Evolution não tem mediaId Whapi — guarda o id da mensagem p/ correlacionar
      mediaId: null,
    });

    if (!messageText && !isFile && !isButton) {
      console.log("⏭️ Mensagem vazia");
      return new Response(JSON.stringify({ ok: true, msg: "empty" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const phone = normalizePhone(remoteJid.replace("@s.whatsapp.net", ""));
    pauseGuardCtx.phone = phone;

    // ─── Rate limit (legacy in-memory + v2 persistent RPC, gated by flag) ──
    // Legacy: per-instance Map → known to leak at multi-container scale (2.33).
    // v2 path: try_acquire_rate_limit RPC backs all containers with the same
    // (phone, window_start) bucket. Under 'dark', we compute both and log the
    // disagreement but defer to the legacy outcome. Under 'canary'/'on', the
    // RPC is authoritative and the in-memory map is bypassed.
    const legacyRateLimited = isRateLimited(phone);
    let rateLimited = legacyRateLimited;
    if (isV2Enabled(v2Flag)) {
      try {
        const { data: rpcOk, error: rpcErr } = await supabase.rpc(
          "try_acquire_rate_limit",
          {
            p_phone: phone,
            p_window_ms: RATE_LIMIT_WINDOW_MS,
            p_max_count: RATE_LIMIT_MAX,
          },
        );
        if (rpcErr) {
          jsonLog("warn", "rate_limit_rpc_failed", {
            phone, v2_flag: v2Flag, error: rpcErr.message,
          });
          // Fail open to legacy decision so a Postgres hiccup never silences
          // the customer.
        } else {
          const rpcRateLimited = rpcOk === false;
          if (rpcRateLimited !== legacyRateLimited) {
            jsonLog("info", "rate_limit_disagreement", {
              phone, v2_flag: v2Flag,
              legacy_rate_limited: legacyRateLimited,
              v2_rate_limited: rpcRateLimited,
            });
          }
          if (isV2Active(v2Flag)) {
            rateLimited = rpcRateLimited;
          }
          // 'dark': keep the legacy outcome (rateLimited already set).
        }
      } catch (e) {
        jsonLog("warn", "rate_limit_rpc_exception", {
          phone, v2_flag: v2Flag,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }
    if (rateLimited) {
      console.warn(`🚫 Rate limited: ${phone} (>${RATE_LIMIT_MAX} msgs em ${RATE_LIMIT_WINDOW_MS}ms)`);
      jsonLog("warn", "rate_limit_checked", {
        phone, v2_flag: v2Flag, rate_limited: true,
      });
      return new Response(JSON.stringify({ ok: true, msg: "rate_limited" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    jsonLog("debug", "rate_limit_checked", {
      phone, v2_flag: v2Flag, rate_limited: false,
    });



    // ─── Customer lock (v2: serialize webhooks per customer_id) ────────
    // Bugfix conditions 2.11 + 2.37: two concurrent webhooks for the same
    // customer must not race on `customers.conversation_step`. We hold a
    // row-based lock (see migration §4.12) for the duration of the load /
    // handler / persist phase, releasing **before** the slow outbound send
    // (Evolution HTTP retries have their own idempotency from Task 8).
    //
    // We can only lock by an *existing* customer_id. The first message from
    // a new lead has no row yet; the customers UNIQUE on
    // (phone_whatsapp, consultant_id) makes that case naturally race-free
    // (only one INSERT can win), so skipping the lock is safe.
    //
    // Under 'dark' mode we acquire-and-release immediately, only to populate
    // logs that surface lock contention before flipping the flag to 'on'.
    if (isV2Enabled(v2Flag)) {
      try {
        const { data: existing } = await supabase
          .from("customers")
          .select("id")
          .eq("phone_whatsapp", phone)
          .eq("consultant_id", instanceData.consultant_id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const existingId = (existing as any)?.id ?? null;
        if (existingId) {
          // Cobre cascatas com mídia; o turno concorrente entra na fila em
          // vez de disputar o estado no meio do envio.
          const ttlMs = 120_000;
          const maxWaitMs = isV2Active(v2Flag) ? 25_000 : 0;
          const pollIntervalMs = 50;
          const startedAt = Date.now();
          while (true) {
            const { data: token, error: lockErr } = await supabase.rpc(
              "try_acquire_customer_lock",
              { p_customer: existingId, p_ttl_ms: ttlMs },
            );
            if (lockErr) {
              jsonLog("warn", "customer_lock_error", {
                customer_id: existingId,
                stage: "acquire",
                v2_flag: v2Flag,
                message: lockErr.message,
              });
              break;
            }
            if (typeof token === "string" && token.length > 0) {
              lockToken = token;
              lockCustomerId = existingId;
              jsonLog("info", "customer_lock_acquired", {
                customer_id: existingId,
                v2_flag: v2Flag,
                waited_ms: Date.now() - startedAt,
                ttl_ms: ttlMs,
              });
              break;
            }
            const waited = Date.now() - startedAt;
            if (waited >= maxWaitMs) {
              jsonLog("warn", "customer_lock_timeout", {
                customer_id: existingId,
                v2_flag: v2Flag,
                waited_ms: waited,
                ttl_ms: ttlMs,
                max_wait_ms: maxWaitMs,
              });
              if (isV2Active(v2Flag)) {
                // Espelho Whapi: não descarta o inbound que chegou durante a
                // cascata. O dono atual do lock o reproduz antes de liberar.
                try {
                  await supabase.rpc("enqueue_pending_inbound", {
                    _customer_id: existingId,
                    _message_id: messageId || `noid-${Date.now()}`,
                  });
                } catch (enqueueErr) {
                  jsonLog("warn", "customer_lock_enqueue_failed", {
                    customer_id: existingId,
                    message: enqueueErr instanceof Error ? enqueueErr.message : String(enqueueErr),
                  });
                }
                return new Response(
                  JSON.stringify({ ok: true, skipped: "busy_enqueued" }),
                  { headers: { ...corsHeaders, "Content-Type": "application/json" } },
                );
              }
              break;
            }
            await new Promise((r) => setTimeout(r, Math.min(pollIntervalMs, maxWaitMs - waited)));
          }
          // Dark mode: drop the lock immediately so we don't change behaviour.
          if (isV2Dark(v2Flag) && lockToken && lockCustomerId) {
            try {
              await supabase.rpc("release_customer_lock", {
                p_customer: lockCustomerId, p_token: lockToken,
              });
            } catch (_) { /* noop */ }
            lockToken = null;
            lockCustomerId = null;
          }
        } else {
          jsonLog("debug", "customer_lock_skipped_new_lead", {
            phone, v2_flag: v2Flag,
          });
        }
      } catch (e) {
        jsonLog("warn", "customer_lock_setup_failed", {
          phone,
          v2_flag: v2Flag,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }


    // ─── 4) OTP intercept (handled before bot flow) ────────────────────
    const otpResult = await tryInterceptOtp({
      supabase, sender, consultantId: instanceData.consultant_id, phone, remoteJid, messageText,
    });
    if (otpResult.intercepted) {
      return new Response(JSON.stringify({
        ok: true, otp: otpResult.otp, customer_id: otpResult.customerId,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ─── 5) Find or create customer ────────────────────────────────────
    // Prioriza carteira (igreen_sync) mesmo com phone sufixado no sync.
    // Sem isso, lead sombra no número limpo recebe Grupo A.
    const { findCustomerForInboundPhone } = await import("../_shared/inbound-customer-resolve.ts");
    let customer = await findCustomerForInboundPhone(
      supabase,
      instanceData.consultant_id,
      phone,
    );

    const POST_CADASTRO_STATUSES = new Set([
      "data_complete", "portal_submitting", "awaiting_otp", "validating_otp",
      "awaiting_manual_submit", "portal_submitted", "registered_igreen",
      "awaiting_signature", "awaiting_facial", "complete",
      "cadastro_concluido", "active", "approved",
    ]);

    // Fallback legado: se helper não achou, tenta exact (inclui pós-cadastro).
    if (!customer) {
      const { data: activeRecords } = await supabase
        .from("customers")
        .select("*")
        .eq("phone_whatsapp", phone)
        .eq("consultant_id", instanceData.consultant_id)
        .order("created_at", { ascending: false })
        .limit(1);
      customer = activeRecords?.[0] || null;
    }

    // ── Status que devem ser resetados quando o cliente volta a interagir ──
    // abandoned/stuck_*: cliente sumiu mas voltou; retomar de onde parou (não resetar step)
    // automation_failed: erro técnico — reset completo para welcome
    const RESUMABLE_STATUSES = new Set([
      "abandoned",
      "stuck_finalizar",
      "stuck_contact",
      "email_pendente_revisao",
    ]);
    if (customer && customer.status === "automation_failed") {
      console.log(`♻️ Telefone ${phone}: automation_failed → resetando para welcome`);
      await supabase.from("customers").update({ conversation_step: "welcome", status: "pending", error_message: null }).eq("id", customer.id);
      customer.conversation_step = "welcome";
      customer.status = "pending";
    } else if (customer && RESUMABLE_STATUSES.has(customer.status)) {
      console.log(`♻️ Telefone ${phone}: ${customer.status} → cliente voltou, status=pending (mantendo step "${customer.conversation_step}")`);
      await supabase.from("customers").update({ status: "pending", error_message: null, rescue_attempts: 0 }).eq("id", customer.id);
      customer.status = "pending";
      customer.error_message = null;
      customer.rescue_attempts = 0;
    } else if (customer && POST_CADASTRO_STATUSES.has(customer.status)) {
      // Paridade whapi 2026-08-02: NÃO recriar lead pós-cadastro — mantém o registro
      // e alinha step para handler educado (OTP/facial/análise/complete).
      const curStep = stripPrefix(customer.conversation_step || "");
      const safeSteps = new Set([
        "aguardando_otp", "validando_otp", "aguardando_assinatura",
        "aguardando_facial", "cadastro_em_analise", "complete",
        "portal_submitting",
      ]);
      if (!safeSteps.has(curStep)) {
        const st = String(customer.status || "");
        const fixStep =
          (st === "awaiting_otp" || st === "validating_otp" || st === "portal_submitting")
            ? "aguardando_otp"
            : (st === "awaiting_signature" || st === "awaiting_facial")
              ? "aguardando_facial"
              : "cadastro_em_analise";
        await supabase
          .from("customers")
          .update({ conversation_step: fixStep })
          .eq("id", customer.id);
        customer.conversation_step = fixStep;
      }
      console.log(`[find-customer] customer ${customer.id} pós-cadastro (status=${customer.status}, step=${customer.conversation_step}) — mantendo, sem reset`);
    }

    if (!customer) {
      console.log(`📱 Telefone ${phone}: criando novo registro.`);
      // Variante respeita `consultants.active_variants` (round-robin via RPC).
      const { data: assignedVariant } = await supabase.rpc("assign_flow_variant", {
        _consultant_id: instanceData.consultant_id,
      });
      const newFlowVariant = resolveCanonicalFlowVariant(
        (typeof assignedVariant === "string" && assignedVariant) || "A",
      );
      const pushNameClean = (parsed?.pushName || "").toString().trim().slice(0, 80);
      const fallbackName = `Cliente ${phone.slice(-4)}`;
      const { data: newCustomer, error } = await supabase
        .from("customers")
        .insert({
          phone_whatsapp: phone,
          name: pushNameClean || fallbackName,
          consultant_id: instanceData.consultant_id,
          status: "pending",
          conversation_step: "welcome",
          flow_variant: newFlowVariant,
          // bind canal/instância de origem (regra de ouro: fica até o fim)
          origin_channel: "evolution",
          origin_instance_name: instanceName,
          origin_consultant_id: instanceData.consultant_id,
        })
        .select().single();

      if (error) {
        console.error("Error creating customer:", error);
        const { data: fallback } = await supabase
          .from("customers")
          .select("*")
          .eq("phone_whatsapp", phone)
          .eq("consultant_id", instanceData.consultant_id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (fallback) {
          console.log(`♻️ Reusing existing record for ${phone} (step: ${fallback.conversation_step})`);
          // Mesma regra do bloco principal: NÃO resetar leads pós-cadastro para welcome.
          customer = fallback;
        } else {
          return new Response(JSON.stringify({ error: "Failed to create customer" }), {
            status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } else {
        customer = newCustomer;
        notifyNewLead(instanceData.consultant_id, {
          id: newCustomer.id,
          name: newCustomer.name,
          phone_whatsapp: newCustomer.phone_whatsapp,
        }).catch((e) => console.warn("[notify-new-lead] falhou:", (e as Error).message));
        // Espelha para captured_leads → painel de Captação enxerga o lead.
        mirrorCustomerToCaptation(supabase, newCustomer.id)
          .catch((e) => console.warn("[mirror-customer] falhou:", (e as Error).message));
      }
    } else {
      // Reentrada: cliente já existe mas voltou após >24h sem inbound → notifica novamente.
      // O helper tem dedup interno de 60s.
      try {
        const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
        const { count } = await supabase
          .from("conversations")
          .select("id", { count: "exact", head: true })
          .eq("customer_id", customer.id)
          .eq("message_direction", "inbound")
          .gte("created_at", since);
        if ((count ?? 0) === 0) {
          notifyNewLead(instanceData.consultant_id, {
            id: customer.id,
            name: (customer as any).name,
            name_source: (customer as any).name_source,
            phone_whatsapp: (customer as any).phone_whatsapp,
          }).catch((e) => console.warn("[notify-new-lead reentry] falhou:", (e as Error).message));
        }
      } catch (e) {
        console.warn("[notify-new-lead reentry] check falhou:", (e as Error).message);
      }
    }

    if (customer?.id) pauseGuardCtx.customerId = customer.id;

    // ─── 5.4) Reconciliação de sinal forte do Meta em mensagem subsequente ─
    // Se uma mensagem POSTERIOR trouxer ad_id/ctwa_clid apontando para uma
    // campanha diferente da persistida, sobrescreve. Evita lead ficar preso
    // na campanha errada escolhida por fallback (bug Jaraguá → Horácio).
    if (customer) {
      try {
        const rawMsgForReconcile: any = body?.data?.message || {};
        await reconcileStrongMetaCampaign(supabase, customer, rawMsgForReconcile, body);
      } catch (e) {
        console.warn("[reconcile-strong-meta evolution] falhou:", (e as Error).message);
      }
    }

    // ─── 5.5) Auto-tag lead source (Meta Ads / CTWA) ─────────────────────
    // Detecta a origem do lead na PRIMEIRA mensagem (source_campaign_id ainda null).
    // Ordem de prioridade (da mais precisa para a mais fraca), confirmada pela
    // doc oficial Meta (Marketing API / Conversions API for Business Messaging):
    //   1. source_id (AD ID do clique) → casa com facebook_campaigns.fb_ad_ids
    //      → atribuição 100% DETERMINÍSTICA da campanha exata.
    //   2. ctwa_clid → tabela ctwa_clid_mapping (populada na criação da campanha).
    //   3. regex/frase CTWA → marca origem Meta, mas NÃO escolhe campanha.
    // Como cada consultor tem o PRÓPRIO número no CTWA, o consultant_id já vem
    // certo pela instância; aqui só travamos a CAMPANHA correta dentro dele.
    // Só roda quando source_campaign_id ainda não está preenchido.
    try {
      const alreadyTagged = !!(customer as any).source_campaign_id || !!(customer as any).lead_source;
      if (!alreadyTagged) {
        const msgData = body?.data?.message || {};
        // Extrai contextInfo de qualquer tipo de mensagem (texto, imagem, etc.)
        const ctxInfo =
          msgData?.extendedTextMessage?.contextInfo ||
          msgData?.imageMessage?.contextInfo ||
          msgData?.documentMessage?.contextInfo ||
          msgData?.videoMessage?.contextInfo ||
          msgData?.audioMessage?.contextInfo ||
          null;
        let externalAdReply: any = ctxInfo?.externalAdReply || null;
        let ctwaClid: string | null = body?.data?.ctwaClid || externalAdReply?.ctwaClid || null;
        // source_id = AD ID que originou o clique (doc oficial Meta: referral.source_id).
        // No Evolution/Baileys vem em externalAdReply.sourceId; aceitamos variações.
        let sourceAdId: string | null = externalAdReply?.sourceId
          || externalAdReply?.source_id
          || body?.data?.sourceId
          || null;
        const sourceType = externalAdReply?.sourceType || externalAdReply?.source_type || null;
        let sourceUrl: string | null = externalAdReply?.sourceUrl || externalAdReply?.source_url || null;

        // FALLBACK RECURSIVO: se o parse direto não achou nada mas o Meta aninhou
        // o referral em outro caminho (viewOnceMessage.*, ephemeralMessage.*, etc.),
        // varre a árvore inteira do payload.
        if (!ctwaClid && !sourceAdId && !externalAdReply) {
          try {
            const { findReferralPaths } = await import("../_shared/ctwa-referral-probe.ts");
            const hit = findReferralPaths(body);
            if (hit.matchedPaths.length > 0) {
              ctwaClid = ctwaClid || hit.ctwaClid;
              sourceAdId = sourceAdId || hit.sourceAdId;
              sourceUrl = sourceUrl || hit.sourceUrl;
              externalAdReply = externalAdReply || hit.raw;
            }
          } catch (e) {
            console.warn("[lead-source] recursive referral scan falhou:", (e as Error).message);
          }
        }

        // Probe diagnóstico (fire-and-forget): grava payload cru quando parece CTWA
        // mas o parse não achou nada — para descobrirmos o shape real do Meta.
        try {
          const { logReferralProbe } = await import("../_shared/ctwa-referral-probe.ts");
          logReferralProbe(supabase, {
            source: "evolution",
            payload: body,
            messageText,
            customerId: customer.id,
            consultantId: instanceData.consultant_id,
          }).catch(() => {});
        } catch { /* ignore */ }

        const hasReferral = !!(externalAdReply || ctwaClid || sourceAdId || sourceUrl);
        const strongMetaSignalPresent = !!(sourceAdId || ctwaClid || sourceUrl);

        // Payload completo do referral para auditoria (grava SEMPRE que veio sinal).
        const referralPayload = hasReferral
          ? {
              title: externalAdReply?.title,
              body: externalAdReply?.body,
              source_url: sourceUrl,
              media_url: externalAdReply?.thumbnailUrl,
              source_id: sourceAdId,
              source_type: sourceType,
              ctwa_clid: ctwaClid,
              raw: externalAdReply,
            }
          : null;

        let sourceCampaignId: string | null = null;
        let matchMethod: "protocol" | "ad_id" | "ad_id_in_url" | "fb_campaign_id" | "ctwa_clid" | "exact_message" | "tsvector" | "unmatched" = "unmatched";
        let matchSimilarity: number | null = null;

        // 0) Blindagem: sinais fortes do Meta vêm primeiro e nunca perdem para protocolo/texto.
        const strongFields = extractMetaReferralFields(msgData, body);
        const strong = await resolveCampaignFromStrongMeta(supabase, instanceData.consultant_id, {
          ...strongFields,
          referral: strongFields.referral || externalAdReply || null,
          ctwaClid: strongFields.ctwaClid || ctwaClid,
          sourceAdId: strongFields.sourceAdId || sourceAdId,
          sourceUrl: strongFields.sourceUrl || sourceUrl,
        });
        if (strong) {
          sourceCampaignId = strong.campaignId;
          sourceAdId = sourceAdId || strong.sourceAdId;
          matchMethod = strong.method;
        }

        // 1) Protocolo legado OU frase exata (= initial_message no banco).
        if (!sourceCampaignId && !strongMetaSignalPresent && messageText) {
          const byProtocol = await resolveCampaignByProtocolOnly(supabase, instanceData.consultant_id, messageText);
          if (byProtocol) {
            sourceCampaignId = byProtocol.campaignId;
            matchMethod = byProtocol.method;
          }
        }

        // 4) Regex fallback para frases típicas de anúncio (último recurso)
        const adsRegex = /(tenho interesse.*mais informa[çc][õo]es|gostaria de saber mais|quero saber mais|vi seu an[uú]ncio|vim do an[uú]ncio|do an[uú]ncio|pelo an[uú]ncio|vi o an[uú]ncio|facebook|instagram|\bfb ads?\b|\bmeta ads?\b|patrocinad|reels|stories|sponsored)/i;
        const textMatch = !isFile && messageText && adsRegex.test(messageText);

        // 4.5) Frase-âncora do Meta CTWA (sinal fraco): NÃO tenta mais adivinhar
        //      a campanha a partir de "única pool ativa" (blindagem do rodízio).
        //      Apenas sinaliza que provavelmente é anúncio; a decisão de fila
        //      de revisão manual acontece no bloco de rodízio abaixo.
        const ctwaPhraseMatch = !isFile && messageText && matchesMetaCtwaPhrase(messageText);


        if (sourceCampaignId && sourceAdId) {
          const validAd = await campaignContainsAdId(supabase, sourceCampaignId, sourceAdId, instanceData.consultant_id);
          if (!validAd) {
            console.warn(`[lead-source] bloqueado: campaign=${sourceCampaignId} não contém ad_id=${sourceAdId}`);
            await markManualReview(supabase, customer.id, "campaign_ad_id_mismatch");
            sourceCampaignId = null;
            matchMethod = "unmatched";
          }
        }

        // Blindagem absoluta: se chegou AD ID/CTWA/source URL do Meta e isso
        // não resolveu uma campanha, não pode usar texto/fallback para escolher
        // outra campanha individual. Melhor revisão manual do que mandar para
        // Rodrigo/Horácio quando o anúncio é de Francisco/Abel/Rafael.
        if (!sourceCampaignId && strongMetaSignalPresent) {
          // Sem campanha mapeada → lead do consultor dono (sem fila).
          await logRodizioOutcome(supabase, {
            customerId: customer.id,
            campaignId: null,
            method: "strong_meta_unmapped",
            outcome: "no_campaign_manual_review",
            messageSample: messageText,
          });
          console.warn(`[lead-source] customer=${customer.id} sinal Meta sem campanha — lead do dono (sem revisão)`);
        }

        if (hasReferral || textMatch || sourceCampaignId || ctwaPhraseMatch) {
          const patch: Record<string, any> = { lead_source: "meta_ads" };
          if (ctwaClid) patch.source_ctwa_clid = ctwaClid;
          if (sourceAdId) patch.source_ad_id = String(sourceAdId);
          if (referralPayload) patch.source_referral = referralPayload;

          if (sourceCampaignId) {
            const bind = await bindCustomerCampaign(supabase, customer.id, sourceCampaignId);
            if (bind.outcome === "bound" || bind.outcome === "already_bound") {
              sourceCampaignId = bind.campaignId;
              (customer as any).source_campaign_id = bind.campaignId;
            } else {
              console.warn(
                `[lead-source] vínculo bloqueado outcome=${bind.outcome} requested=${sourceCampaignId} persisted=${bind.campaignId}`,
              );
              await markManualReview(supabase, customer.id, `campaign_bind_${bind.outcome}`);
              sourceCampaignId = bind.campaignId;
              if (bind.campaignId) (customer as any).source_campaign_id = bind.campaignId;
            }
          }

          await supabase.from("customers").update(patch).eq("id", customer.id);
          Object.assign(customer, patch);

          // Popula ctwa_clid_mapping (clid → campanha) quando temos os dois.
          // Assim o método #2 passa a funcionar de fato para cliques futuros.
          if (ctwaClid && sourceCampaignId) {
            try {
              await supabase.from("ctwa_clid_mapping").upsert(
                { ctwa_clid: String(ctwaClid), campaign_id: sourceCampaignId },
                { onConflict: "ctwa_clid" },
              );
            } catch (e) {
              console.warn("[lead-source] ctwa_clid_mapping upsert falhou:", (e as Error).message);
            }
          }

          const reason = sourceCampaignId
            ? `campaign_match id=${sourceCampaignId} method=${matchMethod}`
            : hasReferral
            ? `referral ad_id=${sourceAdId} ctwa=${ctwaClid}`
            : `regex msg="${(messageText || "").slice(0, 60)}"`;
          jsonLog("info", "lead_source_tagged", {
            customer_id: customer.id,
            consultant_id: instanceData.consultant_id,
            reason,
            source_campaign_id: sourceCampaignId,
            source_ad_id: sourceAdId,
            ctwa_clid: ctwaClid,
            match_method: matchMethod,
          });
          // Re-espelha para promover o canal de 'manual' → 'ctwa' no painel.
          mirrorCustomerToCaptation(supabase, customer.id)
            .catch((e) => console.warn("[mirror-customer:tag] falhou:", (e as Error).message));
        }

        // Log de auditoria de match (Req 8.6) — best-effort, fail-open (Req 8.7)
        try {
          await supabase.from("campaign_match_log").insert({
            customer_id: customer.id,
            campaign_id: sourceCampaignId,
            method: matchMethod,
            similarity: matchSimilarity,
            message_sample: messageText ? String(messageText).slice(0, 200) : null,
          });
        } catch (e) {
          console.warn("[campaign-match-log] insert falhou:", (e as Error).message);
        }
      }
    } catch (e) {
      console.warn("[lead-source] falha ao detectar:", (e as Error).message);
    }

    // ─── Resolução extra de campanha (frase CTWA sem AD ID) ─────────────
    // Protocolo profissional (FB-87321 etc.) ou similaridade segura entre
    // múltiplas campanhas ativas. Não escolhe por acaso em empate.
    if (
      customer &&
      !(customer as any).source_campaign_id &&
      !(customer as any).source_ad_id &&
      !(customer as any).source_ctwa_clid &&
      !(customer as any).ctwa_clid &&
      !isFile &&
      messageText &&
      matchesMetaCtwaPhrase(messageText)
    ) {
      try {
        // Protocolo FB-xxxxx → 1 pool ativa (sole) → fuzzy Jaccard.
        const { resolveCampaignBySinglePoolFuzzy } = await import(
          "../_shared/single-pool-campaign-resolver.ts"
        );
        const resolved = await resolveCampaignBySinglePoolFuzzy(
          supabase,
          instanceData.consultant_id,
          messageText,
        );
        if (resolved) {
          const bind = await bindCustomerCampaign(supabase, customer.id, resolved);
          if (bind.outcome === "bound" || bind.outcome === "already_bound") {
            (customer as any).source_campaign_id = bind.campaignId;
            (customer as any).lead_source = "meta_ads";
          } else {
            await markManualReview(supabase, customer.id, `campaign_bind_${bind.outcome}`);
          }
          jsonLog("info", "lead_source_tagged_single_pool_fuzzy", {
            customer_id: customer.id,
            consultant_id: instanceData.consultant_id,
            campaign_id: resolved,
          });
        } else {
          // Sem protocolo/AD ID/CTWA não atribui campanha: revisão manual.
          const { resolveCampaignAutoLadder } = await import(
            "../_shared/single-pool-campaign-resolver.ts"
          );
          const ladder = await resolveCampaignAutoLadder(
            supabase,
            instanceData.consultant_id,
            { phone: (customer as any).phone_whatsapp, messageText },
          );
          if (ladder) {
            const bind = await bindCustomerCampaign(supabase, customer.id, ladder.campaignId);
            if (bind.outcome === "bound" || bind.outcome === "already_bound") {
              (customer as any).source_campaign_id = bind.campaignId;
              (customer as any).lead_source = "meta_ads";
            } else {
              await markManualReview(supabase, customer.id, `campaign_bind_${bind.outcome}`);
            }
            await logRodizioOutcome(supabase, {
              customerId: customer.id,
              campaignId: ladder.campaignId,
              method: ladder.method,
              outcome: "assigned",
              messageSample: ladder.sample,
            });
            jsonLog("info", "lead_source_tagged_ladder", {
              customer_id: customer.id,
              consultant_id: instanceData.consultant_id,
              campaign_id: ladder.campaignId,
              method: ladder.method,
              sample: ladder.sample,
            });
          }
        }
      } catch (e) {
        console.warn("[single-pool-fuzzy] falhou:", (e as Error).message);
      }

    }

    let rodizioCampaignId = (customer as any)?.source_campaign_id || null;
    if (rodizioCampaignId && (customer as any)?.source_ad_id) {
      const validAd = await campaignContainsAdId(
        supabase,
        rodizioCampaignId,
        (customer as any).source_ad_id,
        instanceData.consultant_id,
      );
      if (!validAd) {
        console.warn(`[rodizio] bloqueado: campaign=${rodizioCampaignId} não contém ad_id=${(customer as any).source_ad_id}`);
        await markManualReview(supabase, customer.id, "campaign_ad_id_mismatch");
        await logRodizioOutcome(supabase, {
          customerId: customer.id,
          campaignId: rodizioCampaignId,
          method: "campaign_ad_id_mismatch",
          outcome: "no_campaign_manual_review",
          messageSample: messageText,
        });
        rodizioCampaignId = null;
      }
    }
    const ctwaSignalNoCampaign =
      !rodizioCampaignId &&
      !isFile &&
      !!messageText &&
      matchesMetaCtwaPhrase(messageText);

    // ─── Rodízio (atômico) ─────────────────────────────────────────────
    // rodizio_assign_lead: FOR UPDATE no customer + rodizio_next na mesma
    // transação. Fail-open: lead nunca se perde (Requisito 11).
    if (customer && !(customer as any).referral_partner_id && rodizioCampaignId) {
      try {
        // Atribuição atômica (FOR UPDATE no customer + rodizio_next na mesma RPC).
        const assign = await assignRodizioLead(supabase, customer.id, rodizioCampaignId);

        if (assign.outcome === "assigned" && assign.partnerId) {
          const rodizioPartnerId = assign.partnerId;
          (customer as any).referral_partner_id = rodizioPartnerId;
          console.log(
            `[rodizio] customer=${customer.id} campaign=${rodizioCampaignId} partner=${rodizioPartnerId}`,
          );
          await logRodizioOutcome(supabase, {
            customerId: customer.id,
            campaignId: rodizioCampaignId,
            method: "rodizio_assign_lead",
            outcome: "assigned",
            messageSample: messageText,
          });

          (async () => {
            const { assignProtocolToCustomer } = await import("../_shared/protocol.ts");
            const { data: prow } = await supabase.from("referral_partners").select("nome").eq("id", rodizioPartnerId).maybeSingle();
            const res = await assignProtocolToCustomer(supabase, customer.id, { partnerId: rodizioPartnerId, partnerName: (prow as any)?.nome });
            return notifyPartnerNewLead(instanceData.consultant_id, rodizioPartnerId, {
              id: customer.id,
              name: (customer as any).name,
              name_source: (customer as any).name_source,
              phone_whatsapp: (customer as any).phone_whatsapp,
              is_sandbox: (customer as any).is_sandbox,
              tracking_protocol: res?.protocol,
            });
          })().catch((e) => console.warn("[notify-partner-lead] falhou:", (e as Error).message));

          const cAny = customer as any;
          if (cAny.source_campaign_id && !cAny.source_ad_id && !cAny.source_ctwa_clid) {
            let partnerName: string | null = null;
            try {
              const { data: prow } = await supabase
                .from("referral_partners")
                .select("nome")
                .eq("id", rodizioPartnerId)
                .maybeSingle();
              partnerName = (prow as any)?.nome ?? null;
            } catch { /* ignore */ }
            notifySuperAdminUnmatchedLead(
              instanceData.consultant_id,
              {
                id: customer.id,
                name: cAny.name,
                phone_whatsapp: cAny.phone_whatsapp,
                is_sandbox: cAny.is_sandbox,
              },
              "initial_message_match_no_ad_id",
              partnerName,
            ).catch((e) => console.warn("[notify-superadmin] falhou:", (e as Error).message));
          }
        } else if (assign.outcome === "already_assigned") {
          if (assign.partnerId) {
            (customer as any).referral_partner_id = assign.partnerId;
          }
          console.log(
            `[rodizio] customer=${customer.id} já atribuído — turno não consumido`,
          );
          await logRodizioOutcome(supabase, {
            customerId: customer.id,
            campaignId: rodizioCampaignId,
            method: "rodizio_assign_lead",
            outcome: "already_assigned",
            messageSample: messageText,
          });
        } else if (assign.outcome === "pool_empty") {
          // Campanha sem pool / sem parceiros → lead fica 100% com o consultor dono.
          // Não entra na fila de revisão nem exige parceiro.
          console.log(
            `[rodizio] customer=${customer.id} campaign=${rodizioCampaignId} pool vazia — lead do consultor dono`,
          );
          await logRodizioOutcome(supabase, {
            customerId: customer.id,
            campaignId: rodizioCampaignId,
            method: "rodizio_assign_lead",
            outcome: "pool_empty",
            messageSample: messageText,
          });
        } else if (assign.outcome === "customer_missing") {
          // Sem parceiro na pool → lead do consultor dono (sem fila).
          console.log(
            `[rodizio] customer=${customer.id} campaign=${rodizioCampaignId} customer_missing/pool — lead do dono`,
          );
          await logRodizioOutcome(supabase, {
            customerId: customer.id,
            campaignId: rodizioCampaignId,
            method: "rodizio_assign_lead",
            outcome: "pool_empty",
            messageSample: messageText,
          });
        } else {
          // rpc_error
          console.warn("[rodizio] rodizio_assign_lead falhou:", assign.errorMessage);
          await markManualReview(supabase, customer.id, "rodizio_rpc_error");
          await logRodizioOutcome(supabase, {
            customerId: customer.id,
            campaignId: rodizioCampaignId,
            method: "rodizio_assign_lead",
            outcome: "rpc_error",
            messageSample: messageText,
          });
          notifyOwnerManualReview(
            instanceData.consultant_id,
            {
              id: customer.id,
              name: (customer as any).name,
              name_source: (customer as any).name_source,
              phone_whatsapp: (customer as any).phone_whatsapp,
              is_sandbox: (customer as any).is_sandbox,
            },
            "rodizio_rpc_error",
          ).catch((e) => console.warn("[notify-owner-review] falhou:", (e as Error).message));
        }
      } catch (e) {
        console.warn("[rodizio] falhou:", (e as Error).message);
      }
    } else if (customer && !(customer as any).referral_partner_id && ctwaSignalNoCampaign) {
      // Frase CTWA sem campanha/parceiro → lead do consultor dono (sem fila).
      await logRodizioOutcome(supabase, {
        customerId: customer.id,
        campaignId: null,
        method: "ctwa_phrase_no_campaign",
        outcome: "no_campaign_manual_review",
        messageSample: messageText,
      });
      console.log(
        `[lead-attribution] customer=${customer.id} ctwa_phrase sem campanha — lead do dono (sem revisão)`,
      );
    }


    // ─── Partner Attribution (Detection Window: primeiras 3 mensagens) ───
    // 1º) Marcador determinístico `#R{short_code}` (inserido pelo qr-redirect).
    //     É o caminho confiável: imune a edição da keyword, colisões e leads
    //     que só mandam "oi" depois.
    // 2º) Fallback: `matchKeyword` EXATO por tokens (legado — QRs antigos /
    //     keyword digitada). Sem fuzzy: "Nilza"≠"nilma". Preferir `#R{code}`.
    if (customer && !(customer as any).referral_partner_id && messageText && !isFile) {
      try {
        const leadSourceText = JSON.stringify((customer as any).lead_source || "").toLowerCase();
        const blockKeywordForMetaLead =
          !!(customer as any).source_campaign_id ||
          !!(customer as any).source_ad_id ||
          !!(customer as any).source_ctwa_clid ||
          !!(customer as any).ctwa_clid ||
          leadSourceText.includes("meta") ||
          matchesMetaCtwaPhrase(messageText);

        if (blockKeywordForMetaLead) {
          // Meta sem pool: não chuta keyword de parceiro; lead fica com o dono.
          console.warn(`[partner-match] keyword bloqueada (Meta) customer=${customer.id} — lead do dono`);
        }

        const { count: inboundCount } = await supabase
          .from("conversations")
          .select("id", { count: "exact", head: true })
          .eq("customer_id", customer.id)
          .eq("message_direction", "inbound");

        const DETECTION_WINDOW = 3;
        if (!blockKeywordForMetaLead && (inboundCount ?? 0) < DETECTION_WINDOW) {
          let matchedPartnerId: string | null = null;
          let matchedKeyword = "";
          let matchedScore = 1.0;
          let matchedSource: "short_code" | "keyword" = "keyword";

          // 1º) Marcador determinístico.
          const markerCode = extractShortCodeMarker(messageText);
          if (markerCode) {
            const { data: byCode } = await supabase
              .from("referral_partners")
              .select("id, keywords")
              .eq("consultant_id", instanceData.consultant_id)
              .eq("is_active", true)
              .eq("short_code", markerCode)
              .limit(1)
              .maybeSingle();
            if (byCode?.id) {
              matchedPartnerId = byCode.id as string;
              matchedKeyword = `#R${markerCode}`;
              matchedSource = "short_code";
              const partnerKws = Array.isArray(byCode.keywords)
                ? (byCode.keywords as string[])
                : [];
              if (partnerKws.length > 0) {
                const loc = matchKeyword(messageText, [
                  { partnerId: byCode.id as string, keywords: partnerKws },
                ]);
                if (loc?.keyword) matchedKeyword = loc.keyword;
              }
            }
          }

          // 2º) Fallback: keyword no texto (parceiros).
          if (!matchedPartnerId) {
            const { data: partners } = await supabase
              .from("referral_partners")
              .select("id, keywords")
              .eq("consultant_id", instanceData.consultant_id)
              .eq("is_active", true);

            if (partners?.length) {
              const partnerKeywords: PartnerKeywords[] = partners.map((p: any) => ({
                partnerId: p.id,
                keywords: p.keywords || [],
              }));
              const match = matchKeyword(messageText, partnerKeywords);
              if (match) {
                matchedPartnerId = match.partnerId;
                matchedKeyword = match.keyword;
                matchedScore = match.score;
                matchedSource = "keyword";
              }
            }
          }

          // 3º) Banner do CONSULTOR (sem parceiro).
          if (!matchedPartnerId) {
            const { data: consBanner } = await supabase
              .from("consultants")
              .select("banner_keywords")
              .eq("id", instanceData.consultant_id)
              .maybeSingle();
            const bannerKws = Array.isArray(consBanner?.banner_keywords)
              ? (consBanner!.banner_keywords as string[]).filter(Boolean)
              : [];
            if (bannerKws.length > 0) {
              const loc = matchKeyword(messageText, [
                { partnerId: instanceData.consultant_id, keywords: bannerKws },
              ]);
              if (loc?.keyword) {
                matchedKeyword = loc.keyword;
                await supabase.from("customers").update({
                  referral_keyword_matched: matchedKeyword,
                  referral_detected_at: new Date().toISOString(),
                }).eq("id", customer.id);
                console.log(
                  `[banner-keyword] customer=${customer.id} consultant=${instanceData.consultant_id} keyword="${matchedKeyword}"`,
                );
              }
            }
          }

          if (matchedPartnerId) {
            const { error: partnerLinkErr } = await supabase.from("customers").update({
              referral_partner_id: matchedPartnerId,
              referral_keyword_matched: matchedKeyword,
              referral_detected_at: new Date().toISOString(),
            }).eq("id", customer.id);
            if (partnerLinkErr) {
              console.warn(
                `[partner-match] update falhou customer=${customer.id} partner=${matchedPartnerId}:`,
                partnerLinkErr.message,
              );
            } else {
              (customer as any).referral_partner_id = matchedPartnerId;
              console.log(
                `[partner-match] customer=${customer.id} partner=${matchedPartnerId} source=${matchedSource} marker="${matchedKeyword}" score=${matchedScore}`,
              );
              // Só notifica se o vínculo ficou gravado no banco.
              (async () => {
                const { assignProtocolToCustomer } = await import("../_shared/protocol.ts");
                const { data: prow } = await supabase.from("referral_partners").select("nome").eq("id", matchedPartnerId).maybeSingle();
                const res = await assignProtocolToCustomer(supabase, customer.id, { partnerId: matchedPartnerId, partnerName: (prow as any)?.nome });
                return notifyPartnerNewLead(instanceData.consultant_id, matchedPartnerId, {
                  id: customer.id,
                  name: (customer as any).name,
                  name_source: (customer as any).name_source,
                  phone_whatsapp: (customer as any).phone_whatsapp,
                  is_sandbox: (customer as any).is_sandbox,
                  tracking_protocol: res?.protocol,
                });
              })().catch((e) => console.warn("[notify-partner-lead] falhou:", (e as Error).message));
            }
          }
        }
      } catch (e) {
        console.warn("[partner-match] falhou:", (e as Error).message);
      }
    }

    // ─── Auto-capture: extrai nome/email/CEP/valor/CPF de TODA inbound de texto ───
    // Paridade com whapi-webhook. Idempotente — só preenche slots vazios.
    if (messageText && !isFile && customer) {
      try {
        const _stepForName = stripPrefix((customer as any).conversation_step || "");
        const multi = extractMultiField(messageText, {
          allowSingleWordName:
            !!(customer as any).name_ask_sent_at ||
            ["ask_name", "aguardando_nome"].includes(_stepForName) ||
            /ask_name|nome/i.test(_stepForName) ||
            (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(_stepForName) &&
              !String((customer as any).name || "").trim()),
        });
        const patch = buildMultiFieldPatch(customer, multi);
        if (Object.keys(patch).length > 0) {
          if (patch.name) {
            const { count: inboundCount } = await supabase
              .from("conversations")
              .select("id", { count: "exact", head: true })
              .eq("customer_id", customer.id)
              .eq("message_direction", "inbound");
            const isEarly = (inboundCount ?? 0) <= 2;
            const isNameCaptureStep = ["ask_name", "aguardando_nome"].includes(stripPrefix((customer as any).conversation_step || ""));
            if (isEarly || isNameCaptureStep) patch.name_source = "self_introduced";
          }
          await supabase.from("customers").update(patch).eq("id", customer.id);
          Object.assign(customer as any, patch);
          console.log(`[auto-capture] customer=${customer.id} fields=${Object.keys(patch).join(",")} name="${patch.name || ""}"`);
        }
      } catch (e) {
        console.warn("[auto-capture] falhou:", (e as Error).message);
      }
    }


    // ─── 6) Log inbound ────────────────────────────────────────────────
    let inboundLogId: string | null = null;
    {
      const meta = inboundConvMeta();
      const { data: inboundIns } = await supabase.from("conversations").insert({
        customer_id: customer.id,
        message_direction: "inbound",
        message_text: meta.message_text,
        message_type: meta.message_type,
        media_id: meta.media_id,
        conversation_step: customer.conversation_step,
        external_message_id: messageId || null,
      }).select("id").maybeSingle();
      inboundLogId = (inboundIns as { id?: string } | null)?.id ?? null;
    }

    // ─── 6.media) Download + last_inbound ANTES de bot_paused / bot-off ──
    // Sem isso, handoff/kill-switch retornava sem MinIO nem last_inbound_media_*,
    // e o feed da Captação ficava sem preview/anexar (paridade Whapi).
    // ─── 6.media) Download media (if any) ───────────────────────────────
    let fileUrl: string | null = null;
    let fileBase64: string | null = null;
    let inboundMediaMinioUrl: string | null = null;
    // Task 14 (whatsapp-flow-reliability-fix): rastrear falhas de download
    // explicitamente e responder ao cliente em vez de silenciar. Quando o
    // download falha completamente (sem base64 e sem URL), registramos em
    // `inbound_media_failures`, mandamos reply de cortesia e MANTEMOS o step
    // atual — antes a thread continuava com `fileBase64=null` e o handler
    // perguntava por foto de novo, ou pior, ficava mudo.
    let mediaDownloadFailed = false;
    if (isFile) {
      console.log("📥 Baixando mídia via Evolution API (getBase64FromMediaMessage)...");
      fileBase64 = await sender.downloadMedia(key, message);
      if (fileBase64) {
        const mimeType = imageMessage?.mimetype || documentMessage?.mimetype || "application/octet-stream";
        // OOM-FIX 2026-06-28: NÃO construir mais `data:${mime};base64,${fileBase64}` aqui.
        // Essa string duplica o heap (base64 + data URL viviam juntos) e era a causa
        // principal dos `Memory limit exceeded` no Edge Function (256MB).
        // Os handlers do bot-flow já fazem fallback inteligente: usam fileBase64 quando
        // existe e só caem em fileUrl quando ele começa com "http" (URL real).
        fileUrl = null;
        console.log(`✅ Mídia baixada via Evolution (${mimeType}, b64 len: ${fileBase64.length})`);

        // Pre-declarado fora do try para o catch poder usar no enqueue de retry.
        const kind: "image" | "audio" | "video" | "document" =
          mimeType.startsWith("image/") ? "image"
          : mimeType.startsWith("audio/") ? "audio"
          : mimeType.startsWith("video/") ? "video"
          : "document";

        // Background: upload to MinIO em whatsapp/{consultor}/{jid}/{kind}/{ts}.{ext}
        // Não bloqueia o fluxo do bot; apenas registra a URL pública para o histórico.
        // Task 15 (whatsapp-flow-reliability-fix): em falha de upload, enfileirar
        // em `inbound_media_retry` com base64 + mime para o cron de retry.
        // O fluxo do bot continua normalmente porque o OCR já tem o base64 em mãos.
        try {
          const { uploadToMinioPath, base64ToBytes, buildConsultantSlug, sanitizeJid, normalizeName, extFromMime } =
            await import("../_shared/minio-upload.ts");
          const slug = buildConsultantSlug(consultorId || instanceData.consultant_id, nomeRepresentante);
          const jid = sanitizeJid(remoteJid || phone);
          const ext = extFromMime(mimeType);
          const objectKey = `whatsapp/${slug}/${jid}/${kind}/${Date.now()}.${ext}`;
          const bytes = base64ToBytes(fileBase64);
          const upRes = await uploadToMinioPath(bytes, mimeType, objectKey);
          inboundMediaMinioUrl = upRes.url;
          console.log(`📦✅ inbound media → MinIO: ${upRes.url.substring(0, 100)}`);
          // Anexa a URL na conversa inbound + last_inbound (paridade Whapi / Captação)
          try {
            const convId = inboundLogId || (await supabase.from("conversations")
              .select("id").eq("customer_id", customer.id).eq("message_direction", "inbound")
              .order("created_at", { ascending: false }).limit(1).maybeSingle()).data?.id;
            if (convId) {
              await supabase.from("conversations").update({
                message_text: `[${kind}] ${upRes.url}`,
                message_type: kind,
              }).eq("id", convId);
            }
          } catch (e) { /* ignore */ }
          try {
            await supabase.from("customers").update({
              last_inbound_media_url: upRes.url,
              last_inbound_media_mime: mimeType,
              last_inbound_media_kind: kind,
              last_inbound_media_message_id: messageId || null,
              last_inbound_media_at: new Date().toISOString(),
            }).eq("id", customer.id);
          } catch (e: any) {
            console.warn(`⚠️ [evolution] Falha ao persistir last_inbound_media: ${e?.message}`);
          }
        } catch (uploadErr: any) {
          console.warn(`📦⚠️ inbound media MinIO falhou — enfileirando retry: ${uploadErr?.message}`);
          // Task 15: enqueue retry em `inbound_media_retry` para o cron processar.
          // base64 + mime ficam disponíveis para upload posterior. TTL default 1h.
          try {
            await supabase.from("inbound_media_retry").insert({
              customer_id: customer.id,
              consultant_id: instanceData.consultant_id,
              message_id: messageId,
              media_kind: kind,
              base64: fileBase64,
              mime_type: mimeType,
            });
            jsonLog("info", "inbound_media_retry_enqueued", {
              customer_id: customer.id,
              consultant_id: instanceData.consultant_id,
              message_id: messageId,
              media_kind: kind,
              reason: uploadErr?.message ?? "minio_upload_failed",
            });
          } catch (enqueueErr: any) {
            console.error("[inbound-media-retry] enqueue falhou:", enqueueErr?.message);
          }
        }
      } else {
        // Task 14: download retornou null. Tenta URL direta como fallback.
        // Se também não houver URL, registra falha persistente, responde ao
        // cliente e marca para preservar o step atual lá embaixo.
        fileUrl = extractMediaUrl(message);
        if (fileUrl) {
          console.warn("⚠️ downloadMedia falhou, usando URL direta como fallback:", fileUrl.substring(0, 80));
          try {
            const _kind = hasDocument ? "document" : (hasVideo ? "video" : (hasImage ? "image" : (hasAudio ? "audio" : "other")));
            const _mime = imageMessage?.mimetype || documentMessage?.mimetype || audioMessage?.mimetype || null;
            await supabase.from("customers").update({
              last_inbound_media_url: fileUrl,
              last_inbound_media_mime: _mime,
              last_inbound_media_kind: _kind,
              last_inbound_media_message_id: messageId || null,
              last_inbound_media_at: new Date().toISOString(),
            }).eq("id", customer.id);
          } catch (e: any) {
            console.warn(`⚠️ [evolution] Falha last_inbound (url fallback): ${e?.message}`);
          }
        } else {
          mediaDownloadFailed = true;
          console.error("❌ Falha total ao baixar mídia — sem base64 e sem URL");
          jsonLog("warn", "evolution_media_lost", {
            customer_id: customer.id,
            consultant_id: instanceData.consultant_id,
            message_id: messageId,
            v2_flag: v2Flag,
            reason: "download_returned_null_no_fallback_url",
          });
          try {
            await supabase.from("inbound_media_failures").insert({
              customer_id: customer.id,
              consultant_id: instanceData.consultant_id,
              message_id: messageId,
              reason: "download_returned_null_no_fallback_url",
              raw_payload: {
                has_image: hasImage,
                has_document: hasDocument,
                image_mime: imageMessage?.mimetype ?? null,
                document_mime: documentMessage?.mimetype ?? null,
                key: key ?? null,
              },
            });
          } catch (logErr: any) {
            console.error("[inbound-media-failures] insert falhou:", logErr?.message);
          }
        }
      }
    }


    // Stop rule: resposta HUMANA pausa/realinha a cadência (sem envio).
    // Clique CTWA / initial_message da campanha NÃO pausa 72h.
    try {
      const { onLeadInboundResponse, ensureCadenceState } = await import(
        "../_shared/cadence-hooks.ts"
      );
      await onLeadInboundResponse(supabase, customer.id);
      await ensureCadenceState(
        supabase,
        customer.id,
        (customer as { consultant_id?: string | null }).consultant_id ?? instanceData.consultant_id ?? null,
      );
    } catch (hookErr) {
      console.warn("[cadence-hooks] inbound sync failed:", (hookErr as Error).message);
    }

    // (Gate global de IA desligada foi movido para o topo — antes mesmo de
    // criar customer ou notificar. Veja "global-off-silent" no início.)

    // ─── 6.0) Captação manual: cliente confirmando dados (SIM/OK/CORRETO) ──
    // Em modo `capture_mode='manual'` (Captação Game/Pro), uma resposta de
    // confirmação só marca os timestamps `bill_data_confirmed_at` /
    // `doc_data_confirmed_at` e PARA. Não deixa o bot-flow seguir sozinho
    // pro próximo tile — o consultor que decide. Espelha o bloco
    // equivalente em `whapi-webhook/index.ts` (linha ~555).
    //
    // Sem esse gate, o cliente respondia "SIM" e o bot avançava o passo
    // automaticamente, gerando duplicação de mídia e descompasso com o
    // painel do consultor (reclamação recorrente §3 do bugfix).
    try {
      if (messageText && (customer as any).capture_mode === "manual") {
        const { data: confState } = await supabase
          .from("customers")
          .select("bill_data_confirmation_by, bill_data_confirmed_at, doc_data_confirmation_by, doc_data_confirmed_at")
          .eq("id", customer.id)
          .maybeSingle();
        const awaitingBill = (confState as any)?.bill_data_confirmation_by === "awaiting_client" && !(confState as any)?.bill_data_confirmed_at;
        const awaitingDoc = (confState as any)?.doc_data_confirmation_by === "awaiting_client" && !(confState as any)?.doc_data_confirmed_at;
        const currentConfirmStep = stripPrefix(String((customer as any).conversation_step || ""));
        const confirmingBill = currentConfirmStep === "confirmando_dados_conta" && !(confState as any)?.bill_data_confirmed_at;
        const confirmingDoc = currentConfirmStep === "confirmando_dados_doc" && !(confState as any)?.doc_data_confirmed_at;
        if (awaitingBill || awaitingDoc || confirmingBill || confirmingDoc) {
          const norm = String(messageText).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
          const isYes = /^(sim|ok|certo|correto|confere|isso|isso mesmo|perfeito|tudo certo|s|👍|✅|confirmo|positivo|exato|tudo certinho)/i.test(norm);
          const isNo = /^(nao|n|errado|incorreto|tem erro|corrige|corrigir)/i.test(norm);
          if (isYes) {
            const patch: Record<string, any> = {};
            const now = new Date().toISOString();
            if (awaitingBill || confirmingBill) { patch.bill_data_confirmed_at = now; patch.bill_data_confirmation_by = "client"; }
            if (awaitingDoc || confirmingDoc) { patch.doc_data_confirmed_at = now; patch.doc_data_confirmation_by = "client"; }
            await supabase.from("customers").update(patch).eq("id", customer.id);
            const reply = "✅ Dados confirmados.";
            try { await sender.sendText(remoteJid, reply); } catch (_e) { /* ignore */ }
            await supabase.from("conversations").insert({
              customer_id: customer.id, message_direction: "outbound",
              message_text: reply, message_type: "text",
              conversation_step: customer.conversation_step,
            });
            jsonLog("info", "capture_confirmed_manual_stop", {
              customer_id: customer.id,
              consultant_id: instanceData.consultant_id,
              bill: awaitingBill || confirmingBill,
              doc: awaitingDoc || confirmingDoc,
            });
            return new Response(JSON.stringify({ ok: true, msg: "capture_confirmed_manual_stop" }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          if (isNo) {
            // Cliente disse não/correção — limpa as flags pra consultor agir manualmente.
            // Bot fica calado: a correção é decisão humana.
            const patch: Record<string, any> = {};
            if (awaitingBill) patch.bill_data_confirmation_by = null;
            if (awaitingDoc) patch.doc_data_confirmation_by = null;
            await supabase.from("customers").update(patch).eq("id", customer.id);
            jsonLog("info", "capture_confirm_rejected", {
              customer_id: customer.id,
              consultant_id: instanceData.consultant_id,
            });
          }
        }
      }
    } catch (e) {
      console.warn("[capture-confirm] err:", (e as Error).message);
    }

    // ─── ⭐ Avaliação de atendimento profissional (1–5) ─────────────────
    // Intercepta ANTES de bot_paused / bot-flow / OCR. Cobre texto e mídia.
    if (customer && (messageText || buttonId || isFile || hasAudio || hasDocument || hasImage)) {
      const { tryInterceptAttendanceRating, isAwaitingAttendanceRating } = await import(
        "../_shared/attendance-flow.ts"
      );
      if (isAwaitingAttendanceRating(customer as any)) {
        const ratingMediaKind = hasDocument ? "document"
          : hasImage ? "image"
          : hasAudio ? "audio"
          : mediaKind === "video" ? "video"
          : isFile ? "file"
          : null;
        const ratingHit = await tryInterceptAttendanceRating({
          supabase,
          customer: {
            id: customer.id,
            conversation_step: (customer as any).conversation_step,
            attendance_rating: (customer as any).attendance_rating,
            attendance_rating_requested_at: (customer as any).attendance_rating_requested_at,
            bot_paused: (customer as any).bot_paused,
            bot_paused_reason: (customer as any).bot_paused_reason,
          },
          remoteJid,
          messageText,
          buttonId,
          isMedia: !!(isFile || hasAudio || hasDocument || hasImage),
          mediaKind: ratingMediaKind,
          // Evolution já logou o inbound acima — evita duplicar.
          skipInboundLog: true,
          sendText: async (jid, text) => {
            try { return !!(await sender.sendText(jid, text)); } catch { return false; }
          },
        });
        if (ratingHit.abandoned) {
          (customer as any).conversation_step = null;
          const reason = String((customer as any).bot_paused_reason || "").toLowerCase();
          const humanKeep =
            reason.includes("humano") || reason.includes("human") || reason.startsWith("handoff");
          if (!humanKeep) {
            (customer as any).bot_paused = false;
            (customer as any).bot_paused_reason = null;
            (customer as any).bot_paused_until = null;
          }
        } else if (ratingHit.intercepted) {
          return new Response(JSON.stringify({
            ok: true,
            msg: ratingHit.silent
              ? "attendance_rating_silent_human"
              : ratingHit.media
              ? "attendance_rating_media_hint"
              : ratingHit.invalid
              ? "attendance_rating_invalid_retry"
              : "attendance_rating_recorded",
            rating: ratingHit.rating ?? null,
          }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }
    }

    // Retentativa pós-reprovado: botão → sai da carteira e entra Grupo A (cadastro).
    if (customer && (buttonId || messageText)) {
      const { isPosVendaRetentativaClick, activatePosVendaRecadastro } = await import(
        "../_shared/pos-venda-retentativa.ts"
      );
      if (isPosVendaRetentativaClick(buttonId, messageText, customer as any)) {
        const act = await activatePosVendaRecadastro(supabase, {
          id: customer.id,
          name: (customer as any).name,
          name_source: (customer as any).name_source,
          consultant_id: (customer as any).consultant_id || null,
        });
        if (act.ok) {
          Object.assign(customer as any, act.patch);
          try {
            await sender.sendText(
              remoteJid,
              "Perfeito! Vamos recomeçar o cadastro juntos. Em instantes eu te guio no próximo passo. 💚",
            );
          } catch (e) {
            console.warn("[pos-venda-retentativa] ack falhou:", (e as Error).message);
          }
          console.log(`[pos-venda-retentativa] recadastro ativado customer=${customer.id}`);
        } else {
          console.warn("[pos-venda-retentativa] activate falhou:", act.error);
        }
      }
    }

    // ─── 6.1) BOT PAUSED — handoff humano ativo ────────────────────────
    // Se um humano assumiu, NÃO responder. Avisa o consultor (texto/mídia).
    // Usa helper canônico (bot_paused OU assigned_human_id OU until).
    if (isCustomerPausedByHuman(customer as any)) {
      const _autoReason = String((customer as any).bot_paused_reason || "").toLowerCase();
      // Só recovery automático. Takeover humano NUNCA despausa sozinho.
      const _isAutoStuckPause = _autoReason.startsWith("lead_travado_recovery")
        && !(customer as any).assigned_human_id;
      // Lead pausado por conta baixa que volta com valor novo (≥ mínimo) ou
      // intenção clara de cadastro → religa e segue para o Grupo A.
      const _lowBill = evaluateLowBillReentry(customer as any, messageText);
      if (_lowBill.reactivate) {
        const _upd: Record<string, unknown> = {
          bot_paused: false,
          bot_paused_reason: null,
          bot_paused_until: null,
          bot_paused_at: null,
          status: "pending",
          conversation_step: "qualificacao",
          flow_variant: "A",
          updated_at: new Date().toISOString(),
        };
        if (_lowBill.billValue != null) _upd.electricity_bill_value = _lowBill.billValue;
        const { error: lbErr } = await supabase.from("customers").update(_upd).eq("id", customer.id);
        if (lbErr) {
          console.error("⚠️ [evolution] falha ao religar low_bill_value:", lbErr);
        } else {
          console.log(`▶️ [evolution] Lead low_bill_value reativado ${phone} (${_lowBill.reason}, valor=${_lowBill.billValue ?? "—"})`);
          (customer as any).bot_paused = false;
          (customer as any).bot_paused_reason = null;
          (customer as any).bot_paused_until = null;
          (customer as any).status = "pending";
          (customer as any).conversation_step = "qualificacao";
          (customer as any).flow_variant = "A";
          if (_lowBill.billValue != null) (customer as any).electricity_bill_value = _lowBill.billValue;
        }
      }
      if (_lowBill.reactivate) {
        // já religado acima — segue o fluxo normal (Grupo A).
      } else if (_isAutoStuckPause) {
        const { error: unpErr } = await supabase
          .from("customers")
          .update({
            bot_paused: false,
            bot_paused_reason: null,
            bot_paused_until: null,
            bot_paused_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", customer.id);
        if (unpErr) {
          console.error("⚠️ [evolution] falha ao auto-despausar:", unpErr);
        } else {
          console.log(`▶️ [evolution] Auto-despausado ${customer.id} (reason=${_autoReason}, lead respondeu) — bot volta`);
          (customer as any).bot_paused = false;
          (customer as any).bot_paused_reason = null;
          (customer as any).bot_paused_until = null;
        }
      }
    }
    if (isCustomerPausedByHuman(customer as any)) {
      console.log(`🤝 [handoff] bot pausado para ${customer.id} (motivo: ${(customer as any).bot_paused_reason}). Skip auto-reply.`);
      try {
        const notifyTo = (customer as any).assigned_human_id || (customer as any).consultant_id || instanceData.consultant_id;
        if (notifyTo) {
          const kind = (mediaKind === "video" ? "video"
            : hasImage ? "image"
            : hasAudio ? "audio"
            : hasDocument ? "document"
            : "text") as "text" | "image" | "audio" | "video" | "document";
          const preview = messageText
            || (kind === "image" ? "[imagem]"
              : kind === "audio" ? "[áudio]"
              : kind === "video" ? "[vídeo]"
              : kind === "document" ? "[documento]"
              : "[mensagem]");
          const { notifyClientReplyWhilePaused } = await import("../_shared/notify-consultant.ts");
          notifyClientReplyWhilePaused(
            notifyTo,
            customer as any,
            preview,
            { kind: kind as any },
          ).catch((e) => console.warn("[notify-paused-reply] falhou:", (e as Error).message));
        }
      } catch (e) {
        console.warn("[notify-paused-reply] setup falhou:", (e as Error).message);
      }
      return new Response(JSON.stringify({ ok: true, msg: "bot_paused" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── 6.1.b) Bot OFF (kill switch global ou IA consultor) — grava + avisa ──
    const forceBotForLead = forceBotForLeadEarly || (customer as any)?.bot_force_enabled === true;
    if ((!botGlobalOutboundEnabled || consultantAiDisabled) && !forceBotForLead) {
      const why = !botGlobalOutboundEnabled
        ? "Kill switch global (bot_global_enabled=false)"
        : "IA do consultor desligada";
      console.log(`🛑 [bot-off] ${why} — inbound sem auto-reply customer=${customer.id}`);
      // Inbound já gravado no passo 6 (+ mídia em 6.media). Não duplicar.
      const notifyTo = (customer as any).assigned_human_id || (customer as any).consultant_id || instanceData.consultant_id;
      if (notifyTo) {
        const kind = hasImage ? "image" : hasAudio ? "audio" : hasDocument ? "document" : "text";
        const preview = messageText
          || (kind === "image" ? "[imagem]" : kind === "audio" ? "[áudio]" : kind === "document" ? "[documento]" : "[mensagem]");
        const { notifyInboundWhileBotOff } = await import("../_shared/notify-consultant.ts");
        notifyInboundWhileBotOff(notifyTo, customer as any, preview, {
          kind: kind as any,
          reason: why,
        }).catch((e) => console.warn("[notify-bot-off] falhou:", (e as Error).message));
      }
      return new Response(JSON.stringify({
        ok: true,
        msg: !botGlobalOutboundEnabled ? "bot_globally_disabled_inbound_saved" : "global_ai_disabled_inbound_saved",
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Task 14: se a mídia foi perdida em definitivo, manda reply de cortesia
    // e retorna 200 SEM avançar/redirecionar o `conversation_step`. O cliente
    // reenviar normalmente cai no mesmo step e refaz o caminho.
    if (mediaDownloadFailed) {
      try {
        await sender.sendText(
          remoteJid,
          "Desculpa 😅 não consegui receber sua imagem. Pode reenviar?"
        );
        await supabase.from("conversations").insert({
          customer_id: customer.id,
          message_direction: "outbound",
          message_text: "Desculpa 😅 não consegui receber sua imagem. Pode reenviar?",
          message_type: "text",
          conversation_step: customer.conversation_step,
        });
      } catch (sendErr: any) {
        console.error("[evolution_media_lost] reply falhou:", sendErr?.message);
      }
      // Liberar customer lock antes do return (mesmo padrão do return final).
      if (lockToken && lockCustomerId) {
        try {
          await supabase.rpc("release_customer_lock", {
            p_customer: lockCustomerId, p_token: lockToken,
          });
        } catch (_) { /* noop */ }
        lockToken = null;
        lockCustomerId = null;
      }
      return new Response(JSON.stringify({ ok: true, mode: "media_lost" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── 7.5) Áudio → transcript (Task 17) ─────────────────────────────
    // Se o cliente mandou áudio E o download deu certo, transcreve via
    // ai-transcribe-media e injeta o texto como `messageText`.
    // Paridade com Whapi: se STT falhar/vazia, pede texto e NÃO segue às cegas.
    if (hasAudio && fileBase64 && !messageText) {
      let audioTranscribeOn = true;
      try {
        const { getGlobalAiSettings } = await import("../_shared/ai-config.ts");
        const g = await getGlobalAiSettings(supabase);
        if (g.audioTranscribe === false) audioTranscribeOn = false;
      } catch (_) { /* fail-safe: mantém ligado */ }

      if (!audioTranscribeOn) {
        console.log("🔇 Transcrição de áudio desligada (ai_audio_transcribe=false) — pedindo texto.");
        try {
          const { AUDIO_STT_DISABLED_FALLBACK } = await import("../_shared/audio-stt-fallback.ts");
          await sender.sendText(remoteJid, AUDIO_STT_DISABLED_FALLBACK);
        } catch (_) { /* best-effort */ }
        return new Response(JSON.stringify({ ok: true, msg: "audio_transcribe_disabled" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      try {
        const mt = audioMessage?.mimetype || "audio/ogg";
        console.log(`🎙️ Transcrevendo áudio do cliente (${mt})...`);
        const transRes = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/ai-transcribe-media`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
          },
          body: JSON.stringify({ base64: fileBase64, mimeType: mt, kind: "audio", language: "pt-BR" }),
        });
        const tj = await transRes.json().catch(() => ({}));
        const transcript = String(tj?.transcript || "").trim();
        if (transcript) {
          console.log(`✅ Transcrição (${transcript.length} chars): "${transcript.substring(0, 120)}"`);
          messageText = transcript;
          isFile = false;
          try {
            const { data: lastConv } = await supabase.from("conversations")
              .select("id").eq("customer_id", customer.id).eq("message_direction", "inbound")
              .order("created_at", { ascending: false }).limit(1).maybeSingle();
            if (lastConv?.id) {
              await supabase.from("conversations").update({
                message_text: `[áudio] ${transcript}`,
              }).eq("id", lastConv.id);
            }
          } catch (_) { /* best-effort */ }
        } else {
          console.warn("⚠️ Transcrição vazia — fallback educado.");
          try {
            const { AUDIO_STT_SOFT_FALLBACK } = await import("../_shared/audio-stt-fallback.ts");
            await sender.sendText(remoteJid, AUDIO_STT_SOFT_FALLBACK);
          } catch (_) { /* best-effort */ }
          return new Response(JSON.stringify({ ok: true, msg: "audio_empty_transcript" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } catch (e: any) {
        console.warn("⚠️ Transcrição falhou — fallback educado:", e?.message);
        try {
          const { AUDIO_STT_SOFT_FALLBACK } = await import("../_shared/audio-stt-fallback.ts");
          await sender.sendText(remoteJid, AUDIO_STT_SOFT_FALLBACK);
        } catch (_) { /* best-effort */ }
        return new Response(JSON.stringify({ ok: true, msg: "audio_transcribe_failed" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // ─── 7.0) Garante consultant_id no customer (lead órfão de tráfego) ─
    if (!customer.consultant_id && instanceData.consultant_id) {
      try {
        await supabase.from("customers")
          .update({ consultant_id: instanceData.consultant_id })
          .eq("id", customer.id);
        (customer as any).consultant_id = instanceData.consultant_id;
        console.log(`👤 [orphan-fix] customer ${customer.id} -> consultant ${instanceData.consultant_id}`);
      } catch (e) { console.warn("orphan-fix update failed:", e); }
    }

    // ─── 7.1) AI AGENT MODE — Camila assume conversa livre ─────────────
    // Steps onde a IA conduz (resto fica no bot hardcoded com BOTÕES intactos).
    // IMPORTANTE: "aguardando_conta" foi removido desta lista — qualquer mensagem
    // nesse step (texto OU arquivo) deve ir para o pipeline determinístico de OCR
    // (bot-flow.ts). Antes, texto livre em aguardando_conta ia para o AI agent
    // router e ignorava o OCR, causando silêncio ou resposta errada.
    const CONVERSATIONAL_STEPS = new Set([
      "welcome",
      "menu_inicial",
      "pos_video",
      "aguardando_humano",
      "qualificacao",
      "apresentacao",
      "objecoes",
    ]);
    // Defesa em profundidade: 'novo_lead' é stage do CRM/Kanban, NÃO um step válido do bot.
    // Se chegou aqui (ex.: ChatView auto-criou customer com esse valor antes do webhook),
    // normaliza para 'welcome' para que isOpeningTurn / CONVERSATIONAL_STEPS / engine override
    // reconheçam corretamente como abertura e disparem o fluxo (qualquer variante).
    if ((customer as any).conversation_step === "novo_lead") {
      (customer as any).conversation_step = "welcome";
    }
    const currentStep = customer.conversation_step || "welcome";

    // Cascata: config do consultor -> config global (consultant_id IS NULL)
    const { data: aiCfgPriv } = await supabase
      .from("ai_agent_config")
      .select("enabled")
      .eq("consultant_id", instanceData.consultant_id)
      .maybeSingle();
    let aiCfg = aiCfgPriv;
    if (!aiCfg) {
      const { data: aiCfgGlobal } = await supabase
        .from("ai_agent_config")
        .select("enabled")
        .is("consultant_id", null)
        .maybeSingle();
      aiCfg = aiCfgGlobal;
    }

    // ─── 7.1.a) Consultant opening-step detection (bugfix §2.17) ──────
    // Se o consultor tem um passo de abertura configurado (primeiro
    // `bot_flow_steps` ativo OU `bot_flow_qa.is_opening=true`), a configuração
    // explícita do consultor PRECEDE a abertura genérica do `ai-agent-router`
    // — caso contrário a Camila tomaria conta do welcome ignorando o roteiro
    // que o consultor escreveu na UI do Flow Builder. Gate é aplicado apenas
    // nos passos de abertura (welcome/menu_inicial/sem step), não nos demais
    // passos conversacionais (qualificacao, apresentacao, objecoes, etc.),
    // que continuam delegados à IA quando habilitada.
    //
    // Observação importante: `bot_flow_steps` NÃO tem coluna `is_opening`
    // (apenas `bot_flow_qa`). Para steps, "abertura" = primeiro step ativo
    // ordenado por `position`. Para QA, `is_opening=true` cobre o caso legado
    // (consultor que ainda não migrou para o Flow Builder dinâmico).
    let consultantHasOpeningStep = false;
    const isOpeningTurn =
      currentStep === "welcome" || currentStep === "menu_inicial" || !customer.conversation_step;
    if (isOpeningTurn) {
      try {
        // Template público A conta: consultor sem bot_flows A próprio (só D seed)
        // ainda tem abertura Sofia — senão a IA KB rouba o "Oi".
        const variant = resolveCanonicalFlowVariant((customer as any)?.flow_variant);
        const flowOwnerId = String(
          (customer as any)?.consultant_id || instanceData.consultant_id || "",
        );
        const resolved = await resolveFlowId(supabase, flowOwnerId, variant);
        const flowId = resolved?.id ?? null;
        if (flowId) {
          // (a) primeiro step ativo da sequência (`bot_flow_steps`)
          const { data: firstStep } = await supabase
            .from("bot_flow_steps")
            .select("id, step_key, position")
            .eq("flow_id", flowId)
            .eq("is_active", true)
            .order("position", { ascending: true })
            .limit(1)
            .maybeSingle();
          if ((firstStep as any)?.id) {
            consultantHasOpeningStep = true;
            jsonLog("info", "consultant_opening_step_detected", {
              consultant_id: instanceData.consultant_id,
              customer_id: customer.id,
              source: "bot_flow_steps",
              flow_id: flowId,
              step_key: (firstStep as any).step_key,
              position: (firstStep as any).position,
              v2_flag: v2Flag,
            });
          } else {
            // (b) fallback legado: `bot_flow_qa.is_opening=true`
            const { data: openingQa } = await supabase
              .from("bot_flow_qa")
              .select("id")
              .eq("flow_id", flowId)
              .eq("is_opening", true)
              .maybeSingle();
            if ((openingQa as any)?.id) {
              consultantHasOpeningStep = true;
              jsonLog("info", "consultant_opening_step_detected", {
                consultant_id: instanceData.consultant_id,
                customer_id: customer.id,
                source: "bot_flow_qa",
                flow_id: flowId,
                v2_flag: v2Flag,
              });
            }
          }
        }
      } catch (e) {
        jsonLog("warn", "consultant_opening_step_check_failed", {
          consultant_id: instanceData.consultant_id,
          customer_id: customer.id,
          v2_flag: v2Flag,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }

    // ─── Handoff manual detectado pelo parser (Evolution) ─────────────
    // Se o parser detectou um pedido explícito de atendimento humano.
    if ((parsed as any).handoffIntent && (customer as any).id) {
      const pausedUntil = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
      await supabase.from("customers").update({
        bot_paused_until: pausedUntil,
        bot_paused_reason: "handoff_request",
      }).eq("id", customer.id);
      
      await supabase.from("bot_handoff_alerts").insert({
        customer_id: customer.id,
        consultant_id: instanceData.consultant_id,
        phone,
        reason: "client_requested_human",
        user_message: (messageText || "").slice(0, 500),
      });

      const handoffReply = `Tudo bem! 🙏 Vou te transferir agora para ${nomeRepresentante}. Em alguns instantes alguém vai responder por aqui.`;
      try { await sender.sendText(remoteJid, handoffReply); } catch (e: any) { console.error("erro handoff reply:", e); }
      
      await supabase.from("conversations").insert({
        customer_id: customer.id,
        message_direction: "outbound",
        message_text: handoffReply,
        message_type: "text",
        conversation_step: (customer as any).conversation_step,
      });

      console.log(`🆘 Handoff ativado via intenção para ${phone} (${customer.id})`);
      return new Response(JSON.stringify({ ok: true, msg: "handoff_triggered", paused_until: pausedUntil }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── 7.1.b) AI vs Flow exclusivity gate (bugfix §2.10 + §2.17) ────
    // Em aguardando_conta, se o cliente mandou MÍDIA (foto da conta), NÃO chamar IA;
    // o bot hardcoded faz OCR + envia botões SIM/NÃO/EDITAR.
    //
    // §2.17 atualizado: quando o consultor tem passo de abertura configurado,
    // o roteiro do consultor SEMPRE vence na abertura. Antes isso dependia da
    // flag v2 e deixava a IA KB-only interceptar "Oi", pausar o lead por
    // `ai_no_kb_match` e impedir o fluxo de iniciar.
    //
    // §2.10: o `if (aiShouldHandle)` abaixo retorna 200 imediatamente após
    // disparar o `ai-agent-router`. Como `runConversationalFlow`/`runBotFlow`
    // só rodam APÓS esse return (no bloco "8) Run bot flow"), a exclusividade
    // é estrutural — `aiShouldHandle=true` ⇒ apenas o `ai-agent-router` envia
    // a resposta neste turno; nenhum motor determinístico é invocado em
    // paralelo. O fallback determinístico só dispara se o router retornar
    // erro/`skipped`, o que é tratado dentro da própria Edge Function
    // `ai-agent-router` (não aqui).
    // Modo NÚMERO DE TESTE / Cérebro ATIVO: se este número está na lista de
    // teste OU o consultor tem `cerebro_ativo='on'`, o turno NÃO é capturado
    // pela IA KB-only (ai-agent-router) — segue até o hook do Cérebro, que é a
    // fonte de verdade. Não afeta nada quando ambos estão desligados.
    let _ehNumeroTesteCerebro = false;
    let _cerebroAtivoConsultor = false;
    try {
      const { ehNumeroDeTesteAsync } = await import("../_shared/cerebro/resposta-hook.ts");
      const { isCerebroAtivo } = await import("../_shared/feature-flag.ts");
      _ehNumeroTesteCerebro = await ehNumeroDeTesteAsync(phone, supabase);
      _cerebroAtivoConsultor = await isCerebroAtivo(supabase as any, instanceData.consultant_id);
    } catch (_) { _ehNumeroTesteCerebro = false; _cerebroAtivoConsultor = false; }

    const aiShouldHandle =
      !_ehNumeroTesteCerebro &&
      !_cerebroAtivoConsultor &&
      aiCfg?.enabled === true &&
      CONVERSATIONAL_STEPS.has(currentStep) &&
      !(currentStep === "aguardando_conta" && isFile) &&
      // 📸 FIX (cadastro completo na IA livre): QUALQUER mídia (foto/PDF/doc)
      // — não só em aguardando_conta — NUNCA é entregue à IA livre, que só
      // conversa e "engole" o arquivo sem rodar OCR. Toda mídia cai no
      // pipeline determinístico (bot-flow → OCR real → confirma → pede doc →
      // OCR doc → e-mail → telefone → portal). Áudio é exceção: vira
      // transcrição/texto e segue na IA livre normalmente.
      !((isFile || hasImage || hasDocument) && !hasAudio) &&
      !(consultantHasOpeningStep && isOpeningTurn);

    if (consultantHasOpeningStep && isOpeningTurn) {
      jsonLog("info", "consultant_opening_step_ai_bypassed", {
        consultant_id: instanceData.consultant_id,
        customer_id: customer.id,
        v2_flag: v2Flag,
        ai_should_handle: aiShouldHandle,
      });
    }

    if (aiShouldHandle) {
      let aiInput = messageText || "";
      let aiInputKind: "text" | "audio_transcript" | "image_caption" | "document" = "text";
      if (isFile && fileBase64) {
        const mt = imageMessage?.mimetype || documentMessage?.mimetype || "application/octet-stream";
        const isAudio = mt.startsWith("audio/");
        const isImage = mt.startsWith("image/");
        try {
          const transRes = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/ai-transcribe-media`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
              apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
            },
            body: JSON.stringify({ base64: fileBase64, mimeType: mt, kind: isAudio ? "audio" : isImage ? "image" : "document" }),
          });
          const tj = await transRes.json();
          if (tj?.transcript) {
            aiInput = tj.transcript;
            aiInputKind = isAudio ? "audio_transcript" : isImage ? "image_caption" : "document";
          }
        } catch (e) { console.error("transcribe failed:", e); }
      }
      try {
        await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/ai-agent-router`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
            "x-service-secret": SERVICE_SHARED_SECRET,
          },
          body: JSON.stringify({
            customer_id: customer.id,
            instance_name: instanceName,
            user_input: aiInput,
            user_input_kind: aiInputKind,
            remote_jid: remoteJid,
          }),
        });
      } catch (e) { console.error("ai-agent-router invoke error:", e); }
      return new Response(JSON.stringify({ ok: true, mode: "ai_agent" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── 8) Run bot flow — engine routing (sys vs flow) ───────────────
    // Roteamento por prefixo: "flow:<id>" → conversational; nome cru → bot-flow determinístico.
    // Compat reversa: UUIDs/"passo_xxx" sem prefixo são tratados como flow.
    let rawStep = customer.conversation_step || null;
    let stepBefore = stripPrefix(rawStep);
    const originalFlowStep =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(stepBefore)
      || stepBefore.startsWith("passo_")
        ? stepBefore
        : null;
    (customer as any).conversation_step = stepBefore;

    // ─── 7.5) GUARD DE RETOMADA DE CADASTRO ──────────────────────────────
    // Bug 2026-06-28 (lead JONATAS 5511971254913): qualquer reset para
    // welcome/d_welcome/null fazia o bot pedir a foto da conta de novo,
    // ignorando que já havia conta + doc + CPF + e-mail no banco. O guard
    // detecta esse cenário e seta o step para o próximo campo realmente
    // pendente (calculado por getNextMissingStep), forçando o pipeline
    // determinístico de cadastro (bot-flow.ts) a retomar dali. Não envia
    // nada aqui — só ajusta o step; o engine a seguir cuida da resposta.
    try {
      const { shouldResumeCadastro } = await import(
        "../_shared/bot/resume-or-skip.ts"
      );
      const consultorEmailForGuard = (consultantData as any)?.igreen_portal_email ?? null;
      const resumeDecision = shouldResumeCadastro(customer, {
        currentStep: stepBefore,
        consultorEmail: consultorEmailForGuard,
      });
      if (resumeDecision) {
        console.log(
          `🛟 [resume-guard] customer=${customer.id} step="${stepBefore}" → "${resumeDecision.nextStep}" (${resumeDecision.reason})`,
        );
        try {
          await supabase
            .from("customers")
            .update({
              conversation_step: resumeDecision.nextStep,
              previous_conversation_step: stepBefore || null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", customer.id);
        } catch (e) {
          console.warn("[resume-guard] persist falhou:", (e as Error).message);
        }
        try {
          await supabase.from("bot_step_transitions").insert({
            customer_id: customer.id,
            consultant_id: instanceData.consultant_id,
            from_step: stepBefore || null,
            to_step: resumeDecision.nextStep,
            reason: resumeDecision.reason,
            intent: "resume_guard",
            phone,
          });
        } catch (_) { /* coluna pode não existir */ }
        (customer as any).conversation_step = resumeDecision.nextStep;
        (customer as any).previous_conversation_step = stepBefore || null;
        rawStep = resumeDecision.nextStep;
        stepBefore = resumeDecision.nextStep;
      }
    } catch (e: any) {
      console.warn("[resume-guard] erro não-bloqueante:", e?.message);
    }

    // ─── Roteador cadência B/C → Grupo A (sem vácuo) ───────────────────
    try {
      const { data: cadenceState } = await supabase
        .from("lead_cadence_state")
        .select("stage, paused_reason")
        .eq("customer_id", customer.id)
        .maybeSingle();
      const { applyCadenceInboundRoute } = await import(
        "../_shared/cadence-inbound-router.ts"
      );
      const cadenceRoute = await applyCadenceInboundRoute(supabase, {
        customer,
        customerId: customer.id,
        remoteJid,
        messageText,
        buttonId: buttonId ?? null,
        isButton,
        isFile,
        hasImage,
        hasDocument,
        cadencePausedReason: (cadenceState as { paused_reason?: string } | null)?.paused_reason ?? null,
        cadenceStage: (cadenceState as { stage?: string } | null)?.stage ?? null,
        sender,
      });
      if (cadenceRoute.routed) {
        rawStep = customer.conversation_step || null;
        stepBefore = stripPrefix(rawStep);
        (customer as any).conversation_step = stepBefore;
        if (!cadenceRoute.continueBotFlow) {
          try {
            await supabase.rpc("release_customer_processing_lock", { _customer_id: customer.id });
          } catch (_) { /* noop */ }
          return new Response(
            JSON.stringify({ ok: true, mode: "cadence_router", reason: cadenceRoute.reason }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      }
    } catch (e: any) {
      console.warn("[cadence-router] erro não-bloqueante:", e?.message);
    }

    // ─── 🔒 Lock de processamento (paridade Whapi) ─────────────────────
    // Serializa cascata de mídia + FAQ. Sem isso, inbound no meio do áudio/vídeo
    // se perde mesmo com abort de cascata. TTL 120s cobre sequência longa.
    let processingLockAcquired = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      const { data: ok } = await supabase.rpc("try_lock_customer_processing", {
        _customer_id: customer.id,
        _seconds: 120,
      });
      if (ok === true) { processingLockAcquired = true; break; }
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!processingLockAcquired) {
      try {
        await supabase.rpc("enqueue_pending_inbound", {
          _customer_id: customer.id,
          _message_id: messageId || `noid-${Date.now()}`,
        });
        console.warn(`📥 [evolution] customer=${customer.id} busy — enfileirado pending_inbound`);
      } catch (e) {
        console.error("[evolution] enqueue_pending_inbound falhou:", (e as Error)?.message);
      }
      return new Response(JSON.stringify({ ok: true, skipped: "busy_enqueued" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    try {
      const { data: fresh } = await supabase.from("customers").select("*").eq("id", customer.id).maybeSingle();
      if (fresh) customer = fresh;
    } catch (_) { /* mantém customer atual */ }

    let reply: string | null = "";
    let updates: Record<string, any> = {};
    let engineUsed: "sys" | "flow" = "sys";
    let runEngine: (() => Promise<any>) | null = null;

    // ─── 7.6) Engine v3 — hook compartilhado (Semana 1 do rollout v3) ──
    // Helper único em `_shared/flow-engine/webhook-hook.ts` evita drift
    // entre whapi-webhook (produção) e evolution-webhook (espelho).
    // Fail-open: erro no v3 nunca bloqueia o caminho legado.
    try {
      const { runEngineV3IfEnabled } = await import("../_shared/engine/webhook-hook.ts");
      await runEngineV3IfEnabled({
        supabase,
        customerId: customer.id,
        consultantId: instanceData.consultant_id,
        legacyStep: stepBefore,
        inboundKind: isButton ? "button_click" : (hasImage || hasDocument || hasAudio ? "media" : "text"),
        inboundText: messageText ?? null,
        inboundButtonId: buttonId ?? null,
        inboundMediaKind: hasAudio ? "audio" : hasImage ? "image" : hasDocument ? "document" : null,
        inboundMessageId: messageId ?? null,
      });
    } catch (e: any) {
      console.warn("[engine-v3-hook] erro não-bloqueante:", e?.message);
    }

    // ─── 7.7) Cérebro IA — hook de SOMBRA (Tarefa 9.2) ────────────────
    // Espelha o hook do engine v3 acima, no MESMO ponto e com os MESMOS dados
    // de inbound/consultor/cliente. Só roda em `flow_engine_v3='dark'`: observa
    // e registra a decisão do Cérebro SEM enviar nada ao cliente. Fail-open
    // total — qualquer erro é engolido e NUNCA afeta o caminho legado.
    try {
      const { executarCerebroSombra } = await import("../_shared/cerebro/sombra-hook.ts");
      await executarCerebroSombra({
        supabase,
        customerId: customer.id,
        consultantId: instanceData.consultant_id,
        legacyStep: stepBefore,
        inboundKind: isButton ? "button_click" : (hasImage || hasDocument || hasAudio ? "media" : "text"),
        inboundText: messageText ?? null,
        inboundButtonId: buttonId ?? null,
        inboundMediaKind: hasAudio ? "audio" : hasImage ? "image" : hasDocument ? "document" : null,
        inboundMessageId: messageId ?? null,
        channel: "evolution",
      });
    } catch (e: any) {
      console.warn("[cerebro-sombra-hook] erro não-bloqueante:", e?.message);
    }

    try {
      const customerOverride = (customer as any).conversational_flow_enabled;
      const consultantFlag = (consultantData as any)?.conversational_flow_enabled === true;

      const routed = routeEngineV2({
        currentStep: rawStep,
        conversationalFlowEnabled: consultantFlag,
        customerOverride: customerOverride === false ? false : null,
      });
      let engine = routed.engine;
      if (routed.step !== null && routed.step !== stripPrefix(rawStep ?? "")) {
        // routeEngineV2 forced a reset (e.g. flow→welcome when flag flipped off).
        (customer as any).conversation_step = routed.step;
      }

      // ─── Fluxo B bypass (engine legado) ──────────────────────────────
      // Variant B = Vendedora V2 (IA livre). NUNCA pode cair no engine
      // "conversational" scripted, mesmo com conversation_step=`flow:*`.
      // Força engine=sys → bot-flow.ts dispatcha runFluxoBAI no topo.
      const _fbVariantLegacy = String((customer as any)?.flow_variant || "").toUpperCase();
      const _fbStepLegacy = String((customer as any)?.conversation_step || "");
      const _fbStepRaw = stripPrefix(_fbStepLegacy);
      const _fbMediaSteps = new Set([
        "aguardando_conta","aguardando_documento","aguardando_humano",
        "aguardando_doc_auto","aguardando_doc_frente","aguardando_doc_verso",
        "aguardando_otp","validando_otp","portal_submitting",
        "cadastro_finalizando","finalizando","complete","cadastro_em_analise",
      ]);
      if (_fbVariantLegacy === "B" && !_fbMediaSteps.has(_fbStepRaw)) {
        if (_fbStepLegacy.startsWith("flow:") || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(_fbStepRaw) || _fbStepRaw.startsWith("passo_")) {
          (customer as any).conversation_step = null;
          try {
            await supabase.from("customers")
              .update({ conversation_step: null, updated_at: new Date().toISOString() })
              .eq("id", customer.id);
          } catch (_) { /* não bloqueia */ }
        }
        engine = "sys";
        console.log(`[fluxo-b-bypass] customer=${customer.id} step_in="${_fbStepLegacy}" → engine=sys (Vendedora V2)`);
      }

      // 🩹 AUTO-CURA DE STEP ÓRFÃO ENTRE VARIANTES (2026-05-25)
      // Bug recorrente: consultor publica nova variante depois que leads já
      // estavam em outra. Os leads ficam com `flow_variant='X'` mas
      // `conversation_step` apontando para UUID de outro fluxo. Como o motor
      // carrega só o fluxo da variant atual, o UUID nunca é resolvido e o lead
      // trava em silêncio. Solução: resetar para welcome (firstActive).
      const _stepRaw = stripPrefix((customer as any).conversation_step || "");
      const _looksLikeFlowStep = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(_stepRaw)
        || _stepRaw.startsWith("passo_");
      const _isCadastroStepGuard = CADASTRO_STEPS.has(_stepRaw);
      if (_looksLikeFlowStep && !_isCadastroStepGuard) {
        try {
          const variant = String((customer as any)?.flow_variant || "A").toUpperCase();
          const flowOwnerId = String((customer as any)?.consultant_id || instanceData.consultant_id || "");
          const { data: stepRow } = await supabase
            .from("bot_flow_steps")
            .select("id, flow_id, is_active")
            .eq("id", _stepRaw)
            .eq("is_active", true)
            .maybeSingle();
          let found = false;
          if (stepRow?.flow_id) {
            const { data: flowRow } = await supabase
              .from("bot_flows")
              .select("id, variant, consultant_id, is_active, is_public")
              .eq("id", stepRow.flow_id)
              .maybeSingle();
            const fv = String((flowRow as any)?.variant || "").toUpperCase();
            const active = !!(flowRow as any)?.is_active;
            const ownerOk =
              String((flowRow as any)?.consultant_id || "") === flowOwnerId ||
              !!(flowRow as any)?.is_public;
            found = active && fv === variant && ownerOk;
          }
          if (!found && flowOwnerId) {
            const { data: byKey } = await supabase
              .from("bot_flow_steps")
              .select("id, bot_flows!inner(variant, is_active, consultant_id)")
              .eq("step_key", _stepRaw)
              .eq("is_active", true)
              .eq("bot_flows.is_active", true)
              .eq("bot_flows.consultant_id", flowOwnerId)
              .eq("bot_flows.variant", variant)
              .limit(1);
            found = Array.isArray(byKey) && byKey.length > 0;
          }
          if (!found) {
            console.warn(
              `🩹 [step-mismatch-cure] customer=${customer.id} step="${_stepRaw}" ` +
              `variant=${variant} owner=${flowOwnerId.slice(0, 8)} → step não pertence ao fluxo. ` +
              `Resetando para welcome (lead será restartado pelo firstActive).`
            );
            try {
              await supabase.from("customers")
                .update({
                  conversation_step: "welcome",
                  previous_conversation_step: customer.conversation_step,
                  custom_step_retries: 0,
                  custom_step_retries_step: null,
                  last_custom_prompt_at: null,
                })
                .eq("id", customer.id);
              try {
                await supabase.from("bot_step_transitions").insert({
                  customer_id: customer.id,
                  consultant_id: flowOwnerId || instanceData.consultant_id,
                  from_step: _stepRaw,
                  to_step: "welcome",
                  reason: `step_variant_mismatch:${variant}`,
                  intent: "auto_cure",
                });
              } catch (_) { /* coluna reason pode não existir ainda */ }
              (customer as any).conversation_step = "welcome";
            } catch (e) {
              console.warn("[step-mismatch-cure] persist falhou:", (e as Error).message);
            }
          }
        } catch (e) {
          console.warn("[step-mismatch-cure] lookup falhou:", (e as Error).message);
        }
      }

      // 🚀 FONTE ÚNICA DE VERDADE: Fluxo da Camila (DB) controla TODO step
      // que não pertence ao pipeline de cadastro. Se houver fluxo ativo + steps,
      // força engine=flow mesmo que o step legacy esteja setado.
      const currentStepRaw = stripPrefix((customer as any).conversation_step || "");
      const isCadastroStep = CADASTRO_STEPS.has(currentStepRaw);

      // 🛟 BRIDGE UUID→sys (espelho do whapi-webhook): UUIDs de passos custom
      // com step_type ∈ {capture_conta, capture_documento, capture_doc,
      // capture_email, confirm_phone, finalizar_cadastro} têm que rodar no
      // engine `sys` (bot-flow.ts) porque só ele faz OCR/edição/Portal2/
      // finalize-capture. Sem este bridge, o conversational handler engole
      // a foto da conta e re-emite o prompt em loop. Custom-step-resolver
      // dentro de bot-flow.ts (linha ~2876) mapeia o UUID para o nominal.
      // 🔒 Flag: quando o bridge forçar sys por causa de um step CUSTOM de
      // captura, o bloco abaixo (engine==="sys" && !isCadastroStep) NÃO pode
      // reverter para "flow" nem zerar conversation_step.
      let bridgeForcedSysForCapture = false;
      try {
        if (engine === "flow" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(currentStepRaw)) {
          const { data: stepRow } = await supabase
            .from("bot_flow_steps")
            .select("step_type")
            .eq("id", currentStepRaw)
            .maybeSingle();
          const CAPTURE_TYPES = new Set([
            "capture_conta", "capture_documento", "capture_doc",
            "capture_email", "confirm_phone", "finalizar_cadastro",
          ]);
          if (stepRow && CAPTURE_TYPES.has(String((stepRow as any).step_type))) {
            console.log(`🛟 [router-bridge] UUID ${currentStepRaw} type=${(stepRow as any).step_type} → forçando engine=sys`);
            engine = "sys";
            bridgeForcedSysForCapture = true;
          }
        }
      } catch (e) {
        console.warn("[router-bridge] lookup step_type falhou:", (e as any)?.message);
      }

      if (engine === "sys" && !isCadastroStep && !bridgeForcedSysForCapture && consultantFlag && customerOverride !== false && _fbVariantLegacy !== "B") {
        try {
          // Usa resolveFlowId (próprio OU template público A) — consultor sem
          // bot_flows variant A (ex.: só D) ainda entra no funil Sofia igual ao Rafael.
          const variant = resolveCanonicalFlowVariant((customer as any)?.flow_variant);
          const flowOwnerId = String(
            (customer as any)?.consultant_id || instanceData.consultant_id || "",
          );
          const resolved = await resolveFlowId(supabase, flowOwnerId, variant);
          if (resolved?.id) {
            const { count } = await supabase
              .from("bot_flow_steps")
              .select("id", { count: "exact", head: true })
              .eq("flow_id", resolved.id)
              .eq("is_active", true);
            if ((count || 0) > 0) {
              engine = "flow";
              const keepFlowStep = !!originalFlowStep;
              if (!keepFlowStep) {
                (customer as any).conversation_step = null;
              }
              if (!(customer as any).flow_variant) {
                (customer as any).flow_variant = variant;
              }
              console.log(
                `🚀 [router] forçado para flow via resolveFlowId (consultor=${flowOwnerId}, flow=${resolved.id}, variant=${variant}, step legado="${stepBefore}", keepStep=${keepFlowStep})`,
              );
            } else {
              console.warn(
                `[router] flow ${resolved.id} (variant=${variant}) sem steps ativos — mantendo sys`,
              );
            }
          } else {
            console.warn(
              `[router] resolveFlowId vazio variant=${variant} consultor=${flowOwnerId} — mantendo sys`,
            );
          }
        } catch (e) {
          console.warn("[router] falha ao verificar flow ativo:", (e as any)?.message);
        }
      }
      engineUsed = engine;

      if (engine === "flow" && originalFlowStep) {
        const memStep = stripPrefix(String((customer as any).conversation_step || ""));
        if (!memStep || memStep === "welcome" || memStep === "menu_inicial") {
          console.log(
            `🔒 [router] restaurando step do fluxo "${originalFlowStep}" (mem="${memStep || "null"}")`,
          );
          (customer as any).conversation_step = originalFlowStep;
        }
      }

      // ─── Engine v3 gate (Task 29 — flow-engine-v3-rewrite) ──────────
      // When `consultants.use_engine_v3 = true`, the v3 engine takes
      // full ownership of this turn: load context, run the pure runner,
      // and dispatch outbounds via the channel adapter. The legacy
      // `runConversationalFlow` / `runBotFlow` path is bypassed entirely
      // for v3-enabled consultors.
      //
      // Default flag value is FALSE — zero leads route through v3 until
      // a consultor is explicitly opted in (Phase 1+ of rollout). On v3
      // errors, the helper pauses the customer + inserts a handoff
      // alert (NEVER falls through to legacy) per the safety contract.
      const { isEngineV3Enabled } = await import("../_shared/engine/router.ts");
      // ─── Fluxo B bypass ──────────────────────────────────────────────
      // Variant B = Vendedora V2 (IA livre). NUNCA entra no V3.
      const _fbVariantTop = String((customer as any)?.flow_variant || "").toUpperCase();
      if (_fbVariantTop !== "B" && await isEngineV3Enabled(supabase as any, instanceData.consultant_id)) {
        const { runUnifiedEngineWebhookEntry } = await import("../_shared/engine/webhook-entry.ts");
        const { getAdapter } = await import("../_shared/channels/index.ts");
        const v3Adapter = getAdapter({
          kind: "evolution",
          input: {
            apiUrl: EVOLUTION_API_URL,
            apiKey: EVOLUTION_API_KEY,
            instanceName,
            connectedPhone: instanceData.connected_phone,
          },
        });
        const v3Outcome = await runUnifiedEngineWebhookEntry({
          supabase: supabase as any,
          adapter: v3Adapter,
          customerId: customer.id,
          consultantId: instanceData.consultant_id,
          jid: remoteJid,
          inbound: {
            messageText,
            buttonId,
            isFile,
            isButton,
            hasImage,
            hasAudio,
            hasDocument,
            mediaKind,
            messageId,
          },
          testRunId: null,
          testTurn: null,
        });
        jsonLog(v3Outcome.ok ? "info" : "warn", "engine_v3_handled", {
          customer_id: customer.id,
          consultant_id: instanceData.consultant_id,
          ok: v3Outcome.ok,
          sent: v3Outcome.sent,
          failed: v3Outcome.failed,
          error: v3Outcome.error,
        });
        try { await supabase.rpc("release_customer_processing_lock", { _customer_id: customer.id }); } catch (_) {}
        return new Response(
          JSON.stringify({ ok: true, mode: "engine_v3", v3: v3Outcome }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // ─── Cérebro IA — RESPOSTA real (Tarefa 15.1) ────────────────────
      // Ponto: DEPOIS do gate do engine v3 (acima, que já deu early-return se
      // assumiu o turno) e IMEDIATAMENTE ANTES do dispatch da vendedora
      // (runConversationalFlow/runBotFlow). Assim o motor determinístico v3
      // mantém prioridade e o Cérebro só substitui o caminho CONVERSACIONAL
      // legado (Fluxo B / runFluxoBAI / runConversational).
      //
      // Só age em canary/on (gate em deveResponderComCerebro). Fail-open total:
      // qualquer erro → respondeu=false e a vendedora responde como hoje. O
      // envio usa o sender REAL do canal (anti-ban + trio de proteção intactos);
      // o Cérebro não reimplementa envio. OTP (interceptado no topo) e o
      // pipeline de OCR/portal (despachado pelo próprio Cérebro) seguem intactos.
      let _cerebroRespondeu = false;
      const _fbVarCerebro = String((customer as any)?.flow_variant || "").toUpperCase();
      const _midiaOcr = (hasImage || hasDocument) && !hasAudio;

      // 🛡️ Guarda de origem: clientes já cadastrados/sincronizados
      // (`igreen_sync` = carteira XLSX/worker; `igreen_extension` = extensão
      // Chrome do consultor) NUNCA entram no cadastro nem no Portal 2 — já
      // estão registrados. Vão direto pro Cérebro responder dúvidas,
      // independente do step legado.
      const _origin = String((customer as any).customer_origin || "").toLowerCase();
      const _isAtivoOrigin = _origin === "igreen_sync" || _origin === "igreen_extension";

      // 🛡️ Cadastro = CADASTRO_STEPS + UUID/passo do funil (Sofia / builder).
      // Sem UUID, Grupo A caía no Cérebro (paridade Whapi / Leandro 2026-07-28).
      // Boot welcome/null no Grupo A também é cadastro (anti "sua consultora").
      const _isGrupoABootStep =
        !stepBefore ||
        stepBefore === "welcome" ||
        stepBefore === "menu_inicial";
      const _emCadastro =
        CADASTRO_STEPS.has(stepBefore) ||
        bridgeForcedSysForCapture ||
        isActiveConversationalFunnelStep(stepBefore) ||
        (_fbVarCerebro === "A" && _isGrupoABootStep && !_isAtivoOrigin);

      // Classifica o input dentro do cadastro. Default = "expected" (vai ao
      // determinístico). Só vira "freeform_question" quando o lead claramente
      // perguntou outra coisa, fora do objetivo do step.
      const { classifyCadastroInput } = await import("../_shared/cadastro-input-classifier.ts");
      const _cadKind = (_emCadastro && !_isAtivoOrigin)
        ? classifyCadastroInput({
          stepBefore,
          text: messageText ?? null,
          isButton,
          hasImage,
          hasDocument,
          hasAudio,
        })
        : null;

      // Decide se o Cérebro deve correr este turno:
      //  - origem ativa (já cadastrado) → SEMPRE Cérebro
      //  - fora do cadastro → comportamento normal (Cérebro decide)
      //  - cadastro + freeform_question → Cérebro (sem mexer no estado)
      //  - cadastro + expected/mídia → determinístico (pula Cérebro)
      const _rodarCerebro = _isAtivoOrigin
        || (!_emCadastro && !(_fbVarCerebro === "D" || _fbVarCerebro === "M" || _fbVarCerebro === "C" || _fbVarCerebro === "E" || _fbVarCerebro === "F"))
        || (_emCadastro && _cadKind === "freeform_question" && _fbVarCerebro !== "A");

      // Um único call-site do Cérebro (paridade Whapi): principal + drain
      // da rajada reutilizam a mesma função com envio idempotente.
      const runConversacionalTurn = async (inb: {
        text: string | null;
        isButton: boolean;
        buttonId: string | null;
        hasImage: boolean;
        hasDocument: boolean;
        hasAudio: boolean;
        messageId: string | null;
      }): Promise<boolean> => {
        try {
          if (_isAtivoOrigin) {
            console.log(`[origin-guard] customer=${customer.id} origin=${_origin} → Cérebro (pula cadastro/portal)`);
          } else if (_emCadastro) {
            console.log(`[cerebro] freeform no cadastro step=${stepBefore} customer=${customer.id} → Cérebro readOnly`);
          }
          const { responderComCerebro } = await import("../_shared/cerebro/resposta-hook.ts");
          const enviarTexto = makeIdempotentEnviarTexto(
            (jid, text, opts) => sender.sendText(jid, text, opts as any),
            remoteJid,
            {
              supabase,
              customerId: customer.id,
              consultantId: instanceData.consultant_id,
              step: stepBefore || "",
            },
          );
          const inboundKind = inb.isButton
            ? "button_click"
            : (inb.hasImage || inb.hasDocument || inb.hasAudio ? "media" : "text");
          const inboundMediaKind = inb.hasAudio
            ? "audio"
            : inb.hasImage
            ? "image"
            : inb.hasDocument
            ? "document"
            : null;
          const r = await responderComCerebro({
            supabase,
            customerId: customer.id,
            consultantId: instanceData.consultant_id,
            inboundKind,
            inboundText: inb.text ?? null,
            inboundButtonId: inb.buttonId ?? null,
            inboundMediaKind,
            inboundMessageId: inb.messageId ?? null,
            channel: "evolution",
            telefone: phone ?? null,
            enviarTexto,
          });
          return r.respondeu;
        } catch (e: any) {
          console.warn("[cerebro-resposta-hook] erro não-bloqueante:", e?.message);
          return false;
        }
      };

      if (!_rodarCerebro) {
        if (_emCadastro) {
          console.log(`[cerebro] cadastro em andamento (midia=${_midiaOcr} step=${stepBefore} kind=${_cadKind ?? "media"}) → determinístico customer=${customer.id}`);
        } else if (_fbVarCerebro === "D" || _fbVarCerebro === "M" || _fbVarCerebro === "C" || _fbVarCerebro === "E" || _fbVarCerebro === "F") {
          console.log(`[fluxo-${_fbVarCerebro.toLowerCase()}-bypass] customer=${customer.id} — Cérebro pulado (fluxo do construtor)`);
        }
      } else if (_isAtivoOrigin) {
        // Cliente carteira → canal de novidades (paridade Whapi). Sem Grupo A.
        try {
          const { tryReplyClienteCanalNovidades } = await import(
            "../_shared/cliente-canal-novidades.ts"
          );
          const canal = await tryReplyClienteCanalNovidades({
            supabase,
            customer: customer as any,
            consultantId: String(
              (customer as any).assigned_consultant_id ||
                (customer as any).consultant_id ||
                instanceData.consultant_id ||
                "",
            ),
            sendText: async (text) => {
              try {
                return !!(await sender.sendText(remoteJid, text));
              } catch {
                return false;
              }
            },
          });
          if (canal.handled) {
            console.log(
              `[origin-guard] customer=${customer.id} origin=${_origin} → canal novidades (${canal.reason})`,
            );
            _cerebroRespondeu = true;
          } else {
            _cerebroRespondeu = await runConversacionalTurn({
              text: messageText ?? null,
              isButton,
              buttonId: buttonId ?? null,
              hasImage,
              hasDocument,
              hasAudio,
              messageId: messageId ?? null,
            });
          }
        } catch (e: any) {
          console.warn("[cliente-canal] falha, fallback Cérebro:", e?.message);
          _cerebroRespondeu = await runConversacionalTurn({
            text: messageText ?? null,
            isButton,
            buttonId: buttonId ?? null,
            hasImage,
            hasDocument,
            hasAudio,
            messageId: messageId ?? null,
          });
        }
      } else {
        _cerebroRespondeu = await runConversacionalTurn({
          text: messageText ?? null,
          isButton,
          buttonId: buttonId ?? null,
          hasImage,
          hasDocument,
          hasAudio,
          messageId: messageId ?? null,
        });
      }
      // GATE (Property 1 — um caminho conversacional só): quando o Cérebro é a
      // fonte de verdade do turno (canary/on), a vendedora legada NÃO responde o
      // mesmo turno — evita resposta dupla. Em off/dark, respondeu=false e segue
      // o caminho atual normalmente (comportamento idêntico ao de hoje).
      if (_cerebroRespondeu) {
        // O Cérebro também precisa consumir a rajada antes de liberar o lock;
        // sem isso o segundo inbound ficava permanentemente pendente.
        try {
          const { drainPendingInboundTurns } = await import("../_shared/bot/pending-inbound.ts");
          const drained = await drainPendingInboundTurns(supabase, customer.id, async (replay) => {
            const { data: fresh } = await supabase.from("customers").select("*").eq("id", customer.id).maybeSingle();
            if (fresh) customer = fresh;
            const replayIsMedia = replay.isFile && !replay.isButton;
            if (_isAtivoOrigin) {
              try {
                const { tryReplyClienteCanalNovidades } = await import(
                  "../_shared/cliente-canal-novidades.ts"
                );
                await tryReplyClienteCanalNovidades({
                  supabase,
                  customer: customer as any,
                  consultantId: String(
                    (customer as any).assigned_consultant_id ||
                      (customer as any).consultant_id ||
                      instanceData.consultant_id ||
                      "",
                  ),
                  sendText: async (text) => {
                    try {
                      return !!(await sender.sendText(remoteJid, text));
                    } catch {
                      return false;
                    }
                  },
                });
              } catch (_) { /* noop */ }
              return;
            }
            await runConversacionalTurn({
              text: replay.messageText || null,
              isButton: replay.isButton,
              buttonId: replay.buttonId,
              hasImage: replayIsMedia,
              hasDocument: false,
              hasAudio: false,
              messageId: replay.messageId,
            });
          });
          if (drained > 0) console.log(`[pending-drain/cerebro] ${drained} turn(s) customer=${customer.id}`);
        } catch (e) {
          console.warn("[pending-drain/cerebro] falhou:", (e as Error).message);
        }
        try { await supabase.rpc("release_customer_processing_lock", { _customer_id: customer.id }); } catch (_) {}
        return new Response(
          JSON.stringify({ ok: true, mode: "cerebro" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // 🛡️ Defesa adicional: origem ativa que por algum motivo o Cérebro não
      // respondeu (off/dark/erro). Não deve cair no cadastro determinístico —
      // só loga e responde 200 sem disparar Portal 2.
      if (_isAtivoOrigin) {
        console.log(`[origin-guard] customer=${customer.id} origin=${_origin} — Cérebro silencioso; pulando cadastro determinístico`);
        try { await supabase.rpc("release_customer_processing_lock", { _customer_id: customer.id }); } catch (_) {}
        return new Response(
          JSON.stringify({ ok: true, mode: "origin_guard_skip" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      runEngine = async () => engine === "flow"
        ? await runConversationalFlow({
            supabase, sender, customer, consultorId, nomeRepresentante, nomeAssistente, consultorGender,
            remoteJid, phone, messageText, buttonId, isFile, isButton,
            hasImage, hasDocument, hasAudio, imageMessage, documentMessage, message, key, messageId,
            instanceName,
            fileUrl, fileBase64, geminiApiKey: GEMINI_API_KEY,
          })
        : await runBotFlow({
            supabase, sender, customer, consultorId, nomeRepresentante, nomeAssistente, consultorGender,
            remoteJid, phone, messageText, buttonId, isFile, isButton,
            hasImage, hasDocument, hasAudio, imageMessage, documentMessage, message, key, messageId,
            instanceName,
            fileUrl, fileBase64, geminiApiKey: GEMINI_API_KEY,
          });
      const result = await runEngine();
      reply = result.reply;
      updates = result.updates;
    } catch (botErr: any) {
      console.error(`💥 [bot-flow crash] step=${stepBefore} customer=${customer.id}:`, botErr);
      captureError(botErr, {
        tags: { function: "evolution-webhook", kind: "bot_flow_crash" },
        extra: { customer_id: customer.id, step: stepBefore },
      });
      reply = "🤖 Tive um probleminha técnico ao processar sua mensagem. Pode me enviar novamente? Se continuar, me responda *MENU* para recomeçarmos juntos. 🙏";
      updates = {};
      try {
        await supabase
          .from("customers")
          .update({
            error_message: `bot_crash@${stepBefore}: ${String(botErr?.message || botErr).substring(0, 250)}`,
            last_bot_reply_at: new Date().toISOString(),
          })
          .eq("id", customer.id);
      } catch (_) { /* não bloquear o reply ao cliente */ }
    }

    // Normaliza conversation_step de saída — flow ganha prefixo, sys vai cru.
    if (updates.conversation_step) {
      const prefixed = normalizeOutgoing(String(updates.conversation_step), engineUsed);
      if (prefixed) updates.conversation_step = prefixed;
    }

    // ─── 9) Persist updates ────────────────────────────────────────────
    // Marca timestamp da última atividade do bot — usado pelo cron de leads parados
    if (Object.keys(updates).length > 0 || reply) {
      (updates as any).last_bot_reply_at = new Date().toISOString();
    }
    // ── GARANTIA ANTI-TRAVA ──
    // Se o cliente está respondendo e o bot está progredindo (há reply OU updates de step/dado),
    // qualquer status "parado" (abandoned/stuck_*/email_pendente_revisao/contato_incompleto)
    // DEVE ser zerado para "pending". Senão o lead fica visualmente travado mesmo avançando no fluxo.
    const STUCK_STATES = new Set([
      "abandoned",
      "stuck_finalizar",
      "stuck_contact",
      "email_pendente_revisao",
      "contato_incompleto",
      "automation_failed",
    ]);
    if (
      (Object.keys(updates).length > 0 || reply) &&
      customer?.status &&
      STUCK_STATES.has(customer.status) &&
      !(updates as any).status
    ) {
      (updates as any).status = "pending";
      (updates as any).error_message = null;
      (updates as any).rescue_attempts = 0;
      console.log(`♻️ [auto-resume] ${customer.id}: status "${customer.status}" → "pending" (cliente respondeu, bot avançando)`);
    }
    // Strip TODAS as chaves internas "__*" antes do update — previne erros de coluna inexistente.
    const __inline_sent_flag = (updates as any).__inline_sent === true;
    for (const k of Object.keys(updates)) {
      if (k.startsWith("__")) delete (updates as any)[k];
    }
    if (Object.keys(updates).length > 0) {
      console.log(`📝 Salvando updates para ${customer.id}:`, JSON.stringify(updates).substring(0, 500));
      const { error: updateError } = await supabase.from("customers").update(updates).eq("id", customer.id).select();
      if (updateError) {
        console.error(`❌ ERRO ao salvar updates para ${customer.id}:`, updateError);
        captureError(updateError as any, {
          tags: { function: "evolution-webhook", kind: "customer_update_failed" },
          extra: { customer_id: customer.id, updates_keys: Object.keys(updates) },
        });
      }
      if (updates.conversation_step && stripPrefix(updates.conversation_step) !== stepBefore) {
        await logStepTransition(supabase, {
          customer_id: customer.id,
          consultant_id: instanceData.consultant_id,
          phone,
          from_step: stepBefore,
          to_step: stripPrefix(updates.conversation_step),
        });
      }
      // Avança o estágio do deal no Kanban conforme o lead progride na conversa.
      if (updates.conversation_step) {
        await syncCustomerStage(supabase, {
          customerId: customer.id,
          stepKeyAfter: updates.conversation_step,
          consultantId: instanceData.consultant_id,
        });
      }
    }

    // 📥 Reprocessa a rajada que chegou enquanto este turno segurava o lock.
    // O estado é buscado de novo a cada replay para manter a mesma serialização
    // do Whapi; replies normais só saem depois que toda a fila foi persistida.
    const primaryStepBefore = stepBefore;
    try {
      const { drainPendingInboundTurns } = await import("../_shared/bot/pending-inbound.ts");
      const drained = await drainPendingInboundTurns(supabase, customer.id, async (replay) => {
        const { data: fresh } = await supabase.from("customers").select("*").eq("id", customer.id).maybeSingle();
        if (fresh) customer = fresh;

        messageText = replay.messageText || "";
        messageId = replay.messageId || "";
        isFile = replay.isFile;
        isButton = replay.isButton;
        buttonId = replay.buttonId;
        // pending_inbound distingue mídia genérica; para o motor legado ela é
        // tratada como imagem, o caso seguro de captura/OCR.
        hasImage = replay.isFile && !replay.isButton;
        hasDocument = false;
        hasAudio = false;
        rawStep = (customer as any).conversation_step || null;
        const replayStepBefore = stripPrefix(rawStep);
        stepBefore = replayStepBefore;
        (customer as any).conversation_step = replayStepBefore;

        console.log(`[pending-drain/evolution] replay customer=${customer.id} text="${String(messageText).slice(0, 80)}"`);
        if (!runEngine) throw new Error("pending replay sem engine selecionado");
        const replayResult = await runEngine();
        const replayUpdates = { ...replayResult.updates };
        if (replayUpdates.conversation_step) {
          const prefixed = normalizeOutgoing(String(replayUpdates.conversation_step), engineUsed);
          if (prefixed) replayUpdates.conversation_step = prefixed;
        }
        if (Object.keys(replayUpdates).length > 0 || replayResult.reply) {
          (replayUpdates as any).last_bot_reply_at = new Date().toISOString();
        }
        for (const key of Object.keys(replayUpdates)) {
          if (key.startsWith("__")) delete (replayUpdates as any)[key];
        }
        if (Object.keys(replayUpdates).length > 0) {
          const { error } = await supabase.from("customers").update(replayUpdates).eq("id", customer.id);
          if (error) throw error;
          Object.assign(customer, replayUpdates);
        }
      });
      if (drained > 0) console.log(`[pending-drain/evolution] ${drained} turn(s) customer=${customer.id}`);
    } catch (e) {
      console.warn("[pending-drain/evolution] falhou:", (e as Error).message);
    } finally {
      // A resposta externa deste turno ainda pertence ao step que a originou;
      // os replays já deixaram seu novo estado persistido no customer.
      stepBefore = primaryStepBefore;
    }

    // 🔓 Libera lock de processamento (pending já drenado) — paridade Whapi.
    try {
      await supabase.rpc("release_customer_processing_lock", { _customer_id: customer.id });
    } catch (_) { /* noop */ }

    jsonLog("info", "handler_done", {
      customer_id: customer.id,
      consultant_id: instanceData.consultant_id,
      engine: engineUsed,
      step_before: stepBefore,
      step_after: updates.conversation_step ? stripPrefix(updates.conversation_step) : stepBefore,
      has_reply: !!reply,
      v2_flag: v2Flag,
    });

    // Release the customer lock *before* the outbound HTTP call. Evolution
    // sends are slow (typing presence + retry backoff) and the lock only
    // protects the read/write of customer state; sendWithRetry has its own
    // idempotency via outbound_message_log (Task 8). Holding the lock here
    // would only force concurrent webhooks for the same customer to wait
    // for an HTTP round-trip with no correctness benefit.
    if (lockToken && lockCustomerId) {
      try {
        await supabase.rpc("release_customer_lock", {
          p_customer: lockCustomerId,
          p_token: lockToken,
        });
        jsonLog("debug", "customer_lock_released", {
          customer_id: lockCustomerId, stage: "before_outbound",
        });
      } catch (releaseErr) {
        jsonLog("warn", "customer_lock_release_failed", {
          customer_id: lockCustomerId,
          stage: "before_outbound",
          message: releaseErr instanceof Error ? releaseErr.message : String(releaseErr),
        });
      } finally {
        lockToken = null;
        lockCustomerId = null;
      }
    }

    // ─── 10) Send reply ────────────────────────────────────────────────
    const stepToSend = updates.conversation_step || stepBefore;

    // Single contract: if the handler explicitly marked __inline_sent, the
    // outbound has already been emitted by the handler (sendStepMedia /
    // direct sender.sendText). Skip ALL further send logic to prevent
    // double-sends. This handles the case where handler returns reply !== ""
    // AND __inline_sent === true simultaneously (which can happen when a
    // step has inline media + a textual fallback that was already emitted).
    //
    // Task 10 of whatsapp-flow-reliability-fix (bugfix.md 2.9 / 3.26):
    // before this change the block had two parallel branches —
    // `handlerSentInline` (only triggered when reply === "") and the
    // anti-dup + send path (triggered when reply !== ""). A handler that
    // emitted media inline AND returned a non-empty reply (e.g. the
    // restart-cascade landing in conversational/index.ts:875, the QA hit
    // at :1006, or the auto-cascade at :1517) ended up double-emitting
    // because __inline_sent was only honored on the empty-reply branch.
    // The new contract is universal: __inline_sent === true means the
    // handler took full responsibility for this turn's outbound, period.
    // 🛡️ Contador determinístico do sender-guard: incrementado em cada
    // sendText/sendMedia/sendButtons/sendAudio bem-sucedido neste turno.
    // Substitui a heurística antiga baseada em consulta racy a `conversations`
    // e na flag manual __inline_sent (que ~50 call sites esqueciam de marcar).
    const senderOutboundCount = Number((sender as any).__turnOutbound || 0);

    if (__inline_sent_flag) {
      // Confia em __inline_sent se o contador (ou fallback DB) confirmar
      // outbound real recente — caso contrário, é violação de contrato e
      // continua pro fallback para garantir que o cliente receba algo.
      let realOutboundExists = senderOutboundCount > 0;
      if (!realOutboundExists) {
        try {
          const sinceIso = new Date(Date.now() - 30_000).toISOString();
          const { data: realRow } = await supabase
            .from("conversations")
            .select("id")
            .eq("customer_id", customer.id)
            .eq("message_direction", "outbound")
            .gte("created_at", sinceIso)
            .not("message_text", "like", "[inline-sent]%")
            .not("message_text", "like", "[failed:%")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          realOutboundExists = !!realRow;
        } catch (_) { /* fail-open para o fallback abaixo */ }
      }

      if (realOutboundExists) {
        jsonLog("info", "inline_sent_skipped", {
          customer_id: customer.id,
          consultant_id: instanceData.consultant_id,
          step: stepToSend ? stripPrefix(String(stepToSend)) : undefined,
          reply_was_set: reply !== "",
          v2_flag: v2Flag,
          sender_outbound_count: senderOutboundCount,
        });
        return new Response(JSON.stringify({ ok: true, mode: "inline_sent" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      jsonLog("warn", "inline_sent_contract_violation", {
        customer_id: customer.id,
        consultant_id: instanceData.consultant_id,
        step: stepToSend ? stripPrefix(String(stepToSend)) : undefined,
        reply_was_set: reply !== "",
        v2_flag: v2Flag,
        sender_outbound_count: senderOutboundCount,
        note: "handler set __inline_sent=true but no real outbound found",
      });
    }


    // GARANTIA: nunca deixar o cliente sem resposta. Detecção em 3 camadas:
    //  1) Contador in-memory do sender-guard (determinístico, sem race).
    //  2) Flag manual __inline_sent (retrocompat).
    //  3) Fallback DB em conversations (race-prone, último recurso).
    let realOutboundExistsFinal = senderOutboundCount > 0;
    if (!realOutboundExistsFinal && !reply) {
      try {
        const sinceIso = new Date(Date.now() - 30_000).toISOString();
        const { data: realRow } = await supabase
          .from("conversations")
          .select("id")
          .eq("customer_id", customer.id)
          .eq("message_direction", "outbound")
          .gte("created_at", sinceIso)
          .not("message_text", "like", "[inline-sent]%")
          .not("message_text", "like", "[failed:%")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        realOutboundExistsFinal = !!realRow;
      } catch (_) { /* fail-open para enviar fallback */ }
    }
    const handlerSentInline = !reply && realOutboundExistsFinal;
    let finalReply = reply;
    if (!finalReply && !handlerSentInline) {
      // 🛟 Camada 2: nunca pausa o bot. Re-prompt humano e segue.
      // Estratégia: re-emite a ÚLTIMA pergunta real do bot (preserva contexto
      // de venda) em vez de "oii" genérico. Se não houver histórico, cai em
      // template de step / reforço de menu.
      console.warn(`⚠️ [empty-reply-safety] step="${stepToSend}" customer=${customer.id} → re-prompting`);
      captureError(new Error(`Bot empty reply at step ${stepToSend}`), {
        tags: { function: "evolution-webhook", kind: "empty_reply_safety" },
        extra: { customer_id: customer.id, step: stepToSend, sender_outbound_count: senderOutboundCount },
      });

      const firstName = safeFirstNameForAddress(
        (customer as any).name,
        (customer as any).name_source,
      );
      const SAFETY_MARKER = "[__safety_ping__]";

      // 🔁 Camada 3: anti-loop. Conta sentinels já gravados no MESMO step
      // nos últimos 5 min. ≥2 → esta é a 3ª → pausa com aviso humano.
      let loopCount = 0;
      try {
        const sinceIso = new Date(Date.now() - 5 * 60_000).toISOString();
        const { count } = await supabase
          .from("conversations")
          .select("id", { count: "exact", head: true })
          .eq("customer_id", customer.id)
          .eq("conversation_step", String(stepToSend ?? ""))
          .eq("message_text", SAFETY_MARKER)
          .gte("created_at", sinceIso);
        loopCount = count ?? 0;
      } catch (_) { /* fail-open: assume sem loop */ }

      // Grava sentinel (best-effort) pra próxima iteração contar.
      try {
        await supabase.from("conversations").insert({
          customer_id: customer.id,
          message_direction: "outbound",
          message_type: "system",
          message_text: SAFETY_MARKER,
          conversation_step: stepToSend ? String(stepToSend) : null,
        });
      } catch (_) { /* noop */ }

      if (loopCount >= 2) {
        console.error(`🛑 [anti-loop] customer=${customer.id} step="${stepToSend}" empty-reply ${loopCount + 1}x em 5min → pausando bot`);
        try {
          await supabase.from("customers").update({
            bot_paused: true,
            bot_paused_reason: "anti_loop_empty_reply",
            bot_paused_at: new Date().toISOString(),
          }).eq("id", customer.id);
        } catch (_) { /* noop */ }
        // Aviso humano visível (sem silêncio): venda não pode sumir.
        finalReply = (firstName ? `${firstName}, ` : "") +
          "vou chamar um consultor humano agora mesmo pra continuar com você 🤝";
      } else {
        // ── Re-prompt inteligente ──────────────────────────────────────
        let repromptText: string | null = null;

        // 1) Última pergunta REAL do bot nos últimos 30 min (ignora sentinels,
        //    inline markers, failed markers). Re-emite com prefixo humano.
        try {
          const sinceIso = new Date(Date.now() - 30 * 60_000).toISOString();
          const { data: lastReal } = await supabase
            .from("conversations")
            .select("message_text")
            .eq("customer_id", customer.id)
            .eq("message_direction", "outbound")
            .neq("message_type", "system")
            .not("message_text", "is", null)
            .not("message_text", "like", "[inline-sent]%")
            .not("message_text", "like", "[failed:%")
            .not("message_text", "like", "[__safety_ping__]%")
            .gte("created_at", sinceIso)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          const lastText = lastReal?.message_text?.trim();
          // Guarda: ignora variáveis {{...}} não resolvidas remanescentes
          if (lastText && lastText.length >= 8 && !/\{\{\s*\w+\s*\}\}/.test(lastText)) {
            const greet = firstName ? `${firstName}, ` : "";
            repromptText = `${greet}voltando aqui 👇\n\n${lastText}`;
          }
        } catch (_) { /* sem histórico, segue para fallback */ }

        // 2) Sem histórico utilizável → tenta template do step (`reprompt`),
        //    depois reforço genérico de venda.
        if (!repromptText) {
          try {
            const { getTemplate } = await import("./handlers/conversational/templates.ts");
            const stepKey = String(stepToSend ?? "menu_inicial");
            const vars = {
              nome: (customer as any).name,
              representante: nomeRepresentante,
              valor_conta: (customer as any).electricity_bill_value,
            };
            let t = await getTemplate(supabase, stepKey, "reprompt", vars);
            if (!t || !t.trim()) {
              t = await getTemplate(supabase, "menu_inicial", "reforco", vars);
            }
            if (t && t.trim()) repromptText = t.trim();
          } catch (_) { /* segue para fallback hardcoded */ }
        }

        // 3) Último recurso — ainda contextual de venda, não "oii".
        if (!repromptText) {
          repromptText = (firstName ? `${firstName}, ` : "") +
            "posso te ajudar a continuar? 🤝";
        }

        finalReply = repromptText;
      }
    }


    let isDuplicate = false;
    if (finalReply) {
      try {
        const { scrubLegacyWelcomeRoleLeak } = await import("../_shared/protocol.ts");
        finalReply = scrubLegacyWelcomeRoleLeak(finalReply);
      } catch (_) { /* best-effort */ }
    }
    if (finalReply && finalReply.trim()) {
      // 🛡️ Anti-duplicação universal: mesmo texto enviado nos últimos 60s → skip.
      //
      // Task 9 of whatsapp-flow-reliability-fix: the legacy comparison is an
      // exact-string match against the most recent outbound row, so two
      // replies that differ only in whitespace / case / leading-trailing
      // whitespace would BOTH be sent. The v2 path probes
      // `conversations.message_text_hash` (a GENERATED STORED column on
      // the same normalization the JS-side `computeMessageTextHash`
      // uses — see migration §4.10 and supabase/functions/_shared/text-hash.ts)
      // for any outbound row in the last 60 s with the same `(customer_id,
      // conversation_step)` and the same hash.
      //
      // Rollout (design.md §8):
      //   - 'off'                 : legacy exact-text comparison (unchanged).
      //   - 'dark'                : both paths run; disagreements are logged
      //                             via `evolution_dedup_short_circuit` so we
      //                             can validate the new path before flipping.
      //                             The legacy result still drives the skip.
      //   - 'canary' / 'on'       : the v2 hash result drives the skip.
      try {
        const sinceIso = new Date(Date.now() - 60_000).toISOString();
        const stepKey = stepToSend ? stripPrefix(String(stepToSend)) : null;

        // Legacy probe — keep running on every flag value so the 'dark'
        // mode can compare them and so 'off' stays byte-identical.
        let legacyDup = false;
        try {
          const { data: lastOut } = await supabase
            .from("conversations")
            .select("message_text, created_at")
            .eq("customer_id", customer.id)
            .eq("message_direction", "outbound")
            .gte("created_at", sinceIso)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (lastOut && String((lastOut as any).message_text || "").trim() === String(finalReply).trim()) {
            const ageMs = Date.now() - new Date((lastOut as any).created_at).getTime();
            console.warn(`🛡️ [anti-dup] skip — mesma msg enviada há ${Math.round(ageMs/1000)}s para customer=${customer.id}`);
            legacyDup = true;
          }
        } catch (_) { /* best-effort */ }

        let v2Dup: boolean | null = null;
        if (isV2Enabled(v2Flag)) {
          try {
            const hash = await computeMessageTextHash(finalReply);
            // Match the conversation_step the row will be saved with: the
            // outer code stores `updates.conversation_step || stepBefore`,
            // which can be prefixed ("flow:foo") or stripped. We probe
            // both forms via OR so the new path doesn't miss a recent
            // outbound stored under the alternate prefix.
            const variants = stepKey
              ? Array.from(new Set([stepKey, `flow:${stepKey}`]))
              : [];
            let q = supabase
              .from("conversations")
              .select("created_at, conversation_step")
              .eq("customer_id", customer.id)
              .eq("message_direction", "outbound")
              .eq("message_text_hash", hash)
              .gte("created_at", sinceIso);
            if (variants.length > 0) {
              q = q.in("conversation_step", variants);
            }
            const { data: hashHit, error: hashErr } = await q
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            if (hashErr) {
              jsonLog("warn", "evolution_dedup_hash_query_failed", {
                customer_id: customer.id,
                v2_flag: v2Flag,
                error: hashErr.message,
              });
              v2Dup = null; // unknown — fall back to legacy decision
            } else {
              v2Dup = !!hashHit;
              if (v2Dup) {
                const ageMs = hashHit
                  ? Date.now() - new Date((hashHit as any).created_at).getTime()
                  : 0;
                jsonLog("info", "evolution_dedup_short_circuit", {
                  customer_id: customer.id,
                  v2_flag: v2Flag,
                  step: stepKey ?? undefined,
                  age_ms: Math.round(ageMs),
                });
              }
            }
          } catch (e) {
            jsonLog("warn", "evolution_dedup_hash_exception", {
              customer_id: customer.id,
              v2_flag: v2Flag,
              message: e instanceof Error ? e.message : String(e),
            });
            v2Dup = null;
          }
        }

        // Decide which result drives the skip per the rollout flag.
        if (isV2Active(v2Flag) && v2Dup !== null) {
          isDuplicate = v2Dup;
        } else {
          isDuplicate = legacyDup;
        }

        // Dark-mode disagreement log so we can validate the v2 path
        // before flipping `flow_reliability_v2='on'`.
        if (isV2Dark(v2Flag) && v2Dup !== null && v2Dup !== legacyDup) {
          jsonLog("info", "evolution_dedup_disagreement", {
            customer_id: customer.id,
            v2_flag: v2Flag,
            step: stepKey ?? undefined,
            legacy_dup: legacyDup,
            v2_dup: v2Dup,
          });
        }
      } catch (_) { /* best-effort: never block sending on a dedup error */ }
    }

    // Resultado real do envio: ok=Evolution aceitou, pending=PENDING (não
    // confirmado pelo WhatsApp), messageId=ID externo, error=falha real.
    let sendResult: { ok: boolean; pending: boolean; messageId: string | null; error?: string } = {
      ok: false,
      pending: false,
      messageId: null,
      error: !finalReply ? "no_reply" : (isDuplicate ? "duplicate_skipped" : undefined),
    };

    if (finalReply && !isDuplicate) {
      try {
        // 🚀 2026-06-05: humanDelayMs fixo em 800ms (era 3.5-14s proporcional).
        // Antes o "digitando…" segurava a resposta por até 14s antes do sendText,
        // somando ~7-52s entre clique do botão e msg chegar. Agora mostra
        // "composing" 1x curto só para não parecer instantâneo. Whapi não muda.
        const humanDelayMs = 800;
        try { await (sender as any).sendPresence?.(remoteJid, "composing", humanDelayMs); } catch (_) { /* noop */ }
        await new Promise((r) => setTimeout(r, humanDelayMs));
        let idemKey = "";
        let payloadHash = "";
        try {
          idemKey = await computeIdempotencyKey({
            customerId: customer.id,
            step: stepToSend || "",
            content: finalReply,
          });
          payloadHash = await computeIdempotencyKey({
            customerId: customer.id,
            step: "payload",
            content: finalReply,
            minuteBucket: 0,
          });
        } catch (_) { /* fail-open: send without idempotency */ }
        sendResult = await (sender as any).sendTextDetailed(remoteJid, finalReply, {
          idempotencyKey: idemKey,
          customerId: customer.id,
          consultantId: instanceData.consultant_id,
          payloadHash,
          supabase,
        });
      } catch (e: any) {
        console.error("Erro enviar:", e);
        sendResult = { ok: false, pending: false, messageId: null, error: e?.message || "exception" };
      }
    }

    // ─── 11) Log outbound com status de entrega real ───────────────────
    // Mapeia o resultado para um delivery_status auditável:
    //   - "sent"   → Evolution confirmou (não-PENDING)
    //   - "queued" → Evolution aceitou mas WhatsApp não confirmou (PENDING)
    //   - "failed" → erro real ou exceção
    // Mensagens duplicadas/sem reply não são gravadas como novo outbound.
    let deliveryStatus: "sent" | "queued" | "failed" | null = null;
    if (finalReply && !isDuplicate) {
      if (sendResult.ok && !sendResult.pending) deliveryStatus = "sent";
      else if (sendResult.ok && sendResult.pending) deliveryStatus = "queued";
      else deliveryStatus = "failed";
    }

    if (!isDuplicate && finalReply) {
      await supabase.from("conversations").insert({
        customer_id: customer.id,
        message_direction: "outbound",
        message_text: finalReply,
        message_type: deliveryStatus === "failed" ? "text_failed" : "text",
        conversation_step: updates.conversation_step || stepBefore,
        external_message_id: sendResult.messageId,
        delivery_status: deliveryStatus,
        delivery_checked_at: new Date().toISOString(),
        delivery_error: deliveryStatus === "failed" ? (sendResult.error || "send_failed") : null,
      });
    }

    jsonLog("info", "outbound_done", {
      customer_id: customer.id,
      consultant_id: instanceData.consultant_id,
      step: updates.conversation_step ? stripPrefix(updates.conversation_step) : stepBefore,
      sent: deliveryStatus === "sent",
      queued: deliveryStatus === "queued",
      failed: deliveryStatus === "failed",
      duplicate: isDuplicate,
      external_message_id: sendResult.messageId,
      v2_flag: v2Flag,
    });

    // Verificação pós-envio assíncrona: se ficou "queued" (PENDING), tenta
    // confirmar no histórico da Evolution após 6s. Best-effort; o ACK real
    // virá pelos eventos MESSAGES_UPDATE quando habilitados na instância.
    if (deliveryStatus === "queued" && sendResult.messageId) {
      const mid = sendResult.messageId;
      const cid = customer.id;
      const inst = instanceName;
      try {
        EdgeRuntime.waitUntil((async () => {
          try {
            await new Promise(r => setTimeout(r, 6000));
            // Use findStatusMessage (real ACK endpoint), not findMessages (history).
            // findMessages was promoting messages to "sent" just because they
            // existed in history — even when WhatsApp returned ERROR.
            const res = await fetch(`${EVOLUTION_API_URL.replace(/\/$/,"")}/chat/findStatusMessage/${inst}`, {
              method: "POST",
              headers: { "Content-Type": "application/json", apikey: EVOLUTION_API_KEY },
              body: JSON.stringify({ where: { keyId: mid } }),
            });
            if (!res.ok) return;
            const data = await res.json();
            const records = Array.isArray(data) ? data : (data?.records || data?.messages?.records || []);
            const found = records.find((m: any) => m?.keyId === mid || m?.key?.id === mid || m?.id === mid);
            if (!found) return;
            const mapped = mapEvolutionDeliveryStatus(found.status ?? found.messageStatus ?? found.update?.status);
            // Only act on a definitive ack. queued/null → stay queued.
            if (!mapped.status || mapped.status === "queued") return;
            await supabase.from("conversations")
              .update({
                delivery_status: mapped.status,
                delivery_checked_at: new Date().toISOString(),
                delivery_error: mapped.status === "failed" ? (mapped.error || "Evolution delivery failed") : null,
              })
              .eq("customer_id", cid)
              .eq("external_message_id", mid);
            await supabase.from("outbound_message_log")
              .update({ result_status: mapped.status === "failed" ? "failed" : "sent" })
              .eq("evolution_message_id", mid);
            if (mapped.status === "failed") {
              await recordRiskSignal(supabase, inst, "send_failure", "medium", {
                source: "post_send_verification",
                message_id: mid,
              });
            }
          } catch (_) { /* best-effort */ }
        })());
      } catch (_) { /* EdgeRuntime indisponível em dev local */ }
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Evolution webhook error:", err);
    captureError(err, { tags: { function: "evolution-webhook" } });
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } finally {
    // Best-effort lock release. Reaching here without a token is normal
    // (legacy path, customer not yet known, lock not acquired). The RPC
    // requires the token to match, so a stale token is a no-op.
    if (lockSupabaseRef && lockCustomerId && lockToken) {
      try {
        await lockSupabaseRef.rpc("release_customer_lock", {
          p_customer: lockCustomerId,
          p_token: lockToken,
        });
      } catch (releaseErr) {
        jsonLog("warn", "customer_lock_release_failed", {
          customer_id: lockCustomerId,
          message: releaseErr instanceof Error ? releaseErr.message : String(releaseErr),
        });
      }
    }
  }
});


