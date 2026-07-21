// Reactivation send — envia mensagem de reaquecimento manualmente ou em lote.
// Usado pelo Painel_de_Reaquecimento (frontend) e pelo cron (auto).
//
// Body:
//   { mode: "single", customer_id, message_text, template_id?, schedule_at? }
//   { mode: "batch",  customer_ids: [...], template_overrides?: {step:msg}, batch_id? }
//
// Reqs cobertos: 13, 14, 15, 17, 18.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createEvolutionSender } from "../_shared/evolution-api.ts";
import { jsonLog, captureError } from "../_shared/audit.ts";
import { checkSendQuota, registerSend, humanJitterMs } from "../_shared/anti-ban.ts";
import { canSendProactive, logProactiveBlock } from "../_shared/proactive-send-guard.ts";
import { isAutomationEnabled, logSkipped } from "../_shared/automation-gate.ts";
import { assertCanContact } from "../_shared/contact-suppression.ts";
import { safeFirstNameForAddress } from "../_shared/customer-display-name.ts";
import { resolvePublicConsultantFirstName } from "../_shared/consultant-public-label.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const EVOLUTION_API_URL = Deno.env.get("EVOLUTION_API_URL") || "";
const EVOLUTION_API_KEY = Deno.env.get("EVOLUTION_API_KEY") || "";

interface SingleBody {
  mode: "single";
  customer_id: string;
  message_text: string;
  template_id?: string | null;
  schedule_at?: string | null; // ISO datetime
  media_url?: string | null;
  media_kind?: "image" | "video" | "document" | null;
}

interface BatchBody {
  mode: "batch";
  customer_ids: string[];
  /** Override por step: { "aguardando_conta": "msg X", ... } */
  template_overrides?: Record<string, string>;
  /** ID do lote pra agrupar reactivation_sends (cliente gera UUID). */
  batch_id?: string;
}

type Body = SingleBody | BatchBody;

function renderVars(template: string, customer: any, consultantName: string): string {
  if (!template) return "";
  const firstName = safeFirstNameForAddress(customer.name, customer.name_source);
  const valor = customer.electricity_bill_value
    ? Number(customer.electricity_bill_value).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "";
  let out = template;
  if (!firstName) {
    out = out
      .replace(/\{\{\s*nome\s*\}\}\s*,\s*/gi, "")
      .replace(/,\s*\{\{\s*nome\s*\}\}/gi, "")
      .replace(/\s+\{\{\s*nome\s*\}\}/gi, "");
  }
  return out
    .replaceAll("{{nome}}", firstName)
    .replaceAll("{{valor_conta}}", valor)
    .replaceAll("{{representante}}", consultantName)
    .replaceAll(/\{\{[a-zA-Z_]+\}\}/g, ""); // remove vars não resolvidas
}

async function fetchInstanceName(supabase: any, consultantId: string): Promise<string | null> {
  const { data } = await supabase
    .from("whatsapp_instances")
    .select("instance_name")
    .eq("consultant_id", consultantId)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.instance_name ?? null;
}

async function logSend(
  supabase: any,
  params: {
    customer_id: string;
    consultant_id: string;
    template_id: string | null;
    conversation_step: string;
    message_text: string;
    trigger_type: "manual" | "auto" | "batch";
    status: "sent" | "failed";
    error_reason?: string;
    batch_id?: string;
  },
) {
  await supabase.from("reactivation_sends").insert({
    customer_id: params.customer_id,
    consultant_id: params.consultant_id,
    template_id: params.template_id,
    conversation_step: params.conversation_step,
    message_text: params.message_text,
    trigger_type: params.trigger_type,
    status: params.status,
    error_reason: params.error_reason ?? null,
    batch_id: params.batch_id ?? null,
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    if (!(await isAutomationEnabled(supabase, "reactivation_cron"))) {
      await logSkipped(supabase, "reactivation_cron");
      return new Response(JSON.stringify({ skipped: "automation_disabled", key: "reactivation_cron" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }


    // ─── Auth ────────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) {
      return new Response(JSON.stringify({ error: "Missing token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const consultantId = user.id;

    // ─── Parse + validate ────────────────────────────────────────────
    const body = (await req.json()) as Body;
    if (!body || (body.mode !== "single" && body.mode !== "batch")) {
      return new Response(JSON.stringify({ error: "mode required: single|batch" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── Consultant info ─────────────────────────────────────────────
    const { data: cons } = await supabase
      .from("consultants")
      .select("id, name, display_name, timezone")
      .eq("id", consultantId)
      .maybeSingle();
    if (!cons) {
      return new Response(JSON.stringify({ error: "Consultant not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Nunca vazar slug/login (silviaclaudiaalmeida) no WhatsApp.
    const consultantName =
      resolvePublicConsultantFirstName(cons.name, (cons as { display_name?: string | null }).display_name) ||
      "iGreen";

    const instanceName = await fetchInstanceName(supabase, consultantId);
    if (!instanceName) {
      return new Response(JSON.stringify({ error: "WhatsApp instance not found or not open" }), {
        status: 412,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 🛡️ Trava de proteção: phone do consultor precisa bater com instância
    const proactiveGuard = await canSendProactive(supabase, { consultantId, instanceName });
    if (!proactiveGuard.allowed) {
      await logProactiveBlock(supabase, {
        consultantId, instanceName,
        reason: proactiveGuard.reason,
        context: { source: "reactivation-send", mode: body.mode, detail: proactiveGuard.detail },
      });
      return new Response(JSON.stringify({
        error: "WhatsApp do consultor não confere com a instância conectada. Atualize o telefone no painel para liberar envios.",
        reason: proactiveGuard.reason,
        detail: proactiveGuard.detail,
      }), { status: 412, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const _rawSender = createEvolutionSender(EVOLUTION_API_URL, EVOLUTION_API_KEY, instanceName);
    const { wrapSenderWithGuard } = await import("../_shared/sender-guard.ts");
    const sender = wrapSenderWithGuard(_rawSender, { supabase, instanceName });


    // ─── Single ──────────────────────────────────────────────────────
    if (body.mode === "single") {
      const { customer_id, message_text, template_id, schedule_at } = body;
      const hasMediaForValidation = !!body.media_url && !!body.media_kind;
      if (!customer_id || (!hasMediaForValidation && (!message_text || message_text.trim().length === 0))) {
        return new Response(JSON.stringify({ error: "customer_id and (message_text or media) required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // RLS check: customer pertence ao consultor
      const { data: customer } = await supabase
        .from("customers")
        .select("id, name, phone_whatsapp, conversation_step, consultant_id, electricity_bill_value, do_not_contact")
        .eq("id", customer_id)
        .eq("consultant_id", consultantId)
        .maybeSingle();
      if (!customer) {
        return new Response(JSON.stringify({ error: "Customer not found or forbidden" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Hard gate LGPD: nunca reaquecer lead em lista de não contato.
      const suppression = await assertCanContact(supabase, {
        customerId: customer_id,
        consultantId,
        phone: (customer as { phone_whatsapp?: string }).phone_whatsapp,
        channel: "reheat",
      });
      if (!suppression.allowed) {
        await logSend(supabase, {
          customer_id,
          consultant_id: consultantId,
          template_id: template_id ?? null,
          conversation_step: String((customer as { conversation_step?: string }).conversation_step || "unknown"),
          message_text: String(message_text || "").slice(0, 500),
          trigger_type: "manual",
          status: "failed",
          error_reason: "do_not_contact",
        });
        return new Response(JSON.stringify({
          ok: false,
          error: "do_not_contact",
          message: "Lead em lista de não contato — reaquecimento bloqueado.",
          reason: suppression.reason,
        }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const finalText = renderVars(message_text, customer, consultantName);

      // Schedule path
      if (schedule_at) {
        const when = new Date(schedule_at);
        const now = new Date();
        const maxFuture = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
        if (isNaN(when.getTime()) || when <= now || when > maxFuture) {
          return new Response(JSON.stringify({ error: "schedule_at must be between 1 minute and 90 days from now" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const { data: scheduled } = await supabase
          .from("scheduled_messages")
          .insert({
            consultant_id: consultantId,
            instance_name: instanceName,
            remote_jid: `${(customer as any).phone_whatsapp}@s.whatsapp.net`,
            message_text: finalText,
            scheduled_at: when.toISOString(),
          })
          .select("id")
          .maybeSingle();
        return new Response(JSON.stringify({ ok: true, scheduled: true, scheduled_id: scheduled?.id }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Send now
      const remoteJid = `${(customer as any).phone_whatsapp}@s.whatsapp.net`;
      try {
        const hasMedia = !!body.media_url && !!body.media_kind;
        const ok = hasMedia
          ? await sender.sendMedia(remoteJid, body.media_url!, finalText, body.media_kind!)
          : await sender.sendText(remoteJid, finalText);
        const status = ok ? "sent" : "failed";
        await logSend(supabase, {
          customer_id,
          consultant_id: consultantId,
          template_id: template_id ?? null,
          conversation_step: (customer as any).conversation_step || "unknown",
          message_text: finalText,
          trigger_type: "manual",
          status,
          error_reason: ok ? undefined : "evolution_send_failed",
        });
        // Loga em conversations pra histórico do CRM
        if (ok) {
          await supabase.from("conversations").insert({
            customer_id,
            message_direction: "outbound",
            message_text: finalText || (hasMedia ? `[${body.media_kind}]` : ""),
            message_type: hasMedia ? body.media_kind! : "text",
            conversation_step: (customer as any).conversation_step,
          });
        }
        jsonLog("info", "reactivation_send_single", { customer_id, status, consultant_id: consultantId });
        return new Response(
          JSON.stringify({ ok, status, customer_id, sent_at: new Date().toISOString() }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        await logSend(supabase, {
          customer_id,
          consultant_id: consultantId,
          template_id: template_id ?? null,
          conversation_step: (customer as any).conversation_step || "unknown",
          message_text: finalText,
          trigger_type: "manual",
          status: "failed",
          error_reason: errMsg,
        });
        return new Response(JSON.stringify({ ok: false, error: errMsg }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // ─── Batch ───────────────────────────────────────────────────────
    if (body.mode === "batch") {
      const { customer_ids, template_overrides, batch_id } = body;
      if (!Array.isArray(customer_ids) || customer_ids.length < 2 || customer_ids.length > 500) {
        return new Response(JSON.stringify({ error: "customer_ids must have 2–500 items" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const finalBatchId = batch_id || crypto.randomUUID();

      // Carrega customers de uma vez (RLS)
      const { data: customers } = await supabase
        .from("customers")
        .select("id, name, phone_whatsapp, conversation_step, consultant_id, electricity_bill_value, do_not_contact")
        .in("id", customer_ids)
        .eq("consultant_id", consultantId);

      if (!customers || customers.length === 0) {
        return new Response(JSON.stringify({ error: "No accessible customers" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Pré-carrega templates ativos do consultor (1 query)
      const { data: templates } = await supabase
        .from("reactivation_templates")
        .select("id, conversation_step, message_text")
        .eq("consultant_id", consultantId)
        .eq("is_active", true);

      const tplByStep = new Map<string, { id: string; message_text: string }>();
      for (const t of (templates as any[]) || []) {
        tplByStep.set(t.conversation_step, { id: t.id, message_text: t.message_text });
      }

      let sent = 0;
      let failed = 0;
      const failures: { customer_id: string; reason: string }[] = [];

      for (const customer of customers as any[]) {
        // Hard gate LGPD por lead (fail-closed via assertCanContact).
        const suppression = await assertCanContact(supabase, {
          customerId: customer.id,
          consultantId,
          phone: customer.phone_whatsapp,
          channel: "reheat",
        });
        if (!suppression.allowed) {
          failed++;
          failures.push({ customer_id: customer.id, reason: "do_not_contact" });
          await logSend(supabase, {
            customer_id: customer.id,
            consultant_id: consultantId,
            template_id: null,
            conversation_step: customer.conversation_step || "unknown",
            message_text: "",
            trigger_type: "batch",
            status: "failed",
            error_reason: "do_not_contact",
            batch_id: finalBatchId,
          });
          continue;
        }

        const step = customer.conversation_step || "unknown";
        const overrideMsg = template_overrides?.[step];
        const tpl = tplByStep.get(step);
        const rawMsg = overrideMsg || tpl?.message_text || "";
        if (!rawMsg.trim()) {
          failed++;
          failures.push({ customer_id: customer.id, reason: "no_template_for_step" });
          await logSend(supabase, {
            customer_id: customer.id,
            consultant_id: consultantId,
            template_id: null,
            conversation_step: step,
            message_text: "",
            trigger_type: "batch",
            status: "failed",
            error_reason: "no_template_for_step",
            batch_id: finalBatchId,
          });
          continue;
        }
        const finalText = renderVars(rawMsg, customer, consultantName);
        const remoteJid = `${customer.phone_whatsapp}@s.whatsapp.net`;

        // 🛡️ Anti-ban guard: respeita warmup + recovery + circuit breaker
        const instName = await fetchInstanceName(supabase, consultantId);
        if (instName) {
          const quota = await checkSendQuota(supabase, instName);
          if (!quota.allowed) {
            failed++;
            failures.push({ customer_id: customer.id, reason: `anti_ban:${quota.reason}` });
            await logSend(supabase, {
              customer_id: customer.id,
              consultant_id: consultantId,
              template_id: tpl?.id ?? null,
              conversation_step: step,
              message_text: finalText,
              trigger_type: "batch",
              status: "failed",
              error_reason: `anti_ban_guard:${quota.reason}`,
              batch_id: finalBatchId,
            });
            break;
          }
        }

        try {
          const ok = await sender.sendText(remoteJid, finalText);
          if (ok) {
            sent++;
            if (instName) await registerSend(supabase, instName);
            await supabase.from("conversations").insert({
              customer_id: customer.id,
              message_direction: "outbound",
              message_text: finalText,
              message_type: "text",
              conversation_step: step,
            });
            await logSend(supabase, {
              customer_id: customer.id,
              consultant_id: consultantId,
              template_id: tpl?.id ?? null,
              conversation_step: step,
              message_text: finalText,
              trigger_type: "batch",
              status: "sent",
              batch_id: finalBatchId,
            });
          } else {
            failed++;
            failures.push({ customer_id: customer.id, reason: "evolution_send_failed" });
            await logSend(supabase, {
              customer_id: customer.id,
              consultant_id: consultantId,
              template_id: tpl?.id ?? null,
              conversation_step: step,
              message_text: finalText,
              trigger_type: "batch",
              status: "failed",
              error_reason: "evolution_send_failed",
              batch_id: finalBatchId,
            });
          }
        } catch (e) {
          failed++;
          const reason = e instanceof Error ? e.message : String(e);
          failures.push({ customer_id: customer.id, reason });
          await logSend(supabase, {
            customer_id: customer.id,
            consultant_id: consultantId,
            template_id: tpl?.id ?? null,
            conversation_step: step,
            message_text: finalText,
            trigger_type: "batch",
            status: "failed",
            error_reason: reason,
            batch_id: finalBatchId,
          });
        }
        // Intervalo entre envios: mínimo do warmup + jitter humano
        await new Promise((r) => setTimeout(r, Math.max(5000, humanJitterMs() * 4)));
      }

      // Audit log
      try {
        await supabase.from("audit_log").insert({
          consultant_id: consultantId,
          action: "reactivation_batch_send",
          entity_type: "reactivation_sends",
          payload: {
            batch_id: finalBatchId,
            total: customers.length,
            sent,
            failed,
          },
        });
      } catch (_) { /* audit_log is best-effort */ }

      return new Response(
        JSON.stringify({ ok: true, batch_id: finalBatchId, total: customers.length, sent, failed, failures }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ error: "Invalid mode" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    captureError(err, { tags: { function: "reactivation-send" } });
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});