import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { captureError } from "../_shared/sentry.ts";
import { isQuietHourBRT, nextQuietWindowEndISO, logQuietSkip } from "../_shared/quiet-hours.ts";
import { isBotGloballyEnabled } from "../_shared/bot/global-flag.ts";
import { renderTemplateVars } from "../_shared/render-vars.ts";
import { checkSendQuota, registerSend, simulateTyping, typingDurationMs, humanJitterMs } from "../_shared/anti-ban.ts";
import { isAutomationEnabled, logSkipped } from "../_shared/automation-gate.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const evolutionUrl = Deno.env.get("EVOLUTION_API_URL");
    const evolutionKey = Deno.env.get("EVOLUTION_API_KEY");

    if (!evolutionUrl || !evolutionKey) {
      return new Response(JSON.stringify({ error: "Evolution API not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    if (!(await isBotGloballyEnabled(supabase))) {
      return new Response(JSON.stringify({ skipped: "bot_globally_disabled" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!(await isAutomationEnabled(supabase, "send_scheduled_messages"))) {
      await logSkipped(supabase, "send_scheduled_messages");
      return new Response(JSON.stringify({ skipped: "automation_disabled" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Em horário de silêncio: adia mensagens devidas para 08:00 BRT e sai.
    if (isQuietHourBRT()) {
      const nextRun = nextQuietWindowEndISO();
      const { data: deferred, error: deferError } = await supabase
        .from("scheduled_messages")
        .update({ scheduled_at: nextRun })
        .eq("status", "pending")
        .lte("scheduled_at", new Date().toISOString())
        .select("id");
      if (deferError) throw deferError;
      logQuietSkip("send-scheduled-messages", { deferred: deferred?.length ?? 0, next_run: nextRun });
      return new Response(
        JSON.stringify({ skipped: "quiet_hours", deferred: deferred?.length ?? 0, next_run: nextRun }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Fetch pending messages where scheduled_at <= now
    const { data: messages, error: fetchError } = await supabase
      .from("scheduled_messages")
      .select("*")
      .eq("status", "pending")
      .lte("scheduled_at", new Date().toISOString())
      .order("scheduled_at", { ascending: true })
      .limit(50);

    if (fetchError) throw fetchError;
    if (!messages || messages.length === 0) {
      return new Response(JSON.stringify({ sent: 0, failed: 0, message: "No pending messages" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let sentCount = 0;
    let failedCount = 0;
    let skippedPaused = 0;

    for (const msg of messages) {
      try {
        const phone = msg.remote_jid.split("@")[0].replace(/\D/g, "");

        // 🛑 Regra de ouro: humano assumiu → IA NÃO manda nada
        let customerName: string | null = null;
        let billValue: number | null = null;
        let representante: string | null = null;
        if (phone) {
          const { data: cust } = await supabase
            .from("customers")
            .select("name, electricity_bill_value, consultant_id, bot_paused, assigned_human_id, bot_paused_until")
            .eq("phone_whatsapp", phone)
            .order("updated_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          const paused =
            !!cust?.bot_paused ||
            !!cust?.assigned_human_id ||
            (cust?.bot_paused_until && new Date(cust.bot_paused_until).getTime() > Date.now());
          if (paused) {
            await supabase
              .from("scheduled_messages")
              .update({ status: "skipped" })
              .eq("id", msg.id);
            console.log(`⏭️ [scheduled] msg ${msg.id} pulada — humano assumiu (phone=${phone})`);
            skippedPaused++;
            continue;
          }
          customerName = (cust as any)?.name || null;
          billValue = (cust as any)?.electricity_bill_value ?? null;
          if ((cust as any)?.consultant_id) {
            const { data: consultant } = await supabase
              .from("consultants")
              .select("name")
              .eq("id", (cust as any).consultant_id)
              .maybeSingle();
            representante = (consultant as any)?.name || null;
          }
        }

        // ✅ Renderiza {{nome}}, {nome}, {NOME}, {{valor_conta}} etc. antes de enviar.
        const renderedText = renderTemplateVars(msg.message_text, {
          name: customerName,
          phone,
          representante,
          valor_conta: billValue,
        });

        // 🛡️ Anti-ban guard
        const quota = await checkSendQuota(supabase, msg.instance_name);
        if (!quota.allowed) {
          // Reagendar para depois (não falhar — só pausar)
          const retryAt = quota.until || quota.next_allowed_at
            || new Date(Date.now() + 30 * 60_000).toISOString();
          await supabase.from("scheduled_messages")
            .update({ scheduled_at: retryAt })
            .eq("id", msg.id);
          console.log(`⏸️ [scheduled] msg ${msg.id} adiada (anti-ban): ${quota.reason} → ${retryAt}`);
          continue;
        }

        // Humaniza: "digitando..."
        await simulateTyping({
          baseUrl: evolutionUrl, apiKey: evolutionKey,
          instance: msg.instance_name, remoteJid: phone,
          durationMs: typingDurationMs(renderedText),
        });

        const res = await fetch(`${evolutionUrl}/message/sendText/${msg.instance_name}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: evolutionKey },
          body: JSON.stringify({ number: phone, text: renderedText }),
        });

        if (res.ok) {
          await supabase
            .from("scheduled_messages")
            .update({ status: "sent", sent_at: new Date().toISOString() })
            .eq("id", msg.id);
          await registerSend(supabase, msg.instance_name);
          sentCount++;
        } else {
          const errText = await res.text();
          console.error(`Failed to send scheduled message ${msg.id}:`, errText);
          await supabase
            .from("scheduled_messages")
            .update({ status: "failed" })
            .eq("id", msg.id);
          failedCount++;
        }
      } catch (err) {
        console.error(`Error sending message ${msg.id}:`, err);
        await supabase
          .from("scheduled_messages")
          .update({ status: "failed" })
          .eq("id", msg.id);
        failedCount++;
      }

      // Intervalo mínimo do warmup + jitter humano
      if (messages.indexOf(msg) < messages.length - 1) {
        await new Promise((r) => setTimeout(r, Math.max(5000, humanJitterMs() * 3)));
      }
    }

    return new Response(
      JSON.stringify({ sent: sentCount, failed: failedCount, skipped_paused: skippedPaused, total: messages.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    captureError(error, { tags: { function: "send-scheduled-messages" } });
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
