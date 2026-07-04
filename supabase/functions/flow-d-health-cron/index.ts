// Flow D health cron — detecta leads travados em pontos críticos do Fluxo D
// e registra alertas em bot_handoff_alerts. Roda a cada 1 minuto.
//
// Reqs cobertos: 2.5 (flow_d_stuck), 2.6 (flow_d_ocr_failed_bill),
// 2.7 (flow_d_ocr_failed_doc).
//
// Critério de "travado":
//  - Lead em Fluxo D (flow_variant='D')
//  - status NOT IN ('approved','cancelled')
//  - última atividade do bot há mais de 30 segundos (last_bot_reply_at)
//  - conversation_step em um dos pontos críticos (aguardando_conta após OCR,
//    capture_documento, etc.)
//
// Anti-spam: só insere alerta se já não tem um do mesmo tipo nos últimos 30 minutos.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jsonLog, captureError } from "../_shared/audit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CheckResult {
  alerts_created: number;
  candidates_scanned: number;
}

async function checkFlowDHealth(supabase: any): Promise<CheckResult> {
  // Steps onde o lead "para" e que esperam ação automática do bot:
  const STUCK_STEPS = [
    "processando_ocr_conta",   // OCR conta deveria avançar em ~5s
    "confirmando_dados_conta", // espera SIM/NÃO/EDITAR mas se já foi 30s sem avanço, alerta
    "aguardando_doc_auto",     // espera doc por upload
    "aguardando_doc_frente",
    "aguardando_doc_verso",
  ];

  const since = new Date(Date.now() - 30_000).toISOString(); // 30s atrás
  const alertWindowStart = new Date(Date.now() - 30 * 60_000).toISOString();

  // Busca candidatos em Fluxo D parados >30s em steps críticos
  const { data: candidates } = await supabase
    .from("customers")
    .select("id, consultant_id, conversation_step, last_bot_reply_at, updated_at, name, phone_whatsapp, flow_variant")
    .in("flow_variant", ["D", "M"])
    .not("status", "in", "(approved,cancelled)")
    .in("conversation_step", STUCK_STEPS)
    .lt("last_bot_reply_at", since)
    .limit(200);

  if (!candidates || candidates.length === 0) {
    return { alerts_created: 0, candidates_scanned: 0 };
  }

  let alertsCreated = 0;

  for (const c of candidates as any[]) {
    // Determina o tipo de alerta com base no step
    let alertType = "flow_d_stuck";
    if (c.conversation_step === "processando_ocr_conta") alertType = "flow_d_ocr_failed_bill";
    else if (
      c.conversation_step === "aguardando_doc_auto" ||
      c.conversation_step === "aguardando_doc_frente" ||
      c.conversation_step === "aguardando_doc_verso"
    ) alertType = "flow_d_ocr_failed_doc";

    // Anti-spam: já tem alerta do mesmo tipo recente?
    const { count: recentAlertCount } = await supabase
      .from("bot_handoff_alerts")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", c.id)
      .eq("reason", alertType)
      .gte("created_at", alertWindowStart);

    if ((recentAlertCount ?? 0) > 0) continue;

    // Cria alerta
    const { error } = await supabase.from("bot_handoff_alerts").insert({
      customer_id: c.id,
      consultant_id: c.consultant_id,
      phone: c.phone_whatsapp,
      reason: alertType,
      metadata: {
        conversation_step: c.conversation_step,
        last_bot_reply_at: c.last_bot_reply_at,
        flow_variant: "D",
        detected_at: new Date().toISOString(),
      },
    });

    if (!error) {
      alertsCreated++;
      jsonLog("info", "flow_d_alert_created", {
        customer_id: c.id,
        consultant_id: c.consultant_id,
        alert_type: alertType,
        step: c.conversation_step,
      });
    } else {
      console.warn(`[flow-d-health] insert alert failed:`, error.message);
    }
  }

  return { alerts_created: alertsCreated, candidates_scanned: candidates.length };
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

    const result = await checkFlowDHealth(supabase);
    jsonLog("info", "flow_d_health_done", result);

    return new Response(JSON.stringify({ ok: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    captureError(err, { tags: { function: "flow-d-health-cron" } });
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
