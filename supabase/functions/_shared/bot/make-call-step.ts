/**
 * Passo make_call do construtor de fluxos.
 *
 * Fail-closed por padrão:
 * - Sem bot_global_enabled → dry-run (would_make_call)
 * - Sem automation_toggles.bot_flow_make_call → dry-run
 * - Live ON → enfileira campanha single (cron disca); NÃO chama MakeTTSCall inline
 *
 * Nunca sintetiza ElevenLabs no dry-run.
 */

import { isBotGloballyEnabled } from "../bot/global-flag.ts";
import { isAutomationEnabled, logSkipped } from "../automation-gate.ts";
import { assertCanContact } from "../contact-suppression.ts";
import { resolveCallDialAudio } from "../voice-dialer/call-stitch.ts";
import { toVelipBRDest, velipConfigured } from "../voice-dialer/velip.ts";
import { makeCallKey } from "../journey-effects.ts";

// deno-lint-ignore no-explicit-any
type SB = any;

export interface MakeCallStepInput {
  supabase: SB;
  consultantId: string;
  customerId: string;
  customerName?: string | null;
  /** customers.name_source — sem fonte confiável → só o corpo. */
  nameSource?: string | null;
  phoneWhatsapp?: string | null;
  stepKey?: string | null;
  voiceAudioClipId?: string | null;
  personalizeName?: boolean;
  /** Força só dry-run mesmo com toggles ON (testes). */
  forceDryRun?: boolean;
}

export interface MakeCallStepResult {
  ok: boolean;
  dryRun: boolean;
  detail: string;
  campaignId?: string;
  velipAudioId?: string;
}

async function enqueueSingleCampaign(
  supabase: SB,
  opts: {
    consultantId: string;
    customerId: string;
    phone: string;
    name: string | null;
    clipId: string;
    velipAudioId: string;
    personalize: boolean;
    stepKey: string | null;
  },
): Promise<{ ok: boolean; campaignId?: string; existed?: boolean; error?: string }> {
  const { data: clip } = await supabase
    .from("voice_audio_clips")
    .select("audio_url")
    .eq("id", opts.clipId)
    .maybeSingle();
  const audioUrl = String((clip as { audio_url?: string } | null)?.audio_url || "");
  if (!audioUrl) {
    return { ok: false, error: "clip_missing_audio_url" };
  }

  // Chave estável: make_call:{customer}:{step}:{turno} — N execuções paralelas
  // do mesmo passo no mesmo turno criam UMA campanha (RPC transacional).
  const logicalKey = makeCallKey(opts.customerId, opts.stepKey || "step");

  const { data, error } = await supabase.rpc("enqueue_single_voice_campaign", {
    p_logical_key: logicalKey,
    p_consultant_id: opts.consultantId,
    p_customer_id: opts.customerId,
    p_phone: opts.phone,
    p_name: opts.name,
    p_campaign_name: `fluxo_make_call:${opts.stepKey || "step"}:${opts.customerId.slice(0, 8)}`,
    p_audio_clip_id: opts.clipId,
    p_audio_url: audioUrl,
    p_config: {
      personalize_name: opts.personalize,
      source: "bot_flow_make_call",
      step_key: opts.stepKey,
      velip_audio_id: opts.velipAudioId,
      logical_key: logicalKey,
    },
  });

  if (error) {
    // Fail-closed: sem RPC não enfileira (não cai em INSERT duplicável).
    return { ok: false, error: `rpc:${error.message}` };
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.campaign_id) {
    return { ok: false, error: "rpc_empty_result" };
  }
  return { ok: true, campaignId: String(row.campaign_id), existed: Boolean(row.existed) };
}

/**
 * Executa (ou simula) o passo make_call.
 */
export async function handleMakeCallStep(input: MakeCallStepInput): Promise<MakeCallStepResult> {
  const clipId = (input.voiceAudioClipId || "").trim();
  const meta = {
    customer_id: input.customerId,
    consultant_id: input.consultantId,
    step_key: input.stepKey,
    clip_id: clipId || null,
  };

  if (!clipId) {
    console.log(JSON.stringify({ level: "warn", event: "make_call_missing_clip", ...meta }));
    return { ok: false, dryRun: true, detail: "missing_voice_audio_clip_id" };
  }

  const botOn = await isBotGloballyEnabled(input.supabase);
  const toggleOn = await isAutomationEnabled(input.supabase, "bot_flow_make_call");
  const live = !input.forceDryRun && botOn && toggleOn;

  if (!live) {
    await logSkipped(input.supabase, "bot_flow_make_call", {
      ...meta,
      reason: input.forceDryRun
        ? "force_dry_run"
        : !botOn
        ? "bot_global_disabled"
        : "toggle_off",
    });
    console.log(JSON.stringify({
      level: "info",
      event: "would_make_call",
      dryRun: true,
      ...meta,
      personalize: !!input.personalizeName,
    }));
    return {
      ok: true,
      dryRun: true,
      detail: `would_make_call:clip=${clipId.slice(0, 8)}`,
    };
  }

  const phoneRaw = input.phoneWhatsapp || "";
  const dest = toVelipBRDest(phoneRaw);
  if (!dest) {
    return { ok: false, dryRun: false, detail: "invalid_phone" };
  }

  const can = await assertCanContact(input.supabase, {
    consultantId: input.consultantId,
    customerId: input.customerId,
    phone: dest,
    channel: "voice",
  });
  if (!can.allowed) {
    return { ok: false, dryRun: false, detail: `suppressed:${can.reason || "dnc"}` };
  }

  if (!velipConfigured()) {
    return { ok: false, dryRun: false, detail: "velip_not_configured" };
  }

  // Resolve áudio (pode chamar ElevenLabs só se personalize e sem cache).
  const resolved = await resolveCallDialAudio(input.supabase, {
    consultantId: input.consultantId,
    clipId,
    rawName: input.customerName,
    nameSource: input.nameSource,
    personalize: !!input.personalizeName,
  });
  if (!resolved.ok || !resolved.velip_audio_id) {
    return { ok: false, dryRun: false, detail: `audio_resolve:${resolved.error || "fail"}` };
  }

  const enq = await enqueueSingleCampaign(input.supabase, {
    consultantId: input.consultantId,
    customerId: input.customerId,
    phone: dest,
    name: input.customerName ?? null,
    clipId,
    velipAudioId: resolved.velip_audio_id,
    personalize: !!input.personalizeName,
    stepKey: input.stepKey ?? null,
  });

  if (!enq.ok) {
    return { ok: false, dryRun: false, detail: `enqueue:${enq.error || "fail"}` };
  }

  console.log(JSON.stringify({
    level: "info",
    event: enq.existed ? "make_call_dedup_existing" : "make_call_enqueued",
    campaign_id: enq.campaignId,
    ...meta,
  }));

  return {
    ok: true,
    dryRun: false,
    detail: enq.existed ? `dedup_existing:${enq.campaignId}` : `enqueued:${enq.campaignId}`,
    campaignId: enq.campaignId,
    velipAudioId: resolved.velip_audio_id,
  };
}
