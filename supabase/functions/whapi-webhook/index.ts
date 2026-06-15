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
import { createWhapiSender, parseWhapiMessage } from "../_shared/whapi-api.ts";
import { checkAndMarkProcessed, logStepTransition, jsonLog } from "../_shared/audit.ts";
import { runBotFlow } from "./handlers/bot-flow.ts";
import { runConversationalFlow, CADASTRO_STEPS } from "./handlers/conversational/index.ts";
import { normalizeOutgoing, stripPrefix } from "./handlers/step-namespace.ts";
import { routeEngine as routeEngineV2 } from "../_shared/flow-router.ts";
import { captureError } from "../_shared/sentry.ts";
import { detectHandoffIntent } from "../_shared/captureExtractors.ts";
import { extractMultiField, buildMultiFieldPatch } from "../_shared/multi-field-extractor.ts";
import { botRequestStore, isTestPhone, logTestOutbound } from "../_shared/test-mode.ts";
import { notifyNewLead, notifyPartnerNewLead } from "../_shared/notify-consultant.ts";
import { syncCustomerStage } from "../_shared/conversion/crm-sync.ts";
import { isCustomerPausedByHuman, isConsultantAIDisabled } from "../_shared/bot/paused.ts";
import { isBotGloballyEnabled } from "../_shared/bot/global-flag.ts";
import { matchKeyword, type PartnerKeywords } from "../_shared/keyword-matcher.ts";
// `pickFlowVariant` (A/D 50/50) descontinuado — usamos a RPC
// `assign_flow_variant` que respeita `consultants.active_variants`.

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

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Kill switch global (Fase 0 auditoria). Fail-open: erros = habilitado.
    // `as any`: helper compartilhado pina @supabase/supabase-js@2.49.4 enquanto este
    // arquivo pina @2; runtime idêntico mas TS vê duas shapes diferentes.
    if (!(await isBotGloballyEnabled(supabase as any))) {
      console.log("[whapi-webhook] bot_global_enabled=false → silenciado");
      return new Response(JSON.stringify({ ok: true, msg: "bot_globally_disabled" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    console.log("Whapi webhook received:", JSON.stringify(body).substring(0, 500));

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
      const outPhone = normalizePhone(outChatId.replace("@s.whatsapp.net", "")).replace(/\D/g, "");
      console.log(`👤 Outbound humano detectado (source=${outSource}) → pausando bot para ${outPhone}`);
      try {
        const { data: cust, error: selErr } = await supabase
          .from("customers")
          .select("id, bot_paused, assigned_human_id, consultant_id")
          .eq("phone_whatsapp", outPhone)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (selErr) console.error("⚠️ select customer (outboundHuman):", selErr);
        if (cust && (!cust.bot_paused || !cust.assigned_human_id)) {
          const { error: updErr } = await supabase
            .from("customers")
            .update({
              bot_paused: true,
              bot_paused_reason: "humano_assumiu_whatsapp",
              bot_paused_at: new Date().toISOString(),
              bot_paused_until: null,
              assigned_human_id: cust.consultant_id ?? cust.assigned_human_id ?? null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", cust.id);
          if (updErr) console.error("⚠️ update bot_paused (outboundHuman):", updErr);
          else console.log(`✅ Bot pausado para ${outPhone} (customer ${cust.id})`);
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
      remoteJid, hasImage, hasDocument, hasAudio,
      imageMessage, documentMessage, audioMessage, key, message,
      fileBase64: whapiFileBase64, fileUrl: whapiFileUrl, fromName,
    } = parsed;
    let { messageText, isFile, isButton, buttonId, messageId } = parsed;

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
      .select("id, name, igreen_id, conversational_flow_enabled")
      .eq("id", superAdminConsultantId)
      .single();

    // Usa só o PRIMEIRO NOME — soa mais natural no WhatsApp ("Rafael" em vez de "Rafael Ferreira").
    const _fullName = consultantData?.name || "iGreen Energy";
    const nomeRepresentante = _fullName.trim().split(/\s+/)[0] || "iGreen Energy";
    const consultorId = consultantData?.igreen_id || "124170";
    console.log(`✅ Whapi super admin: ${nomeRepresentante} (full: ${_fullName}, iGreen ID: ${consultorId})`);





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
          .select("id, name, status")
          .eq("phone_whatsapp", phone)
          .eq("consultant_id", superAdminConsultantId)
          .in("status", ["awaiting_otp", "portal_submitting"])
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (otpCustomer) {
          console.log(`🔑 [whapi-otp] OTP ${extractedOtp} capturado para ${otpCustomer.name} (${otpCustomer.id})`);
          await supabase.from("customers").update({
            otp_code: extractedOtp,
            otp_received_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }).eq("id", otpCustomer.id);

          const workerUrl = settings.portal_worker_url || Deno.env.get("PORTAL_WORKER_URL") || Deno.env.get("WORKER_PORTAL_URL") || "";
          const workerSecret = settings.worker_secret || Deno.env.get("WORKER_SECRET") || "";
          if (workerUrl && workerSecret) {
            try {
              const ctrl = new AbortController();
              const timer = setTimeout(() => ctrl.abort(), 5000);
              await fetch(`${workerUrl.replace(/\/$/, "")}/confirm-otp`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${workerSecret}` },
                body: JSON.stringify({ customer_id: otpCustomer.id, otp_code: extractedOtp }),
                signal: ctrl.signal,
              });
              clearTimeout(timer);
              console.log(`✅ [whapi-otp] OTP enviado ao worker`);
            } catch (e: any) {
              console.warn(`⚠️ [whapi-otp] Falha ao notificar worker: ${e?.message}`);
            }
          }

          await supabase.from("conversations").insert({
            customer_id: otpCustomer.id, message_direction: "inbound",
            message_text: messageText, message_type: "text",
            conversation_step: "otp_received",
          });
          try {
            const reply = "✅ Código recebido! Estou finalizando seu cadastro, aguarde alguns segundos...";
            await realSender.sendText(remoteJid, reply);
            await supabase.from("conversations").insert({
              customer_id: otpCustomer.id, message_direction: "outbound",
              message_text: reply, message_type: "text",
              conversation_step: "otp_received",
            });
          } catch (_) {}

          return new Response(JSON.stringify({ ok: true, msg: "otp_intercepted", otp: extractedOtp }), {
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
        // Step legacy/desconhecido em customer já finalizado → coloca em cadastro_em_analise.
        await supabase.from("customers")
          .update({ conversation_step: "cadastro_em_analise" })
          .eq("id", customer.id);
        customer.conversation_step = "cadastro_em_analise";
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
      const abVariant = (typeof assignedVariant === "string" && assignedVariant) || "A";
      const { data: newCustomer, error } = await supabase
        .from("customers")
        .insert({
          phone_whatsapp: phone,
          consultant_id: superAdminConsultantId,
          status: "pending",
          conversation_step: "welcome",
          flow_variant: abVariant,
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
        const multi = extractMultiField(messageText);
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
            .eq("consultant_id", superAdminConsultantId)
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
              notifyPartnerNewLead(superAdminConsultantId, match.partnerId, {
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
        const shouldRewelcome = baseShould && !inCustomFlow && (recentTrans ?? 0) === 0;

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
    // Override por lead: customer.bot_force_enabled=true ignora IA global off.
    // Setado pelo botão "Zerar" (via trigger apply_force_bot_on_customer_insert
    // + tabela force_bot_phones) e pelo toggle individual no chat.
    const forceBotForLead = (customer as any)?.bot_force_enabled === true;

    if (globalAiDisabled === true && !isFile && !inActiveCapture && !forceBotForLead) {
      await supabase.from("conversations").insert({
        customer_id: customer.id,
        message_direction: "inbound",
        message_text: messageText || (hasAudio ? "[áudio]" : "[arquivo]"),
        message_type: hasAudio ? "audio" : "text",
        conversation_step: customer.conversation_step,
      });
      console.log(`🛑 [global-off-silent] IA manual — inbound texto/áudio salvo sem resposta customer=${customer.id} step="${currentStep}"`);
      return new Response(JSON.stringify({ ok: true, msg: "global_ai_disabled_inbound_saved" }), {
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
          console.error("⚠️ falha ao despausar lead_travado_recovery:", unpErr);
        } else {
          console.log(`▶️ Auto-despausado ${phone} (reason=lead_travado_recovery, lead respondeu) — bot volta`);
          (customer as any).bot_paused = false;
          (customer as any).bot_paused_reason = null;
          (customer as any).bot_paused_until = null;
        }
      } else {
        await supabase.from("conversations").insert({
          customer_id: customer.id,
          message_direction: "inbound",
          message_text: messageText || (hasAudio ? "[áudio]" : "[arquivo]"),
          message_type: hasAudio ? "audio" : (isFile ? "image" : "text"),
          conversation_step: customer.conversation_step,
        });
        const _pausedUntil = (customer as any).bot_paused_until && new Date((customer as any).bot_paused_until) > new Date();
        const _reason = (customer as any).bot_paused_reason || ((customer as any).assigned_human_id ? "humano_assumiu" : (_pausedUntil ? "paused_until" : "manual"));
        console.log(`🔇 Bot pausado para ${phone} (flag=${(customer as any).bot_paused === true}, human=${(customer as any).assigned_human_id || "—"}, until=${(customer as any).bot_paused_until || "—"}, reason=${_reason}) — ignorando msg`);
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
    const inboundLogText = hasAudio ? "[áudio]" : (isFile ? "[arquivo]" : messageText);
    const inboundLogType = hasAudio ? "audio" : (isFile ? "image" : "text");
    const { data: inboundLog } = await supabase.from("conversations").insert({
      customer_id: customer.id,
      message_direction: "inbound",
      message_text: inboundLogText,
      message_type: inboundLogType,
      conversation_step: customer.conversation_step,
      external_message_id: messageId || null,
    }).select("id").maybeSingle();

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
      if (_flowVariant !== "D") {
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
      if (_flowVariant === "D" || _hasActiveFlow) {
        console.log(`[manual-capture-stop] BYPASS — customer=${customer.id} flow_variant=${_flowVariant} hasActiveFlow=${_hasActiveFlow}`);
      } else {
      try {
        const multi = extractMultiField(messageText);
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
    //   3. initial_message → texto pré-preenchido (heurística)
    //   4. regex → frases típicas de anúncio (último recurso)
    // Só roda quando source_campaign_id ainda não está preenchido.
    try {
      const alreadyTagged = !!(customer as any).source_campaign_id || !!(customer as any).lead_source;
      if (!alreadyTagged) {
        const rawMsg: any = body?.messages?.[0] || {};
        const referral = rawMsg.referral || rawMsg.context?.referred_product || rawMsg.context?.referral || rawMsg.ad_reply || null;
        const ctwaClid = rawMsg.ctwa_clid || referral?.ctwa_clid || null;
        // source_id = AD ID que originou o clique (doc oficial Meta: referral.source_id).
        const sourceAdId = referral?.source_id || referral?.sourceId || rawMsg.source_id || null;
        const sourceType = referral?.source_type || referral?.sourceType || null;
        const hasReferral = !!(referral || ctwaClid);

        const referralPayload = referral
          ? { ...referral, source_id: sourceAdId, source_type: sourceType, ctwa_clid: ctwaClid }
          : ctwaClid
          ? { ctwa_clid: ctwaClid }
          : null;

        let sourceCampaignId: string | null = null;
        let matchMethod: "ad_id" | "ctwa_clid" | "exact_message" | "unmatched" = "unmatched";

        // 1) Match DETERMINÍSTICO por AD ID (source_id) → fb_ad_ids da campanha.
        if (sourceAdId) {
          try {
            const { data: campByAd } = await supabase
              .from("facebook_campaigns")
              .select("id")
              .eq("consultant_id", (customer as any).consultant_id)
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

        // 2) Match via ctwa_clid_mapping (sinal forte).
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

        // 3) Match por initial_message (heurística)
        if (!sourceCampaignId && messageText && messageText.trim().length > 5) {
          try {
            const normalizedMsg = messageText.trim().toLowerCase().replace(/\s+/g, " ");
            // Na ambiguidade (várias campanhas com a MESMA initial_message),
            // prioriza ativa + mais recente em vez de chutar a primeira.
            const { data: campaigns } = await supabase
              .from("facebook_campaigns")
              .select("id, initial_message, status, created_at")
              .eq("consultant_id", (customer as any).consultant_id)
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
                sourceCampaignId = matches[0].id;
                matchMethod = "exact_message";
                console.log(`[lead-source] customer ${customer.id} matched campaign ${matches[0].id} via initial_message (ambiguous=${matches.length > 1})`);
              }
            }
          } catch (e) {
            console.warn("[lead-source] initial_message match falhou:", (e as Error).message);
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

        if (hasReferral || textMatch || sourceCampaignId || utmDetail || ctwaClid) {
          const patch: Record<string, any> = {};
          if (hasReferral || ctwaClid || sourceCampaignId || textMatch) {
            patch.lead_source = "meta_ads";
          } else if (utmDetail?.utm_source === "qr") {
            patch.lead_source = "qr_code";
          } else if (utmDetail) {
            patch.lead_source = utmDetail.utm_source || "utm";
          }
          if (sourceCampaignId) patch.source_campaign_id = sourceCampaignId;
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
          }
        }
      }
    } catch (e) {
      console.warn("[lead-source] falha ao detectar:", (e as Error).message);
    }
    // ─── Download media ────────────────────────────────────────────────
    let fileUrl: string | null = whapiFileUrl || null;
    let fileBase64: string | null = whapiFileBase64 || null;

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
          const mime = audioMessage?.mimetype || imageMessage?.mimetype || documentMessage?.mimetype || "application/octet-stream";
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
    // Permite que "Captura conta" / "Captura documento" reaproveite o arquivo depois.
    if (isFile && customer?.id && (fileUrl || fileBase64)) {
      try {
        const _mime = imageMessage?.mimetype || documentMessage?.mimetype || null;
        const _kind = hasDocument ? "document" : (hasImage ? "image" : "other");
        await supabase.from("customers").update({
          last_inbound_media_url: fileUrl || null,
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
          try { await sender.sendText(remoteJid, "Não consegui ouvir direito seu áudio 🙏 Pode me mandar por texto, por favor?"); } catch {}
          return new Response(JSON.stringify({ ok: true, msg: "audio_empty_transcript" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } catch (e: any) {
        console.error(`❌ [whapi] Erro ao transcrever áudio:`, e?.message);
        try { await sender.sendText(remoteJid, "Não consegui ouvir seu áudio agora 🙏 Pode me mandar por texto?"); } catch {}
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
      if (_flowVariantA !== "D") {
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
      if (_flowVariantA === "D" || _hasActiveFlowA) {
        console.log(`[manual-capture-stop-audio] BYPASS — customer=${customer.id} flow_variant=${_flowVariantA} hasActiveFlow=${_hasActiveFlowA}`);
      } else {
      try {
        const multi = extractMultiField(messageText);
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
    const rawStep = customer.conversation_step || null;
    const stepBefore = stripPrefix(rawStep); // valor cru consumido pelos engines

    // Sincroniza o customer em memória com o valor cru — engines mantêm sua lógica intacta.
    (customer as any).conversation_step = stepBefore;

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
          // Lookup: este step existe em algum fluxo ativo deste consultor com esta variant?
          const { data: stepLookup } = await supabase
            .from("bot_flow_steps")
            .select("id, flow_id, is_active, bot_flows!inner(variant, is_active, consultant_id)")
            .or(`id.eq.${_stepRaw},step_key.eq.${_stepRaw}`)
            .eq("is_active", true)
            .eq("bot_flows.is_active", true)
            .eq("bot_flows.consultant_id", superAdminConsultantId)
            .eq("bot_flows.variant", variant)
            .limit(1);
          const found = Array.isArray(stepLookup) && stepLookup.length > 0;
          if (!found) {
            console.warn(
              `🩹 [step-mismatch-cure] customer=${customer.id} step="${_stepRaw}" ` +
              `variant=${variant} → step não pertence ao fluxo desta variant. ` +
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
                  consultant_id: superAdminConsultantId,
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
      if (
        engine === "sys" &&
        !isCadastroStep &&
        consultantFlag &&
        customerOverride !== false &&
        _fbVariantLegacy !== "B"
      ) {
        try {
          // 🔑 FIX: Rafael tem fluxos A/B/C ativos simultâneos. Filtrar pela
          // variant do customer (default "A") evita o erro "multiple rows"
          // que antes deixava activeFlow=null e fazia o engine cair em sys
          // (que disparava a IA do welcome legacy em vez do Fluxo da Camila).
          const variant = (customer as any)?.flow_variant || "A";
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
              // Limpa o step legado para que runConversationalFlow restarte
              // no firstActive do Fluxo da Camila — sem bounce, sem mistura.
              (customer as any).conversation_step = null;
              console.log(`🚀 [router] forçado para flow (consultor=${superAdminConsultantId}, variant=${variant}, step legado="${stepBefore}")`);
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
            supabase, sender: engineSender, customer, consultorId, nomeRepresentante,
            remoteJid, phone, messageText, buttonId, isFile, isButton,
            hasImage, hasDocument, imageMessage, documentMessage, message, key, messageId,
            instanceName: "whapi-superadmin",
            fileUrl, fileBase64, geminiApiKey: GEMINI_API_KEY,
          })
        : await runBotFlow({
            supabase, sender: engineSender, customer, consultorId, nomeRepresentante,
            remoteJid, phone, messageText, buttonId, isFile, isButton,
            hasImage, hasDocument, imageMessage, documentMessage, message, key, messageId,
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
              enviarTexto: async (texto) => await sender.sendText(remoteJid, texto),
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
            enviarTexto: async (texto) => await sender.sendText(remoteJid, texto),
          });
          return r.respondeu;
        } catch (e: any) {
          console.warn("[cerebro-resposta-hook] erro não-bloqueante:", e?.message);
          return false;
        }
      };

      if (_fbVarCerebro === "D") {
        console.log(`[fluxo-d-bypass] customer=${customer.id} — IA pulada (fluxo com botões)`);
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
      reply = "Tive um probleminha aqui. Pode me mandar de novo, por favor?";
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
