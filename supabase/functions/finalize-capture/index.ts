// finalize-capture: chamado pelo botão "Finalizar Cadastro" do Modo Captação.
// Valida no servidor com o MESMO validador do frontend (portalValidation.ts).
// Se faltar campo ou houver inválido (CPF errado, R$/kWh fora da faixa, etc.),
// REJEITA antes de qualquer dispatch — nada de chegar no portal e voltar.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { dispatchPortalWorker } from "../_shared/portal-worker.ts";
import { validateForPortal, PORTAL_FIELDS } from "../_shared/portalValidation.ts";
import { notifyPartnerStep } from "../_shared/notify-consultant.ts";
import { preflightPortalDocuments } from "../_shared/storage-download.ts";
import { assertCanContact } from "../_shared/contact-suppression.ts";
import { resolveCaller, assertOwnership } from "../_shared/caller-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-service-secret",
};

const SELECT_FIELDS = PORTAL_FIELDS.map((f) => f.key).join(", ") +
  ", portal2_celular_alt, phone_landline, phone_contact_confirmed, name_mismatch_flag, name_mismatch_acknowledged_at, contaunica_answered, contaunica, electricity_boleto_photo_url";

const TERMINAL = new Set([
  "portal_submitting", "awaiting_otp", "validating_otp",
  "registered_igreen", "cadastro_concluido", "approved", "active",
]);

function jres(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sendWhatsAppNotice(supabase: any, customer: any) {
  try {
    const { data: settingsRows } = await supabase.from("settings").select("*");
    const settings: Record<string, string> = {};
    settingsRows?.forEach((s: any) => { settings[s.key] = s.value; });

    const phone = String(customer.whatsapp_chat_id || customer.phone_whatsapp || "").replace(/\D/g, "");
    if (!phone) return;
    // Só DNC/supressão — NÃO assertBotOutboundAllowed (bot_global não pode
    // cortar aviso transacional de OTP no meio do portal).
    const suppression = await assertCanContact(supabase, {
      customerId: customer.id,
      phone,
      consultantId: customer.consultant_id,
      channel: "whatsapp",
    });
    if (!suppression.allowed) {
      console.warn(`[finalize-capture] notice blocked: ${suppression.reason}`);
      return;
    }
    const text =
      "✅ *Todos os dados coletados!* 🎉\n\n" +
      "⏳ Estamos enviando seu cadastro para o portal da iGreen…\n\n" +
      "📱 Em alguns instantes você recebe aqui no WhatsApp um *código de verificação*. Quando chegar, *digite o código aqui mesmo*.";

    // Tenta Evolution primeiro (instância do consultor), depois Whapi
    let instanceName: string | null = null;
    if (customer.consultant_id) {
      const { data: inst } = await supabase
        .from("whatsapp_instances")
        .select("instance_name")
        .eq("consultant_id", customer.consultant_id)
        .limit(1).maybeSingle();
      instanceName = inst?.instance_name || null;
    }

    const evoUrl = (settings.evolution_api_url || Deno.env.get("EVOLUTION_API_URL") || "").replace(/\/$/, "");
    const evoKey = settings.evolution_api_key || Deno.env.get("EVOLUTION_API_KEY") || "";
    const whapiToken = settings.whapi_token || Deno.env.get("WHAPI_TOKEN") || "";
    const whapiUrl = (settings.whapi_api_url || Deno.env.get("WHAPI_API_URL") || "https://gate.whapi.cloud").replace(/\/$/, "");
    const { resolveWhatsAppChatId } = await import("../_shared/resolve-whatsapp-chat-id.ts");

    if (evoUrl && evoKey && instanceName) {
      try {
        const { checkSendQuota, registerSend } = await import("../_shared/anti-ban.ts");
        const quota = await checkSendQuota(supabase, instanceName);
        if (!quota.allowed) {
          console.warn(`🚫 [finalize-capture] evolution bloqueado instance=${instanceName} reason=${quota.reason} — fallback Whapi`);
        } else {
          const resolved = await resolveWhatsAppChatId({
            phoneOrJid: phone,
            provider: { kind: "evolution", apiUrl: evoUrl, apiKey: evoKey, instanceName },
            fallbackProviders: whapiToken
              ? [{ kind: "whapi", apiToken: whapiToken, baseUrl: whapiUrl }]
              : [],
            supabase,
            customerId: customer.id,
          });
          if (resolved.ok) {
            const number = resolved.chatId.split("@")[0].replace(/\D/g, "");
            const r = await fetch(`${evoUrl}/message/sendText/${instanceName}`, {
              method: "POST",
              headers: { "Content-Type": "application/json", apikey: evoKey },
              body: JSON.stringify({ number, text }),
            });
            if (r.ok) { await registerSend(supabase, instanceName); return; }
          }
        }
      } catch (e) { console.warn("[finalize-capture] evolution send failed", (e as any)?.message); }
    }

    if (whapiToken) {
      // Fallback Whapi também passa pelo anti-ban (com o bypass soft já canônico do Whapi).
      const { awaitOutboundSendQuota, registerSend: regSend } = await import("../_shared/anti-ban.ts");
      const whapiQuota = await awaitOutboundSendQuota(supabase, "whapi", { channelKind: "whapi" });
      if (!whapiQuota.allowed) {
        console.warn(`🚫 [finalize-capture] whapi bloqueado pelo anti-ban reason=${whapiQuota.reason}`);
        return;
      }

      const resolved = await resolveWhatsAppChatId({
        phoneOrJid: phone,
        provider: { kind: "whapi", apiToken: whapiToken, baseUrl: whapiUrl },
        supabase,
        customerId: customer.id,
      });
      if (!resolved.ok) {
        console.warn("[finalize-capture] whapi dest unresolved", resolved.reason);
        return;
      }
      const wr = await fetch(`${whapiUrl}/messages/text`, {
        method: "POST",
        headers: { Authorization: `Bearer ${whapiToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ to: resolved.chatId, body: text, typing_time: 0 }),
      });
      if (wr.ok) await regSend(supabase, "whapi");
    }

  } catch (e: any) {
    console.warn("[finalize-capture] notice send error:", e?.message);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jres({ error: "Method not allowed" }, 405);

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({}));
    const customerId = String(body?.customerId || body?.customer_id || "").trim();
    // sendNotice: default true só com bot ATIVO. Com bot_paused, só envia se
    // a UI passou explicitamente sendNotice=true (após diálogo de confirmação).
    const sendNoticeRaw = body?.sendNotice;
    if (!customerId) return jres({ error: "customerId obrigatório" }, 400);

    // Auth + posse: JWT do consultor dono (ou admin) OU x-service-secret.
    // Sem isso, qualquer autenticado com customerId alheio disparava Portal 2 (IDOR).
    const caller = await resolveCaller(req, supabase);
    if (caller instanceof Response) return caller;
    const deny = await assertOwnership(caller, { customerId }, supabase);
    if (deny) return deny;

    const finalizedBy = caller.mode === "jwt" ? caller.consultantId : null;

    const { data: customer, error: fetchErr } = await supabase
      .from("customers")
      .select("id, consultant_id, phone_whatsapp, name, status, conversation_step, bot_paused, name_mismatch_flag, name_mismatch_acknowledged_at, document_front_url, document_back_url, electricity_bill_photo_url, electricity_boleto_photo_url, bill_base64, document_front_base64, document_back_base64, document_type, igreen_link, customer_origin")
      .eq("id", customerId)
      .maybeSingle();

    if (fetchErr || !customer) return jres({ error: "Cliente não encontrado" }, 404);

    // Guarda server-side: bot pausado → aviso WhatsApp só com sendNotice=true explícito.
    // Evita que retry/cron/UI com capture_mode=auto mande "enviando cadastro" sozinho.
    const sendNotice = customer.bot_paused
      ? sendNoticeRaw === true
      : sendNoticeRaw !== false;

    // 🛡️ Guarda de origem: clientes já cadastrados/sincronizados
    // (`igreen_sync` = carteira XLSX/worker; `igreen_extension` = extensão
    // Chrome do consultor) JÁ ESTÃO no portal. Nunca devem disparar o Portal 2
    // de novo — geraria duplicidade. Defesa-em-profundidade para o caso de o
    // botão "Finalizar" ser clicado ou um webhook chamar este endpoint pra um
    // lead de origem ativa.
    const _origin = String((customer as any).customer_origin || "").toLowerCase();
    if (_origin === "igreen_sync" || _origin === "igreen_extension") {
      console.log(`[finalize-capture][origin-guard] customer=${customerId} origin=${_origin} — bloqueado (já cadastrado)`);
      return jres({
        ok: true,
        already: true,
        mode: "origin_guard_skip",
        origin: _origin,
        message: "Cliente já cadastrado (carteira/extensão). Portal 2 não é disparado.",
      });
    }

    // Já em OTP/assinatura/concluído → não re-dispara.
    // Falha recuperável (worker_offline / missing_documents) pode reentrar
    // mesmo com conversation_step=portal_submitting (senão o botão Retry
    // e o cron ficam bloqueados por "already_dispatched").
    const step = String(customer.conversation_step || "");
    const status = String(customer.status || "");
    const ADVANCED = new Set([
      "awaiting_otp", "aguardando_otp", "validating_otp", "validando_otp",
      "registered_igreen", "cadastro_concluido", "approved", "active",
    ]);
    if (ADVANCED.has(step) || ADVANCED.has(status)) {
      return jres({
        ok: true,
        already: true,
        mode: "already_dispatched",
        status: customer.status,
        step: customer.conversation_step,
        message: "Lead já está em processamento no portal.",
      });
    }
    const canRetryFailure =
      status === "worker_offline" || status === "missing_documents";
    if ((TERMINAL.has(step) || TERMINAL.has(status)) && !canRetryFailure) {
      return jres({
        ok: true,
        already: true,
        mode: "already_dispatched",
        status: customer.status,
        step: customer.conversation_step,
        message: "Lead já está em processamento no portal.",
      });
    }

    // Carrega TODOS os campos do portal para validar com a régua oficial
    const { data: full } = await supabase
      .from("customers")
      .select(SELECT_FIELDS)
      .eq("id", customerId)
      .maybeSingle();

    const validation = validateForPortal(full as any);
    const docMissing: { key: string; label: string }[] = [];
    if (!customer.document_back_url) docMissing.push({ key: "document_back_url", label: "Documento (verso)" });
    if (!customer.electricity_bill_photo_url) docMissing.push({ key: "electricity_bill_photo_url", label: "Conta de luz" });

    if (!validation.ok || docMissing.length) {
      const missing = [...validation.missing, ...docMissing];
      console.warn(`[finalize-capture] customer=${customerId} REJEITADO — missing=${missing.length} invalid=${validation.invalid.length}`);
      return jres({
        ok: false,
        error: "incomplete",
        missing: missing.map((m) => m.label),
        invalid: validation.invalid.map((i) => ({ field: i.field, label: i.label, reason: i.reason, suggestion: i.suggestion })),
      }, 400);
    }

    // Pré-voo: arquivos precisam ser BAIXÁVEIS (bucket privado). Sem isso o
    // worker devolve 422 e o cliente já teria recebido "estamos enviando…".
    const docsOk = await preflightPortalDocuments(supabase, {
      ...(customer as any),
      ...(full as any),
    });
    if (!docsOk.ok) {
      console.warn(`[finalize-capture] customer=${customerId} docs ilegíveis: ${docsOk.missing.join(", ")}`);
      await supabase.from("customers").update({
        status: "awaiting_manual_submit",
        portal2_status: "blocked_missing_documents",
        error_message: `Documentos ilegíveis/ausentes: ${docsOk.missing.join(", ")}`,
        last_portal_dispatch_error: `docs_unreadable:${docsOk.missing.join(",")}`,
      }).eq("id", customerId);
      return jres({
        ok: false,
        error: "docs_unreadable",
        missing: docsOk.missing,
        message: "Os anexos não puderam ser lidos. Reanexe conta e documento antes de finalizar.",
      }, 400);
    }

    // Regenera igreen_link do consultor dono (mesmo guard do bot-flow)
    const updates: Record<string, any> = {
      status: "portal_submitting",
      conversation_step: "portal_submitting",
      finalized_at: new Date().toISOString(),
      // Lead concluiu e entrou no portal: cancela qualquer follow-up agendado
      // ("me chama amanhã") para o process-followups não tocar um cliente que
      // já fechou e virou carteira via sync.
      next_followup_at: null,
      followup_hook: null,
      ...(finalizedBy ? { finalized_by: finalizedBy } : {}),
    };
    const mediaAtual = Number((full as any)?.media_consumo || 0);
    const valorConta = Number((full as any)?.electricity_bill_value || 0);
    if ((!Number.isFinite(mediaAtual) || mediaAtual < 50) && Number.isFinite(valorConta) && valorConta >= 30) {
      updates.media_consumo = Math.max(100, Math.min(2000, Math.round(valorConta / 1.10)));
      console.log(`[finalize-capture] media_consumo estimado=${updates.media_consumo} kWh customer=${customerId}`);
    }
    if (customer.consultant_id) {
      const { data: c } = await supabase
        .from("consultants").select("cadastro_url").eq("id", customer.consultant_id).maybeSingle();
      if (c?.cadastro_url) updates.igreen_link = c.cadastro_url;
    }

    const { error: upErr } = await supabase.from("customers").update(updates).eq("id", customerId);
    if (upErr) {
      console.error("[finalize-capture] update error", upErr);
      return jres({ error: "Falha ao marcar lead", detail: upErr.message }, 500);
    }

    // 📣 Avisa o parceiro: cadastro completo (validação OK, indo pro portal)
    if (customer.consultant_id) {
      notifyPartnerStep(customer.consultant_id, customerId, "cadastro_complete")
        .catch((e) => console.warn("[finalize-capture] notify cadastro_complete:", e?.message));
    }

    // Dispara o worker PRIMEIRO — só avisa o cliente se o despacho aceitou.
    // Nunca prometer OTP/código com worker offline ou docs quebrados.
    const dispatch = await dispatchPortalWorker(supabase, customerId);

    if (dispatch.ok) {
      if (sendNotice) await sendWhatsAppNotice(supabase, customer);
      if (customer.consultant_id) {
        notifyPartnerStep(customer.consultant_id, customerId, "portal_sent")
          .catch((e) => console.warn("[finalize-capture] notify portal_sent:", e?.message));
      }
    } else {
      console.warn(`[finalize-capture] customer=${customerId} dispatch falhou — sem aviso WhatsApp (${dispatch.error || dispatch.mode})`);
    }

    return jres({
      ok: dispatch.ok,
      mode: dispatch.mode,
      status: dispatch.ok ? "portal_submitting" : "worker_offline",
      error: dispatch.error,
      noticeSent: !!(dispatch.ok && sendNotice),
    });
  } catch (e: any) {
    console.error("[finalize-capture] fatal", e?.message || e);
    return jres({ error: e?.message || String(e) }, 500);
  }
});
