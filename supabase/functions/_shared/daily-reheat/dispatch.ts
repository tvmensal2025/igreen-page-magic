/**
 * daily-reheat dispatch — Fase 1 (código pronto, cadeados OFF).
 *
 * Só envia se TODOS forem true:
 *   1. automation_toggles.daily_reheat
 *   2. daily_reheat_settings.enabled
 *   3. daily_reheat_settings.live_dispatch_enabled
 *   4. app_settings.bot_global_enabled
 *   5. dryRun === false no cron
 *
 * Sem isso, NUNCA chama WhatsApp / Velip / SMS.
 */

import { sendWelcomeHeader, sendAttendanceRatingRequest } from "../attendance-flow.ts";
import { resolveChannelForCustomer } from "../channel-sender.ts";
import {
  makeTTSCall,
  playAudioFile,
  makeSMS,
  toVelipBRDest,
  toCtid,
  velipConfigured,
} from "../voice-dialer/velip.ts";
import { recordProactiveTouch } from "../retention-orchestrator.ts";
import { isAutomationEnabled } from "../automation-gate.ts";
import { isBotGloballyEnabled } from "../bot/global-flag.ts";
import type { CandidatePlan, DailyReheatSettings, PlannedAction } from "./plan.ts";

// deno-lint-ignore no-explicit-any
type SB = any;

export type CycleKit = {
  consultant_id: string;
  wa_open_text: string | null;
  wa_audio_mon_url: string | null;
  wa_audio_tue_url: string | null;
  wa_audio_wed_url: string | null;
  wa_audio_thu_url: string | null;
  wa_audio_fri_url: string | null;
  wa_audio_sat_url: string | null;
  voice_audio_clip_id: string | null;
  call_tts_fallback: string | null;
  sms_na_text: string | null;
  sms_retry_text: string | null;
  bina_notes: string | null;
  velip_audio_id?: string | null;
};

export type DispatchGates = {
  toggleOn: boolean;
  settingsEnabled: boolean;
  liveDispatchEnabled: boolean;
  botGlobalEnabled: boolean;
};

export function canLiveDispatch(gates: DispatchGates): boolean {
  return (
    gates.toggleOn &&
    gates.settingsEnabled &&
    gates.liveDispatchEnabled &&
    gates.botGlobalEnabled
  );
}

export async function loadDispatchGates(
  supabase: SB,
  settings: DailyReheatSettings & { live_dispatch_enabled?: boolean },
): Promise<DispatchGates> {
  const [toggleOn, botGlobalEnabled] = await Promise.all([
    isAutomationEnabled(supabase, "daily_reheat"),
    isBotGloballyEnabled(supabase),
  ]);
  return {
    toggleOn,
    settingsEnabled: !!settings.enabled,
    liveDispatchEnabled: !!(settings as any).live_dispatch_enabled,
    botGlobalEnabled,
  };
}

export async function loadCycleKit(supabase: SB, consultantId: string): Promise<CycleKit | null> {
  const { data } = await supabase
    .from("daily_reheat_kit")
    .select("*")
    .eq("consultant_id", consultantId)
    .maybeSingle();
  if (!data) return null;

  let velip_audio_id: string | null = null;
  if (data.voice_audio_clip_id) {
    const { data: clip } = await supabase
      .from("voice_audio_clips")
      .select("velip_audio_id")
      .eq("id", data.voice_audio_clip_id)
      .maybeSingle();
    velip_audio_id = clip?.velip_audio_id ?? null;
  }

  return { ...data, velip_audio_id } as CycleKit;
}

/** Áudio WA do dia (BRT). Dom → sábado. */
export function weekdayWaAudioUrl(kit: CycleKit, now = new Date()): string | null {
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
  }).format(now);
  const map: Record<string, string | null | undefined> = {
    Mon: kit.wa_audio_mon_url,
    Tue: kit.wa_audio_tue_url,
    Wed: kit.wa_audio_wed_url,
    Thu: kit.wa_audio_thu_url,
    Fri: kit.wa_audio_fri_url,
    Sat: kit.wa_audio_sat_url,
    Sun: kit.wa_audio_sat_url,
  };
  return map[wd] || kit.wa_audio_mon_url || null;
}

function renderVars(
  text: string,
  vars: Record<string, string>,
): string {
  let out = text;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replaceAll(`{{${k}}}`, v).replaceAll(`{{ ${k} }}`, v);
  }
  return out;
}

async function loadNames(supabase: SB, customerId: string, consultantId: string | null) {
  const { data: cust } = await supabase
    .from("customers")
    .select("id, name, phone_whatsapp, tracking_protocol, flow_variant")
    .eq("id", customerId)
    .maybeSingle();
  let consultor = "iGreen";
  if (consultantId) {
    const { data: c } = await supabase
      .from("consultants")
      .select("name, display_name")
      .eq("id", consultantId)
      .maybeSingle();
    consultor = (c as any)?.display_name || (c as any)?.name || consultor;
  }
  const nome = ((cust as any)?.name || "").split(" ")[0] || "tudo bem";
  return {
    cust,
    nome,
    consultor,
    protocolo: String((cust as any)?.tracking_protocol || ""),
  };
}

type ActionResult = { action: PlannedAction; ok: boolean; detail: string };

async function runOpenAttendance(
  supabase: SB,
  plan: CandidatePlan,
  kit: CycleKit | null,
  env: Record<string, string>,
): Promise<ActionResult> {
  const { nome, consultor, protocolo } = await loadNames(
    supabase,
    plan.customer_id,
    plan.consultant_id,
  );
  const raw =
    kit?.wa_open_text?.trim() ||
    `Oi {{nome}}, aqui é {{consultor}} da iGreen.\n\nProtocolo {{protocolo}} — vou te ajudar com a conta de luz.`;
  const text = renderVars(raw, { nome, consultor, protocolo });
  const audio = kit ? weekdayWaAudioUrl(kit) : null;

  const r = await sendWelcomeHeader(supabase, {
    customerId: plan.customer_id,
    consultantId: plan.consultant_id || undefined,
    env: env as any,
    customTemplate: { text, audio_url: audio, typing_delay_ms: 0 },
  });
  if (!r.ok && (r as any).skipped !== "already_sent") {
    return { action: "open_attendance", ok: false, detail: (r as any).code || "welcome_failed" };
  }
  return {
    action: "open_attendance",
    ok: true,
    detail: (r as any).skipped === "already_sent" ? "already_sent" : "opened",
  };
}

async function runSendAudio(
  supabase: SB,
  plan: CandidatePlan,
  kit: CycleKit | null,
  env: Record<string, string>,
): Promise<ActionResult> {
  const url = kit ? weekdayWaAudioUrl(kit) : null;
  if (!url) return { action: "send_audio", ok: true, detail: "no_audio_configured_skip" };

  const ch = await resolveChannelForCustomer(supabase, plan.customer_id, env as any);
  if ((ch as any).unavailable) {
    return { action: "send_audio", ok: false, detail: (ch as any).reason || "no_channel" };
  }

  const { data: cust } = await supabase
    .from("customers")
    .select("phone_whatsapp")
    .eq("id", plan.customer_id)
    .maybeSingle();
  const digits = String(cust?.phone_whatsapp || "").replace(/\D/g, "");
  if (digits.length < 12) return { action: "send_audio", ok: false, detail: "no_phone" };
  const jid = `${digits}@s.whatsapp.net`;

  const r = await (ch as any).adapter.sendMedia(
    jid,
    { kind: "audio", url, ptt: true } as any,
    {
      customerId: plan.customer_id,
      consultantId: plan.consultant_id || "",
      stepId: "daily_reheat:audio",
      idempotencyKey: `dreheat-audio:${plan.customer_id}:${Date.now()}`,
      supabase,
    } as any,
  );
  if (!(r as any)?.ok) {
    return { action: "send_audio", ok: false, detail: (r as any)?.detail || "send_failed" };
  }
  return { action: "send_audio", ok: true, detail: "audio_sent" };
}

async function runCall(
  supabase: SB,
  plan: CandidatePlan,
  kit: CycleKit | null,
): Promise<ActionResult> {
  if (!velipConfigured()) return { action: "call", ok: false, detail: "velip_not_configured" };
  const { cust, nome, consultor } = await loadNames(supabase, plan.customer_id, plan.consultant_id);
  if (!cust?.phone_whatsapp) return { action: "call", ok: false, detail: "no_phone" };
  const dest = toVelipBRDest(cust.phone_whatsapp);
  if (!dest) return { action: "call", ok: false, detail: "invalid_phone" };

  const ctid = toCtid(`dreheat_${plan.customer_id.slice(0, 8)}_${Date.now()}`);
  const tts =
    kit?.call_tts_fallback?.trim() ||
    `Olá ${nome}, aqui é ${consultor} da iGreen Energia. Tentei falar sobre a economia na conta de luz. Me retorne no WhatsApp.`;

  try {
    const r = kit?.velip_audio_id
      ? await playAudioFile({ to: dest, audioId: kit.velip_audio_id, ctid })
      : await makeTTSCall({ to: dest, ttsText: renderVars(tts, { nome, consultor, protocolo: "" }), ctid });
    if (!r.ok) return { action: "call", ok: false, detail: `velip:${r.error || "fail"}` };
    return { action: "call", ok: true, detail: `call_placed:${r.cd_id ?? "?"}` };
  } catch (e) {
    return { action: "call", ok: false, detail: (e as Error).message };
  }
}

async function runSms(
  supabase: SB,
  plan: CandidatePlan,
  kit: CycleKit | null,
  which: "sms" | "retry" = "sms",
): Promise<ActionResult> {
  if (!velipConfigured()) return { action: "sms", ok: false, detail: "velip_not_configured" };
  const { cust, nome, consultor, protocolo } = await loadNames(
    supabase,
    plan.customer_id,
    plan.consultant_id,
  );
  if (!cust?.phone_whatsapp) return { action: "sms", ok: false, detail: "no_phone" };
  const dest = toVelipBRDest(cust.phone_whatsapp);
  if (!dest) return { action: "sms", ok: false, detail: "invalid_phone" };

  const raw =
    (which === "retry" ? kit?.sms_retry_text : kit?.sms_na_text)?.trim() ||
    kit?.sms_na_text?.trim() ||
    "";
  if (!raw) return { action: "sms", ok: true, detail: "no_sms_text_skip" };
  const message = renderVars(raw, { nome, consultor, protocolo });

  try {
    const r = await makeSMS({ to: dest, message });
    await supabase.from("voice_sms_log").insert({
      consultant_id: plan.consultant_id,
      phone: dest,
      message,
      velip_sms_id: r.cdls_id ?? null,
      status: r.ok ? "sent" : "failed",
      error: r.ok ? null : (r.error ?? "velip_error"),
      raw: r.raw ?? {},
      sent_at: r.ok ? new Date().toISOString() : null,
    });
    if (!r.ok) return { action: "sms", ok: false, detail: `velip:${r.error}` };
    return { action: "sms", ok: true, detail: `sms_sent:${r.cdls_id ?? "?"}` };
  } catch (e) {
    return { action: "sms", ok: false, detail: (e as Error).message };
  }
}

async function runStartFlow(
  supabase: SB,
  plan: CandidatePlan,
  settings: DailyReheatSettings,
): Promise<ActionResult> {
  const variant = settings.flow_variant || "F";
  await supabase
    .from("customers")
    .update({
      flow_variant: variant,
      bot_paused: false,
      capture_mode: "auto",
      assigned_human_id: null,
    })
    .eq("id", plan.customer_id);
  return { action: "start_flow", ok: true, detail: `variant_${variant}` };
}

async function runCloseRating(
  supabase: SB,
  plan: CandidatePlan,
  env: Record<string, string>,
): Promise<ActionResult> {
  const r = await sendAttendanceRatingRequest(supabase, {
    customerId: plan.customer_id,
    consultantId: plan.consultant_id || undefined,
    env: env as any,
  });
  if (!r.ok && !(r as any).skipped) {
    return { action: "close_rating", ok: false, detail: (r as any).code || "close_failed" };
  }
  return {
    action: "close_rating",
    ok: true,
    detail: (r as any).skipped || "rating_requested",
  };
}

export async function dispatchCandidate(
  supabase: SB,
  plan: CandidatePlan,
  settings: DailyReheatSettings,
  kit: CycleKit | null,
  env: Record<string, string>,
): Promise<{ ok: boolean; results: ActionResult[] }> {
  const results: ActionResult[] = [];

  for (const action of plan.planned_actions) {
    if (action === "wait") {
      results.push({ action, ok: true, detail: "wait_noop" });
      continue;
    }
    let res: ActionResult;
    if (action === "open_attendance") res = await runOpenAttendance(supabase, plan, kit, env);
    else if (action === "send_audio") {
      // Se open_attendance já mandou audio_url no template, evita duplicar no mesmo tick
      const opened = results.find((r) => r.action === "open_attendance" && r.ok);
      if (opened && kit && weekdayWaAudioUrl(kit)) {
        res = { action: "send_audio", ok: true, detail: "bundled_in_open" };
      } else {
        res = await runSendAudio(supabase, plan, kit, env);
      }
    } else if (action === "start_flow") res = await runStartFlow(supabase, plan, settings);
    else if (action === "call") res = await runCall(supabase, plan, kit);
    else if (action === "sms") res = await runSms(supabase, plan, kit, "sms");
    else if (action === "close_rating") res = await runCloseRating(supabase, plan, env);
    else res = { action, ok: true, detail: "unknown_skip" };

    results.push(res);
    if (!res.ok && (action === "open_attendance" || action === "call")) break;
  }

  const ok = results.every((r) => r.ok);
  if (ok) {
    await recordProactiveTouch(supabase, plan.customer_id, "daily_reheat", {
      queue: plan.queue,
      step: plan.step,
      actions: results.map((r) => r.action),
    }).catch(() => {});
  }
  return { ok, results };
}

export async function dispatchPlans(
  supabase: SB,
  plans: CandidatePlan[],
  settings: DailyReheatSettings,
  env: Record<string, string>,
): Promise<{
  dispatched: number;
  failed: number;
  details: Array<{ customer_id: string; ok: boolean; results: ActionResult[] }>;
}> {
  const kitCache = new Map<string, CycleKit | null>();
  let dispatched = 0;
  let failed = 0;
  const details: Array<{ customer_id: string; ok: boolean; results: ActionResult[] }> = [];

  for (const plan of plans) {
    const cid = plan.consultant_id || "";
    if (!kitCache.has(cid)) {
      kitCache.set(cid, cid ? await loadCycleKit(supabase, cid) : null);
    }
    const kit = kitCache.get(cid) ?? null;
    const r = await dispatchCandidate(supabase, plan, settings, kit, env);
    details.push({ customer_id: plan.customer_id, ok: r.ok, results: r.results });
    if (r.ok) {
      dispatched++;
      await supabase
        .from("daily_reheat_queue")
        .update({ status: "done", step: plan.step, updated_at: new Date().toISOString() })
        .eq("customer_id", plan.customer_id)
        .eq("cycle_date", new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date()));
    } else {
      failed++;
      await supabase
        .from("daily_reheat_queue")
        .update({
          status: "blocked",
          skip_reason: r.results.find((x) => !x.ok)?.detail || "dispatch_failed",
          updated_at: new Date().toISOString(),
        })
        .eq("customer_id", plan.customer_id)
        .eq("cycle_date", new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date()));
    }
  }

  return { dispatched, failed, details };
}
