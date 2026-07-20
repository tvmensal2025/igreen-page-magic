/**
 * Whapi Webhook — Super Admin ONLY (rafael.ids@icloud.com)
 * 
 * Recebe mensagens do Whapi Cloud e roda o MESMO bot-flow.ts
 * que o Evolution webhook, mas usando botões reais do WhatsApp.
 * 
 * NÃO interfere nas instâncias Evolution dos consultores.
 * 
 * Endpoint: POST /whapi-webhook
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizePhone } from "../_shared/utils.ts";
import { createWhapiSender, parseWhapiMessage, resolveInboundConversationMeta } from "../_shared/whapi-api.ts";
import { checkAndMarkProcessed, logStepTransition, jsonLog } from "../_shared/audit.ts";
import { runBotFlow } from "./handlers/bot-flow.ts";
import { runConversationalFlow, CADASTRO_STEPS } from "./handlers/conversational/index.ts";
import { normalizeOutgoing, stripPrefix } from "./handlers/step-namespace.ts";
import { routeEngine as routeEngineV2 } from "../_shared/flow-router.ts";
import { captureError } from "../_shared/sentry.ts";
import { detectHandoffIntent } from "../_shared/captureExtractors.ts";
import { extractMultiField, buildMultiFieldPatch } from "../_shared/multi-field-extractor.ts";
import { botRequestStore, isTestPhone, logTestOutbound } from "../_shared/test-mode.ts";
import { notifyNewLead, notifyPartnerNewLead, notifySuperAdminUnmatchedLead, notifyOwnerManualReview } from "../_shared/notify-consultant.ts";
import { mirrorCustomerToCaptation } from "../_shared/captation/mirror-customer.ts";
import { syncCustomerStage } from "../_shared/conversion/crm-sync.ts";
import { isCustomerPausedByHuman, isConsultantAIDisabled } from "../_shared/bot/paused.ts";
import { isBotGloballyEnabled } from "../_shared/bot/global-flag.ts";
import { matchKeyword, type PartnerKeywords } from "../_shared/keyword-matcher.ts";
import { extractShortCodeMarker } from "../_shared/qr-phrase.ts";
import { makeIdempotentEnviarTexto } from "../_shared/bot/conversational-send-idempotency.ts";
import { summarizeWebhookBody } from "../_shared/log-redact.ts";
import { verifyWebhookOrigin } from "../_shared/webhook-auth.ts";
import { resolveWorker } from "../_shared/portal-worker.ts";
import { matchesMetaCtwaPhrase } from "../_shared/meta-ctwa-fallback.ts";
import { markManualReview, logRodizioOutcome } from "../_shared/rodizio-cas.ts";
import { assignRodizioLead, bindCustomerCampaign } from "../_shared/rodizio-assign.ts";
import {
  campaignContainsAdId,
  extractMetaReferralFields,
  resolveCampaignFromStrongMeta,
  resolveCampaignByProtocolOnly,
} from "../_shared/deterministic-campaign-resolver.ts";
import { reconcileStrongMetaCampaign } from "../_shared/reconcile-strong-meta.ts";
import {
  resolveCanonicalFlowVariant,
} from "../_shared/bot/canonical-flow-variant.ts";

// `pickFlowVariant` (A/D 50/50) descontinuado — usamos a RPC
// `assign_flow_variant` que respeita `consultants.active_variants`.
// Desde 2026-07-20 a variante canônica é sempre A (Grupo A / Sofia).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_AI_API_KEY") || "";

function inferNameSource(name: string | null | undefined, currentSource: string | null | undefined): string {
  const src = String(currentSource || "").toLowerCase();
  if (src) return src;
  const value = String(name || "").trim();
  return value ? "whatsapp_profile" : "unknown";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Validação de origem: por padrão GRACE (log-only) — Whapi Cloud não envia
  // x-webhook-secret sem URL com ?secret=. Enforce só com ENFORCE_WEBHOOK_ORIGIN=true
  // (depois de o provedor já enviar o secret).
  const originAuth = verifyWebhookOrigin(req, "WHAPI_WEBHOOK_SECRET");
  if (!originAuth.ok) {
    const enforce =
      (Deno.env.get("ENFORCE_WEBHOOK_ORIGIN") || "").trim().toLowerCase() === "true";
    console.warn(
      `[whapi-webhook] origem sem secret (${enforce ? "ENFORCE → 401" : "grace/log-only, NÃO bloqueia"}):`,
      originAuth.reason,
    );
    if (enforce) {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized_webhook", reason: originAuth.reason }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Kill switch global: OFF = não fala (outbound), MAS continua recebendo.
    // Flag lida cedo; o early-return antigo foi removido para não perder lead.
    const botGlobalOutboundEnabled = await isBotGloballyEnabled(supabase as any);
    if (!botGlobalOutboundEnabled) {
      console.log("[whapi-webhook] bot_global_enabled=false → inbound OK, outbound automático bloqueado");
    }

    let body: any;
    try {
      const raw = await req.text();
      if (!raw || raw.trim() === "") {
        return new Response(JSON.stringify({ ok: true, msg: "ignored_empty_body" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      body = JSON.parse(raw);
    } catch (parseErr) {
      console.warn("[whapi-webhook] body parse falhou:", (parseErr as Error).message);
      return new Response(JSON.stringify({ ok: true, msg: "ignored_bad_body" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // LGPD: nunca logar o corpo cru (contém telefone e texto do cliente).
    // `summarizeWebhookBody` retorna apenas metadados estruturais.
    console.log("Whapi webhook received:", JSON.stringify(summarizeWebhookBody(body)));

    // ─── Ignorar eventos que não são mensagens ─────────────────────────
    const eventType = body.event?.type;
    if (eventType && eventType !== "messages") {
      return new Response(JSON.stringify({ ok: true, msg: "non-message event" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── Parsear mensagem Whapi ────────────────────────────────────────
    const parsed = parseWhapiMessage(body);
    if (!parsed) {
      console.log("⏭️ Mensagem ignorada (from_me via API, grupo, ou vazia)");
      return new Response(JSON.stringify({ ok: true, msg: "ignored" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── Carregar settings + identificar super admin ANTES de qualquer DB write ─
    // Necessário para o gate global de IA desligada (silêncio total) rodar antes
    // de outboundHuman, dedup, customer-create, etc.
    const { data: settingsRows } = await supabase.from("settings").select("*");
    const settings: Record<string, string> = {};
    settingsRows?.forEach((s: any) => { settings[s.key] = s.value; });

    const superAdminConsultantId = settings.superadmin_consultant_id || "";
    if (!superAdminConsultantId) {
      console.error("❌ superadmin_consultant_id não configurado na tabela settings");
      return new Response(JSON.stringify({ error: "Super admin not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // IA global OFF deve silenciar apenas respostas automáticas. O inbound ainda
    // precisa ser salvo e alimentar captura (ex.: cliente digitou o nome após "Pedir nome").
    // Type cast: helpers compartilhados pinam @supabase/supabase-js@2.49.4 enquanto
    // este arquivo pina @2; o runtime é idêntico mas TS vê duas shapes diferentes
    // de protected property. Mesmo workaround usado em evolution-webhook/index.ts:191.
    const globalAiDisabled = await isConsultantAIDisabled(supabase as any, superAdminConsultantId);

    // ─── Outbound humano (consultor digitou no WhatsApp Business/app) ─
    if ((parsed as any).outboundHuman) {
      const outChatId: string = (parsed as any).chatId || "";
      const outSource: string = (parsed as any).source || "";
      const outMessageId: string = (parsed as any).messageId || "";
      const outPhone = normalizePhone(outChatId.replace("@s.whatsapp.net", "")).replace(/\D/g, "");
      console.log(`👤 Outbound humano detectado (source=${outSource}) → verificando antes de pausar bot para ${outPhone}`);
      try {
        // Guard 1: eco do próprio bot — se este messageId já foi registrado em
        // outbound_message_log nos últimos 120s, é a nossa própria mensagem voltando.
        if (outMessageId) {
          const { data: echo } = await supabase
            .from("outbound_message_log")
            .select("idempotency_key")
            .eq("evolution_message_id", outMessageId)
            .gte("created_at", new Date(Date.now() - 120_000).toISOString())
            .limit(1)
            .maybeSingle();
          if (echo) {
            console.log(`↩️ ignored_self_echo messageId=${outMessageId} — não pausando`);
            return new Response(JSON.stringify({ ok: true, msg: "ignored_self_echo" }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        }

        const { data: cust, error: selErr } = await supabase
          .from("customers")
          .select("id, bot_paused, assigned_human_id, consultant_id, last_bot_reply_at")
          .eq("phone_whatsapp", outPhone)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (selErr) console.error("⚠️ select customer (outboundHuman):", selErr);

        // Eco do bot já é filtrado acima (source=api / log de outbound).
        // NÃO ignorar takeover por last_bot_reply_at: consultor responde no meio
        // da conversa exatamente quando o bot precisa calar.

        if (cust && (!cust.bot_paused || !cust.assigned_human_id)) {
          // Pausa estável (igual portal): sem auto-unpause no próximo inbound.
          const { error: updErr } = await supabase
            .from("customers")
            .update({
              bot_paused: true,
              bot_paused_reason: "humano_assumiu",
              bot_paused_at: new Date().toISOString(),
              bot_paused_until: null,
              assigned_human_id: cust.consultant_id ?? cust.assigned_human_id ?? null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", cust.id);
          if (updErr) console.error("⚠️ update bot_paused (outboundHuman):", updErr);
          else console.log(`✅ Bot pausado para ${outPhone} (customer ${cust.id}, reason=humano_assumiu)`);
        } else if (!cust) {
          console.warn(`⚠️ Nenhum customer encontrado para ${outPhone} — bot não foi pausado`);
        }
      } catch (e) {
        console.error("⚠️ Falha ao pausar bot via outbound humano:", e);
      }
      return new Response(JSON.stringify({ ok: true, msg: "outbound_human_takeover" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }


    const {
      remoteJid, hasImage, hasDocument, hasAudio, hasVideo,
      imageMessage, documentMessage, audioMessage, videoMessage, key, message,
      fileBase64: whapiFileBase64, fileUrl: whapiFileUrl, fromName,
      mediaId: inboundMediaId,
    } = parsed;
    let { messageText, isFile, isButton, buttonId, messageId } = parsed;

    const inboundConvMeta = () => resolveInboundConversationMeta({
      hasAudio,
      hasImage,
      hasDocument,
      hasVideo: !!hasVideo,
      isFile,
      messageText,
      mediaId: inboundMediaId || null,
    });

    // ─── Aprovação de cadastro por "SIM" do super admin ────────────────
    // Se o super admin responder "SIM" (ou "SIM <nome>") no WhatsApp, aprova
    // o cadastro de consultor pendente sem precisar abrir o painel. A guarda
    // de telefone (allowlist do super admin) está dentro do helper, então um
    // lead qualquer que mande "sim" NÃO dispara aprovação.
    try {
      const senderPhone = normalizePhone(String(remoteJid).replace("@s.whatsapp.net", "")).replace(/\D/g, "");
      const { parseApprovalCommand, handleSuperAdminApproval } = await import("../_shared/superadmin-approval.ts");
      if (messageText && parseApprovalCommand(messageText)) {
        const whapiToken = settings.whapi_token || Deno.env.get("WHAPI_TOKEN") || "";
        const whapiBaseUrl = settings.whapi_api_url || "https://gate.whapi.cloud";
        const approvalSender = createWhapiSender(whapiToken, whapiBaseUrl);
        const res = await handleSuperAdminApproval({
          supabase: supabase as any,
          superAdminConsultantId,
          senderPhone,
          messageText,
          sender: approvalSender,
          remoteJid,
        });
        if (res.handled) {
          console.log(`[whapi-webhook] aprovação super admin tratada (approved=${res.approvedConsultantId ?? "—"})`);
          return new Response(JSON.stringify({ ok: true, msg: "superadmin_approval", approved: res.approvedConsultantId ?? null }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    } catch (e) {
      console.error("⚠️ Falha na aprovação por SIM do super admin:", (e as Error).message);
      // Fail-open: segue o fluxo normal se algo der errado.
    }

    // Helper: limpa emojis/símbolos do pushName e pega o primeiro nome válido
    const cleanPushName = (raw: string | null | undefined): string | null => {
      if (!raw) return null;
      // Remove emojis e símbolos, mantém letras/acentos/espaços/hífen
      const cleaned = String(raw)
        .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{2300}-\u{23FF}\u{2700}-\u{27BF}\u{FE0F}\u{200D}]/gu, "")
        .replace(/[^\p{L}\s'-]/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!cleaned) return null;
      // Rejeita se parecer só número/placeholder
      if (/^\d+$/.test(cleaned)) return null;
      return cleaned;
    };

    if (!messageText && !isFile && !isButton) {
      console.log("⏭️ Mensagem vazia");
      return new Response(JSON.stringify({ ok: true, msg: "empty" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── Deduplicação ──────────────────────────────────────────────────
    if (messageId && await checkAndMarkProcessed(supabase as any, messageId, "whapi-superadmin")) {
      return new Response(JSON.stringify({ ok: true, msg: "duplicate" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const phone = normalizePhone(remoteJid.replace("@s.whatsapp.net", ""));
    const phoneLocal = phone.startsWith("55") ? phone.slice(2) : phone;
    let resetMarker: any = null;
    try {
      const { data: resetRow, error: resetErr } = await supabase
        .from("phone_reset_quarantine")
        .select("reset_at, quarantine_until")
        .in("phone_digits", Array.from(new Set([phone, phoneLocal])))
        .order("reset_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (resetErr) console.warn("[reset-marker] lookup falhou:", resetErr.message);
      resetMarker = resetRow || null;
      if (resetMarker) {
        console.log(`[reset-marker] phone=${phone} reset_at=${resetMarker.reset_at} quarantine_until=${resetMarker.quarantine_until}`);
      }
    } catch (e) {
      console.warn("[reset-marker] lookup exception:", (e as Error).message);
    }

    // ─── Validar token Whapi (settings já carregadas acima) ────────────
    const whapiToken = settings.whapi_token || Deno.env.get("WHAPI_TOKEN") || "";
    if (!whapiToken) {
      console.error("❌ WHAPI_TOKEN não configurado");
      return new Response(JSON.stringify({ error: "Whapi token not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── Modo teste end-to-end ────────────────────────────────────────────
    // Dois modos:
    //   1) Sandbox tradicional → phone começa com 5500000 (mocks ligados, delays zerados)
    //   2) Modo Real → header x-bot-real-services + x-bot-test-run-id, phone REAL,
    //      OCR/portal/OTP/facial usam serviços reais; outbound é REAL + espelhado
    //      em bot_test_outbound pra UI mostrar.
    const sandboxPhone = isTestPhone(phone);
    const headerRunId = req.headers.get("x-bot-test-run-id");
    const headerRealServices = req.headers.get("x-bot-real-services") === "1";
    const headerBypassQuiet = req.headers.get("x-bot-bypass-quiet-hours") === "1";
    const headerFastClock = req.headers.get("x-bot-fast-clock") === "1";
    const headerForceOcrFail = req.headers.get("x-bot-force-ocr-fail") === "1";
    const realMode = headerRealServices && !!headerRunId; // phone pode ser real
    const testMode = sandboxPhone || realMode;
    let testRunId: string | null = null;
    let testTurn = 0;
    let realServices = false;
    if (testMode) {
      const headerTurn = Number(req.headers.get("x-bot-test-turn") || "0");
      if (headerRunId) {
        testRunId = headerRunId;
        testTurn = Number.isFinite(headerTurn) ? headerTurn : 0;
      } else if (sandboxPhone) {
        const { data: runRow } = await supabase
          .from("bot_test_runs")
          .select("id")
          .eq("status", "running")
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        testRunId = runRow?.id || null;
      }
      realServices = realMode;
      console.log(`🧪 [test-mode] ATIVO phone=${phone} runId=${testRunId} turn=${testTurn} realServices=${realServices}`);
    }

    // Sender real OU mock que registra em bot_test_outbound
    const realSender = createWhapiSender(whapiToken);

    // Phase A — Task 8 (whatsapp-flow-architecture-v3): smoke wiring do adapter
    // unificado. NÃO troca `realSender` — apenas confirma que `getAdapter`
    // funciona para o canal Whapi. Wiring real chega nas próximas phases.
    try {
      const { getAdapter } = await import("../_shared/channels/index.ts");
      const adapter = getAdapter({
        kind: "whapi",
        input: { apiToken: whapiToken },
      });
      jsonLog("debug", "channel_adapter_ready", {
        channel: adapter.capabilities.channel,
        supports_buttons: adapter.capabilities.supportsButtons,
        max_buttons: adapter.capabilities.maxButtons,
        supports_list: adapter.capabilities.supportsList,
      });
    } catch (e: any) {
      console.warn("[channel-adapter] smoke wiring falhou (não bloqueante):", e?.message);
    }

    // Sandbox tradicional → sender 100% mock (não toca Whapi)
    const mockSender = {
      sendText: async (_jid: string, text: string) => {
        await logTestOutbound("text", text); return true;
      },
      sendButtons: async (_jid: string, message: string, buttons: any[]) => {
        const payload = JSON.stringify({
          text: message,
          buttons: (buttons || []).map((b: any) => ({
            id: String(b?.id ?? ""),
            title: String(b?.title ?? b?.id ?? ""),
          })),
        });
        await logTestOutbound("buttons", payload);
        return true;
      },
      sendMedia: async (_jid: string, mediaUrl: string, caption: string, mediatype: string) => {
        await logTestOutbound(`media:${mediatype}`, `${mediaUrl} | ${caption || ""}`);
        return true;
      },
      sendPresence: async () => true,
      downloadMedia: async () => null,
    };

    // Modo Real → wrap realSender pra espelhar cada outbound em bot_test_outbound.
    // O envio real (Whapi) sempre ocorre; a falha do mirror NUNCA bloqueia o envio.
    const mirrorSender = {
      sendText: async (jid: string, text: string) => {
        const ok = await realSender.sendText(jid, text);
        try { await logTestOutbound("text", text); } catch (_) {}
        return ok;
      },
      sendButtons: async (jid: string, message: string, buttons: any[]) => {
        const ok = await realSender.sendButtons(jid, message, buttons);
        try {
          const payload = JSON.stringify({
            text: message,
            buttons: (buttons || []).map((b: any) => ({
              id: String(b?.id ?? ""),
              title: String(b?.title ?? b?.id ?? ""),
            })),
          });
          await logTestOutbound("buttons", payload);
        } catch (_) {}
        return ok;
      },
      sendMedia: async (jid: string, mediaUrl: string, caption: string, mediatype: string) => {
        // realSender.sendMedia tipa mediatype como union estrita ("audio"|"video"|...).
        // Como callers do bot-flow já passam o kind validado, fazemos o cast aqui pra
        // não vazar pela API pública do mirror (que precisa aceitar string genérico).
        const ok = await realSender.sendMedia(jid, mediaUrl, caption, mediatype as any);
        try { await logTestOutbound(`media:${mediatype}`, `${mediaUrl} | ${caption || ""}`); } catch (_) {}
        return ok;
      },
      sendPresence: realSender.sendPresence?.bind(realSender) ?? (async () => true),
      downloadMedia: realSender.downloadMedia?.bind(realSender) ?? (async () => null),
    };

    const sender = realServices ? mirrorSender : (sandboxPhone ? mockSender : realSender);


    // ─── Identificar consultor super admin (id já validado no topo) ────
    const { data: consultantData } = await supabase
      .from("consultants")
      .select("id, name, display_name, assistant_name, igreen_id, conversational_flow_enabled")
      .eq("id", superAdminConsultantId)
      .single();

    // Prefere display_name (nome humano cadastrado) sobre name (pode ser slug do login).
    // Usa só o PRIMEIRO NOME — soa mais natural no WhatsApp ("Rafael" em vez de "Rafael Ferreira").
    const _fullName = (consultantData?.display_name || consultantData?.name || "iGreen Energy").trim();
    const nomeRepresentante = _fullName.split(/\s+/)[0] || "iGreen Energy";
    const nomeAssistente = String(consultantData?.assistant_name || "").trim() || "Sofia";
    const consultorId = consultantData?.igreen_id || "124170";
    console.log(`✅ Whapi super admin: ${nomeRepresentante} (full: ${_fullName}, iGreen ID: ${consultorId}, IA: ${nomeAssistente})`);





    // ─── 🔑 OTP INTERCEPT (antes do bot-flow) ─────────────────────────
    // Se o cliente está em awaiting_otp/portal_submitting e mandou um código
    // numérico, capturamos e notificamos o worker. Bypassa o fluxo conversacional.
    if (messageText && !isButton && !isFile) {
      const otpDigits = messageText.replace(/\D/g, "");
      let extractedOtp: string | null = null;
      const otpPatterns = [
        /(?:c[oó]digo|code|otp|token|verifica[cç][aã]o)[^\d]*(\d{4,8})/i,
        /^(\d{4,8})$/,
      ];
      for (const pat of otpPatterns) {
        const m = messageText.match(pat);
        if (m) { extractedOtp = m[1] || m[0]; break; }
      }
      if (!extractedOtp && /^\d{4,8}$/.test(otpDigits)) extractedOtp = otpDigits;

      if (extractedOtp) {
        const { data: otpCustomer } = await supabase
          .from("customers")
          .select(`
            id, name, status, consultant_id, portal2_idcliente, portal_idconsultor_override,
            consultants:consultant_id(igreen_id),
            referral_partners:referral_partner_id(cli, partner_igreen_id)
          `)
          .eq("phone_whatsapp", phone)
          .eq("consultant_id", superAdminConsultantId)
          .in("status", ["awaiting_otp", "portal_submitting"])
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (otpCustomer) {
          console.log(`🔑 [whapi-otp] OTP ${extractedOtp} capturado para ${otpCustomer.name} (${otpCustomer.id}) idcliente=${otpCustomer.portal2_idcliente ?? 'null'}`);

          // Sempre persiste o código recebido. Se o cadastro no Portal 2 ainda
          // não terminou (portal2_idcliente null), marca otp_pending_replay=true
          // pra recover-stuck-otp reaproveitar quando o idcliente chegar.
          await supabase.from("customers").update({
            otp_code: extractedOtp,
            otp_received_at: new Date().toISOString(),
            otp_pending_replay: !otpCustomer.portal2_idcliente,
            updated_at: new Date().toISOString(),
          }).eq("id", otpCustomer.id);

          // Mesma prioridade do buildPortal2Payload:
          // override > partner_igreen_id > cli > dono
          const oc: any = otpCustomer;
          const overrideRaw = Number(oc.portal_idconsultor_override || 0);
          const overrideId = Number.isFinite(overrideRaw) && overrideRaw > 0 ? overrideRaw : 0;
          const donoIgreenId = oc.consultants?.igreen_id ? Number(oc.consultants.igreen_id) : null;
          const partnerIgreenId = oc.referral_partners?.partner_igreen_id
            ? Number(oc.referral_partners.partner_igreen_id) : 0;
          const partnerCli = oc.referral_partners?.cli ? Number(oc.referral_partners.cli) : 0;
          const partnerAsConsultant =
            (Number.isFinite(partnerIgreenId) && partnerIgreenId > 0)
              ? partnerIgreenId
              : (Number.isFinite(partnerCli) && partnerCli > 0 ? partnerCli : 0);
          const idconsultor = overrideId > 0
            ? overrideId
            : (partnerAsConsultant > 0 ? partnerAsConsultant : donoIgreenId);
          const idcliente = otpCustomer.portal2_idcliente
            ? Number(otpCustomer.portal2_idcliente)
            : null;

          // Roteia o OTP pelo worker resolvido (Portal 2 / autoconexão).
          const resolvedOtpWorker = await resolveWorker(supabase, otpCustomer.id).catch(() => null);
          const workerUrl = resolvedOtpWorker?.url || "";
          const workerSecret = resolvedOtpWorker?.secret || "";

          let workerOk = false;
          let workerErrorKind: string | null = null;
          if (!workerUrl || !workerSecret) {
            workerErrorKind = "worker_not_configured";
            console.warn(`⚠️ [whapi-otp] worker indisponível (url=${!!workerUrl} secret=${!!workerSecret})`);
          } else if (!idconsultor || !idcliente) {
            // Cadastro ainda não terminou — recover-stuck-otp vai reprocessar.
            workerErrorKind = !idcliente ? "awaiting_portal_idcliente" : "missing_idconsultor";
            console.log(`⏳ [whapi-otp] cadastro incompleto (${workerErrorKind}); OTP guardado pra replay`);
          } else {
            const payload = {
              customer_id: otpCustomer.id,
              idconsultor,
              idcliente,
              code: extractedOtp,
              otp_code: extractedOtp, // compat: aceita ambos os nomes
            };
            try {
              const ctrl = new AbortController();
              const timer = setTimeout(() => ctrl.abort(), 60_000);
              const wr = await fetch(`${workerUrl.replace(/\/$/, "")}/confirm-otp`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${workerSecret}` },
                body: JSON.stringify(payload),
                signal: ctrl.signal,
              });
              clearTimeout(timer);
              workerOk = wr.ok;
              if (wr.ok) {
                // Sucesso: o worker já manda a "chave de ouro" com o link
                // direto. Limpa o flag de replay e fica em silêncio aqui pra
                // não duplicar mensagem.
                await supabase.from("customers").update({
                  otp_pending_replay: false,
                  updated_at: new Date().toISOString(),
                }).eq("id", otpCustomer.id);
                console.log(`✅ [whapi-otp] OTP confirmado pelo worker (chave de ouro disparada)`);
              } else {
                const txt = await wr.text().catch(() => "");
                workerErrorKind = `worker_status_${wr.status}`;
                console.warn(`⚠️ [whapi-otp] worker respondeu ${wr.status}: ${txt.slice(0, 200)}`);
              }
            } catch (e: any) {
              workerErrorKind = e?.name === "AbortError" ? "worker_timeout" : "worker_fetch_failed";
              console.warn(`⚠️ [whapi-otp] Falha ao notificar worker: ${e?.message}`);
            }
          }

          await supabase.from("conversations").insert({
            customer_id: otpCustomer.id, message_direction: "inbound",
            message_text: messageText, message_type: "text",
            conversation_step: "otp_received",
          });

          // Se o worker já confirmou, ele mesmo manda a mensagem chave de ouro
          // com o link. Aqui só falamos algo se a confirmação NÃO foi imediata
          // (worker offline, cadastro ainda em andamento, etc.). Como o código
          // sempre é válido, nunca dizemos "código inválido".
          if (!workerOk) {
            try {
              const reply = "✅ Código recebido! Estou finalizando seu cadastro, em alguns segundos eu te confirmo aqui. 💚";
              await realSender.sendText(remoteJid, reply);
              await supabase.from("conversations").insert({
                customer_id: otpCustomer.id, message_direction: "outbound",
                message_text: reply, message_type: "text",
                conversation_step: "otp_received",
              });
            } catch (_) {}
          }

          return new Response(JSON.stringify({
            ok: true,
            msg: "otp_intercepted",
            otp: extractedOtp,
            worker_ok: workerOk,
            worker_error: workerErrorKind,
          }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }


    // ─── Find or create customer ────────────────────────────────────
    // 🚨 NUNCA filtrar a busca por status — se filtrarmos, leads em
    // awaiting_otp/awaiting_signature/registered_igreen/complete ficam
    // "invisíveis" e o código cria um customer NOVO com step=welcome,
    // disparando o áudio inicial de novo. Sempre buscar o registro mais
    // recente do telefone e decidir o que fazer baseado no status.
    let activeQuery = supabase
      .from("customers")
      .select("*")
      .eq("phone_whatsapp", phone)
      .eq("consultant_id", superAdminConsultantId)
      .order("created_at", { ascending: false })
      .limit(1);
    // Modo Real do simulador deve isolar o lead de teste e nunca reaproveitar
    // um customer real antigo do mesmo telefone (ex.: capture_mode=manual).
    if (realMode) activeQuery = activeQuery.eq("is_test_lead", true);
    let { data: activeRecords } = await activeQuery;

    let customer = activeRecords?.[0] || null;

    // Status pós-cadastro — manter como está; handlers de bot-flow
    // (aguardando_otp / aguardando_assinatura / cadastro_em_analise / complete)
    // já respondem educadamente sem disparar mídia.
    const POST_CADASTRO_STATUSES = new Set([
      "data_complete", "portal_submitting", "awaiting_otp", "validating_otp",
      "awaiting_manual_submit", "portal_submitted", "registered_igreen",
      "awaiting_signature", "awaiting_facial", "complete",
      "cadastro_concluido", "active", "approved",
    ]);
    const RESUMABLE_STATUSES = new Set(["abandoned", "stuck_finalizar", "stuck_contact", "email_pendente_revisao"]);

    if (customer && customer.status === "automation_failed") {
      // Falha técnica — pode recomeçar do welcome.
      await supabase.from("customers").update({ conversation_step: "welcome", status: "pending", error_message: null }).eq("id", customer.id);
      customer.conversation_step = "welcome";
      customer.status = "pending";
    } else if (customer && RESUMABLE_STATUSES.has(customer.status)) {
      await supabase.from("customers").update({ status: "pending", error_message: null, rescue_attempts: 0 }).eq("id", customer.id);
      customer.status = "pending";
    } else if (customer && POST_CADASTRO_STATUSES.has(customer.status)) {
      // ✅ NÃO resetar. Garante que o step esteja em algum handler educado.
      const curStep = stripPrefix(customer.conversation_step || "");
      const safeSteps = new Set([
        "aguardando_otp", "validando_otp", "aguardando_assinatura",
        "aguardando_facial", "cadastro_em_analise", "complete",
        "portal_submitting",
      ]);
      if (!safeSteps.has(curStep)) {
        // Step legacy/desconhecido: alinha ao status real (nunca forçar
        // cadastro_em_analise enquanto OTP/facial ainda pendentes — caso Osmar).
        const st = String(customer.status || "");
        const fixStep =
          (st === "awaiting_otp" || st === "validating_otp" || st === "portal_submitting")
            ? "aguardando_otp"
            : (st === "awaiting_signature" || st === "awaiting_facial")
              ? "aguardando_facial"
              : "cadastro_em_analise";
        await supabase.from("customers")
          .update({ conversation_step: fixStep })
          .eq("id", customer.id);
        customer.conversation_step = fixStep;
      }
      console.log(`[find-customer] customer ${customer.id} pós-cadastro (status=${customer.status}, step=${customer.conversation_step}) — mantendo, sem reset`);
    }

    if (!customer) {
      const pushedName = resetMarker ? null : cleanPushName(fromName);
      // Variante respeita `consultants.active_variants` (round-robin
      // determinístico via RPC `assign_flow_variant`). Só sorteia para
      // lead NOVO — lead existente mantém sua variante.
      const { data: assignedVariant } = await supabase.rpc("assign_flow_variant", {
        _consultant_id: superAdminConsultantId,
      });
      // Variante canônica = Grupo A (Sofia). Nunca F/D/M em lead novo.
      const abVariant = resolveCanonicalFlowVariant(
        (typeof assignedVariant === "string" && assignedVariant) || "A",
      );
      const { data: newCustomer, error } = await supabase
        .from("customers")
        .insert({
          phone_whatsapp: phone,
          consultant_id: superAdminConsultantId,
          status: "pending",
          conversation_step: "welcome",
          flow_variant: abVariant,
          // bind canal/instância de origem (regra de ouro: fica até o fim)
          origin_channel: "whapi",
          origin_instance_name: "whapi-superadmin",
          origin_consultant_id: superAdminConsultantId,
          ...(realMode ? { is_test_lead: true, is_sandbox: false, capture_mode: "auto" } : {}),
          ...(pushedName ? { name: pushedName, name_source: "whatsapp_profile" } : {}),
          ...(resetMarker ? { chat_cleared_at: resetMarker.reset_at } : {}),
        })
        .select().single();
      if (error) {
        let fallbackQuery = supabase
          .from("customers")
          .select("*")
          .eq("phone_whatsapp", phone)
          .eq("consultant_id", superAdminConsultantId)
          .order("created_at", { ascending: false })
          .limit(1);
        if (realMode) fallbackQuery = fallbackQuery.eq("is_test_lead", true);
        const { data: fallback } = await fallbackQuery.maybeSingle();
        if (fallback) {
          // Mesma regra do bloco principal: NÃO resetar leads pós-cadastro para welcome.
          customer = fallback;
        } else {
          return new Response(JSON.stringify({ error: "Failed to create customer" }), {
            status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } else {
        customer = newCustomer;
        // 🎉 Notifica o consultor (fire-and-forget)
        notifyNewLead(superAdminConsultantId, {
          id: newCustomer.id,
          name: newCustomer.name,
          phone_whatsapp: newCustomer.phone_whatsapp,
        }).catch((e) => console.warn("[notify-new-lead] falhou:", (e as Error).message));
        // Espelha para captured_leads → painel de Captação enxerga o lead.
        mirrorCustomerToCaptation(supabase, newCustomer.id)
          .catch((e) => console.warn("[mirror-customer] falhou:", (e as Error).message));
      }
    } else {
      // ─── Notificação de "novo lead" também quando o customer já existe ───
      // Dispara se: (a) não há inbound nas últimas 24h (lead voltou depois de sumir)
      // ou (b) foi acabado de reativar (automation_failed / RESUMABLE_STATUSES acima).
      // O helper tem dedup interno de 60s, evita duplicatas em rajada.
      try {
        const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
        const { count } = await supabase
          .from("conversations")
          .select("id", { count: "exact", head: true })
          .eq("customer_id", customer.id)
          .eq("message_direction", "inbound")
          .gte("created_at", since);
        if ((count ?? 0) === 0) {
          notifyNewLead(superAdminConsultantId, {
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

    // ─── Backfill: se o customer existe mas ainda não tem nome, usa o pushName do WhatsApp ─
    // Depois de clicar em "Zerar", não reaproveitamos from_name/pushName do WhatsApp.
    // Isso evita parecer que o bot "lembrou" do número durante testes do fluxo.
    const wasManuallyReset = !!(customer as any)?.chat_cleared_at || !!resetMarker;
    if (customer && !customer.name && !wasManuallyReset) {
      const pushedName = cleanPushName(fromName);
      if (pushedName) {
        await supabase.from("customers")
          .update({ name: pushedName, name_source: "whatsapp_profile" })
          .eq("id", customer.id);
        customer.name = pushedName;
        (customer as any).name_source = "whatsapp_profile";
      }
    }

    // ─── Auto-capture: extrai nome/email/CEP/valor/CPF de TODA inbound de texto ───
    // Roda independente de capture_mode, fluxo ativo (D), ou IA ligada/desligada.
    // Idempotente: `buildMultiFieldPatch` só preenche slots vazios e respeita
    // hierarquia de `name_source` (nunca sobrescreve manual/ocr/user_confirmed).
    // Nas 2 primeiras inbound (ou em step de pedir nome), promove `name_source`
    // pra `self_introduced` (mais forte que freeform_multi).
    if (messageText && !isFile && customer) {
      try {
        const _stepForName = stripPrefix((customer as any).conversation_step || "");
        const multi = extractMultiField(messageText, {
          allowSingleWordName:
            !!(customer as any).name_ask_sent_at ||
            ["ask_name", "aguardando_nome"].includes(_stepForName) ||
            /ask_name|nome/i.test(_stepForName) ||
            // Em passo de fluxo (UUID) sem nome ainda: aceita 1 palavra (Sofia a1).
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

    // ─── Partner Attribution (Detection Window: primeiras 3 mensagens) ───
    // 1º) Marcador determinístico `#R{short_code}` (inserido pelo qr-redirect).
    // 2º) Fallback: `matchKeyword` EXATO por tokens (legado). Sem fuzzy.
    // ─── Reconciliação de sinal forte do Meta ──────────────────────────────
    // Antes de qualquer decisão de rodízio, se ESTA mensagem trouxe ad_id /
    // ctwa_clid / URL com ad_id que resolve para uma campanha DIFERENTE da
    // atualmente persistida, sobrescreve. Impede que a primeira mensagem sem
    // referral prenda o lead na campanha errada (bug Jaraguá → Horácio).
    if (customer) {
      try {
        const rawMsgForReconcile: any = body?.messages?.[0] || {};
        await reconcileStrongMetaCampaign(supabase, customer, rawMsgForReconcile, body);
      } catch (e) {
        console.warn("[reconcile-strong-meta whapi] falhou:", (e as Error).message);
      }
    }

    if (customer && !(customer as any).referral_partner_id && messageText && !isFile) {
      try {
        // ─── Rodízio de leads de anúncio (round-robin) — paridade com evolution ──
        // No whapi-webhook a detecção completa de lead-source roda mais à frente
        // (~linha 1293), depois do partner-match. Para preservar a paridade com
        // o evolution (que resolve lead-source ANTES e roda o rodízio aqui),
        // fazemos a mini-resolução de campaign_id (source_campaign_id do
        // customer; senão AD ID; senão ctwa_clid) e, se houver pool ativa,
        // chamamos `rodizio_assign_lead` (atômico) + `notifyPartnerNewLead`,
        // exatamente como o evolution. Persistimos `source_campaign_id` aqui
        // para que o lead-source posterior NÃO refaça trabalho nem consuma um
        // segundo turno da fila.
        // Fail-open total: qualquer erro só loga e segue para o keyword.
        let rodizioPoolAtiva = false;
        let resolvedCampaignId: string | null = null;
        let rodizioMatchMethod: "cached_campaign" | "protocol" | "ad_id_or_ctwa_clid" | "fallback_single_active_pool" | "ddd_city_match" | "recent_strong_activity" | "fallback_rotation" = "cached_campaign";
        let metaCtwaSignal = false;
        let strongMetaSignalPresent = false;
        try {
          // 1) campaign_id já resolvido numa mensagem anterior?
          let candidateCampaignId: string | null = (customer as any).source_campaign_id || null;
          const campaignAlreadyPersisted = !!candidateCampaignId;

          // 2) Sinais fortes do Meta SEMPRE vencem protocolo/fallback.
          //    Isso impede lead do ad de Jaraguá/Francisco cair no pool Horácio.
          let currentSourceAdId: string | null = (customer as any).source_ad_id || null;
          if (!campaignAlreadyPersisted) {
            const rawMsg: any = body?.messages?.[0] || {};
            const fields = extractMetaReferralFields(rawMsg, body);
            let referral = fields.referral;
            let ctwaClid = fields.ctwaClid;
            let sourceAdId = fields.sourceAdId;
            let sourceUrl = fields.sourceUrl;
            currentSourceAdId = sourceAdId || currentSourceAdId;

            // FALLBACK RECURSIVO: varre a árvore inteira do payload procurando
            // qualquer campo CTWA aninhado que os paths acima possam ter perdido.
            if (!ctwaClid && !sourceAdId && !referral && !sourceUrl) {
              try {
                const { findReferralPaths } = await import("../_shared/ctwa-referral-probe.ts");
                const hit = findReferralPaths(body);
                if (hit.matchedPaths.length > 0) {
                  ctwaClid = ctwaClid || hit.ctwaClid;
                  sourceAdId = sourceAdId || hit.sourceAdId;
                  sourceUrl = sourceUrl || hit.sourceUrl;
                  referral = referral || hit.raw;
                }
              } catch (e) {
                console.warn("[lead-source whapi] recursive scan falhou:", (e as Error).message);
              }
            }

            strongMetaSignalPresent = !!(sourceAdId || ctwaClid || fields.fbCampaignId || sourceUrl);

            // Probe diagnóstico (fire-and-forget).
            try {
              const { logReferralProbe } = await import("../_shared/ctwa-referral-probe.ts");
              logReferralProbe(supabase, {
                source: "whapi",
                payload: body,
                messageText,
                customerId: (customer as any).id,
                consultantId: (customer as any).consultant_id,
              }).catch(() => {});
            } catch { /* ignore */ }

            try {
              const strong = await resolveCampaignFromStrongMeta(
                supabase,
                (customer as any).consultant_id,
                { referral, ctwaClid, sourceAdId, sourceUrl, fbCampaignId: fields.fbCampaignId },
              );
              if (strong) {
                candidateCampaignId = strong.campaignId;
                rodizioMatchMethod = "ad_id_or_ctwa_clid";
                currentSourceAdId = strong.sourceAdId || currentSourceAdId;
                sourceAdId = sourceAdId || strong.sourceAdId;
              }
            } catch (e) {
              console.warn("[lead-source whapi] strong-meta match falhou:", (e as Error).message);
            }

            // Persistir referral bruto quando algum sinal veio, mesmo sem match.
            if ((referral || ctwaClid || sourceAdId || sourceUrl) && (customer as any).id) {
              try {
                const patch: Record<string, any> = { lead_source: "meta_ads" };
                if (ctwaClid) patch.source_ctwa_clid = ctwaClid;
                if (sourceAdId) patch.source_ad_id = String(sourceAdId);
                patch.source_referral = {
                  source_id: sourceAdId,
                  ctwa_clid: ctwaClid,
                  source_url: sourceUrl,
                  raw: referral,
                };
                await supabase.from("customers").update(patch).eq("id", (customer as any).id);
                Object.assign(customer as any, patch);
              } catch (e) {
                console.warn("[lead-source whapi] persist referral falhou:", (e as Error).message);
              }
            }
          }

          // Blindagem absoluta: se o payload trouxe AD ID/CTWA, a campanha é
          // individual e só pode ser definida por esse sinal. Se ainda não
          // mapeamos o AD ID, NÃO pode cair em "campanha quente"/fallback.
          if (!candidateCampaignId && strongMetaSignalPresent) {
            await markManualReview(supabase, customer.id, "strong_meta_unmapped");
            await logRodizioOutcome(supabase, {
              customerId: customer.id,
              campaignId: null,
              method: "strong_meta_unmapped",
              outcome: "no_campaign_manual_review",
              messageSample: messageText,
            });
            console.warn(`[lead-attribution] customer=${customer.id} possui sinal forte Meta sem campanha mapeada — fallback bloqueado`);
          }

          // 2.1) protocolo legado OU frase exata (= initial_message) depois dos sinais fortes.
          if (!candidateCampaignId && !strongMetaSignalPresent && messageText) {
            const byProtocol = await resolveCampaignByProtocolOnly(
              supabase,
              (customer as any).consultant_id,
              messageText,
            );
            if (byProtocol) {
              candidateCampaignId = byProtocol.campaignId;
              rodizioMatchMethod = "protocol"; // bucket texto: protocol ou exact_message
            }
          }

          // 2.5) Frase-âncora do Meta CTWA — marca sinal e tenta resolver campanha:
          //      protocolo FB-xxxxx → 1 pool ativa (sole) → fuzzy Jaccard.
          //      Com 2+ pools e sem protocolo, mantém metaCtwaSignal → fila manual.
          if (!candidateCampaignId && !strongMetaSignalPresent && messageText && !isFile && !hasAudio) {
            if (matchesMetaCtwaPhrase(messageText)) {
              metaCtwaSignal = true;
              try {
                const { resolveCampaignBySinglePoolFuzzy } = await import(
                  "../_shared/single-pool-campaign-resolver.ts"
                );
                const fuzzy = await resolveCampaignBySinglePoolFuzzy(
                  supabase,
                  (customer as any).consultant_id,
                  messageText,
                );
                if (fuzzy) {
                  candidateCampaignId = fuzzy;
                  rodizioMatchMethod = "protocol";
                  console.log(
                    `[lead-attribution] customer=${customer.id} single_pool_fuzzy resolveu campaign=${fuzzy}`,
                  );
                } else {
                  // Sem protocolo/AD ID/CTWA não atribui campanha: revisão manual.
                  const { resolveCampaignAutoLadder } = await import(
                    "../_shared/single-pool-campaign-resolver.ts"
                  );
                  const ladder = await resolveCampaignAutoLadder(
                    supabase,
                    (customer as any).consultant_id,
                    { phone: (customer as any).phone_whatsapp, messageText },
                  );
                  if (ladder) {
                    candidateCampaignId = ladder.campaignId;
                    rodizioMatchMethod = ladder.method;
                    await logRodizioOutcome(supabase, {
                      customerId: customer.id,
                      campaignId: ladder.campaignId,
                      method: ladder.method,
                      outcome: "assigned",
                      messageSample: ladder.sample,
                    });
                    console.log(
                      `[lead-attribution] customer=${customer.id} ladder(${ladder.method}) resolveu campaign=${ladder.campaignId} — ${ladder.sample}`,
                    );
                  } else {
                    console.log(
                      `[lead-attribution] customer=${customer.id} meta_ctwa_phrase — sem sinal determinístico, indo para fila manual`,
                    );
                  }
                }

              } catch (e) {
                console.warn("[single-pool-fuzzy] falhou:", (e as Error).message);
              }
            }
          }

          // Persistir lead_source='meta_ads' quando a frase-âncora bate.
          if (metaCtwaSignal && !(customer as any).lead_source) {
            await supabase
              .from("customers")
              .update({ lead_source: "meta_ads" })
              .eq("id", customer.id);
            (customer as any).lead_source = "meta_ads";
          }

          // SEMPRE marca a conversa com a campanha assim que resolvida
          // (protocolo / ad_id / ctwa / fuzzy). Antes só gravava se o rodízio
          // ganhasse o CAS — leads ficavam sem source_campaign_id e sumiam
          // do dialog "Ver leads do rodízio".
          if (candidateCampaignId && currentSourceAdId) {
            const validAd = await campaignContainsAdId(
              supabase,
              candidateCampaignId,
              currentSourceAdId,
              (customer as any).consultant_id,
            );
            if (!validAd) {
              console.warn(`[rodizio] bloqueado: campaign=${candidateCampaignId} não contém ad_id=${currentSourceAdId}`);
              await markManualReview(supabase, customer.id, "campaign_ad_id_mismatch");
              await logRodizioOutcome(supabase, {
                customerId: customer.id,
                campaignId: candidateCampaignId,
                method: "campaign_ad_id_mismatch",
                outcome: "no_campaign_manual_review",
                messageSample: messageText,
              });
              candidateCampaignId = null;
            }
          }

          if (candidateCampaignId && !campaignAlreadyPersisted) {
            const bind = await bindCustomerCampaign(supabase, customer.id, candidateCampaignId);
            if (bind.outcome === "bound" || bind.outcome === "already_bound") {
              candidateCampaignId = bind.campaignId;
              (customer as any).source_campaign_id = bind.campaignId;
              (customer as any).lead_source = "meta_ads";
            } else {
              console.warn(
                `[rodizio] vínculo bloqueado outcome=${bind.outcome} requested=${candidateCampaignId} persisted=${bind.campaignId}`,
              );
              await markManualReview(supabase, customer.id, `campaign_bind_${bind.outcome}`);
              candidateCampaignId = bind.campaignId;
              if (bind.campaignId) (customer as any).source_campaign_id = bind.campaignId;
            }
          }

          // 3) há pool de rodízio ATIVA para essa campanha? (dupla trava: pool.is_active + campanha viva)
          if (candidateCampaignId) {
            if (currentSourceAdId) {
              const validAd = await campaignContainsAdId(supabase, candidateCampaignId, currentSourceAdId, (customer as any).consultant_id);
              if (!validAd) {
                console.warn(`[rodizio] pool bloqueada: campaign=${candidateCampaignId} não contém ad_id=${currentSourceAdId}`);
                await markManualReview(supabase, customer.id, "campaign_ad_id_mismatch");
                candidateCampaignId = null;
              }
            }
          }

          if (candidateCampaignId) {
            const { data: pool } = await supabase
              .from("rodizio_pools")
              .select("id, facebook_campaigns!inner(status)")
              .eq("campaign_id", candidateCampaignId)
              .eq("is_enabled", true)
              .eq("is_active", true)
              .eq("facebook_campaigns.status", "active")
              .maybeSingle();
            if ((pool as any)?.id) {
              rodizioPoolAtiva = true;
              resolvedCampaignId = candidateCampaignId;
            } else {
              console.log(`[rodizio] campanha ${candidateCampaignId} sem pool ativa (provavelmente pausada) — não vai para rodízio`);
            }
          }


          // 4) Atribuição efetiva por rodízio (RPC atômica — paridade Evolution).
          if (rodizioPoolAtiva && resolvedCampaignId) {
            try {
              const assign = await assignRodizioLead(supabase, customer.id, resolvedCampaignId);

              if (assign.outcome === "assigned" && assign.partnerId) {
                const rodizioPartnerId = assign.partnerId;
                // A RPC já vinculou a campanha de forma transacional. Aqui apenas
          // complementamos a origem quando necessário, sem regravar o vínculo.
          if (rodizioMatchMethod !== "cached_campaign") {
            await supabase.from("customers").update({ lead_source: "meta_ads" }).eq("id", customer.id);
          }
                (customer as any).referral_partner_id = rodizioPartnerId;
                if (!campaignAlreadyPersisted) {
                  (customer as any).source_campaign_id = resolvedCampaignId;
                }
                console.log(
                  `[rodizio] customer=${customer.id} campaign=${resolvedCampaignId} partner=${rodizioPartnerId} method=${rodizioMatchMethod}`,
                );

                await logRodizioOutcome(supabase, {
                  customerId: customer.id,
                  campaignId: resolvedCampaignId,
                  method: rodizioMatchMethod || "rodizio_assign_lead",
                  outcome: "assigned",
                  messageSample: messageText,
                });

                (async () => {
                  const { assignProtocolToCustomer } = await import("../_shared/protocol.ts");
                  const { data: prow } = await supabase.from("referral_partners").select("nome").eq("id", rodizioPartnerId).maybeSingle();
                  const res = await assignProtocolToCustomer(supabase, customer.id, { partnerId: rodizioPartnerId, partnerName: (prow as any)?.nome });
                  return notifyPartnerNewLead(superAdminConsultantId, rodizioPartnerId, {
                    id: customer.id,
                    name: (customer as any).name,
                    name_source: (customer as any).name_source,
                    phone_whatsapp: (customer as any).phone_whatsapp,
                    is_sandbox: (customer as any).is_sandbox,
                    tracking_protocol: res?.protocol,
                  });
                })().catch((e) => console.warn("[notify-partner-lead] falhou:", (e as Error).message));
              } else if (assign.outcome === "already_assigned") {
                if (assign.partnerId) {
                  (customer as any).referral_partner_id = assign.partnerId;
                }
                console.log(
                  `[rodizio] customer=${customer.id} já atribuído — turno não consumido`,
                );
                await logRodizioOutcome(supabase, {
                  customerId: customer.id,
                  campaignId: resolvedCampaignId,
                  method: "rodizio_assign_lead",
                  outcome: "already_assigned",
                  messageSample: messageText,
                });
              } else if (assign.outcome === "pool_empty" || assign.outcome === "customer_missing") {
                await markManualReview(supabase, customer.id, "rodizio_pool_empty");
                await logRodizioOutcome(supabase, {
                  customerId: customer.id,
                  campaignId: resolvedCampaignId,
                  method: "rodizio_assign_lead",
                  outcome: "pool_empty",
                  messageSample: messageText,
                });
                notifyOwnerManualReview(
                  superAdminConsultantId,
                  {
                    id: customer.id,
                    name: (customer as any).name,
                    name_source: (customer as any).name_source,
                    phone_whatsapp: (customer as any).phone_whatsapp,
                    is_sandbox: (customer as any).is_sandbox,
                  },
                  "rodizio_pool_empty",
                ).catch((e) => console.warn("[notify-owner-review] falhou:", (e as Error).message));
              } else {
                console.warn("[rodizio] rodizio_assign_lead falhou:", assign.errorMessage);
                await markManualReview(supabase, customer.id, "rodizio_rpc_error");
                await logRodizioOutcome(supabase, {
                  customerId: customer.id,
                  campaignId: resolvedCampaignId,
                  method: "rodizio_assign_lead",
                  outcome: "rpc_error",
                  messageSample: messageText,
                });
                notifyOwnerManualReview(
                  superAdminConsultantId,
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
          } else if (metaCtwaSignal) {
            // Frase-âncora bateu mas nenhuma campanha determinística → fila manual.
            await markManualReview(supabase, customer.id, "no_campaign_ctwa_phrase");
            await logRodizioOutcome(supabase, {
              customerId: customer.id,
              campaignId: null,
              method: "ctwa_phrase_no_campaign",
              outcome: "no_campaign_manual_review",
              messageSample: messageText,
            });
            notifyOwnerManualReview(
              superAdminConsultantId,
              {
                id: customer.id,
                name: (customer as any).name,
                name_source: (customer as any).name_source,
                phone_whatsapp: (customer as any).phone_whatsapp,
                is_sandbox: (customer as any).is_sandbox,
              },
              "no_campaign_ctwa_phrase",
            ).catch((e) => console.warn("[notify-owner-review] falhou:", (e as Error).message));
          }

        } catch (e) {
          // Fail-open: na dúvida, segue o fluxo normal de keyword.
          console.warn(
            "[partner-match][rodizio-guard] checagem de pool falhou, seguindo com keyword:",
            (e as Error).message,
          );
          rodizioPoolAtiva = false;
        }

        if (rodizioPoolAtiva) {
          console.log(
            `[partner-match] customer=${customer.id} pulando keyword: campanha de origem tem pool de rodízio ativa (prioridade do rodízio)`,
          );
        }


        const leadSourceText = JSON.stringify((customer as any).lead_source || "").toLowerCase();
        const blockKeywordForMetaLead =
          !rodizioPoolAtiva &&
          (!!(customer as any).source_campaign_id ||
            !!(customer as any).source_ad_id ||
            !!(customer as any).source_ctwa_clid ||
            !!(customer as any).ctwa_clid ||
            leadSourceText.includes("meta") ||
            matchesMetaCtwaPhrase(messageText));

        if (blockKeywordForMetaLead) {
          await markManualReview(supabase, customer.id, "meta_lead_no_campaign_or_pool");
          console.warn(`[partner-match] bloqueado para lead Meta sem rodízio customer=${customer.id}`);
        }

        const { count: inboundCount } = await supabase
          .from("conversations")
          .select("id", { count: "exact", head: true })
          .eq("customer_id", customer.id)
          .eq("message_direction", "inbound");

        const DETECTION_WINDOW = 3;
        if (!rodizioPoolAtiva && !blockKeywordForMetaLead && (inboundCount ?? 0) < DETECTION_WINDOW) {
          let matchedPartnerId: string | null = null;
          let matchedKeyword = "";
          let matchedScore = 1.0;
          let matchedSource: "short_code" | "keyword" = "keyword";

          // 1º) Marcador determinístico `#R{code}`.
          const markerCode = extractShortCodeMarker(messageText);
          if (markerCode) {
            const { data: byCode } = await supabase
              .from("referral_partners")
              .select("id, keywords")
              .eq("consultant_id", superAdminConsultantId)
              .eq("is_active", true)
              .eq("short_code", markerCode)
              .limit(1)
              .maybeSingle();
            if (byCode?.id) {
              matchedPartnerId = byCode.id as string;
              matchedKeyword = `#R${markerCode}`;
              matchedSource = "short_code";
            }
          }

          // 2º) Fallback: keyword no texto.
          if (!matchedPartnerId) {
            const { data: partners } = await supabase
              .from("referral_partners")
              .select("id, keywords")
              .eq("consultant_id", superAdminConsultantId)
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

          if (matchedPartnerId) {
            await supabase.from("customers").update({
              referral_partner_id: matchedPartnerId,
              referral_keyword_matched: matchedKeyword,
              referral_detected_at: new Date().toISOString(),
            }).eq("id", customer.id);
            (customer as any).referral_partner_id = matchedPartnerId;
            console.log(
              `[partner-match] customer=${customer.id} partner=${matchedPartnerId} source=${matchedSource} marker="${matchedKeyword}" score=${matchedScore}`,
            );
            try {
              await supabase.from("campaign_match_log").insert({
                customer_id: customer.id,
                campaign_id: null,
                method: matchedSource === "short_code" ? "short_code" : "keyword",
                similarity: matchedScore,
                message_sample: messageText ? String(messageText).slice(0, 200) : null,
              });
            } catch (e) {
              console.warn("[campaign-match-log] insert falhou:", (e as Error).message);
            }
            // Aviso EXTRA ao parceiro (se tiver notification_phone). Não bloqueia o fluxo.
            (async () => {
              const { assignProtocolToCustomer } = await import("../_shared/protocol.ts");
              const { data: prow } = await supabase.from("referral_partners").select("nome").eq("id", matchedPartnerId).maybeSingle();
              const res = await assignProtocolToCustomer(supabase, customer.id, { partnerId: matchedPartnerId, partnerName: (prow as any)?.nome });
              return notifyPartnerNewLead(superAdminConsultantId, matchedPartnerId, {
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
      } catch (e) {
        console.warn("[partner-match] falhou:", (e as Error).message);
      }
    }

    // ─── 🔄 RE-WELCOME após inatividade longa ────────────────────────────
    // Se o lead voltou após silêncio do bot por horas e mandou só "oi",
    // OU ficou >24h sem qualquer interação, resetar conversation_step para
    // que o welcome do fluxo ativo rode de novo. Isso evita o cenário do
    // lead travado num passo `capture_*` por dias mandando "oi" e o bot
    // gravando "texto salvo sem avanço" silenciosamente.
    // 🧪 No simulador (sandbox/testMode) o "Zerar" já esvazia conversations,
    // o que faria essa regra disparar a cada clique de botão (hoursSinceBot=∞)
    // e zerar o step → welcome eterno. Simulator controla reset via fresh:true.
    // 🚫 Clique de botão NUNCA dispara re-welcome — o lead já está engajado
    // no fluxo respondendo a uma pergunta interativa. Sem esse guard, qualquer
    // clique curto ("Quero simular") em chat antigo zerava conversation_step e
    // o webhook respondia de novo o passo welcome em loop.
    if (messageText && !isFile && !isButton && !buttonId && customer && (customer as any).conversation_step && !testMode && !(customer as any).is_sandbox) {
      try {
        // GUARD adicional: se o lead já está em fluxo custom (flow:<uuid>,
        // UUID puro legacy ou passo_<ts>), NÃO resetamos. Resetar nesse caso
        // fazia o engine reentrar no welcome em loop a cada inbound curto.
        const cs = String((customer as any).conversation_step || "");
        const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        const inCustomFlow = cs.startsWith("flow:") || cs.startsWith("passo_") || UUID_RE.test(cs);
        // Só bloqueia re-welcome enquanto a pesquisa está ATIVA.
        // Após abandonar (step null) ou finalizar, mensagem pode reabrir fluxo.
        const inAttendanceRating = cs === "aguardando_avaliacao_atendimento";

        // Atividade recente em transições = lead engajado, não resetar.
        const since30 = new Date(Date.now() - 30 * 60 * 1000).toISOString();
        const { count: recentTrans } = await supabase
          .from("bot_step_transitions")
          .select("id", { count: "exact", head: true })
          .eq("customer_id", customer.id)
          .gte("created_at", since30);

        const { data: lastOut } = await supabase
          .from("conversations")
          .select("created_at")
          .eq("customer_id", customer.id)
          .eq("message_direction", "outbound")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const lastOutAt = (lastOut as any)?.created_at;
        const hoursSinceBot = lastOutAt
          ? (Date.now() - new Date(lastOutAt).getTime()) / 3_600_000
          : Infinity;
        const trimmed = String(messageText || "").trim();
        const isGreeting = /^(oi+|olá+|ola+|opa+|bom dia|boa tarde|boa noite|eai|e\s*aí|hey+|hello+|hi+|alo+|começar|comecar|iniciar)\W*$/i
          .test(trimmed);
        const shortMsg = trimmed.length <= 24;
        const baseShould =
          (hoursSinceBot >= 4 && (isGreeting || shortMsg)) || hoursSinceBot >= 24;
        const shouldRewelcome = baseShould && !inCustomFlow && !inAttendanceRating && (recentTrans ?? 0) === 0;

        if (shouldRewelcome) {
          const prevStep = (customer as any).conversation_step;
          const wasManual = (customer as any).capture_mode === "manual";
          console.log(`[re-welcome] customer=${customer.id} inatividade=${hoursSinceBot === Infinity ? "∞" : hoursSinceBot.toFixed(1)}h step_anterior="${prevStep}" greeting=${isGreeting} msg="${trimmed.slice(0, 40)}" capture_mode_was=${wasManual ? "manual" : "auto"}`);

          // GUARD: não reseta capture_mode se o consultor configurou "manual"
          // intencionalmente. Resetar silenciosamente desfaz a configuração
          // do consultor sem aviso. Só reseta se já estava em "auto".
          const patch: Record<string, any> = {
            conversation_step: null,
            custom_step_retries: 0,
            custom_step_retries_step: null,
            last_custom_prompt_at: null,
            ai_followups_count: 0,
            previous_conversation_step: prevStep,
            updated_at: new Date().toISOString(),
          };
          if (!wasManual) {
            patch.capture_mode = "auto";
          }

          await supabase.from("customers").update(patch).eq("id", customer.id);
          (customer as any).conversation_step = null;
          if (!wasManual) (customer as any).capture_mode = "auto";
          (customer as any).custom_step_retries = 0;
          (customer as any).last_custom_prompt_at = null;
          (customer as any).ai_followups_count = 0;
          (customer as any).previous_conversation_step = prevStep;

          // Limpa histórico de dispatch de slots para que áudio/vídeo possam
          // ser reenviados nesta nova sessão (ignora min_interval_minutes).
          try {
            const { error: clrErr } = await supabase
              .from("ai_slot_dispatch_log")
              .delete()
              .eq("customer_id", customer.id);
            if (clrErr) console.warn("[re-welcome] limpar dispatch_log:", clrErr.message);
            else console.log(`[re-welcome] dispatch_log limpo para customer=${customer.id}`);
          } catch (e) {
            console.warn("[re-welcome] dispatch_log cleanup falhou:", (e as Error).message);
          }
        }
      } catch (e) {
        console.warn("[re-welcome] falhou:", (e as Error).message);
      }
    }



    // IA em modo manual (globalAiDisabled=true) NÃO pode bloquear o pipeline
    // de cadastro: nome, email, CPF, CEP, conta de luz, documento, finalização
    // no portal e OTP. Se o lead está em um passo ativo desses, o bot responde
    // normalmente (igual ao fluxo da Camila), porque foi o consultor que clicou
    // em "Devolver para o passo" e ativou o pipeline manualmente.
    const ACTIVE_CAPTURE_STEPS = new Set<string>([
      "ask_name", "ask_email", "ask_cpf", "ask_rg", "ask_cep",
      "ask_number", "ask_complement", "ask_bill_value",
      "ask_phone_confirm", "aguardando_conta", "confirmando_dados_conta",
      "aguardando_doc_auto", "aguardando_doc_frente", "aguardando_doc_verso",
      "ask_doc_frente_manual", "ask_doc_verso_manual",
      "ask_tipo_documento", "confirmando_dados_doc", "confirmar_titularidade",
      "ask_finalizar", "finalizando", "portal_submitting",
      "aguardando_otp", "validando_otp",
    ]);
    const currentStep = String((customer as any)?.conversation_step || "");
    const UUID_RX_LOCAL = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const isCustomFlowStep = UUID_RX_LOCAL.test(currentStep) || currentStep.startsWith("passo_");
    const isCaptureModeManual = (customer as any)?.capture_mode === "manual";
    const inActiveCapture = ACTIVE_CAPTURE_STEPS.has(currentStep) || (isCaptureModeManual && isCustomFlowStep);

    // ─── ⭐ Avaliação de atendimento profissional (1–5) ─────────────────
    // Intercepta ANTES de global-off / bot-paused / bot-flow / OCR.
    // Cobre texto, botão E mídia (PDF/foto) — mídia NUNCA trava o lead.
    if (customer && (messageText || buttonId || isFile || hasAudio || hasDocument || hasImage)) {
      const { tryInterceptAttendanceRating, isAwaitingAttendanceRating } = await import(
        "../_shared/attendance-flow.ts"
      );
      if (isAwaitingAttendanceRating(customer as any)) {
        const mediaKind = hasDocument ? "document"
          : hasImage ? "image"
          : hasAudio ? "audio"
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
          mediaKind,
          sendText: async (jid, text) => {
            try { return !!(await sender.sendText(jid, text)); } catch { return false; }
          },
        });
        if (ratingHit.abandoned) {
          // Msg qualquer (não-nota) — pesquisa encerrada, conversa reaberta.
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

    // Override por lead: customer.bot_force_enabled=true ignora IA global off.
    // Setado pelo botão "Zerar" (via trigger apply_force_bot_on_customer_insert
    // + tabela force_bot_phones) e pelo toggle individual no chat.
    const forceBotForLead = (customer as any)?.bot_force_enabled === true;

    if (globalAiDisabled === true && !isFile && !inActiveCapture && !forceBotForLead) {
      const meta = inboundConvMeta();
      await supabase.from("conversations").insert({
        customer_id: customer.id,
        message_direction: "inbound",
        message_text: meta.message_text || (hasAudio ? "[áudio]" : "[arquivo]"),
        message_type: meta.message_type,
        media_id: meta.media_id,
        conversation_step: customer.conversation_step,
        external_message_id: messageId || null,
      });
      console.log(`🛑 [global-off-silent] IA manual — inbound texto/áudio salvo sem resposta customer=${customer.id} step="${currentStep}"`);
      {
        const notifyTo = (customer as any).assigned_human_id || (customer as any).consultant_id || superAdminConsultantId;
        if (notifyTo) {
          const preview = messageText || (hasAudio ? "[áudio]" : "[mensagem]");
          const { notifyInboundWhileBotOff } = await import("../_shared/notify-consultant.ts");
          notifyInboundWhileBotOff(notifyTo, customer as any, preview, {
            kind: hasAudio ? "audio" : "text",
            reason: "IA do consultor desligada",
          }).catch((e) => console.warn("[notify-bot-off] falhou:", (e as Error).message));
        }
      }
      return new Response(JSON.stringify({ ok: true, msg: "global_ai_disabled_inbound_saved" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Kill switch global OFF: grava inbound, avisa consultor, não responde.
    if (!botGlobalOutboundEnabled && !forceBotForLead) {
      const meta = inboundConvMeta();
      await supabase.from("conversations").insert({
        customer_id: customer.id,
        message_direction: "inbound",
        message_text: meta.message_text,
        message_type: meta.message_type,
        media_id: meta.media_id,
        conversation_step: customer.conversation_step,
        external_message_id: messageId || null,
      });
      const notifyTo = (customer as any).assigned_human_id || (customer as any).consultant_id || superAdminConsultantId;
      if (notifyTo) {
        const kind = hasVideo ? "image" : hasImage ? "image" : hasAudio ? "audio" : hasDocument ? "document" : "text";
        const preview = messageText
          || (hasVideo ? "[vídeo]" : kind === "image" ? "[imagem]" : kind === "audio" ? "[áudio]" : kind === "document" ? "[documento]" : "[mensagem]");
        const { notifyInboundWhileBotOff } = await import("../_shared/notify-consultant.ts");
        notifyInboundWhileBotOff(notifyTo, customer as any, preview, {
          kind: kind as any,
          reason: "Kill switch global (bot_global_enabled=false)",
        }).catch((e) => console.warn("[notify-bot-off] falhou:", (e as Error).message));
      }
      return new Response(JSON.stringify({ ok: true, msg: "bot_globally_disabled_inbound_saved" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (globalAiDisabled === true && forceBotForLead) {
      console.log(`✅ [force-bot-active] IA global off, mas customer=${customer.id} tem bot_force_enabled=true → bot responde`);
    }

    // silentMode = arquivo recebido com IA manual MAS fora de qualquer passo
    // ativo de captura. Roda OCR/upload em background sem outbound. Dentro de
    // passo ativo, o bot envia tudo normalmente para guiar o cliente.
    const silentMode = globalAiDisabled === true && isFile && !inActiveCapture && !forceBotForLead;
    if (silentMode) {
      console.log(`🤫 [silent-capture] IA manual + arquivo fora de passo ativo → OCR/upload sem outbound customer=${customer.id}`);
    } else if (globalAiDisabled === true && inActiveCapture) {
      console.log(`✅ [manual-capture-active] IA manual mas lead em passo ativo "${currentStep}" → bot responde normalmente customer=${customer.id}`);
    }

    // ─── 🔇 BOT PAUSADO (handoff humano ativo) ────────────────────────
    // Respeita bot_paused, assigned_human_id E bot_paused_until via helper único.
    if (isCustomerPausedByHuman(customer as any)) {
      // Auto-unpause em falso positivo do bot-stuck-recovery: se a pausa veio
      // do cron automático ("lead_travado_recovery_*") e o lead acabou de
      // mandar mensagem (ou apertar botão), ele claramente NÃO está travado.
      // Despausamos e seguimos o fluxo normalmente — senão flow D/quick replies
      // ficam mudos.
      const _autoReason = String((customer as any).bot_paused_reason || "").toLowerCase();
      // Só auto-despausa recovery automático (lead travado). Takeover humano
      // (portal ou WhatsApp app) NUNCA despausa sozinho — consultor precisa religar.
      const _isAutoStuckPause = _autoReason.startsWith("lead_travado_recovery")
        && !(customer as any).assigned_human_id;
      if (_isAutoStuckPause) {
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
          console.error("⚠️ falha ao auto-despausar:", unpErr);
        } else {
          console.log(`▶️ Auto-despausado ${phone} (reason=${_autoReason}, lead respondeu) — bot volta`);
          (customer as any).bot_paused = false;
          (customer as any).bot_paused_reason = null;
          (customer as any).bot_paused_until = null;
        }
      } else {
        await supabase.from("conversations").insert({
          customer_id: customer.id,
          message_direction: "inbound",
          ...inboundConvMeta(),
          conversation_step: customer.conversation_step,
          external_message_id: messageId || null,
        });
        const _pausedUntil = (customer as any).bot_paused_until && new Date((customer as any).bot_paused_until) > new Date();
        const _reason = (customer as any).bot_paused_reason || ((customer as any).assigned_human_id ? "humano_assumiu" : (_pausedUntil ? "paused_until" : "manual"));
        console.log(`🔇 Bot pausado para ${phone} (flag=${(customer as any).bot_paused === true}, human=${(customer as any).assigned_human_id || "—"}, until=${(customer as any).bot_paused_until || "—"}, reason=${_reason}) — ignorando msg`);

        // Cliente respondeu durante o atendimento humano: avisa o consultor.
        // Fire-and-forget (dedup interno). Cobre texto, imagem, áudio e documento.
        {
          const notifyTo = (customer as any).assigned_human_id || (customer as any).consultant_id;
          if (notifyTo) {
            const kind = hasVideo ? "image" : hasImage ? "image"
              : hasAudio ? "audio"
              : hasDocument ? "document"
              : "text";
            const preview = messageText
              || (hasVideo ? "[vídeo]" : kind === "image" ? "[imagem]"
                : kind === "audio" ? "[áudio]"
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
        }
        return new Response(JSON.stringify({ ok: true, msg: "bot_paused", reason: _reason, paused_until: (customer as any).bot_paused_until || null }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // ─── ✅ Captação manual: cliente respondendo confirmação de dados ────
    // Em modo manual/game, "SIM" em conta/documento só confirma a ficha e PARA.
    // Não deixa o bot-flow avançar sozinho para o próximo tile.
    try {
      if (messageText && (customer as any).capture_mode === "manual") {
        const { data: confState } = await supabase
          .from("customers")
          .select("bill_data_confirmation_by, bill_data_confirmed_at, doc_data_confirmation_by, doc_data_confirmed_at")
          .eq("id", customer.id).maybeSingle();
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
            await supabase.from("conversations").insert({
              customer_id: customer.id, message_direction: "inbound",
              message_text: messageText, message_type: "text",
              conversation_step: customer.conversation_step,
            });
            const reply = "✅ Dados confirmados.";
            try { await sender.sendText(remoteJid, reply); } catch (_e) { /* ignore */ }
            await supabase.from("conversations").insert({
              customer_id: customer.id, message_direction: "outbound",
              message_text: reply, message_type: "text",
              conversation_step: customer.conversation_step,
            });
            console.log(`[capture-confirm] customer=${customer.id} confirmou: bill=${awaitingBill || confirmingBill} doc=${awaitingDoc || confirmingDoc} manual_stop=true`);
            return new Response(JSON.stringify({ ok: true, msg: "capture_confirmed_manual_stop", bill: awaitingBill || confirmingBill, doc: awaitingDoc || confirmingDoc }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          if (isNo) {
            // Reset flag pra consultor agir manualmente
            const patch: Record<string, any> = {};
            if (awaitingBill) patch.bill_data_confirmation_by = null;
            if (awaitingDoc) patch.doc_data_confirmation_by = null;
            await supabase.from("customers").update(patch).eq("id", customer.id);
            // Não envia reply aqui — deixa o fluxo/consultor decidir o que fazer com a correção.
            console.log(`[capture-confirm] customer=${customer.id} disse NÃO/correção — flags resetadas`);
          }
        }
      }
    } catch (e) {
      console.warn("[capture-confirm] err:", (e as Error).message);
    }


    // ─── 🆘 HANDOFF: cliente pediu pra falar com humano ────────────────
    if (messageText && detectHandoffIntent(messageText)) {
      const pausedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      await supabase.from("customers").update({
        bot_paused_until: pausedUntil,
        bot_paused_reason: "handoff_request",
      }).eq("id", customer.id);
      await supabase.from("bot_handoff_alerts").insert({
        customer_id: customer.id,
        consultant_id: superAdminConsultantId,
        phone,
        reason: "client_requested_human",
        user_message: messageText.slice(0, 500),
      });
      // Log inbound
      await supabase.from("conversations").insert({
        customer_id: customer.id,
        message_direction: "inbound",
        message_text: messageText,
        message_type: "text",
        conversation_step: customer.conversation_step,
      });
      const handoffReply = `Tudo bem! 🙏 Vou te transferir agora para ${nomeRepresentante}. Em alguns instantes alguém vai responder por aqui.`;
      try { await sender.sendText(remoteJid, handoffReply); } catch (e: any) { console.error("erro handoff reply:", e); }
      await supabase.from("conversations").insert({
        customer_id: customer.id,
        message_direction: "outbound",
        message_text: handoffReply,
        message_type: "text",
        conversation_step: customer.conversation_step,
      });
      console.log(`🆘 Handoff ativado para ${phone} (${customer.id})`);
      return new Response(JSON.stringify({ ok: true, msg: "handoff_triggered", paused_until: pausedUntil }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── Log inbound (audio: marcamos como [áudio] e atualizamos depois com a transcrição) ──
    const inboundMeta = inboundConvMeta();
    const { data: inboundLog } = await supabase.from("conversations").insert({
      customer_id: customer.id,
      message_direction: "inbound",
      message_text: inboundMeta.message_text,
      message_type: inboundMeta.message_type,
      media_id: inboundMeta.media_id,
      conversation_step: customer.conversation_step,
      external_message_id: messageId || null,
    }).select("id").maybeSingle();

    // Stop rule: resposta HUMANA pausa/realinha a cadência (sem envio).
    // Clique CTWA / initial_message da campanha NÃO pausa 72h.
    try {
      const { onLeadInboundResponse, ensureCadenceState } = await import(
        "../_shared/cadence-hooks.ts"
      );
      await onLeadInboundResponse(supabase, customer.id, { messageText });
      await ensureCadenceState(
        supabase,
        customer.id,
        (customer as { consultant_id?: string | null }).consultant_id ?? null,
      );
    } catch (hookErr) {
      console.warn("[cadence-hooks] inbound sync failed:", (hookErr as Error).message);
    }

    // ─── Modo Captação (manual): dispara IA p/ sugerir campos em background ──
    try {
      if ((customer as any).capture_mode === "manual" && !hasAudio && !isFile && !isButton && messageText) {
        const fnUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/capture-extract`;
        // fire-and-forget
        fetch(fnUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          },
          body: JSON.stringify({ customer_id: customer.id, source_message_id: inboundLog?.id || null }),
        }).catch((e) => console.warn("[capture-extract] dispatch fail:", (e as Error).message));
      }
    } catch (e) {
      console.warn("[capture-extract] dispatch err:", (e as Error).message);
    }

    // ─── Modo Captação manual: salvar resposta na ficha e PARAR ─────────
    // O consultor controla o próximo tile. Texto livre do lead não deve rodar
    // o motor conversacional nem avançar automaticamente para o próximo passo.
    //
    // EXCEÇÃO: quando engine v3 está ativo para o consultor, o v3 toma
    // posse do turno e o helper `runUnifiedEngineWebhookEntry` zera o
    // `capture_mode` para "auto" antes de chamar o engine. Por isso
    // aqui pulamos o short-circuit quando a flag está ON — o ramo v3
    // mais adiante neste mesmo handler vai responder.
    let _v3Active = false;
    try {
      const { isEngineV3Enabled: _isV3 } = await import("../_shared/engine/router.ts");
      _v3Active = await _isV3(supabase as any, superAdminConsultantId);
    } catch (_) {/* swallow */}
    if (!_v3Active && (customer as any).capture_mode === "manual" && !hasAudio && !isFile && !isButton && messageText) {
      // Fluxos A/B/C/D com bot_flow_steps ativos são 100% automáticos —
      // nunca aplicar o short-circuit "manual_capture_text_saved_no_auto_flow"
      // pra leads em variant cuja consultor tem flow desenhado. Isso quebra
      // a transição entre passos (ex.: cliente manda "oi" e o welcome do
      // FlowBuilder não dispara porque capture_mode='manual' herdado do
      // trigger customers_default_capture_mode).
      //
      // Trigger SQL marca capture_mode='manual' para qualquer lead novo
      // sem name+cpf. Bypass de variant D não cobria A/B/C — leads desses
      // ficavam mudos respondendo "manual_capture_text_saved_no_auto_flow"
      // até o consultor intervir manualmente. Bug confirmado em produção:
      // 133 leads (132 A + 1 C) afetados nos últimos 30 dias.
      const _flowVariant = String((customer as any)?.flow_variant || "").toUpperCase();
      let _hasActiveFlow = false;
      if (_flowVariant !== "D" && _flowVariant !== "M") {
        // D já é bypass por padrão; checa se A/B/C têm bot_flow ativo do consultor.
        try {
          const { count } = await supabase
            .from("bot_flows")
            .select("id", { count: "exact", head: true })
            .eq("consultant_id", superAdminConsultantId)
            .eq("is_active", true)
            .eq("variant", _flowVariant || "A");
          _hasActiveFlow = (count ?? 0) > 0;
        } catch (_) { /* fail-open: assume sem flow → mantém bypass desligado */ }
      }
      if (_flowVariant === "D" || _flowVariant === "M" || _hasActiveFlow) {
        console.log(`[manual-capture-stop] BYPASS — customer=${customer.id} flow_variant=${_flowVariant} hasActiveFlow=${_hasActiveFlow}`);
      } else {
      try {
        const multi = extractMultiField(messageText, { allowSingleWordName: !!(customer as any).name_ask_sent_at });
        const patch = buildMultiFieldPatch(customer as any, multi);
        if (Object.keys(patch).length > 0) {
          await supabase.from("customers").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", customer.id);
          Object.assign(customer as any, patch);
          console.log(`[manual-capture-stop] customer=${customer.id} campos_salvos=${Object.keys(patch).join(",")} step="${(customer as any).conversation_step || ""}"`);
        } else {
          console.log(`[manual-capture-stop] customer=${customer.id} texto salvo sem avanço step="${(customer as any).conversation_step || ""}"`);
        }
      } catch (e) {
        console.warn("[manual-capture-stop] extração falhou:", (e as Error).message);
      }
      return new Response(JSON.stringify({ ok: true, msg: "manual_capture_text_saved_no_auto_flow" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
      }
    }




    // ─── Auto-tag lead source (Meta Ads) ─────────────────────────────────
    // Ordem de prioridade (mais precisa → mais fraca), conforme doc oficial Meta:
    //   1. source_id (AD ID do clique) → casa com facebook_campaigns.fb_ad_ids (determinístico)
    //   2. ctwa_clid → ctwa_clid_mapping (populado na criação da campanha)
    //   3. regex/frase CTWA → marca origem Meta, mas NÃO escolhe campanha.
    // Só roda quando source_campaign_id ainda não está preenchido.
    try {
      const alreadyTagged = !!(customer as any).source_campaign_id || !!(customer as any).lead_source;
      if (!alreadyTagged) {
        const rawMsg: any = body?.messages?.[0] || {};
        const fields = extractMetaReferralFields(rawMsg, body);
        const referral = fields.referral;
        const ctwaClid = fields.ctwaClid;
        // source_id = AD ID que originou o clique (doc oficial Meta: referral.source_id).
        const sourceAdId = fields.sourceAdId;
        const sourceUrl = fields.sourceUrl;
        const sourceType = (referral as any)?.source_type || (referral as any)?.sourceType || null;
        const hasReferral = !!(referral || ctwaClid || sourceAdId || sourceUrl);
        const strongMetaSignalPresent = !!(sourceAdId || ctwaClid || fields.fbCampaignId || sourceUrl);

        const referralPayload = referral
          ? { ...referral, source_id: sourceAdId, source_type: sourceType, ctwa_clid: ctwaClid }
          : ctwaClid
          ? { ctwa_clid: ctwaClid }
          : null;

        let sourceCampaignId: string | null = null;
        let matchMethod: "protocol" | "ad_id" | "ad_id_in_url" | "fb_campaign_id" | "ctwa_clid" | "exact_message" | "unmatched" = "unmatched";

        // 0) Match forte Meta primeiro: AD ID / URL com AD ID / FB Campaign / CTWA.
        const strong = await resolveCampaignFromStrongMeta(
          supabase,
          (customer as any).consultant_id,
          fields,
        );
        if (strong) {
          sourceCampaignId = strong.campaignId;
          matchMethod = strong.method;
        }

        // 1) Protocolo legado OU frase exata (= initial_message no banco).
        if (!sourceCampaignId && !strongMetaSignalPresent && messageText) {
          const byProtocol = await resolveCampaignByProtocolOnly(
            supabase,
            (customer as any).consultant_id,
            messageText,
          );
          if (byProtocol) {
            sourceCampaignId = byProtocol.campaignId;
            matchMethod = byProtocol.method;
          }
        }

        // 4) Regex fallback para frases típicas de anúncio (último recurso)
        const adsRegex = /(tenho interesse.*mais informa[çc][õo]es|gostaria de saber mais|quero saber mais|vi seu an[uú]ncio|vim do an[uú]ncio|do an[uú]ncio|pelo an[uú]ncio|vi o an[uú]ncio|facebook|instagram|\bfb ads?\b|\bmeta ads?\b|patrocinad|reels|stories|sponsored)/i;
        const textMatch = !hasAudio && !isFile && messageText && adsRegex.test(messageText);

        // UTM capture do QR code (formato: ?utm_source=qr&utm_campaign=feira-sp)
        let utmDetail: Record<string, string> | null = null;
        if (messageText) {
          const utmMatches = messageText.match(/utm_(?:source|campaign|medium|content|term)=([^\s&]+)/gi);
          if (utmMatches) {
            utmDetail = {};
            for (const m of utmMatches) {
              const [k, v] = m.split("=");
              utmDetail[k.toLowerCase()] = decodeURIComponent(v || "");
            }
          }
        }

        if (sourceCampaignId && sourceAdId) {
          const validAd = await campaignContainsAdId(
            supabase,
            sourceCampaignId,
            sourceAdId,
            (customer as any).consultant_id,
          );
          if (!validAd) {
            console.warn(`[lead-source] bloqueado: campaign=${sourceCampaignId} não contém ad_id=${sourceAdId}`);
            await markManualReview(supabase, customer.id, "campaign_ad_id_mismatch");
            sourceCampaignId = null;
            matchMethod = "unmatched";
          }
        }

        if (!sourceCampaignId && strongMetaSignalPresent) {
          await markManualReview(supabase, customer.id, "strong_meta_unmapped");
          await logRodizioOutcome(supabase, {
            customerId: customer.id,
            campaignId: null,
            method: "strong_meta_unmapped",
            outcome: "no_campaign_manual_review",
            messageSample: messageText,
          });
          console.warn(`[lead-source] customer ${customer.id} possui sinal forte Meta sem campanha mapeada — fallback bloqueado`);
        }

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

        if (hasReferral || textMatch || sourceCampaignId || utmDetail || ctwaClid) {
          const patch: Record<string, any> = {};
          if (hasReferral || ctwaClid || sourceCampaignId || textMatch) {
            patch.lead_source = "meta_ads";
          } else if (utmDetail?.utm_source === "qr") {
            patch.lead_source = "qr_code";
          } else if (utmDetail) {
            patch.lead_source = utmDetail.utm_source || "utm";
          }
          if (ctwaClid) patch.ctwa_clid = ctwaClid;
          if (sourceAdId) patch.source_ad_id = String(sourceAdId);
          const detail: Record<string, any> = {};
          if (referralPayload) detail.referral = referralPayload;
          if (utmDetail) Object.assign(detail, utmDetail);
          if (Object.keys(detail).length > 0) patch.lead_source_detail = detail;

          const { error: tagErr } = await supabase.from("customers").update(patch).eq("id", customer.id);
          if (tagErr) {
            console.warn(`[lead-source] update falhou: ${tagErr.message}`);
          } else {
            Object.assign(customer, patch);
            // Popula ctwa_clid_mapping (clid → campanha) quando temos os dois.
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
            const reason = sourceCampaignId ? `campaign_match id=${sourceCampaignId} method=${matchMethod}`
              : ctwaClid ? `ctwa=${ctwaClid}`
              : hasReferral ? `referral ad_id=${sourceAdId}`
              : utmDetail ? `utm=${JSON.stringify(utmDetail)}`
              : `regex msg="${(messageText || "").slice(0, 80)}"`;
            console.log(`[lead-source] customer ${customer.id} tagged ${patch.lead_source} (${reason})`);
            // Re-espelha para promover canal 'manual' → 'ctwa' no painel.
            mirrorCustomerToCaptation(supabase, customer.id)
              .catch((e) => console.warn("[mirror-customer:tag] falhou:", (e as Error).message));
          }
        }
      }
    } catch (e) {
      console.warn("[lead-source] falha ao detectar:", (e as Error).message);
    }
    // ─── Download media ────────────────────────────────────────────────
    let fileUrl: string | null = whapiFileUrl || null;
    let fileBase64: string | null = whapiFileBase64 || null;
    // URL durável p/ Captação ("Do chat") — preferir http original; data: só se não houver link.
    const durableInboundMediaUrl =
      (whapiFileUrl && String(whapiFileUrl).startsWith("http")) ? String(whapiFileUrl) : null;

    // Se Whapi enviou link mas não base64, baixar
    if (isFile && !fileBase64 && fileUrl && fileUrl.startsWith("http")) {
      try {
        console.log(`📥 Baixando mídia Whapi: ${fileUrl.substring(0, 80)}`);
        // Header Authorization só pra URLs Whapi (gate.whapi.cloud).
        // URLs externas (Supabase storage, simulator-uploads) rejeitam esse
        // bearer e o download falha silenciosamente, deixando fileBase64=null
        // e o handler de OCR cai em "evolution-media:pending" → step trava.
        const fetchHeaders: Record<string, string> = {};
        const isWhapiUrl = /(?:^|\/\/)(?:[a-z0-9.-]+\.)?whapi\.cloud\b/i.test(fileUrl);
        if (isWhapiUrl) {
          fetchHeaders["Authorization"] = `Bearer ${whapiToken}`;
        }
        const mediaRes = await fetch(fileUrl, { headers: fetchHeaders });
        if (mediaRes.ok) {
          const buf = await mediaRes.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let binary = "";
          const chunkSize = 8192;
          for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, i + chunkSize);
            for (let j = 0; j < chunk.length; j++) binary += String.fromCharCode(chunk[j]);
          }
          fileBase64 = btoa(binary);
          const mime = audioMessage?.mimetype || imageMessage?.mimetype || documentMessage?.mimetype || videoMessage?.mimetype || "application/octet-stream";
          fileUrl = `data:${mime};base64,${fileBase64}`;
          console.log(`✅ Mídia Whapi baixada (${mime}, b64 len: ${fileBase64.length})`);
        } else {
          console.warn(`⚠️ Mídia download falhou: ${mediaRes.status} (whapi=${isWhapiUrl})`);
        }
      } catch (e: any) {
        console.warn(`⚠️ Erro ao baixar mídia Whapi: ${e?.message}`);
      }
    }

    // ─── Persistir SEMPRE a última mídia recebida (mesmo IA manual / silentMode) ──
    // Preferir URL http (Whapi CDN) — evita gravar data: gigante em customers.
    if (isFile && customer?.id && (durableInboundMediaUrl || fileUrl || fileBase64)) {
      try {
        const _mime = imageMessage?.mimetype || documentMessage?.mimetype || videoMessage?.mimetype || audioMessage?.mimetype || null;
        const _kind = hasDocument ? "document" : (hasVideo ? "video" : (hasImage ? "image" : (hasAudio ? "audio" : "other")));
        const persistUrl = durableInboundMediaUrl
          || (fileUrl && String(fileUrl).startsWith("http") ? fileUrl : null)
          || (fileUrl && String(fileUrl).startsWith("data:") ? fileUrl : null);
        await supabase.from("customers").update({
          last_inbound_media_url: persistUrl,
          last_inbound_media_mime: _mime,
          last_inbound_media_kind: _kind,
          last_inbound_media_message_id: messageId || null,
          last_inbound_media_at: new Date().toISOString(),
        }).eq("id", customer.id);
      } catch (e: any) {
        console.warn(`⚠️ Falha ao persistir last_inbound_media: ${e?.message}`);
      }
    }

    // ─── Áudio do cliente → transcreve com Gemini e trata como texto ──────
    if (hasAudio && testMode) {
      // 🧪 modo teste: usa transcript embutido no payload
      const t = (audioMessage as any)?.transcript || (parsed.message as any)?.audio?.transcript || "";
      if (t) { messageText = String(t); isFile = false; }
    } else if (hasAudio && fileBase64 && !(await (async () => {
      // Flag global do Superadmin: quando desligada, NÃO transcreve.
      try {
        const { getGlobalAiSettings } = await import("../_shared/ai-config.ts");
        const g = await getGlobalAiSettings(supabase);
        return g.audioTranscribe === false;
      } catch (_) { return false; }
    })())) {
      try {
        const mt = audioMessage?.mimetype || "audio/ogg";
        console.log(`🎙️ [whapi] Transcrevendo áudio do cliente (${mt}, ${fileBase64.length} b64 chars)...`);
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
        const transcript = (tj?.transcript || "").trim();
        if (transcript) {
          console.log(`✅ [whapi] Transcrição (${transcript.length} chars): "${transcript.substring(0, 120)}"`);
          messageText = transcript;
          isFile = false;
          if (inboundLog?.id) {
            await supabase.from("conversations").update({
              message_text: `[áudio] ${transcript}`,
              message_type: "audio",
            }).eq("id", inboundLog.id);
          }
        } else {
          console.warn(`⚠️ [whapi] Transcrição vazia — status=${transRes.status} body=${JSON.stringify(tj).substring(0, 300)}`);
          try {
            const { AUDIO_STT_SOFT_FALLBACK } = await import("../_shared/audio-stt-fallback.ts");
            await sender.sendText(remoteJid, AUDIO_STT_SOFT_FALLBACK);
          } catch {}
          return new Response(JSON.stringify({ ok: true, msg: "audio_empty_transcript" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } catch (e: any) {
        console.error(`❌ [whapi] Erro ao transcrever áudio:`, e?.message);
        try {
          const { AUDIO_STT_SOFT_FALLBACK } = await import("../_shared/audio-stt-fallback.ts");
          await sender.sendText(remoteJid, AUDIO_STT_SOFT_FALLBACK);
        } catch {}
        return new Response(JSON.stringify({ ok: true, msg: "audio_transcribe_failed" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (!_v3Active && (customer as any).capture_mode === "manual" && hasAudio && messageText && !isFile) {
      // Mesmo bypass do bloco de texto: A/B/C/D com flow ativo do consultor
      // são automáticos — não cair no short-circuit que silencia o bot.
      const _flowVariantA = String((customer as any)?.flow_variant || "").toUpperCase();
      let _hasActiveFlowA = false;
      if (_flowVariantA !== "D" && _flowVariantA !== "M") {
        try {
          const { count } = await supabase
            .from("bot_flows")
            .select("id", { count: "exact", head: true })
            .eq("consultant_id", superAdminConsultantId)
            .eq("is_active", true)
            .eq("variant", _flowVariantA || "A");
          _hasActiveFlowA = (count ?? 0) > 0;
        } catch (_) { /* fail-open */ }
      }
      if (_flowVariantA === "D" || _flowVariantA === "M" || _hasActiveFlowA) {
        console.log(`[manual-capture-stop-audio] BYPASS — customer=${customer.id} flow_variant=${_flowVariantA} hasActiveFlow=${_hasActiveFlowA}`);
      } else {
      try {
        const multi = extractMultiField(messageText, { allowSingleWordName: !!(customer as any).name_ask_sent_at });
        const patch = buildMultiFieldPatch(customer as any, multi);
        if (Object.keys(patch).length > 0) {
          await supabase.from("customers").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", customer.id);
          console.log(`[manual-capture-stop-audio] customer=${customer.id} campos_salvos=${Object.keys(patch).join(",")} step="${(customer as any).conversation_step || ""}"`);
        }
      } catch (e) {
        console.warn("[manual-capture-stop-audio] extração falhou:", (e as Error).message);
      }
      return new Response(JSON.stringify({ ok: true, msg: "manual_capture_audio_saved_no_auto_flow" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
      }
    }

    // ─── Run bot flow ──────────────────────────────────────────────────
    // ─── 🔒 Lock per-customer: evita webhooks paralelos enviando msgs duplicadas
    // quando o lead manda 2+ mensagens em rajada. O fluxo pode enviar áudio/vídeo/
    // imagem + texto e passar de 25s; por isso a trava precisa durar mais que a
    // cascata inteira, senão uma segunda invocação entra no meio e repete o step.
    //
    // 🧪 Em modo teste/sandbox a cascata é instantânea (mocks ligados, delays
    // zerados) e cada turno é serializado pelo simulador. Pulamos o lock pra
    // não esperar 25s entre turnos quando o anterior ainda está finalizando.
    let lockAcquired = false;
    if (testMode) {
      lockAcquired = true; // skip lock em sandbox
    } else {
      for (let attempt = 0; attempt < 50; attempt++) {
        const { data: ok } = await supabase.rpc("try_lock_customer_processing", {
          _customer_id: customer.id,
          _seconds: 120,
        });
        if (ok === true) { lockAcquired = true; break; }
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    if (!lockAcquired) {
      // Em vez de descartar silenciosamente, enfileira a mensagem pra a 1ª
      // invocação reprocessar quando liberar o lock. Garante zero perda.
      try {
        await supabase.rpc("enqueue_pending_inbound", {
          _customer_id: customer.id,
          _message_id: messageId || `noid-${Date.now()}`,
        });
        console.warn(`📥 [whapi] customer=${customer.id} busy — enfileirado pending_inbound`);
      } catch (e) {
        console.error("[whapi] enqueue_pending_inbound falhou:", (e as Error)?.message);
      }
      return new Response(JSON.stringify({ ok: true, skipped: "busy_enqueued" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Re-fetch customer pra pegar updates feitos pela invocação anterior (ex: novo conversation_step)
    try {
      const { data: fresh } = await supabase.from("customers").select("*").eq("id", customer.id).maybeSingle();
      if (fresh) customer = fresh;
    } catch (_) { /* mantém customer atual */ }

    // Roteamento por prefixo: "flow:<id>" → conversational; nome cru → bot-flow determinístico.
    // Compat reversa: UUIDs/"passo_xxx" sem prefixo são tratados como flow.
    let rawStep = customer.conversation_step || null;
    let stepBefore = stripPrefix(rawStep); // valor cru consumido pelos engines
    // UUID/passo_xxx do DB no início do turno — imutável; protege contra step-mismatch
    // ou router que zeram conversation_step em memória mas routeEngine ainda viu flow.
    const originalFlowStep =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(stepBefore)
      || stepBefore.startsWith("passo_")
        ? stepBefore
        : null;

    // Sincroniza o customer em memória com o valor cru — engines mantêm sua lógica intacta.
    (customer as any).conversation_step = stepBefore;

    // ─── GUARD DE RETOMADA DE CADASTRO (espelho do evolution-webhook) ────
    // Bug 2026-06-28 (lead JONATAS): qualquer reset para welcome/null fazia
    // o bot pedir a foto da conta de novo mesmo com tudo já preenchido. Se
    // o customer já está avançado no funil, pula direto pro próximo campo
    // pendente em vez de reiniciar o fluxo.
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
            consultant_id: superAdminConsultantId,
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

    let reply: string | null = "";
    let updates: Record<string, any> = {};
    let engineUsed: "sys" | "flow" = "sys";

    const applyTurnResult = async (
      turnReply: string | null,
      turnUpdates: Record<string, any>,
      turnStepBefore: string,
    ) => {
      let localReply = turnReply;
      let localUpdates = { ...turnUpdates };

      if (localUpdates.conversation_step) {
        const prefixed = normalizeOutgoing(String(localUpdates.conversation_step), engineUsed);
        if (prefixed) localUpdates.conversation_step = prefixed;
      }

      if (Object.keys(localUpdates).length > 0 || localReply) {
        (localUpdates as any).last_bot_reply_at = new Date().toISOString();
        (localUpdates as any).last_bot_interaction_at = new Date().toISOString();
        if ((customer as any).followup_count > 0) (localUpdates as any).followup_count = 0;
      }
      const STUCK_STATES = new Set(["abandoned", "stuck_finalizar", "stuck_contact", "email_pendente_revisao", "contato_incompleto", "automation_failed"]);
      if ((Object.keys(localUpdates).length > 0 || localReply) && customer?.status && STUCK_STATES.has(customer.status) && !(localUpdates as any).status) {
        (localUpdates as any).status = "pending";
        (localUpdates as any).error_message = null;
        (localUpdates as any).rescue_attempts = 0;
      }
      try {
        const lastOut = (customer as any).last_bot_reply_at ? new Date((customer as any).last_bot_reply_at) : null;
        if (lastOut && (Date.now() - lastOut.getTime()) < 60 * 60 * 1000) {
          await supabase.rpc("increment_ab_metric", {
            p_template_key: "any", p_step_key: turnStepBefore, p_variant: "default",
            p_consultant_id: superAdminConsultantId, p_metric: "replied",
          });
        }
        if (localUpdates.conversation_step && stripPrefix(localUpdates.conversation_step) !== turnStepBefore) {
          await supabase.rpc("increment_ab_metric", {
            p_template_key: "any", p_step_key: turnStepBefore, p_variant: "default",
            p_consultant_id: superAdminConsultantId, p_metric: "advanced",
          });
        }
      } catch (_) { /* tracking não bloqueia */ }

      const __intent = (localUpdates as any).__intent ?? null;
      const __confidence = (localUpdates as any).__confidence ?? null;
      const __inline_sent_flag = (localUpdates as any).__inline_sent === true;
      for (const k of Object.keys(localUpdates)) {
        if (k.startsWith("__")) delete (localUpdates as any)[k];
      }

      if (Object.keys(localUpdates).length > 0) {
        const { error: updateError } = await supabase.from("customers").update(localUpdates).eq("id", customer.id).select();
        if (updateError) console.error(`❌ ERRO ao salvar updates:`, updateError);
        else Object.assign(customer, localUpdates);
        if (localUpdates.conversation_step && stripPrefix(localUpdates.conversation_step) !== turnStepBefore) {
          await logStepTransition(supabase, {
            customer_id: customer.id, consultant_id: superAdminConsultantId,
            phone, from_step: turnStepBefore, to_step: stripPrefix(localUpdates.conversation_step),
            intent: __intent, confidence: __confidence,
          });
        }
        if (localUpdates.conversation_step) {
          await syncCustomerStage(supabase, {
            customerId: customer.id,
            stepKeyAfter: localUpdates.conversation_step,
            consultantId: customer.consultant_id || superAdminConsultantId,
          });
        }
      }

      const handlerSentInline = localReply === "" && (Object.keys(localUpdates).length > 0 || __inline_sent_flag);
      let finalReply = localReply;
      if (!finalReply && !handlerSentInline) finalReply = "";
      if (silentMode && finalReply) {
        console.log(`🤫 [silent-capture] suprimindo reply final ("${finalReply.slice(0, 60)}...") — IA manual`);
        finalReply = "";
      }
      if (finalReply) {
        let isDuplicate = false;
        try {
          const sinceIso = new Date(Date.now() - 60_000).toISOString();
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
            isDuplicate = true;
          }
        } catch (_) { /* noop */ }

        if (!isDuplicate) {
          try { await sender.sendText(remoteJid, finalReply); } catch (e: any) { console.error("Erro enviar:", e); }
          await supabase.from("conversations").insert({
            customer_id: customer.id,
            message_direction: "outbound",
            message_text: finalReply,
            message_type: "text",
            conversation_step: localUpdates.conversation_step || turnStepBefore,
          });
        }
      }
    };

    try {
      // ─── Engine v3 gate (FIRST — before any legacy routing) ──────────
      // When v3 is enabled for the consultant, it takes FULL ownership of
      // the turn. No legacy routing, no auto-cure, no "FONTE ÚNICA DE
      // VERDADE" block. The v3 entry helper handles everything: load
      // context, run engine, dispatch outbounds, persist state.
      const { isEngineV3Enabled } = await import("../_shared/engine/router.ts");
      // ─── Fluxo B bypass ──────────────────────────────────────────────
      // Variant B = Vendedora V2 (IA livre). NUNCA entra no V3 — cai
      // direto no bot-flow legado, que dispatcha runFluxoBAI. Captura de
      // mídia (aguardando_conta/documento) continua determinística no
      // legado também.
      const _fbVariantTop = String((customer as any)?.flow_variant || "").toUpperCase();
      if (_fbVariantTop !== "B" && await isEngineV3Enabled(supabase as any, superAdminConsultantId)) {
        const { runUnifiedEngineWebhookEntry } = await import("../_shared/engine/webhook-entry.ts");
        const { getAdapter } = await import("../_shared/channels/index.ts");
        const v3Adapter = getAdapter({
          kind: "whapi",
          input: { apiToken: whapiToken },
        });
        const v3Outcome = await runUnifiedEngineWebhookEntry({
          supabase: supabase as any,
          adapter: v3Adapter,
          customerId: customer.id,
          consultantId: superAdminConsultantId,
          jid: remoteJid,
          inbound: {
            messageText,
            buttonId,
            isFile,
            isButton,
            hasImage,
            hasAudio,
            hasDocument,
            messageId,
          },
          testRunId: testMode ? testRunId : null,
          testTurn: testMode ? Number(testTurn || 1) : null,
        });
        jsonLog(v3Outcome.ok ? "info" : "warn", "engine_v3_handled", {
          customer_id: customer.id,
          consultant_id: superAdminConsultantId,
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

      const customerOverride = (customer as any).conversational_flow_enabled;
      const consultantFlag = (consultantData as any)?.conversational_flow_enabled === true;

      const routed = routeEngineV2({
        currentStep: rawStep,
        conversationalFlowEnabled: consultantFlag,
        customerOverride: customerOverride === false ? false : null,
      });
      let engine = routed.engine;
      // Se o consultor não habilitou o motor novo, ou o cliente desligou explicitamente,
      // qualquer step "flow:" é rebaixado para sys (cai no welcome canônico).
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
      // Bug recorrente: consultor publica um Fluxo D depois que leads já estavam
      // no meio do Fluxo A. Os leads ficam com `flow_variant='D'` mas
      // `conversation_step` apontando para UUID que só existe no Fluxo A. Como
      // o motor carrega só o fluxo da variant atual, o UUID nunca é resolvido
      // e o lead trava. Solução: detectar UUIDs/passo_xxx que NÃO existem em
      // nenhum step ativo do(s) fluxo(s) da variant atual e resetar para
      // welcome (motor reinicia no firstActive).
      const _stepRaw = stripPrefix((customer as any).conversation_step || "");
      const _looksLikeFlowStep = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(_stepRaw)
        || _stepRaw.startsWith("passo_");
      const _isCadastroStepGuard = CADASTRO_STEPS.has(_stepRaw);
      if (_looksLikeFlowStep && !_isCadastroStepGuard) {
        try {
          const variant = String((customer as any)?.flow_variant || "A").toUpperCase();
          // Dono do fluxo = consultor do LEAD (não o superadmin do canal Whapi).
          // Usar só superAdminConsultantId gerava falso positivo de mismatch e
          // resetava para welcome a cada turno — Sofia C travava no a3.
          const flowOwnerId = String((customer as any)?.consultant_id || superAdminConsultantId || "");
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
          // Fallback: step_key no fluxo do consultor (UUID órfão republicado)
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
                  consultant_id: flowOwnerId || superAdminConsultantId,
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
      // que não pertence ao pipeline de cadastro (OCR/doc/portal). Cadastro
      // continua em sys (bot-flow.ts). Nada mais bounce entre engines.
      const currentStepRaw = stripPrefix((customer as any).conversation_step || "");
      const isCadastroStep = CADASTRO_STEPS.has(currentStepRaw);

      // 🛟 BRIDGE UUID→sys: quando o conversation_step é um UUID de um passo
      // CUSTOM cujo step_type é capture_conta/capture_documento/capture_doc/
      // capture_email/confirm_phone/finalizar_cadastro, FORÇA engine=sys.
      //
      // Por quê: `routeEngine` manda qualquer UUID para `flow`
      // (runConversationalFlow), mas só o engine `sys` (bot-flow.ts legacy)
      // tem o pipeline de OCR, edição de dados, Portal2 e finalize-capture.
      // Sem este bridge, leads em fluxo custom (5 passos: conta→doc→email→
      // confirm_phone→finalizar) recebem o prompt repetido a cada inbound
      // porque o conversational handler não sabe processar foto/PDF como
      // conta de luz. O custom-step-resolver dentro do bot-flow.ts (linha
      // ~2856) mapeia o UUID para o step nominal correto (aguardando_conta
      // etc.) e o switch executa OCR + botões SIM/NÃO/EDITAR.
      // Bug observado: lead 5511971254913 enviou conta de luz 2× e bot
      // re-emitiu prompt 3× sem nunca chamar OCR (ocr_conta_attempts=0).
      // 🔒 Flag: quando o bridge forçar sys por causa de um step CUSTOM de
      // captura, o bloco abaixo (engine==="sys" && !isCadastroStep) NÃO pode
      // reverter para "flow" nem zerar conversation_step, senão o handler
      // conversacional recebe o PDF/imagem e fica mudo (não tem OCR).
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
            console.log(`🛟 [router-bridge] UUID ${currentStepRaw} type=${(stepRow as any).step_type} → forçando engine=sys (legacy tem OCR/portal2/finalize)`);
            engine = "sys";
            bridgeForcedSysForCapture = true;
            // ⚠️ NÃO limpa conversation_step — o custom-step-resolver dentro
            // de bot-flow.ts precisa do UUID para localizar o step e
            // (a) mapear para o nominal correto, (b) avançar pelo
            // bot_flow_steps.position+1 quando o passo concluir.
          }
        }
      } catch (e) {
        console.warn("[router-bridge] lookup step_type falhou:", (e as any)?.message);
      }

      if (
        engine === "sys" &&
        !isCadastroStep &&
        !bridgeForcedSysForCapture &&
        consultantFlag &&
        customerOverride !== false &&
        _fbVariantLegacy !== "B"
      ) {
        try {
          // 🔑 FIX: Rafael tem fluxos A/B/C ativos simultâneos. Filtrar pela
          // variant do customer (default "A") evita o erro "multiple rows"
          // que antes deixava activeFlow=null e fazia o engine cair em sys
          // (que disparava a IA do welcome legacy em vez do Fluxo da Camila).
          const variant = resolveCanonicalFlowVariant((customer as any)?.flow_variant);
          const { data: activeFlows } = await supabase
            .from("bot_flows")
            .select("id")
            .eq("consultant_id", superAdminConsultantId)
            .eq("is_active", true)
            .eq("variant", variant)
            .order("created_at", { ascending: true })
            .limit(1);
          const activeFlow = activeFlows?.[0] || null;
          if (activeFlow?.id) {
            const { count } = await supabase
              .from("bot_flow_steps")
              .select("id", { count: "exact", head: true })
              .eq("flow_id", (activeFlow as any).id)
              .eq("is_active", true);
            if ((count || 0) > 0) {
              engine = "flow";
              // Só limpa step legado (welcome/null) — NUNCA UUID ativo do fluxo custom.
              const keepFlowStep = !!originalFlowStep;
              if (!keepFlowStep) {
                (customer as any).conversation_step = null;
              }
              console.log(`🚀 [router] forçado para flow (consultor=${superAdminConsultantId}, variant=${variant}, step legado="${stepBefore}", keepStep=${keepFlowStep})`);
            } else {
              console.warn(`[router] flow ${activeFlow.id} (variant=${variant}) sem steps ativos — mantendo sys`);
            }
          } else {
            console.warn(`[router] nenhum bot_flow ativo para variant=${variant} consultor=${superAdminConsultantId} — mantendo sys`);
          }
        } catch (e) {
          console.warn("[router] falha ao verificar flow ativo:", (e as any)?.message);
        }
      }

      engineUsed = engine;

      // 🔒 Restaura UUID do fluxo se algum guard (step-mismatch/router) rebaixou
      // para welcome/null em memória — evita restart welcome→a3 a cada inbound.
      if (engine === "flow" && originalFlowStep) {
        const memStep = stripPrefix(String((customer as any).conversation_step || ""));
        if (!memStep || memStep === "welcome" || memStep === "menu_inicial") {
          console.log(
            `🔒 [router] restaurando step do fluxo "${originalFlowStep}" (mem="${memStep || "null"}")`,
          );
          (customer as any).conversation_step = originalFlowStep;
        }
      }

      // 🤫 Em silentMode (IA manual + arquivo recebido), o pipeline precisa
      // rodar (download, OCR, updates) mas NUNCA enviar texto/botões/mídia
      // ao cliente. Wrap o sender com no-ops para envio outbound.
      const engineSender = silentMode
        ? {
            sendText: async (_jid: string, _text: string) => {
              console.log(`🤫 [silent-capture] sendText suprimido`);
              return true;
            },
            sendButtons: async (_jid: string, _msg: string, _btns: any[]) => {
              console.log(`🤫 [silent-capture] sendButtons suprimido`);
              return true;
            },
            sendMedia: async (_jid: string, _url: string, _cap: string, _type: string) => {
              console.log(`🤫 [silent-capture] sendMedia suprimido`);
              return true;
            },
            sendPresence: async () => true,
            downloadMedia: sender.downloadMedia,
          }
        : sender;

      // ─── Engine v3 — hook compartilhado (Semana 1 do rollout v3) ──
      // Mesma chamada do evolution-webhook. Fail-open: nunca bloqueia o
      // caminho legado, apenas observa e loga para validação dark→canary→on.
      try {
        const { runEngineV3IfEnabled } = await import("../_shared/engine/webhook-hook.ts");
        await runEngineV3IfEnabled({
          supabase,
          customerId: customer.id,
          consultantId: superAdminConsultantId,
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

      // ─── Cérebro IA — hook de SOMBRA (Tarefa 9.2) ──────────────────
      // Espelha o hook do engine v3 acima, no MESMO ponto e com os MESMOS
      // dados de inbound/consultor/cliente (par simétrico com evolution-webhook).
      // Só roda em `flow_engine_v3='dark'`: observa e registra a decisão do
      // Cérebro SEM enviar nada ao cliente. Fail-open total — qualquer erro é
      // engolido e NUNCA afeta o caminho legado.
      try {
        const { executarCerebroSombra } = await import("../_shared/cerebro/sombra-hook.ts");
        await executarCerebroSombra({
          supabase,
          customerId: customer.id,
          consultantId: superAdminConsultantId,
          legacyStep: stepBefore,
          inboundKind: isButton ? "button_click" : (hasImage || hasDocument || hasAudio ? "media" : "text"),
          inboundText: messageText ?? null,
          inboundButtonId: buttonId ?? null,
          inboundMediaKind: hasAudio ? "audio" : hasImage ? "image" : hasDocument ? "document" : null,
          inboundMessageId: messageId ?? null,
          channel: "whapi",
        });
      } catch (e: any) {
        console.warn("[cerebro-sombra-hook] erro não-bloqueante:", e?.message);
      }

      // ─── Engine v3 gate (Task 29 — flow-engine-v3-rewrite) ──────────
      // When `consultants.use_engine_v3 = true`, the v3 engine takes
      const runEngine = async () => engine === "flow"
        ? await runConversationalFlow({
            supabase, sender: engineSender, customer, consultorId, nomeRepresentante, nomeAssistente,
            remoteJid, phone, messageText, buttonId, isFile, isButton,
            hasImage, hasDocument, hasAudio, imageMessage, documentMessage, message, key, messageId,
            instanceName: "whapi-superadmin",
            fileUrl, fileBase64, geminiApiKey: GEMINI_API_KEY,
          })
        : await runBotFlow({
            supabase, sender: engineSender, customer, consultorId, nomeRepresentante, nomeAssistente,
            remoteJid, phone, messageText, buttonId, isFile, isButton,
            hasImage, hasDocument, hasAudio, imageMessage, documentMessage, message, key, messageId,
            instanceName: "whapi-superadmin",
            fileUrl, fileBase64, geminiApiKey: GEMINI_API_KEY,
          });
      // ─── Cérebro IA — RESPOSTA real (Tarefa 15.1) ────────────────────
      // Par simétrico com evolution-webhook. Ponto: DEPOIS do gate do engine v3
      // (acima, que já deu early-return se assumiu o turno) e IMEDIATAMENTE ANTES
      // de invocar a vendedora (runConversationalFlow/runBotFlow via runEngine).
      // O motor determinístico v3 mantém prioridade; o Cérebro só substitui o
      // caminho CONVERSACIONAL legado (Fluxo B / runFluxoBAI / runConversational).
      //
      // Só age em canary/on (gate em deveResponderComCerebro). Fail-open total:
      // erro → respondeu=false e a vendedora responde como hoje. Envio pelo
      // sender REAL do canal (anti-ban + trio de proteção intactos). OTP
      // (interceptado no topo) e OCR/portal (despachados pelo Cérebro) intactos.
      let _cerebroRespondeu = false;
      // Roteamento por variante (Etapa 2 do plano "Fluxo D + Fluxo B IA"):
      //   D → motor determinístico de botões (engine legado). Sem IA conversacional.
      //   B → NOVO Fluxo B IA (IA livre, FAQ + RAG, do "oi" até pedir foto da conta).
      //   demais → fallback no cérebro legado (compatibilidade temporária).
      const _fbVarCerebro = String((customer as any)?.flow_variant || "").toUpperCase();

      // Executa UM turno do caminho conversacional (Fluxo B IA ou Cérebro
      // legado) com os dados de inbound fornecidos. Extraído numa função para
      // poder ser REUTILIZADO ao drenar a rajada (pending_inbound) — sem isso a
      // 2ª mensagem de uma rajada ("oi" seguido de "quero saber mais") ficava
      // presa na fila e o bot parecia mudo no meio do cadastro.
      const runConversacionalTurn = async (inb: {
        text: string | null;
        isButton: boolean;
        buttonId: string | null;
        hasImage: boolean;
        hasDocument: boolean;
        hasAudio: boolean;
        messageId: string | null;
      }): Promise<boolean> => {
        const inboundKind = inb.isButton
          ? "button_click"
          : (inb.hasImage || inb.hasDocument || inb.hasAudio ? "media" : "text");
        const inboundMediaKind = inb.hasAudio
          ? "audio"
          : inb.hasImage ? "image" : inb.hasDocument ? "document" : null;
        // Envio idempotente: rajadas do MESMO texto (ex.: "Golpe" 4×) não
        // disparam 4 respostas idênticas — o slot em `outbound_message_log`
        // dedupa por (customerId, step, content, minuto). Ver
        // `_shared/bot/conversational-send-idempotency.ts`.
        const enviarTexto = makeIdempotentEnviarTexto(
          (jid, text, opts) => sender.sendText(jid, text, opts as any),
          remoteJid,
          {
            supabase,
            customerId: customer.id,
            consultantId: superAdminConsultantId,
            step: stepBefore || "",
          },
        );
        if (_fbVarCerebro === "B") {
          try {
            const { processarTurnoFluxoB } = await import("../_shared/fluxo-b-ia/agent.ts");
            const r = await processarTurnoFluxoB({
              supabase,
              customerId: customer.id,
              consultantId: superAdminConsultantId,
              inboundKind,
              inboundText: inb.text ?? null,
              inboundMediaKind,
              inboundMessageId: inb.messageId ?? null,
              telefone: phone ?? null,
              enviarTexto,
            });
            return r.respondeu;
          } catch (e: any) {
            console.warn("[fluxo-b-ia] erro não-bloqueante:", e?.message);
            return false;
          }
        }
        try {
          const { responderComCerebro } = await import("../_shared/cerebro/resposta-hook.ts");
          const r = await responderComCerebro({
            supabase,
            customerId: customer.id,
            consultantId: superAdminConsultantId,
            inboundKind,
            inboundText: inb.text ?? null,
            inboundButtonId: inb.buttonId ?? null,
            inboundMediaKind,
            inboundMessageId: inb.messageId ?? null,
            channel: "whapi",
            telefone: phone ?? null,
            enviarTexto,
          });
          return r.respondeu;
        } catch (e: any) {
          console.warn("[cerebro-resposta-hook] erro não-bloqueante:", e?.message);
          return false;
        }
      };

      // 🛡️ Guarda de origem: clientes já cadastrados/sincronizados (carteira
      // iGreen via XLSX/worker = `igreen_sync`, ou via extensão Chrome do
      // consultor = `igreen_extension`) NUNCA entram no cadastro nem vão ao
      // Portal 2 — já estão no portal. Quando mandam mensagem, vão direto
      // pro Cérebro responder dúvidas, independente do step legado.
      const _origin = String((customer as any).customer_origin || "").toLowerCase();
      const _isAtivoOrigin = _origin === "igreen_sync" || _origin === "igreen_extension";

      // Classifica o input dentro do cadastro. Default = "expected" (vai ao
      // determinístico). Só vira "freeform_question" quando o lead claramente
      // perguntou outra coisa, fora do objetivo do step.
      const { classifyCadastroInput } = await import("../_shared/cadastro-input-classifier.ts");
      // 🛡️ Cadastro também inclui UUID de passos custom de captura/finalize
      // (capture_conta/capture_documento/capture_email/confirm_phone/
      // finalizar_cadastro). Sem isso, o Cérebro/IA livre engole o turno e o
      // OCR/portal nunca roda — exatamente o bug reincidente no 11971254913.
      const _emCadastro = CADASTRO_STEPS.has(stepBefore) || bridgeForcedSysForCapture;
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
      const _midiaOcr = (hasImage || hasDocument) && !hasAudio;

      // Variantes scriptadas do Flow Builder (Camila): NÃO passam pelo Cérebro.
      // Sem isso, número de teste (ex.: 11971254913) ativa o Cérebro com
      // respondeu=true e reply vazio → early-return e o fluxo C nunca inicia.
      // B = Vendedora IA (continua no caminho IA). D/M/C/E/F = roteiro do builder.
      if (
        (_fbVarCerebro === "D" || _fbVarCerebro === "M" || _fbVarCerebro === "C" ||
          _fbVarCerebro === "E" || _fbVarCerebro === "F") && !_isAtivoOrigin
      ) {
        console.log(`[fluxo-script-bypass] customer=${customer.id} variant=${_fbVarCerebro} — IA pulada (fluxo do construtor)`);
      } else if (_fbVarCerebro === "A" && _emCadastro && !_isAtivoOrigin) {
        console.log(`[fluxo-a-bypass] customer=${customer.id} step=${stepBefore} — cadastro determinístico, Cérebro pulado`);
      } else if (_isAtivoOrigin) {
        // Cliente já cadastrado (carteira/extensão) → Cérebro responde sempre,
        // SEM tocar em estado de cadastro, SEM OCR, SEM Portal 2.
        console.log(`[origin-guard] customer=${customer.id} origin=${_origin} → Cérebro (readOnly), pula cadastro/portal`);
        _cerebroRespondeu = await runConversacionalTurn({
          text: messageText ?? null,
          isButton,
          buttonId: buttonId ?? null,
          hasImage,
          hasDocument,
          hasAudio,
          messageId: messageId ?? null,
        });
      } else if (!_emCadastro) {
        _cerebroRespondeu = await runConversacionalTurn({
          text: messageText ?? null,
          isButton,
          buttonId: buttonId ?? null,
          hasImage,
          hasDocument,
          hasAudio,
          messageId: messageId ?? null,
        });
      } else if (_midiaOcr || _cadKind === "expected") {
        // 🔑 CADASTRO + resposta esperada → caminho determinístico (OCR +
        // confirmação + doc + portal). O Cérebro NÃO interpreta o input
        // esperado do step. Cada etapa tem foco único — quem valida e
        // re-pergunta é o handler determinístico.
        console.log(`[cerebro] cadastro em andamento (step=${stepBefore} kind=${_cadKind ?? "media"}) → determinístico customer=${customer.id}`);
      } else {
        // CADASTRO + pergunta livre off-topic → Cérebro responde sem mexer
        // no estado. O step do cadastro permanece intacto e o próximo
        // re-prompt do determinístico segue normalmente.
        console.log(`[cerebro] freeform no cadastro step=${stepBefore} customer=${customer.id} → Cérebro readOnly`);
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
      if (_cerebroRespondeu) {
        // 📥 Drena a rajada ANTES de soltar o lock (mesma proteção do caminho
        // legado em applyTurnResult). Sem isso a 2ª mensagem da rajada ficava
        // presa em pending_inbound e o bot silenciava no meio do cadastro.
        try {
          const { drainPendingInboundTurns } = await import("../_shared/bot/pending-inbound.ts");
          const drained = await drainPendingInboundTurns(supabase, customer.id, async (replay) => {
            // Re-fetch do customer pra refletir o estado gravado pelo turno anterior.
            try {
              const { data: fresh } = await supabase.from("customers").select("*").eq("id", customer.id).maybeSingle();
              if (fresh) customer = fresh;
            } catch (_) { /* mantém customer atual */ }
            console.log(`[pending-drain fluxo-b] replay customer=${customer.id} text="${String(replay.messageText).slice(0, 80)}"`);
            // O claim só distingue mídia genérica (isFile) de botão/texto; tratamos
            // mídia como imagem (foto da conta), o caso de longe mais comum.
            const replayIsMedia = replay.isFile && !replay.isButton;
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
          if (drained > 0) console.log(`[pending-drain fluxo-b] ${drained} turn(s) customer=${customer.id}`);
        } catch (e) {
          console.warn("[pending-drain fluxo-b] falhou:", (e as Error).message);
        }

        // 🔓 Libera o lock (o early-return pulava o release lá embaixo).
        try { await supabase.rpc("release_customer_processing_lock", { _customer_id: customer.id }); } catch (_) {}

        return new Response(
          JSON.stringify({ ok: true, mode: _fbVarCerebro === "B" ? "fluxo-b-ia" : "cerebro" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const result = testMode && testRunId
        ? await botRequestStore.run({ testMode: true, runId: testRunId, supabase, turn: testTurn, realServices, bypassQuietHours: testMode && headerBypassQuiet, fastClock: testMode && headerFastClock, forceOcrFail: testMode && headerForceOcrFail }, runEngine)
        : await runEngine();
      reply = result.reply;
      updates = result.updates;

      // Telemetria do classificador (intent/confidence) — registrada na transição, não persistida no customer.
      if (engine === "flow") {
        (updates as any).__intent = (updates as any).__intent;
        (updates as any).__confidence = (updates as any).__confidence;
      }

      await applyTurnResult(reply, updates, stepBefore);

      // 📥 Drena mensagens que chegaram com lock ocupado (pending_inbound)
      try {
        const { drainPendingInboundTurns } = await import("../_shared/bot/pending-inbound.ts");
        const drained = await drainPendingInboundTurns(supabase, customer.id, async (replay) => {
          messageText = replay.messageText;
          messageId = replay.messageId;
          isFile = replay.isFile;
          isButton = replay.isButton;
          buttonId = replay.buttonId;
          const { data: fresh } = await supabase.from("customers").select("*").eq("id", customer.id).maybeSingle();
          if (fresh) customer = fresh;
          const drainStepBefore = stripPrefix((customer as any).conversation_step || "");
          (customer as any).conversation_step = drainStepBefore;
          console.log(`[pending-drain] replay customer=${customer.id} text="${String(messageText).slice(0, 80)}"`);
          const drainResult = await runEngine();
          await applyTurnResult(drainResult.reply, drainResult.updates, drainStepBefore);
        });
        if (drained > 0) console.log(`[pending-drain] ${drained} turn(s) customer=${customer.id}`);
      } catch (e) {
        console.warn("[pending-drain] falhou:", (e as Error).message);
      }
    } catch (botErr: any) {
      console.error(`💥 [whapi bot-flow crash] step=${stepBefore}:`, botErr);
      captureError(botErr, {
        tags: { function: "whapi-webhook", kind: "bot_flow_crash" },
        extra: { customer_id: customer.id, step: stepBefore },
      });
      reply = "Tive um probleminha aqui. Pode me mandar de novo? 🙂";
      updates = {};
      await applyTurnResult(reply, updates, stepBefore);
    }

    // 🔓 Libera o lock antes de retornar (pending já foi drenado dentro do try).
    try { await supabase.rpc("release_customer_processing_lock", { _customer_id: customer.id }); } catch (_) {}

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Whapi webhook error:", err);
    captureError(err, { tags: { function: "whapi-webhook" } });
    // best-effort: tenta liberar lock se foi adquirido
    try {
      // @ts-ignore — customer/lockAcquired podem não estar no escopo
      if (typeof customer !== "undefined" && customer?.id && typeof lockAcquired !== "undefined" && lockAcquired) {
        // @ts-ignore
        await supabase.rpc("release_customer_processing_lock", { _customer_id: customer.id });
      }
    } catch (_) {}
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
