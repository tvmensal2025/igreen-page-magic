// close-attendance-scheduled
// Cron: varre customers.attendance_auto_close_at <= now(), pega o toggle
// `end_customer_attendance_auto` e chama sendAttendanceRatingRequest para cada um.
// Segurança: pula quem já foi avaliado, quem respondeu (o trigger de inbound
// já limpa attendance_auto_close_at), quem já pediu avaliação, ou se o toggle
// universal estiver desligado.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { sendAttendanceRatingRequest } from "../_shared/attendance-flow.ts";
import { loadChannelEnv } from "../_shared/attendance-channel-env.ts";
import { isAutomationEnabled, logSkipped } from "../_shared/automation-gate.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    if (!(await isAutomationEnabled(supabase, "end_customer_attendance_auto"))) {
      await logSkipped(supabase, "end_customer_attendance_auto");
      return json({ ok: true, skipped: "automation_disabled", processed: 0 });
    }

    const { data: due, error } = await supabase
      .from("customers")
      .select("id, consultant_id, attendance_rating_requested_at, attendance_rating, welcome_sent_at, attendance_auto_close_at")
      .lte("attendance_auto_close_at", new Date().toISOString())
      .not("attendance_auto_close_at", "is", null)
      .limit(30);

    if (error) throw error;
    if (!due || due.length === 0) {
      return json({ ok: true, processed: 0 });
    }

    const env = await loadChannelEnv(supabase);
    let closed = 0;
    let skipped = 0;
    let failed = 0;

    for (const c of due) {
      const row = c as Record<string, unknown>;
      const customerId = String(row.id);
      const consultantId = row.consultant_id ? String(row.consultant_id) : null;

      // Já avaliado / pesquisa já pedida / sem consultor → apenas limpa flag.
      const skipReason =
        !consultantId ? "no_consultant" :
        row.attendance_rating != null ? "already_rated" :
        row.attendance_rating_requested_at ? "rating_pending" :
        !row.welcome_sent_at ? "not_started" :
        null;

      if (skipReason) {
        await supabase
          .from("customers")
          .update({ attendance_auto_close_at: null, attendance_auto_close_source: null })
          .eq("id", customerId);
        skipped++;
        continue;
      }

      try {
        const res = await sendAttendanceRatingRequest(supabase, {
          customerId,
          consultantId: consultantId!,
          env,
          superadminConsultantId: env.superadminConsultantId,
        });
        // Sucesso, skipped ou soft-fail → limpa a flag (não fica em loop).
        await supabase
          .from("customers")
          .update({ attendance_auto_close_at: null, attendance_auto_close_source: null })
          .eq("id", customerId);
        if (res.ok) closed++;
        else failed++;
      } catch (e) {
        // Exceção (rede/timeout): antes a flag ficava intocada e o registro
        // era reprocessado a cada tick, para sempre. Agora: retry em 30min;
        // se a flag já venceu há mais de 24h, desiste e limpa (sem loop).
        console.error("[close-attendance-scheduled] fail", customerId, e);
        const dueAt = row.attendance_auto_close_at ? new Date(String(row.attendance_auto_close_at)).getTime() : 0;
        const expired = dueAt > 0 && Date.now() - dueAt > 24 * 3600_000;
        await supabase
          .from("customers")
          .update(expired
            ? { attendance_auto_close_at: null, attendance_auto_close_source: null }
            : { attendance_auto_close_at: new Date(Date.now() + 30 * 60_000).toISOString() })
          .eq("id", customerId);
        failed++;
      }
    }

    return json({ ok: true, processed: due.length, closed, skipped, failed });
  } catch (e) {
    console.error("[close-attendance-scheduled] exception", e);
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
