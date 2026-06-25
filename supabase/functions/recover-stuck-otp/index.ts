// Edge function executada via cron diário.
// Identifica leads parados em `awaiting_otp` há mais de 24h e os requeue
// enviando uma mensagem de follow-up via Evolution API.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EVOLUTION_API_URL = Deno.env.get("EVOLUTION_API_URL") || "";
const EVOLUTION_API_KEY = Deno.env.get("EVOLUTION_API_KEY") || "";

const STUCK_HOURS = 24;
const FOLLOWUP_MESSAGE =
  "🔔 Olá! Notamos que ainda estamos aguardando o código de verificação para finalizar seu cadastro na iGreen Energy.\n\n" +
  "📱 Por favor, verifique suas mensagens no WhatsApp e nos envie o código aqui.\n\n" +
  "Se você não recebeu o código ou precisa de ajuda, é só responder esta mensagem!";

async function sendWhatsAppText(supabase: any, instanceName: string, remoteJid: string, text: string) {
  if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY) return false;
  // Anti-ban: bloqueia se instância em fatal_lock / recovery / quota estourada
  const { checkSendQuota, registerSend } = await import("../_shared/anti-ban.ts");
  const quota = await checkSendQuota(supabase, instanceName);
  if (!quota.allowed) {
    console.warn(`🚫 [recover-stuck-otp] envio bloqueado instance=${instanceName} reason=${quota.reason}`);
    return false;
  }
  const url = `${EVOLUTION_API_URL.replace(/\/$/, "")}/message/sendText/${instanceName}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: EVOLUTION_API_KEY,
      },
      body: JSON.stringify({ number: remoteJid, text }),
    });
    if (res.ok) await registerSend(supabase, instanceName);
    return res.ok;
  } catch (e) {
    console.error(`[recover-stuck-otp] sendText failed: ${(e as Error).message}`);
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // ─── Auth: only the cron job (with shared secret) can trigger this ─────
  const expectedSecret = Deno.env.get("CRON_SECRET") || Deno.env.get("WORKER_SECRET");
  const providedSecret = req.headers.get("x-cron-secret") || req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (expectedSecret && providedSecret !== expectedSecret) {
    console.warn("[recover-stuck-otp] Unauthorized attempt");
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const cutoff = new Date(Date.now() - STUCK_HOURS * 3600_000).toISOString();

  // Buscar leads em awaiting_otp ou aguardando_otp há mais de N horas
  const { data: stuck, error } = await supabase
    .from("customers")
    .select("id, name, phone_whatsapp, consultant_id, status, conversation_step, updated_at, otp_received_at")
    .or("status.eq.awaiting_otp,conversation_step.eq.aguardando_otp")
    .lt("updated_at", cutoff)
    .eq("bot_paused", false)
    .is("assigned_human_id", null)
    .limit(100);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const results: Array<{ id: string; sent: boolean; reason?: string }> = [];

  for (const lead of stuck || []) {
    if (!lead.consultant_id) {
      results.push({ id: lead.id, sent: false, reason: "no_consultant" });
      continue;
    }

    // Buscar instance_name do consultor
    const { data: instance } = await supabase
      .from("whatsapp_instances")
      .select("instance_name")
      .eq("consultant_id", lead.consultant_id)
      .maybeSingle();

    if (!instance?.instance_name) {
      results.push({ id: lead.id, sent: false, reason: "no_instance" });
      continue;
    }

    const remoteJid = `${lead.phone_whatsapp}@s.whatsapp.net`;
    const sent = await sendWhatsAppText(supabase, instance.instance_name, remoteJid, FOLLOWUP_MESSAGE);

    if (sent) {
      // Marcar como reativado para não mandar de novo amanhã
      await supabase
        .from("customers")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", lead.id);

      await supabase.from("conversations").insert({
        customer_id: lead.id,
        message_direction: "outbound",
        message_text: FOLLOWUP_MESSAGE,
        message_type: "text",
        conversation_step: "stuck_otp_followup",
      });
    }

    results.push({ id: lead.id, sent });
  }

  // ─── F6 — Recovery branch: leads parados em "finalizando" > 10min ─────
  // Notifica o consultor (notification_phone) para intervenção manual.
  // Sem requeue automático: finalizando envolve OTP/portal externos,
  // não dá pra disparar mensagem genérica sem risco.
  const finalizandoCutoff = new Date(Date.now() - 10 * 60_000).toISOString();
  const handoffResults: Array<{ id: string; notified: boolean; reason?: string }> = [];
  try {
    const { data: stuckFinal } = await supabase
      .from("customers")
      .select("id, name, phone_whatsapp, consultant_id, conversation_step, updated_at")
      .eq("conversation_step", "finalizando")
      .lt("updated_at", finalizandoCutoff)
      .eq("bot_paused", false)
      .is("assigned_human_id", null)
      .limit(50);

    for (const lead of stuckFinal || []) {
      if (!lead.consultant_id) {
        handoffResults.push({ id: lead.id, notified: false, reason: "no_consultant" });
        continue;
      }

      // Dedup: já notificamos esse lead nas últimas 6h?
      const { data: recent } = await supabase
        .from("conversations")
        .select("id")
        .eq("customer_id", lead.id)
        .eq("conversation_step", "stuck_finalizando_notify")
        .gte("created_at", new Date(Date.now() - 6 * 3600_000).toISOString())
        .limit(1);
      if (recent && recent.length > 0) {
        handoffResults.push({ id: lead.id, notified: false, reason: "deduped" });
        continue;
      }

      const { data: consultant } = await supabase
        .from("consultants")
        .select("notification_phone, name")
        .eq("id", lead.consultant_id)
        .maybeSingle();
      const notifPhone = (consultant as any)?.notification_phone;
      if (!notifPhone) {
        handoffResults.push({ id: lead.id, notified: false, reason: "no_notification_phone" });
        continue;
      }

      const { data: instance } = await supabase
        .from("whatsapp_instances")
        .select("instance_name")
        .eq("consultant_id", lead.consultant_id)
        .maybeSingle();
      if (!instance?.instance_name) {
        handoffResults.push({ id: lead.id, notified: false, reason: "no_instance" });
        continue;
      }

      const msg =
        `⚠️ Lead parado em *finalizando* há mais de 10 min\n\n` +
        `👤 ${lead.name || "Sem nome"}\n` +
        `📱 ${lead.phone_whatsapp}\n\n` +
        `Verifique se o cadastro travou no portal/OTP e ajude manualmente.`;
      const notifJid = `${String(notifPhone).replace(/\D/g, "")}@s.whatsapp.net`;
      const ok = await sendWhatsAppText(supabase, instance.instance_name, notifJid, msg);

      if (ok) {
        // Marca dedup via conversations (sem mexer no updated_at do lead)
        await supabase.from("conversations").insert({
          customer_id: lead.id,
          message_direction: "outbound",
          message_text: "[handoff:finalizando] notificou consultor",
          message_type: "text",
          conversation_step: "stuck_finalizando_notify",
        });
      }
      handoffResults.push({ id: lead.id, notified: ok });
    }
  } catch (e) {
    console.error("[recover-stuck-otp] finalizando branch failed:", (e as Error).message);
  }

  // ─── REPLAY de OTP pendente ─────────────────────────────────────────────
  // Casos em que o cliente respondeu o código ANTES de o Portal 2 terminar
  // o cadastro: o webhook grava otp_code + otp_pending_replay=true e aqui
  // disparamos /confirm-otp do worker assim que portal2_idcliente existir.
  const replayResults: Array<{ id: string; replayed: boolean; reason?: string }> = [];
  try {
    const { data: pending } = await supabase
      .from("customers")
      .select("id, consultant_id, otp_code, portal2_idcliente, consultants:consultant_id(igreen_id)")
      .eq("otp_pending_replay", true)
      .not("portal2_idcliente", "is", null)
      .not("otp_code", "is", null)
      .limit(50);

    const workerUrl = (Deno.env.get("PORTAL2_WORKER_URL") || "").replace(/\/$/, "");
    const workerSecret = Deno.env.get("PORTAL2_WORKER_SECRET") || Deno.env.get("WORKER_SECRET") || "";

    for (const lead of pending || []) {
      if (!workerUrl || !workerSecret) {
        replayResults.push({ id: lead.id, replayed: false, reason: "worker_not_configured" });
        continue;
      }
      const idconsultor = (lead as any)?.consultants?.igreen_id;
      const idcliente = lead.portal2_idcliente;
      if (!idconsultor || !idcliente) {
        replayResults.push({ id: lead.id, replayed: false, reason: "missing_ids" });
        continue;
      }
      try {
        const r = await fetch(`${workerUrl}/confirm-otp`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${workerSecret}` },
          body: JSON.stringify({
            customer_id: lead.id,
            idconsultor: Number(idconsultor),
            idcliente: Number(idcliente),
            code: lead.otp_code,
          }),
        });
        const ok = r.ok;
        if (ok) {
          await supabase.from("customers").update({ otp_pending_replay: false }).eq("id", lead.id);
        }
        replayResults.push({ id: lead.id, replayed: ok, reason: ok ? undefined : `worker_${r.status}` });
      } catch (e) {
        replayResults.push({ id: lead.id, replayed: false, reason: (e as Error).message });
      }
    }
  } catch (e) {
    console.error("[recover-stuck-otp] replay branch failed:", (e as Error).message);
  }

  return new Response(
    JSON.stringify({
      ok: true,
      processed: results.length,
      sent: results.filter((r) => r.sent).length,
      finalizando_processed: handoffResults.length,
      finalizando_notified: handoffResults.filter((r) => r.notified).length,
      replay_processed: replayResults.length,
      replay_succeeded: replayResults.filter((r) => r.replayed).length,
      results,
      handoffResults,
      replayResults,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});

