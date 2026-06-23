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
import { computeIdempotencyKey } from "../_shared/idempotency.ts";
import { computeMessageTextHash } from "../_shared/text-hash.ts";
import { checkAndMarkProcessed, logStepTransition, jsonLog } from "../_shared/audit.ts";
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
import { routeEngine as routeEngineV2 } from "../_shared/flow-router.ts";
import { captureError } from "../_shared/sentry.ts";
import { notifyNewLead, notifyPartnerNewLead } from "../_shared/notify-consultant.ts";
import { syncCustomerStage } from "../_shared/conversion/crm-sync.ts";
import { isConsultantAIDisabled } from "../_shared/bot/paused.ts";
import { isBotGloballyEnabled } from "../_shared/bot/global-flag.ts";
import { matchKeyword, type PartnerKeywords } from "../_shared/keyword-matcher.ts";
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

type DeliveryStatus = "queued" | "sent" | "delivered" | "read" | "failed";

function mapEvolutionDeliveryStatus(raw: unknown): { status: DeliveryStatus | null; error?: string } {
  const stNum = Number(raw);
  if (Number.isFinite(stNum)) {
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
  if (s === "READ" || s === "PLAYED") return { status: "read" };
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

  // Validação de origem (fail-open): só bloqueia se EVOLUTION_WEBHOOK_SECRET
  // estiver configurado. Sem a env, mantém o comportamento atual.
  const originAuth = verifyWebhookOrigin(req, "EVOLUTION_WEBHOOK_SECRET");
  if (!originAuth.ok) {
    console.warn("[evolution-webhook] origem rejeitada:", originAuth.reason);
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
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
        const rank: Record<string, number> = { failed: 0, queued: 1, sent: 2, delivered: 3, read: 4 };

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
                result_status: mapped.status === "failed" ? "failed" : mapped.status === "queued" ? "queued" : "sent",
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

    // Kill switch global (Fase 0 auditoria). Fail-open: erros = habilitado.
    // Status/ACK e conexão são processados antes do kill switch para não perder
    // confirmações/falhas reais de entrega quando a IA estiver silenciada.
    if (!(await isBotGloballyEnabled(supabase as any))) {
      console.log("[evolution-webhook] bot_global_enabled=false → silenciado");
      return new Response(JSON.stringify({ ok: true, msg: "bot_globally_disabled" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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
      .select("id, name, igreen_id, conversational_flow_enabled")
      .eq("id", instanceData.consultant_id)
      .single();

    console.log(`✅ Instance found: ${instanceName} (consultant: ${consultantData?.name || "unknown"})`);
    const _fullName = consultantData?.name || "iGreen Energy";
    const nomeRepresentante = _fullName.trim().split(/\s+/)[0] || "iGreen Energy";
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
    const sender = wrapSenderWithGuard(rawSender, { supabase, instanceName });

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

    // ─── 🛑 IA GLOBALMENTE DESLIGADA — silêncio total (antes de tudo) ──
    // Antes do parse/dedup/customer: se o switch está OFF, ignora e retorna ok.
    // `as any`: helper compartilhado pina @supabase/supabase-js@2.49.4 enquanto este
    // arquivo pina @2; runtime idêntico mas TS vê duas shapes (mesmo padrão da linha
    // que cuida de checkAndMarkProcessed abaixo).
    if (await isConsultantAIDisabled(supabase as any, instanceData.consultant_id)) {
      // Antes de silenciar, checa override por lead (force_bot_phones ou
      // customers.bot_force_enabled). Setado pelo botão Zerar e pelo toggle
      // individual no chat. Phone vem do remoteJid do payload.
      const rawJid: string = body?.data?.key?.remoteJid || "";
      const phoneDigits = String(rawJid).split("@")[0].replace(/\D/g, "");
      let forceForLead = false;
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
        forceForLead = !!pending || !!cust;
      }
      if (!forceForLead) {
        console.log(`🛑 [global-off-silent] IA do consultor ${instanceData.consultant_id} desligada — ignorando inbound`);
        return new Response(JSON.stringify({ ok: true, msg: "global_ai_disabled_silent" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      console.log(`✅ [force-bot-active] IA global off, mas lead ${phoneDigits} tem override → bot responde`);
    }

    // ─── 3) Parse + dedupe + filter ────────────────────────────────────
    const parsed = parseEvolutionMessage(body, instanceData.connected_phone);
    if (!parsed) {
      console.log("⏭️ Mensagem ignorada (from_me, grupo, ou auto-mensagem da instância)");
      return new Response(JSON.stringify({ ok: true, msg: "ignored" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const messageId = body.data?.key?.id || "";
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

    const {
      remoteJid, buttonId, hasImage, hasDocument, hasAudio, isFile, isButton, mediaKind,
      imageMessage, documentMessage, audioMessage, key, message,
    } = parsed;
    // messageText pode ser sobrescrito pela transcrição automática quando o
    // inbound é áudio (Task 17). Por isso vai como `let` e não destructured.
    let messageText: string = parsed.messageText;

    if (!messageText && !isFile && !isButton) {
      console.log("⏭️ Mensagem vazia");
      return new Response(JSON.stringify({ ok: true, msg: "empty" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const phone = normalizePhone(remoteJid.replace("@s.whatsapp.net", ""));

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
          const ttlMs = 8000;
          const maxWaitMs = isV2Active(v2Flag) ? 4000 : 0;
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
                // Caller short-circuits to a neutral 200 — no side effects.
                // The other webhook holding the lock will respond.
                return new Response(
                  JSON.stringify({ ok: true, mode: "customer_lock_timeout" }),
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
    const statusFinalizados = [
      'data_complete', 'portal_submitting', 'awaiting_otp', 'validating_otp',
      'awaiting_manual_submit', 'portal_submitted', 'registered_igreen',
      'awaiting_signature', 'complete',
    ];
    const stepsFinalizados = ['complete', 'portal_submitting'];

    let { data: activeRecords } = await supabase
      .from("customers")
      .select("*")
      .eq("phone_whatsapp", phone)
      .eq("consultant_id", instanceData.consultant_id)
      .not("status", "in", `(${statusFinalizados.join(",")})`)
      .order("created_at", { ascending: false })
      .limit(1);

    let customer = activeRecords?.[0] || null;

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
    }

    if (customer && stepsFinalizados.includes(customer.conversation_step || "")) {
      console.log(`📱 Telefone ${phone}: cliente com step="${customer.conversation_step}" (finalizado). Criando novo.`);
      customer = null;
    }

    if (!customer) {
      console.log(`📱 Telefone ${phone}: criando novo registro.`);
      // Variante respeita `consultants.active_variants` (round-robin via RPC).
      const { data: assignedVariant } = await supabase.rpc("assign_flow_variant", {
        _consultant_id: instanceData.consultant_id,
      });
      const newFlowVariant = (typeof assignedVariant === "string" && assignedVariant) || "A";
      const { data: newCustomer, error } = await supabase
        .from("customers")
        .insert({
          phone_whatsapp: phone,
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
          if (stepsFinalizados.includes(fallback.conversation_step || "") || statusFinalizados.includes(fallback.status)) {
            await supabase.from("customers").update({ conversation_step: "welcome", status: "pending" }).eq("id", fallback.id);
            fallback.conversation_step = "welcome";
            fallback.status = "pending";
          }
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
            phone_whatsapp: (customer as any).phone_whatsapp,
          }).catch((e) => console.warn("[notify-new-lead reentry] falhou:", (e as Error).message));
        }
      } catch (e) {
        console.warn("[notify-new-lead reentry] check falhou:", (e as Error).message);
      }
    }

    // ─── 5.5) Auto-tag lead source (Meta Ads / CTWA) ─────────────────────
    // Detecta a origem do lead na PRIMEIRA mensagem (source_campaign_id ainda null).
    // Ordem de prioridade (da mais precisa para a mais fraca), confirmada pela
    // doc oficial Meta (Marketing API / Conversions API for Business Messaging):
    //   1. source_id (AD ID do clique) → casa com facebook_campaigns.fb_ad_ids
    //      → atribuição 100% DETERMINÍSTICA da campanha exata.
    //   2. ctwa_clid → tabela ctwa_clid_mapping (populada na criação da campanha).
    //   3. initial_message → texto pré-preenchido do CTWA (heurística).
    //   4. regex → frases típicas de anúncio (último recurso).
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
        const externalAdReply = ctxInfo?.externalAdReply || null;
        const ctwaClid = body?.data?.ctwaClid || externalAdReply?.ctwaClid || null;
        // source_id = AD ID que originou o clique (doc oficial Meta: referral.source_id).
        // No Evolution/Baileys vem em externalAdReply.sourceId; aceitamos variações.
        const sourceAdId = externalAdReply?.sourceId
          || externalAdReply?.source_id
          || body?.data?.sourceId
          || null;
        const sourceType = externalAdReply?.sourceType || externalAdReply?.source_type || null;
        const hasReferral = !!(externalAdReply || ctwaClid);

        // Payload completo do referral para auditoria
        const referralPayload = externalAdReply
          ? {
              title: externalAdReply.title,
              body: externalAdReply.body,
              source_url: externalAdReply.sourceUrl,
              media_url: externalAdReply.thumbnailUrl,
              source_id: sourceAdId,
              source_type: sourceType,
              ctwa_clid: ctwaClid,
            }
          : ctwaClid
          ? { ctwa_clid: ctwaClid }
          : null;

        let sourceCampaignId: string | null = null;
        let matchMethod: "ad_id" | "ctwa_clid" | "exact_message" | "tsvector" | "unmatched" = "unmatched";
        let matchSimilarity: number | null = null;

        // 1) Match DETERMINÍSTICO por AD ID (source_id) → fb_ad_ids da campanha.
        if (sourceAdId) {
          try {
            const { data: campByAd } = await supabase
              .from("facebook_campaigns")
              .select("id")
              .eq("consultant_id", instanceData.consultant_id)
              .contains("fb_ad_ids", JSON.stringify([String(sourceAdId)]))
              .maybeSingle();
            if ((campByAd as any)?.id) {
              sourceCampaignId = (campByAd as any).id;
              matchMethod = "ad_id";
            }
          } catch (e) {
            console.warn("[lead-source] ad_id match falhou:", (e as Error).message);
          }
        }

        // 2) Match via ctwa_clid_mapping (sinal forte) — populado na criação da campanha.
        if (ctwaClid && !sourceCampaignId) {
          try {
            const { data: mapping } = await supabase
              .from("ctwa_clid_mapping")
              .select("campaign_id")
              .eq("ctwa_clid", ctwaClid)
              .maybeSingle();
            if ((mapping as any)?.campaign_id) {
              sourceCampaignId = (mapping as any).campaign_id;
              matchMethod = "ctwa_clid";
            }
          } catch (e) {
            console.warn("[lead-source] ctwa_clid_mapping lookup falhou:", (e as Error).message);
          }
        }

        // 3) Match por initial_message (heurística — texto pré-preenchido da campanha)
        if (!sourceCampaignId && messageText && messageText.trim().length > 5) {
          try {
            const normalizedMsg = messageText.trim().toLowerCase().replace(/\s+/g, " ");
            // Ordena por ativa primeiro e mais recente: na ambiguidade (várias
            // campanhas com a MESMA initial_message), escolhe a que provavelmente
            // está gerando tráfego agora, em vez de chutar a primeira do banco.
            const { data: campaigns } = await supabase
              .from("facebook_campaigns")
              .select("id, initial_message, status, created_at")
              .eq("consultant_id", instanceData.consultant_id)
              .not("initial_message", "is", null)
              .order("created_at", { ascending: false })
              .limit(50);

            if (campaigns && campaigns.length > 0) {
              const matches = (campaigns as any[]).filter((c) => {
                const im = String(c.initial_message || "").trim().toLowerCase().replace(/\s+/g, " ");
                return im.length > 5 && normalizedMsg.startsWith(im.slice(0, Math.min(im.length, 60)));
              });
              if (matches.length > 0) {
                const rank = (s: string) => (s === "active" ? 0 : s === "pending_review" ? 1 : s === "paused" ? 2 : 3);
                matches.sort((a, b) => {
                  const r = rank(a.status) - rank(b.status);
                  if (r !== 0) return r;
                  return String(b.created_at).localeCompare(String(a.created_at));
                });
                const matched = matches[0];
                sourceCampaignId = matched.id;
                matchMethod = "exact_message";
                jsonLog("info", "lead_source_campaign_matched", {
                  customer_id: customer.id,
                  consultant_id: instanceData.consultant_id,
                  campaign_id: matched.id,
                  method: "initial_message",
                  ambiguous: matches.length > 1,
                  candidates: matches.length,
                });
              }
            }
          } catch (e) {
            console.warn("[lead-source] initial_message match falhou:", (e as Error).message);
          }
        }

        // 4) Regex fallback para frases típicas de anúncio (último recurso)
        const adsRegex = /(tenho interesse.*mais informa[çc][õo]es|gostaria de saber mais|quero saber mais|vi seu an[uú]ncio|vim do an[uú]ncio|do an[uú]ncio|pelo an[uú]ncio|vi o an[uú]ncio|facebook|instagram|\bfb ads?\b|\bmeta ads?\b|patrocinad|reels|stories|sponsored)/i;
        const textMatch = !isFile && messageText && adsRegex.test(messageText);

        if (hasReferral || textMatch || sourceCampaignId) {
          const patch: Record<string, any> = { lead_source: "meta_ads" };
          if (sourceCampaignId) patch.source_campaign_id = sourceCampaignId;
          if (ctwaClid) patch.source_ctwa_clid = ctwaClid;
          if (sourceAdId) patch.source_ad_id = String(sourceAdId);
          if (referralPayload) patch.source_referral = referralPayload;

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

    // ─── Keyword Detection (Detection Window: primeiras 3 mensagens) ───
    if (customer && !(customer as any).referral_partner_id && messageText && !isFile) {
      try {
        const { count: inboundCount } = await supabase
          .from("conversations")
          .select("id", { count: "exact", head: true })
          .eq("customer_id", customer.id)
          .eq("message_direction", "inbound");

        const DETECTION_WINDOW = 3;
        if ((inboundCount ?? 0) < DETECTION_WINDOW) {
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
              await supabase.from("customers").update({
                referral_partner_id: match.partnerId,
                referral_keyword_matched: match.keyword,
                referral_detected_at: new Date().toISOString(),
              }).eq("id", customer.id);
              (customer as any).referral_partner_id = match.partnerId;
              console.log(`[keyword-match] customer=${customer.id} partner=${match.partnerId} keyword="${match.keyword}"`);
              // Aviso EXTRA ao parceiro (se tiver notification_phone). Não bloqueia o fluxo.
              notifyPartnerNewLead(instanceData.consultant_id, match.partnerId, {
                id: customer.id,
                name: (customer as any).name,
                phone_whatsapp: (customer as any).phone_whatsapp,
                is_sandbox: (customer as any).is_sandbox,
              }).catch((e) => console.warn("[notify-partner-lead] falhou:", (e as Error).message));
            }
          }
        }
      } catch (e) {
        console.warn("[keyword-match] falhou:", (e as Error).message);
      }
    }

    // ─── Auto-capture: extrai nome/email/CEP/valor/CPF de TODA inbound de texto ───
    // Paridade com whapi-webhook. Idempotente — só preenche slots vazios.
    if (messageText && !isFile && customer) {
      try {
        const multi = extractMultiField(messageText, { allowSingleWordName: !!(customer as any).name_ask_sent_at });
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
    await supabase.from("conversations").insert({
      customer_id: customer.id,
      message_direction: "inbound",
      message_text: isFile ? "[arquivo]" : messageText,
      message_type: isFile ? "image" : "text",
      conversation_step: customer.conversation_step,
    });

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


    // ─── 6.1) BOT PAUSED — handoff humano ativo ────────────────────────
    // Se um humano assumiu, NÃO responder. Apenas registrar inbound (acima) e sair.
    if ((customer as any).bot_paused === true) {
      console.log(`🤝 [handoff] bot pausado para ${customer.id} (motivo: ${(customer as any).bot_paused_reason}). Skip auto-reply.`);
      return new Response(JSON.stringify({ ok: true, msg: "bot_paused" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── 7) Download media (if any) ────────────────────────────────────
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
        fileUrl = `data:${mimeType};base64,${fileBase64}`;
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
          // Anexa a URL na última conversa inbound deste customer (best effort)
          try {
            const { data: lastConv } = await supabase.from("conversations")
              .select("id").eq("customer_id", customer.id).eq("message_direction", "inbound")
              .order("created_at", { ascending: false }).limit(1).maybeSingle();
            if (lastConv?.id) {
              await supabase.from("conversations").update({
                message_text: `[${kind}] ${upRes.url}`,
                message_type: kind,
              }).eq("id", lastConv.id);
            }
          } catch (e) { /* ignore */ }
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

    // Task 14: se a mídia foi perdida em definitivo, manda reply de cortesia
    // e retorna 200 SEM avançar/redirecionar o `conversation_step`. O cliente
    // reenviar normalmente cai no mesmo step e refaz o caminho.
    if (mediaDownloadFailed) {
      try {
        await sender.sendText(
          remoteJid,
          "Desculpa 😅 não consegui receber sua imagem. Pode reenviar, por favor?"
        );
        await supabase.from("conversations").insert({
          customer_id: customer.id,
          message_direction: "outbound",
          message_text: "Desculpa 😅 não consegui receber sua imagem. Pode reenviar, por favor?",
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
    // ai-transcribe-media e injeta o texto como `messageText` para que os
    // motores conversacionais (`runConversationalFlow`/`ai-agent-router`)
    // tratem como se fosse texto. O áudio original já está em MinIO via
    // bloco 7 acima. Se a transcrição falhar, mantemos o comportamento
    // atual (handler de mídia recebe áudio bruto). Best-effort, never throws.
    if (hasAudio && fileBase64 && !messageText) {
      // Flag global do Superadmin: quando desligada, não transcreve (cai no
      // comportamento de áudio bruto). Default = ligada (null → trata como true).
      let audioTranscribeOn = true;
      try {
        const { getGlobalAiSettings } = await import("../_shared/ai-config.ts");
        const g = await getGlobalAiSettings(supabase);
        if (g.audioTranscribe === false) audioTranscribeOn = false;
      } catch (_) { /* fail-safe: mantém ligado */ }

      if (!audioTranscribeOn) {
        console.log("🔇 Transcrição de áudio desligada (ai_audio_transcribe=false) — seguindo com áudio bruto.");
      } else {
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
          // Atualiza a última conversa inbound com o transcript para histórico/IA.
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
          console.warn("⚠️ Transcrição vazia — seguindo com áudio bruto.");
        }
      } catch (e: any) {
        console.warn("⚠️ Transcrição falhou — seguindo com áudio bruto:", e?.message);
      }
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
        // Seleção determinística por variante (espelho 1:1 do whapi-webhook):
        // .eq("variant").order("created_at").limit(1) → no máximo 1 fluxo,
        // nunca lança para 0/1/N fluxos ativos (substitui .maybeSingle()).
        const variant = (customer as any)?.flow_variant || "A";
        const { data: activeFlows } = await supabase
          .from("bot_flows")
          .select("id")
          .eq("consultant_id", instanceData.consultant_id)
          .eq("is_active", true)
          .eq("variant", variant)
          .order("created_at", { ascending: true })
          .limit(1);
        const activeFlow = activeFlows?.[0] || null;
        const flowId = (activeFlow as any)?.id ?? null;
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
    const rawStep = customer.conversation_step || null;
    const stepBefore = stripPrefix(rawStep);
    (customer as any).conversation_step = stepBefore;

    let reply: string | null = "";
    let updates: Record<string, any> = {};
    let engineUsed: "sys" | "flow" = "sys";

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
          // Aceita steps do fluxo do consultor OU do template PÚBLICO da mesma
          // variante quando o consultor está em sync_mode='public' (resolveFlowId
          // redireciona o roteamento para o público, então conversation_step
          // pode apontar para UUIDs de steps do template).
          const { data: ownFlow } = await supabase
            .from("bot_flows")
            .select("id, sync_mode")
            .eq("consultant_id", instanceData.consultant_id)
            .eq("variant", variant)
            .eq("is_active", true)
            .maybeSingle();
          const allowedFlowIds: string[] = [];
          if ((ownFlow as any)?.id) allowedFlowIds.push((ownFlow as any).id);
          const ownSync = String((ownFlow as any)?.sync_mode ?? "public").toLowerCase();
          if (!ownFlow || ownSync === "public") {
            const { data: pubFlow } = await supabase
              .from("bot_flows")
              .select("id")
              .eq("is_public", true)
              .eq("is_active", true)
              .eq("variant", variant)
              .maybeSingle();
            if ((pubFlow as any)?.id) allowedFlowIds.push((pubFlow as any).id);
          }
          let found = false;
          if (allowedFlowIds.length > 0) {
            const { data: stepLookup } = await supabase
              .from("bot_flow_steps")
              .select("id")
              .or(`id.eq.${_stepRaw},step_key.eq.${_stepRaw}`)
              .eq("is_active", true)
              .in("flow_id", allowedFlowIds)
              .limit(1);
            found = Array.isArray(stepLookup) && stepLookup.length > 0;
          }
          if (!found) {
            console.warn(
              `🩹 [step-mismatch-cure] customer=${customer.id} step="${_stepRaw}" ` +
              `variant=${variant} → step não pertence ao fluxo desta variant. ` +
              `Resetando para welcome.`
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
                  consultant_id: instanceData.consultant_id,
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
          // Seleção determinística por variante (espelho 1:1 do whapi-webhook):
          // .eq("variant").order("created_at").limit(1) → no máximo 1 fluxo,
          // nunca lança para 0/1/N fluxos ativos (substitui .maybeSingle()).
          const variant = (customer as any)?.flow_variant || "A";
          const { data: activeFlows } = await supabase
            .from("bot_flows")
            .select("id")
            .eq("consultant_id", instanceData.consultant_id)
            .eq("is_active", true)
            .eq("variant", variant)
            .order("created_at", { ascending: true })
            .limit(1);
          const activeFlow = activeFlows?.[0] || null;
          if ((activeFlow as any)?.id) {
            const { count } = await supabase
              .from("bot_flow_steps")
              .select("id", { count: "exact", head: true })
              .eq("flow_id", (activeFlow as any).id)
              .eq("is_active", true);
            if ((count || 0) > 0) {
              engine = "flow";
              (customer as any).conversation_step = null;
              console.log(`🚀 [router] forçado para flow (consultor=${instanceData.consultant_id}, step legado="${stepBefore}")`);
            }
          }
        } catch (e) {
          console.warn("[router] falha ao verificar flow ativo:", (e as any)?.message);
        }
      }
      engineUsed = engine;

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
      // 🛡️ Cadastro também inclui UUID custom de captura/finalize — sem isso
      // o Cérebro/IA livre engole a foto da conta e o OCR nunca roda.
      const _emCadastro = CADASTRO_STEPS.has(stepBefore) || bridgeForcedSysForCapture;

      // 🛡️ Guarda de origem: clientes já cadastrados/sincronizados
      // (`igreen_sync` = carteira XLSX/worker; `igreen_extension` = extensão
      // Chrome do consultor) NUNCA entram no cadastro nem no Portal 2 — já
      // estão registrados. Vão direto pro Cérebro responder dúvidas,
      // independente do step legado.
      const _origin = String((customer as any).customer_origin || "").toLowerCase();
      const _isAtivoOrigin = _origin === "igreen_sync" || _origin === "igreen_extension";

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
        || (!_emCadastro && !(_fbVarCerebro === "D"))
        || (_emCadastro && _cadKind === "freeform_question");

      if (!_rodarCerebro) {
        if (_emCadastro) {
          console.log(`[cerebro] cadastro em andamento (midia=${_midiaOcr} step=${stepBefore} kind=${_cadKind ?? "media"}) → determinístico customer=${customer.id}`);
        } else if (_fbVarCerebro === "D") {
          console.log(`[fluxo-d-bypass] customer=${customer.id} — Cérebro pulado (fluxo com botões)`);
        }
      } else try {
        if (_isAtivoOrigin) {
          console.log(`[origin-guard] customer=${customer.id} origin=${_origin} → Cérebro (pula cadastro/portal)`);
        } else if (_emCadastro) {
          console.log(`[cerebro] freeform no cadastro step=${stepBefore} customer=${customer.id} → Cérebro readOnly`);
        }
        const { responderComCerebro } = await import("../_shared/cerebro/resposta-hook.ts");
        const r = await responderComCerebro({
          supabase,
          customerId: customer.id,
          consultantId: instanceData.consultant_id,
          inboundKind: isButton ? "button_click" : (hasImage || hasDocument || hasAudio ? "media" : "text"),
          inboundText: messageText ?? null,
          inboundButtonId: buttonId ?? null,
          inboundMediaKind: hasAudio ? "audio" : hasImage ? "image" : hasDocument ? "document" : null,
          inboundMessageId: messageId ?? null,
          channel: "evolution",
          telefone: phone ?? null,
          // Sender REAL do canal já protegido (anti-ban + dedup + lock + rate
          // limit). Retorna false quando o guard bloqueou o envio.
          enviarTexto: async (texto) => await sender.sendText(remoteJid, texto),
        });
        _cerebroRespondeu = r.respondeu;
      } catch (e: any) {
        // Fail-open: erro ao ligar o Cérebro nunca bloqueia o atendimento.
        console.warn("[cerebro-resposta-hook] erro não-bloqueante:", e?.message);
        _cerebroRespondeu = false;
      }
      // GATE (Property 1 — um caminho conversacional só): quando o Cérebro é a
      // fonte de verdade do turno (canary/on), a vendedora legada NÃO responde o
      // mesmo turno — evita resposta dupla. Em off/dark, respondeu=false e segue
      // o caminho atual normalmente (comportamento idêntico ao de hoje).
      if (_cerebroRespondeu) {
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
        return new Response(
          JSON.stringify({ ok: true, mode: "origin_guard_skip" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const result = engine === "flow"
        ? await runConversationalFlow({
            supabase, sender, customer, consultorId, nomeRepresentante,
            remoteJid, phone, messageText, buttonId, isFile, isButton,
            hasImage, hasDocument, hasAudio, imageMessage, documentMessage, message, key, messageId,
            instanceName,
            fileUrl, fileBase64, geminiApiKey: GEMINI_API_KEY,
          })
        : await runBotFlow({
            supabase, sender, customer, consultorId, nomeRepresentante,
            remoteJid, phone, messageText, buttonId, isFile, isButton,
            hasImage, hasDocument, hasAudio, imageMessage, documentMessage, message, key, messageId,
            instanceName,
            fileUrl, fileBase64, geminiApiKey: GEMINI_API_KEY,
          });
      reply = result.reply;
      updates = result.updates;
    } catch (botErr: any) {
      console.error(`💥 [bot-flow crash] step=${stepBefore} customer=${customer.id}:`, botErr);
      captureError(botErr, {
        tags: { function: "evolution-webhook", kind: "bot_flow_crash" },
        extra: { customer_id: customer.id, step: stepBefore },
      });
      reply = "🤖 Tive um probleminha técnico ao processar sua mensagem. Pode me enviar novamente, por favor? Se continuar, me responda *MENU* para recomeçarmos juntos. 🙏";
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

      const firstName = String((customer as any).name || "").split(" ")[0] || "";
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
