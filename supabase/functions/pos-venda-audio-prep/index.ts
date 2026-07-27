// Pré-gera TTS dos agendamentos pós-venda (atrasados + 48h).
// Roda FORA da janela 08–20 — só prepara áudio; não envia.
// Auth: assertCronAuth (x-internal-secret / x-service-secret).

import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { assertCronAuth, cronAuthUnauthorized } from "../_shared/cron-auth.ts";
import { isAutomationEnabled } from "../_shared/automation-gate.ts";
import { runPosVendaAudioPrepTick } from "../_shared/pos-venda-audio-prep.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-service-secret, x-internal-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const cronAuth = await assertCronAuth(req, supabase as any);
    if (!cronAuth.ok) return cronAuthUnauthorized(cronAuth.reason, corsHeaders);

    if (!(await isAutomationEnabled(supabase, "pos_venda_auto_messages"))) {
      return new Response(
        JSON.stringify({ skipped: "automation_disabled", key: "pos_venda_auto_messages" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let limit = 40;
    try {
      const body = await req.json().catch(() => ({}));
      const n = Number(body?.limit);
      if (Number.isFinite(n) && n > 0) limit = Math.min(80, Math.floor(n));
    } catch {
      /* default */
    }

    const result = await runPosVendaAudioPrepTick(supabase, { limit });
    console.log(JSON.stringify({ event: "pos_venda_audio_prep", ...result }));

    return new Response(JSON.stringify({ ok: true, ...result }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[pos-venda-audio-prep]", (e as Error)?.message);
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
