// cadence-tick — cron 5 min do motor "Zero Lead Perdido" (Fase 2).
//
// Varre lead_cadence_state onde next_action_at <= now() e stage pendente.
// Para stages WhatsApp (COLD_*) faz o disparo real usando o canal do cliente
// (evolution/whapi) + template configurável por consultor em cadence_stage_config.
// Voice/SMS/Meta ficam registrados como "queued" para as fases 3-5.

import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { STAGE_MAP, computeNextActionAt, shouldDispatch, type Stage } from "../_shared/cadence-engine.ts";
import { isBusinessHour } from "../_shared/business-window.ts";
import { resolveChannelForCustomer, isUnavailable, ctx } from "../_shared/channel-sender.ts";
import { checkSendQuota, registerSend } from "../_shared/anti-ban.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface StageConfig {
  enabled: boolean;
  delay_hours: number;
  message_text: string | null;
  media_url: string | null;
  media_type: string | null;
}

async function loadStageConfig(
  supabase: any,
  consultantId: string | null,
  stage: string,
): Promise<StageConfig | null> {
  // 1) consultor-específico
  if (consultantId) {
    const { data } = await supabase
      .from("cadence_stage_config")
      .select("enabled, delay_hours, message_text, media_url, media_type")
      .eq("consultant_id", consultantId)
      .eq("stage", stage)
      .maybeSingle();
    if (data) return data;
  }
  // 2) global
  const { data: g } = await supabase
    .from("cadence_stage_config")
    .select("enabled, delay_hours, message_text, media_url, media_type")
    .is("consultant_id", null)
    .eq("stage", stage)
    .maybeSingle();
  return g ?? null;
}

function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? "");
}

async function dispatchWhatsApp(
  supabase: any,
  env: { evolutionUrl?: string; evolutionKey?: string; whapiToken: string },
  row: any,
  stage: Stage,
  cfg: StageConfig,
): Promise<{ ok: boolean; detail: string }> {
  const { data: cust } = await supabase
    .from("customers")
    .select("id, name, phone_whatsapp, consultant_id")
    .eq("id", row.customer_id)
    .maybeSingle();

  if (!cust?.phone_whatsapp) return { ok: false, detail: "no_phone" };

  const ch = await resolveChannelForCustomer(supabase, row.customer_id, {
    evolutionUrl: env.evolutionUrl,
    evolutionKey: env.evolutionKey,
    whapiToken: env.whapiToken,
  });
  if (isUnavailable(ch)) return { ok: false, detail: `channel_${ch.reason}` };

  const quota = await checkSendQuota(supabase, ch.instanceName);
  if (!quota.allowed) return { ok: false, detail: `quota_${quota.reason}` };

  const firstName = (cust.name || "").split(" ")[0] || "";
  const text = renderTemplate(cfg.message_text || "", { nome: firstName });
  const jid = `${String(cust.phone_whatsapp).replace(/\D/g, "")}@s.whatsapp.net`;
  const sendCtx = ctx(row.consultant_id || "system", row.customer_id, `cadence:${stage}`);

  try {
    const mtype = cfg.media_type || "text";
    let r;
    if (mtype === "audio" && cfg.media_url) {
      r = await ch.adapter.sendMedia(jid, { kind: "audio", url: cfg.media_url, ptt: true } as any, sendCtx);
    } else if ((mtype === "image" || mtype === "video") && cfg.media_url) {
      r = await ch.adapter.sendMedia(jid, { kind: mtype, url: cfg.media_url, caption: text } as any, sendCtx);
    } else {
      if (!text.trim()) return { ok: false, detail: "empty_message" };
      r = await ch.adapter.sendText(jid, text, { ...sendCtx, supabase } as any);
    }
    if (!(r as any)?.ok) return { ok: false, detail: `send_failed:${(r as any)?.detail ?? "?"}` };
    await registerSend(supabase, ch.instanceName);
    return { ok: true, detail: `sent_via_${ch.kind}` };
  } catch (e) {
    return { ok: false, detail: `exception:${(e as Error).message}` };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const env = {
    evolutionUrl: Deno.env.get("EVOLUTION_API_URL") ?? undefined,
    evolutionKey: Deno.env.get("EVOLUTION_API_KEY") ?? undefined,
    whapiToken: Deno.env.get("WHAPI_TOKEN") ?? "",
  };

  // Kill-switch global
  const { data: settings } = await supabase
    .from("app_settings")
    .select("cadence_engine_enabled")
    .eq("id", "global")
    .maybeSingle();

  if (!settings?.cadence_engine_enabled) {
    return json({ skipped: "cadence_disabled" });
  }

  const now = new Date();
  const { data: due, error } = await supabase
    .from("lead_cadence_state")
    .select("id, customer_id, consultant_id, stage, attempts_by_channel, paused_until")
    .lte("next_action_at", now.toISOString())
    .not("stage", "in", "(CLOSE_LOST,WON,PAUSED,RETARGET_META)")
    .order("next_action_at", { ascending: true })
    .limit(100);

  if (error) return json({ error: error.message }, 500);
  if (!due || due.length === 0) return json({ processed: 0 });

  let dispatched = 0, deferred = 0, skipped = 0, sent = 0, failed = 0;

  for (const row of due) {
    const stage = row.stage as Stage;
    if (row.paused_until && new Date(row.paused_until) > now) {
      await supabase.from("lead_cadence_state").update({ next_action_at: row.paused_until }).eq("id", row.id);
      deferred++; continue;
    }
    const def = STAGE_MAP[stage];
    if (!def) { skipped++; continue; }

    if (def.requiresBusinessHours && !isBusinessHour(now)) {
      const nextSlot = computeNextActionAt(stage, now);
      await supabase.from("lead_cadence_state").update({ next_action_at: nextSlot?.toISOString() }).eq("id", row.id);
      deferred++; continue;
    }
    if (!shouldDispatch(stage, now)) { skipped++; continue; }

    let status: "queued" | "sent" | "failed" = "queued";
    let detail: Record<string, unknown> = { note: "phase2_orchestrator", scheduled_next: def.next };

    // Fase 2: WhatsApp real para COLD_*
    if (def.channel === "whatsapp" && stage.startsWith("COLD_")) {
      const cfg = await loadStageConfig(supabase, row.consultant_id, stage);
      if (!cfg || !cfg.enabled) {
        detail = { ...detail, reason: "config_disabled_or_missing" };
      } else {
        const res = await dispatchWhatsApp(supabase, env, row, stage, cfg);
        status = res.ok ? "sent" : "failed";
        detail = { ...detail, dispatch: res.detail };
        if (res.ok) sent++; else failed++;
      }
    }

    const insertRes = await supabase.from("cadence_action_log").insert({
      customer_id: row.customer_id,
      consultant_id: row.consultant_id,
      stage, channel: def.channel, status, detail,
    });
    if (insertRes.error && !String(insertRes.error.message).includes("duplicate")) {
      console.error("cadence log insert failed", insertRes.error);
    }

    const nextAt = computeNextActionAt(def.next, now);
    const attempts = (row.attempts_by_channel as Record<string, number>) ?? {};
    attempts[def.channel] = (attempts[def.channel] ?? 0) + 1;

    await supabase.from("lead_cadence_state").update({
      stage: def.next,
      last_action_at: now.toISOString(),
      next_action_at: nextAt?.toISOString() ?? null,
      attempts_by_channel: attempts,
    }).eq("id", row.id);

    dispatched++;
  }

  return json({ processed: due.length, dispatched, deferred, skipped, sent, failed });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
