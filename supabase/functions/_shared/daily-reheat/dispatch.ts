/**
 * daily-reheat dispatch — envio real só com cadeados ON.
 *
 * Só envia se TODOS forem true:
 *   1. automation_toggles.daily_reheat
 *   2. daily_reheat_settings.enabled
 *   3. daily_reheat_settings.live_dispatch_enabled
 *   4. app_settings.bot_global_enabled
 *
 * Sem isso, o cron só planeja a fila (dry).
 */

import { sendWelcomeHeader, sendAttendanceRatingRequest } from "../attendance-flow.ts";
import { isActiveConversationalFunnelStep } from "../bot/cadastro-fixes.ts";
import { assignProtocolToCustomer } from "../protocol.ts";
import { resolveChannelForCustomerWithFailover } from "../channel-sender.ts";
import { safeFirstNameForAddress, scrubEmptyNameGreeting } from "../customer-display-name.ts";
import { resolveConsultantPresentationLabel, oAConsultor } from "../consultant-public-label.ts";
import {
  playAudioFile,
  makeSMS,
  toVelipBRDest,
  toVelipSmsDest,
  toCtid,
  velipConfigured,
  isReprovedVelipCode,
  stripVelipNinthDigit,
} from "../voice-dialer/velip.ts";
import { debitSmsSent } from "../voice-sms-billing.ts";
import { resolvePersonalizedCallAudio } from "../voice-dialer/call-stitch.ts";
import { finishOutboundEffect, finishProactiveTouch, markEffectSending, reserveOutboundEffect, reserveProactiveTouch } from "../journey-effects.ts";
import { isAutomationEnabled } from "../automation-gate.ts";
import { isBotGloballyEnabled } from "../bot/global-flag.ts";
import { resolveCanonicalFlowVariant } from "../bot/canonical-flow-variant.ts";
import { assertCanContact } from "../contact-suppression.ts";
import { assertBotOutboundAllowed } from "../bot/outbound-gate.ts";
import {
  delayMinutesForTransition,
  stepDef,
  type CycleQueue,
} from "./cycle.ts";
import type { CandidatePlan, DailyReheatSettings, PlannedAction } from "./plan.ts";
import { cycleDateBRT } from "./plan.ts";

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
  voice_audio_clip_id_retry: string | null;
  personalize_name: boolean;
  call_tts_fallback: string | null;
  sms_na_text: string | null;
  sms_retry_text: string | null;
  bina_notes: string | null;
  velip_audio_id?: string | null;
  velip_audio_id_retry?: string | null;
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

/** Kit oficial (Rafael / Multicanal) — fallback quando o consultor não tem kit próprio. */
const RAFAEL_KIT_CONSULTANT_ID = "0c2711ad-4836-41e6-afba-edd94f698ae3";

async function loadCycleKitRow(supabase: SB, consultantId: string): Promise<CycleKit | null> {
  const { data } = await supabase
    .from("daily_reheat_kit")
    .select("*")
    .eq("consultant_id", consultantId)
    .maybeSingle();
  if (!data) return null;

  let velip_audio_id: string | null = null;
  let velip_audio_id_retry: string | null = null;
  const clipIds = [data.voice_audio_clip_id, data.voice_audio_clip_id_retry].filter(
    (id: string | null | undefined): id is string => !!id,
  );
  if (clipIds.length) {
    const { data: clips } = await supabase
      .from("voice_audio_clips")
      .select("id, velip_audio_id")
      .in("id", clipIds);
    const byId = new Map(
      (clips ?? []).map((c: { id: string; velip_audio_id: string | null }) => [
        c.id,
        c.velip_audio_id,
      ]),
    );
    if (data.voice_audio_clip_id) velip_audio_id = byId.get(data.voice_audio_clip_id) ?? null;
    if (data.voice_audio_clip_id_retry) {
      velip_audio_id_retry = byId.get(data.voice_audio_clip_id_retry) ?? null;
    }
  }

  return {
    ...data,
    personalize_name: !!data.personalize_name,
    voice_audio_clip_id_retry: data.voice_audio_clip_id_retry ?? null,
    velip_audio_id,
    velip_audio_id_retry,
  } as CycleKit;
}

/** Clipes de identidade do próprio consultor (nunca de outro — a voz diz o nome). */
async function loadOwnIdentityCallClips(
  supabase: SB,
  consultantId: string,
): Promise<{ body: string | null; retry: string | null; velip: string | null; velipRetry: string | null }> {
  const { data } = await supabase
    .from("voice_audio_clips")
    .select("id, name, velip_audio_id, created_at")
    .eq("consultant_id", consultantId)
    .eq("is_call_body", true)
    .order("created_at", { ascending: false })
    .limit(60);
  const rows = (data ?? []) as Array<{ id: string; name: string; velip_audio_id: string | null }>;
  const find = (needle: string) =>
    rows.find((r) => String(r.name || "").toUpperCase().includes(needle)) ?? null;
  const retry = find("A_CALL_RETRY");
  const body = rows.find(
    (r) =>
      String(r.name || "").toUpperCase().includes("A_CALL") &&
      !String(r.name || "").toUpperCase().includes("A_CALL_RETRY"),
  ) ?? null;
  return {
    body: body?.id ?? null,
    retry: retry?.id ?? null,
    velip: body?.velip_audio_id ?? null,
    velipRetry: retry?.velip_audio_id ?? null,
  };
}

export async function loadCycleKit(supabase: SB, consultantId: string): Promise<CycleKit | null> {
  const own = await loadCycleKitRow(supabase, consultantId);
  if (own) return own;
  if (consultantId === RAFAEL_KIT_CONSULTANT_ID) return null;

  const base = await loadCycleKitRow(supabase, RAFAEL_KIT_CONSULTANT_ID);
  if (!base) return null;

  // NUNCA reaproveitar voz/áudio de outro consultor: a gravação diz o nome dele
  // (bug "Abel ligou e a voz falou Rafael"). Só textos são herdados.
  const ident = await loadOwnIdentityCallClips(supabase, consultantId);
  return {
    ...base,
    consultant_id: consultantId,
    wa_audio_mon_url: null,
    wa_audio_tue_url: null,
    wa_audio_wed_url: null,
    wa_audio_thu_url: null,
    wa_audio_fri_url: null,
    wa_audio_sat_url: null,
    voice_audio_clip_id: ident.body,
    voice_audio_clip_id_retry: ident.retry,
    velip_audio_id: ident.velip,
    velip_audio_id_retry: ident.velipRetry,
  };
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
  const nome = String(vars.nome || "").trim();
  if (!nome) {
    out = scrubEmptyNameGreeting(out);
  }
  for (const [k, v] of Object.entries(vars)) {
    out = out.replaceAll(`{{${k}}}`, v).replaceAll(`{{ ${k} }}`, v);
  }
  if (!nome) {
    out = scrubEmptyNameGreeting(out);
  }
  return out.replace(/[ \t]{2,}/g, " ").replace(/\s+([,.!?;:])/g, "$1").replace(/\n{3,}/g, "\n\n").trim();
}

async function loadNames(supabase: SB, customerId: string, consultantId: string | null) {
  const { data: cust } = await supabase
    .from("customers")
    .select("id, name, name_source, phone_whatsapp, tracking_protocol, flow_variant")
    .eq("id", customerId)
    .maybeSingle();
  let consultor = "consultor";
  let o_a_consultor = "o";
  if (consultantId) {
    const { data: c } = await supabase
      .from("consultants")
      .select("name, display_name, gender")
      .eq("id", consultantId)
      .maybeSingle();
    const gender = String((c as { gender?: string } | null)?.gender || "").trim() === "consultora"
      ? "consultora"
      : "consultor";
    o_a_consultor = oAConsultor(gender);
    // Nunca vazar slug/login (ex.: silviaclaudiaalmeida) no WhatsApp.
    consultor = resolveConsultantPresentationLabel(
      (c as { name?: string } | null)?.name,
      (c as { display_name?: string } | null)?.display_name,
      gender,
    );
  }
  const nome = safeFirstNameForAddress((cust as any)?.name, (cust as any)?.name_source);
  return {
    cust,
    nome,
    rawName: (cust as any)?.name ?? null,
    nameSource: (cust as any)?.name_source ?? null,
    consultor,
    o_a_consultor,
    protocolo: String((cust as any)?.tracking_protocol || "").trim(),
  };
}

type ActionResult = { action: PlannedAction; ok: boolean; detail: string };

async function runOpenAttendance(
  supabase: SB,
  plan: CandidatePlan,
  kit: CycleKit | null,
  env: Record<string, string>,
): Promise<ActionResult> {
  const { data: stepRow } = await supabase
    .from("customers")
    .select("conversation_step, welcome_sent_at")
    .eq("id", plan.customer_id)
    .maybeSingle();
  if (isActiveConversationalFunnelStep((stepRow as any)?.conversation_step)) {
    return { action: "open_attendance", ok: true, detail: "already_in_funnel" };
  }

  const { nome, consultor, o_a_consultor, protocolo: existingProto } = await loadNames(
    supabase,
    plan.customer_id,
    plan.consultant_id,
  );
  // Gera o número ANTES de montar o texto — evita "Protocolo —" sem código.
  const assigned = await assignProtocolToCustomer(supabase, plan.customer_id, {
    consultantId: plan.consultant_id || null,
  });
  const protocolo = String(assigned?.protocol || existingProto || "").trim();
  const raw =
    kit?.wa_open_text?.trim() ||
    `*iGreen | Conta de Luz Mais Barata 🌱*

Olá! Aqui é {{o_a_consultor}} *{{consultor}}* da *iGreen*.

Seu atendimento foi iniciado com sucesso e eu vou acompanhar você durante todo o processo.

📋 *Protocolo:* {{protocolo}}

Para agilizar seu atendimento, por favor, informe seu *primeiro nome*.`;
  const text = renderVars(raw, { nome, consultor, o_a_consultor, protocolo });
  const audio = kit ? weekdayWaAudioUrl(kit) : null;

  const r = await sendWelcomeHeader(supabase, {
    customerId: plan.customer_id,
    consultantId: plan.consultant_id || undefined,
    env: env as any,
    customTemplate: { text, audio_url: audio, typing_delay_ms: 0 },
  });
  if (!r.ok && (r as any).skipped !== "already_sent" && (r as any).skipped !== "already_in_funnel") {
    return { action: "open_attendance", ok: false, detail: (r as any).code || "welcome_failed" };
  }
  return {
    action: "open_attendance",
    ok: true,
    detail:
      (r as any).skipped === "already_sent"
        ? "already_sent"
        : (r as any).skipped === "already_in_funnel"
          ? "already_in_funnel"
          : "opened",
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

  const ch = await resolveChannelForCustomerWithFailover(supabase, plan.customer_id, env as any);
  if ((ch as any).unavailable) {
    return { action: "send_audio", ok: false, detail: (ch as any).reason || "no_channel" };
  }

  const { data: cust } = await supabase
    .from("customers")
    .select("phone_whatsapp, whatsapp_chat_id")
    .eq("id", plan.customer_id)
    .maybeSingle();
  const digits = String(
    (cust as { whatsapp_chat_id?: string | null } | null)?.whatsapp_chat_id ||
      cust?.phone_whatsapp ||
      "",
  ).replace(/\D/g, "");
  if (digits.length < 12) return { action: "send_audio", ok: false, detail: "no_phone" };
  const jid = `${digits}@s.whatsapp.net`;

  const r = await (ch as any).adapter.sendMedia(
    jid,
    { kind: "audio", url, ptt: true } as any,
    {
      customerId: plan.customer_id,
      consultantId: plan.consultant_id || "",
      stepId: "daily_reheat:audio",
      idempotencyKey: `dreheat-audio:${plan.customer_id}:${plan.step}`,
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
  const { cust, rawName, nameSource } = await loadNames(supabase, plan.customer_id, plan.consultant_id);
  if (!cust?.phone_whatsapp) return { action: "call", ok: false, detail: "no_phone" };
  const dest = toVelipBRDest(cust.phone_whatsapp);
  if (!dest) return { action: "call", ok: false, detail: "invalid_phone" };
  // Celular antigo (12 dig) já sai com 9 via toVelipBRDest — evita discagem morta.

  const destAlt = stripVelipNinthDigit(dest);
  const phoneCandidates = [...new Set([dest, destAlt].filter(Boolean))] as string[];
  const { data: priorFails } = await supabase
    .from("voice_call_logs")
    .select("velip_status")
    .eq("consultant_id", plan.consultant_id)
    .in("to_phone", phoneCandidates)
    .in("velip_status", ["IK", "EK", "CK", "BK", "ik", "ek", "ck", "bk"])
    .order("created_at", { ascending: false })
    .limit(1);
  const prior = (priorFails as { velip_status: string | null }[] | null)?.[0];
  if (prior && isReprovedVelipCode(prior.velip_status)) {
    return {
      action: "call",
      ok: false,
      detail: `velip_reproved:${String(prior.velip_status).toUpperCase()}`,
    };
  }

  const effKey = `dreheat:call:${plan.customer_id}:${plan.step}`;
  const eff = await reserveOutboundEffect(supabase, {
    idempotencyKey: effKey,
    engineKey: "daily_reheat",
    channel: "voice",
    customerId: plan.customer_id,
    consultantId: plan.consultant_id,
    stage: String(plan.step),
    actionKey: "call",
  });
  if (!eff.canSend) {
    return { action: "call", ok: false, detail: `effect_blocked:${eff.reason}` };
  }

  const ctid = toCtid(`dreheat_${plan.customer_id.slice(0, 8)}_${plan.step}`);

  const isRetry = plan.step === "retry";
  const bodyClipId = isRetry
    ? (kit?.voice_audio_clip_id_retry || kit?.voice_audio_clip_id || null)
    : (kit?.voice_audio_clip_id || null);
  const bodyVelipId = isRetry
    ? (kit?.velip_audio_id_retry || kit?.velip_audio_id || null)
    : (kit?.velip_audio_id || null);
  const personalize = !!kit?.personalize_name;

  try {
    await markEffectSending(supabase, eff.effectId);
    let r;
    if (bodyClipId && personalize) {
      const st = await resolvePersonalizedCallAudio(supabase, {
        consultantId: plan.consultant_id,
        bodyClipId,
        rawName,
        nameSource,
        fallbackToBody: true,
      });
      if (st.ok && st.velip_audio_id) {
        r = await playAudioFile({ to: dest, audioId: st.velip_audio_id, ctid });
      } else if (bodyVelipId) {
        r = await playAudioFile({ to: dest, audioId: bodyVelipId, ctid });
      } else {
        await finishOutboundEffect(supabase, eff.effectId, "failed_final", {
          errorCode: "sofia_required_no_audio",
        });
        return { action: "call", ok: false, detail: "sofia_required_no_audio" };
      }
    } else if (bodyVelipId) {
      r = await playAudioFile({ to: dest, audioId: bodyVelipId, ctid });
    } else if (bodyClipId) {
      // Clip sem velip_audio_id ainda — tenta stitch/corpo (Sofia); sem TTS Velip.
      const st = await resolvePersonalizedCallAudio(supabase, {
        consultantId: plan.consultant_id,
        bodyClipId,
        rawName: personalize ? rawName : null,
        nameSource: personalize ? nameSource : null,
        fallbackToBody: true,
      });
      if (st.ok && st.velip_audio_id) {
        r = await playAudioFile({ to: dest, audioId: st.velip_audio_id, ctid });
      } else {
        await finishOutboundEffect(supabase, eff.effectId, "failed_final", {
          errorCode: "sofia_required_no_audio",
        });
        return { action: "call", ok: false, detail: "sofia_required_no_audio" };
      }
    } else {
      await finishOutboundEffect(supabase, eff.effectId, "failed_final", {
        errorCode: "sofia_required_no_clip",
      });
      return { action: "call", ok: false, detail: "sofia_required_no_clip" };
    }
    if (!r.ok) {
      await finishOutboundEffect(supabase, eff.effectId, "failed_retryable", {
        errorCode: `velip:${r.error || "fail"}`,
      });
      return { action: "call", ok: false, detail: `velip:${r.error || "fail"}` };
    }
    if (r.cd_id) {
      const { error: callLogErr } = await supabase.from("voice_call_logs").insert({
        consultant_id: plan.consultant_id,
        to_phone: dest,
        status: "dialing",
        velip_call_id: r.cd_id,
        raw: {
          source: "daily_reheat",
          step: plan.step,
          customer_id: plan.customer_id,
          ctid,
        },
      });
      if (callLogErr) {
        console.warn("[daily-reheat] voice_call_logs insert failed", callLogErr.message);
      }
    }
    await finishOutboundEffect(supabase, eff.effectId, "sent", {
      providerMessageId: r.cd_id != null ? String(r.cd_id) : null,
    });
    return { action: "call", ok: true, detail: `call_placed:${r.cd_id ?? "?"}` };
  } catch (e) {
    // Ambíguo após provider: não repetir cegamente.
    await finishOutboundEffect(supabase, eff.effectId, "unknown", {
      errorCode: String((e as Error).message || "call_exception").slice(0, 120),
    });
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
  const dest = toVelipSmsDest(cust.phone_whatsapp);
  if (!dest) return { action: "sms", ok: false, detail: "invalid_phone" };
  if (dest.length === 12) return { action: "sms", ok: false, detail: "sms_skip_landline" };

  const raw =
    (which === "retry" ? kit?.sms_retry_text : kit?.sms_na_text)?.trim() ||
    kit?.sms_na_text?.trim() ||
    "";
  if (!raw) return { action: "sms", ok: true, detail: "no_sms_text_skip" };
  const message = renderVars(raw, { nome, consultor, protocolo });

  const effKey = `dreheat:sms:${plan.customer_id}:${plan.step}:${which}`;
  const eff = await reserveOutboundEffect(supabase, {
    idempotencyKey: effKey,
    engineKey: "daily_reheat",
    channel: "sms",
    customerId: plan.customer_id,
    consultantId: plan.consultant_id,
    stage: String(plan.step),
    actionKey: `sms:${which}`,
  });
  if (!eff.canSend) {
    return { action: "sms", ok: false, detail: `effect_blocked:${eff.reason}` };
  }

  try {
    await markEffectSending(supabase, eff.effectId);
    const r = await makeSMS({ to: dest, message });
    const { data: smsLogRow, error: smsLogErr } = await supabase.from("voice_sms_log").insert({
      consultant_id: plan.consultant_id,
      phone: dest,
      message,
      velip_sms_id: r.cdls_id != null ? String(r.cdls_id) : null,
      status: r.ok ? "sent" : "failed",
      error: r.ok ? null : (r.error ?? "velip_error"),
    }).select("id").maybeSingle();
    if (smsLogErr) {
      console.warn("[daily-reheat] voice_sms_log insert failed", smsLogErr.message);
    }
    if (!r.ok) {
      await finishOutboundEffect(supabase, eff.effectId, "failed_retryable", {
        errorCode: `velip:${r.error || "fail"}`,
      });
      return { action: "sms", ok: false, detail: `velip:${r.error}` };
    }
    const smsRef = r.cdls_id != null
      ? String(r.cdls_id)
      : (smsLogRow as { id?: string } | null)?.id ?? `reheat_sms_${plan.customer_id}_${plan.step}`;
    void debitSmsSent(supabase, {
      consultantId: plan.consultant_id,
      providerRef: smsRef,
      metadata: { source: "daily_reheat" },
    });
    await finishOutboundEffect(supabase, eff.effectId, "sent", {
      providerMessageId: smsRef,
    });
    return { action: "sms", ok: true, detail: `sms_sent:${r.cdls_id ?? "?"}` };
  } catch (e) {
    await finishOutboundEffect(supabase, eff.effectId, "unknown", {
      errorCode: String((e as Error).message || "sms_exception").slice(0, 120),
    });
    return { action: "sms", ok: false, detail: (e as Error).message };
  }
}

async function runStartFlow(
  supabase: SB,
  plan: CandidatePlan,
  settings: DailyReheatSettings,
): Promise<ActionResult> {
  // Trava canônica: Grupo A (Sofia). Nunca gravar F/D/M via reheat.
  const safeVariant = resolveCanonicalFlowVariant(settings.flow_variant);
  await supabase
    .from("customers")
    .update({
      flow_variant: safeVariant,
      bot_paused: false,
      capture_mode: "auto",
      assigned_human_id: null,
    })
    .eq("id", plan.customer_id);
  return { action: "start_flow", ok: true, detail: `variant_${safeVariant}` };
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

  const contact = await assertCanContact(supabase, {
    customerId: plan.customer_id,
    channel: plan.would_call && !plan.would_consume_whapi ? "voice" : "whatsapp",
  });
  if (!contact.allowed) {
    return {
      ok: false,
      results: [{ action: "wait", ok: false, detail: `dnc:${contact.reason}` }],
    };
  }

  // E2E_STRICT_OUTBOUND (opt-in): bloqueia live reheat fora da allowlist / sandbox 5500000.
  const outbound = await assertBotOutboundAllowed(supabase, {
    customerId: plan.customer_id,
    consultantId: plan.consultant_id,
  });
  if (!outbound.allowed) {
    return {
      ok: false,
      results: [{ action: "wait", ok: false, detail: `outbound_gate:${outbound.reason}` }],
    };
  }

  // Fail-closed: se o lead já está no meio do Grupo A / flow, não ciclar
  // open/ligação/SMS por cima (mesmo se a fila foi planejada antes).
  {
    const { data: live } = await supabase
      .from("customers")
      .select("conversation_step")
      .eq("id", plan.customer_id)
      .maybeSingle();
    if (isActiveConversationalFunnelStep((live as any)?.conversation_step)) {
      return {
        ok: false,
        results: [{ action: "wait", ok: false, detail: "already_in_funnel" }],
      };
    }
  }

  // Orquestrador atômico: daily reheat não pode disputar o cliente com a
  // jornada A/B/C nem com follow-ups (fail-closed: erro = não tocar hoje).
  const hasRealAction = plan.planned_actions.some((a) => a !== "wait");
  let touch: Awaited<ReturnType<typeof reserveProactiveTouch>> | null = null;
  if (hasRealAction) {
    touch = await reserveProactiveTouch(supabase, plan.customer_id, "daily_reheat", {
      queue: plan.queue,
      step: plan.step,
    });
    if (!touch.allowed) {
      return {
        ok: false,
        results: [{
          action: "wait",
          ok: false,
          detail: `orchestrator:${touch.reason}${touch.blockedBy ? `:${touch.blockedBy}` : ""}`,
        }],
      };
    }
  }

  for (const action of plan.planned_actions) {
    if (action === "wait") {
      results.push({ action, ok: true, detail: "wait_noop" });
      continue;
    }
    let res: ActionResult;
    if (action === "open_attendance") res = await runOpenAttendance(supabase, plan, kit, env);
    else if (action === "send_audio") {
      // Se open_attendance já mandou audio_url no template, evita duplicar no mesmo tick.
      // Mid-funnel / already_sent: não manda áudio por cima do fluxo A.
      const opened = results.find((r) => r.action === "open_attendance" && r.ok);
      if (
        opened &&
        (opened.detail === "already_in_funnel" || opened.detail === "already_sent")
      ) {
        res = { action: "send_audio", ok: true, detail: `skipped_${opened.detail}` };
      } else if (opened && kit && weekdayWaAudioUrl(kit)) {
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
  if (touch?.allowed) {
    const touched = results.some((r) => r.ok && r.action !== "wait");
    await finishProactiveTouch(
      supabase, touch.reservationId, touch.claimToken,
      touched ? "done" : "released",
    );
  }
  return { ok, results };
}

async function advanceQueueAfterSuccess(
  supabase: SB,
  plan: CandidatePlan,
  settings: DailyReheatSettings,
): Promise<{ nextDueNow: CandidatePlan | null }> {
  const cycleDate = cycleDateBRT();
  const queue = plan.queue as CycleQueue;
  const current = stepDef(queue, plan.step);
  if (!current) {
    await supabase
      .from("daily_reheat_queue")
      .update({ status: "done", updated_at: new Date().toISOString() })
      .eq("customer_id", plan.customer_id)
      .eq("cycle_date", cycleDate);
    return { nextDueNow: null };
  }

  const nextId = current.next;
  if (!nextId) {
    await supabase
      .from("daily_reheat_queue")
      .update({
        status: "done",
        step: current.id,
        planned_actions: [],
        updated_at: new Date().toISOString(),
      })
      .eq("customer_id", plan.customer_id)
      .eq("cycle_date", cycleDate);
    return { nextDueNow: null };
  }

  const next = stepDef(queue, nextId);
  if (!next) {
    await supabase
      .from("daily_reheat_queue")
      .update({ status: "done", updated_at: new Date().toISOString() })
      .eq("customer_id", plan.customer_id)
      .eq("cycle_date", cycleDate);
    return { nextDueNow: null };
  }

  const delayMin = delayMinutesForTransition(
    queue,
    current.id,
    nextId,
    settings.queue_a_silence_hours,
  );
  const nextAt = new Date(Date.now() + delayMin * 60_000).toISOString();

  await supabase
    .from("daily_reheat_queue")
    .update({
      status: "planned",
      step: next.id,
      planned_actions: next.actions,
      next_action_at: nextAt,
      skip_reason: null,
      updated_at: new Date().toISOString(),
    })
    .eq("customer_id", plan.customer_id)
    .eq("cycle_date", cycleDate);

  if (delayMin > 0) return { nextDueNow: null };

  return {
    nextDueNow: {
      ...plan,
      claim_token: null,
      step: next.id,
      planned_actions: [...next.actions],
      would_consume_whapi: next.would_consume_whapi,
      would_call: next.would_call,
      would_sms: next.would_sms,
      reason: `chain_${next.id}`,
    },
  };
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
  const cycleDate = cycleDateBRT();

  for (const initial of plans) {
    let plan: CandidatePlan | null = initial;
    let hops = 0;
    while (plan && hops < 8) {
      hops++;
      const cid = plan.consultant_id || "";
      if (!kitCache.has(cid)) {
        kitCache.set(cid, cid ? await loadCycleKit(supabase, cid) : null);
      }
      const kit = kitCache.get(cid) ?? null;

      // Claim CAS: só quem passa de planned→claimed (ou já veio claimed da RPC) despacha.
      if (plan.id && !plan.claim_token) {
        const { data: got } = await supabase
          .from("daily_reheat_queue")
          .update({
            status: "claimed",
            updated_at: new Date().toISOString(),
          })
          .eq("id", plan.id)
          .eq("status", "planned")
          .select("id, claim_token")
          .maybeSingle();
        if (!got?.id) {
          // Outro worker já pegou.
          break;
        }
        plan = { ...plan, claim_token: got.claim_token ?? "cas" };
      } else if (!plan.id) {
        const { data: got } = await supabase
          .from("daily_reheat_queue")
          .update({ status: "claimed", updated_at: new Date().toISOString() })
          .eq("customer_id", plan.customer_id)
          .eq("cycle_date", cycleDate)
          .eq("status", "planned")
          .select("id")
          .maybeSingle();
        if (!got?.id) break;
        plan = { ...plan, id: got.id, claim_token: "cas" };
      }

      const r = await dispatchCandidate(supabase, plan, settings, kit, env);
      details.push({ customer_id: plan.customer_id, ok: r.ok, results: r.results });
      if (!r.ok) {
        failed++;
        const skipDetail = r.results.find((x) => !x.ok)?.detail || "dispatch_failed";
        const asSkipped =
          skipDetail === "already_in_funnel" || skipDetail.startsWith("dnc:");
        let q = supabase
          .from("daily_reheat_queue")
          .update({
            status: asSkipped ? "skipped" : "blocked",
            skip_reason: skipDetail,
            updated_at: new Date().toISOString(),
          })
          .eq("customer_id", plan.customer_id)
          .eq("cycle_date", cycleDate);
        if (plan.claim_token && plan.claim_token !== "cas") {
          q = q.eq("claim_token", plan.claim_token);
        }
        await q;
        break;
      }
      dispatched++;
      const { nextDueNow } = await advanceQueueAfterSuccess(supabase, plan, settings);
      plan = nextDueNow;
    }
  }

  return { dispatched, failed, details };
}
