// 3.5 — Alertas operacionais para super_admin.
// Cron a cada 5min. Detecta:
//   1) Instâncias whatsapp_instances com status down há mais de 5min.
//   2) (Stub) Worker-portal offline — futuro, requer endpoint /health no worker.
// Notifica super_admin via Evolution. Dedup: 30min por instância/severidade
// usando infra_metrics(metric_key='instance_alert').

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EVOLUTION_API_URL = (Deno.env.get("EVOLUTION_API_URL") || "").replace(/\/$/, "");
const EVOLUTION_API_KEY = Deno.env.get("EVOLUTION_API_KEY") || "";
const DOWN_STATUSES = ["needs_reconnect", "disconnected", "close"];

async function sendAlert(supabase: any, key: string, severity: string, text: string): Promise<boolean> {
  const dedupCutoff = new Date(Date.now() - 30 * 60_000).toISOString();
  const { data: recent } = await supabase
    .from("infra_metrics")
    .select("id")
    .eq("metric_key", "instance_alert")
    .gte("created_at", dedupCutoff)
    .contains("meta", { key, severity })
    .limit(1);
  if (recent && recent.length > 0) return false;

  const { data: settings } = await supabase
    .from("app_settings")
    .select("super_admin_phone, super_admin_instance_name")
    .eq("id", "global")
    .maybeSingle();
  const phone = (settings as any)?.super_admin_phone;
  const inst = (settings as any)?.super_admin_instance_name;
  if (!phone || !inst || !EVOLUTION_API_URL || !EVOLUTION_API_KEY) return false;

  try {
    const jid = `${String(phone).replace(/\D/g, "")}@s.whatsapp.net`;
    // INTENTIONAL: staff alert — bypasses anti-ban guard (alerta crítico ao super-admin)
    const r = await fetch(`${EVOLUTION_API_URL}/message/sendText/${encodeURIComponent(inst)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: EVOLUTION_API_KEY },
      body: JSON.stringify({ number: jid, text }),
    });
    const ok = r.ok;
    await supabase.from("infra_metrics").insert({
      metric_key: "instance_alert",
      value_num: null,
      meta: { key, severity, text, sent: ok },
    });
    return ok;
  } catch (e) {
    console.error("[super-admin-alerts] envio falhou:", (e as Error).message);
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const cutoff = new Date(Date.now() - 5 * 60_000).toISOString();
  const { data: down } = await supabase
    .from("whatsapp_instances")
    .select("id, instance_name, status, last_health_check_at, consultant_id, consultants:consultant_id(name, license)")
    .in("status", DOWN_STATUSES)
    .or(`last_health_check_at.is.null,last_health_check_at.lt.${cutoff}`)
    .limit(50);

  let notified = 0;
  const results: Array<{ instance: string; notified: boolean }> = [];
  for (const inst of (down as any[]) || []) {
    const consultantName = (inst as any).consultants?.name || "?";
    const license = (inst as any).consultants?.license || "—";
    const txt =
      `⚠️ Instância WhatsApp fora do ar\n\n` +
      `👤 ${consultantName} (lic ${license})\n` +
      `📦 Instância: ${inst.instance_name}\n` +
      `📡 Status: ${inst.status}\n` +
      `🕐 Última checagem: ${inst.last_health_check_at || "nunca"}\n\n` +
      `Verifique no Easypanel ou peça pro consultor reconectar.`;
    const ok = await sendAlert(supabase, `instance:${inst.instance_name}`, "warn", txt);
    if (ok) notified++;
    results.push({ instance: inst.instance_name, notified: ok });
  }

  return new Response(
    JSON.stringify({ ok: true, down: results.length, notified, results }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
