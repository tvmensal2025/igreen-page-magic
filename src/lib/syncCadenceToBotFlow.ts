/**
 * Painel Multicanal ↔ bot_flow_steps + rascunho remoto.
 * O WhatsApp só lê message_text / captures._buttons / slot_key / ai_media_library.
 * localStorage é cache local — a fonte da verdade é o fluxo + biblioteca remota.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  MULTICHANNEL_CADENCE_TEMPLATES,
  emptyLibrary,
  resolveBody,
  resolveButtons,
  type CadenceButton,
  type SavedCadenceLibrary,
} from "@/lib/multichannelCadenceTexts";

const REMOTE_LIBRARY_SLOT = "multichannel_cadence_v2";

type CaptureRow = {
  field?: string;
  enabled?: boolean;
  value?: unknown;
  [k: string]: unknown;
};

type TransitionRow = {
  trigger_intent?: string | null;
  trigger_phrases?: string[] | null;
  goto_step_id?: string | null;
  goto_special?: string | null;
  [k: string]: unknown;
};

type FlowStepRow = {
  id: string;
  step_key: string | null;
  message_text: string | null;
  captures: CaptureRow[] | null;
  transitions: TransitionRow[] | null;
  voice_audio_clip_id?: string | null;
};

async function resolveActiveFlowId(
  consultantId: string,
  variant: string,
): Promise<string | null> {
  const { data: flow, error } = await supabase
    .from("bot_flows")
    .select("id")
    .eq("consultant_id", consultantId)
    .eq("variant", variant)
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !flow?.id) return null;
  return String(flow.id);
}

function buttonsFromCaptures(captures: CaptureRow[] | null | undefined): CadenceButton[] {
  const cap = (captures || []).find((c) => c.field === "_buttons" && c.enabled !== false);
  if (!cap || !Array.isArray(cap.value)) return [];
  return (cap.value as Array<{ id?: string; title?: string }>)
    .map((b) => ({
      id: String(b?.id || "").trim(),
      title: String(b?.title || "").trim(),
    }))
    .filter((b) => b.id && b.title);
}

/** Carrega textos/botões já gravados no fluxo ativo → biblioteca do painel. */
export async function loadCadenceLibraryFromBotFlow(
  consultantId: string,
  variant: string = "A",
): Promise<Partial<SavedCadenceLibrary>> {
  const flowId = await resolveActiveFlowId(consultantId, variant);
  if (!flowId) return {};

  const keys = MULTICHANNEL_CADENCE_TEMPLATES.filter(
    (t) => t.group === "A" && !t.hiddenInPanel,
  ).map((t) => t.key);

  const { data: steps, error } = await supabase
    .from("bot_flow_steps")
    .select("id, step_key, message_text, captures, transitions, voice_audio_clip_id")
    .eq("flow_id", flowId)
    .in("step_key", keys);

  if (error || !steps?.length) return {};

  const bodies: Record<string, string> = {};
  const buttons: Record<string, CadenceButton[]> = {};
  const audioClipIds: Record<string, string> = {};

  for (const raw of steps as FlowStepRow[]) {
    const key = String(raw.step_key || "");
    const tpl = MULTICHANNEL_CADENCE_TEMPLATES.find((t) => t.key === key);
    if (!tpl) continue;
    if (tpl.channel !== "whatsapp_audio" && String(raw.message_text || "").trim()) {
      bodies[key] = String(raw.message_text);
    }
    const btns = buttonsFromCaptures(raw.captures);
    if (btns.length) buttons[key] = btns;
    if (raw.voice_audio_clip_id) audioClipIds[key] = String(raw.voice_audio_clip_id);
  }

  return { bodies, buttons, audioClipIds };
}

/** Rascunho completo no MinIO/DB (sobrevive a troca de navegador). */
export async function persistCadenceLibraryRemote(
  consultantId: string,
  lib: SavedCadenceLibrary,
): Promise<void> {
  const payload = JSON.stringify({
    ...lib,
    version: 2,
    updatedAt: new Date().toISOString(),
  });
  const now = new Date().toISOString();
  const { error: deactErr } = await supabase
    .from("ai_media_library")
    .update({ active: false, updated_at: now })
    .eq("consultant_id", consultantId)
    .eq("slot_key", REMOTE_LIBRARY_SLOT)
    .eq("active", true);
  if (deactErr) throw new Error(`persist_deactivate: ${deactErr.message}`);
  const { error: insErr } = await supabase.from("ai_media_library").insert({
    consultant_id: consultantId,
    slot_key: REMOTE_LIBRARY_SLOT,
    kind: "text",
    label: "Multicanal · biblioteca painel",
    url: "about:blank",
    text_content: payload.slice(0, 500_000),
    active: true,
    send_order: 0,
    is_draft: false,
    is_public: false,
    delay_before_ms: 0,
    priority: 0,
  });
  if (insErr) throw new Error(`persist_insert: ${insErr.message}`);
}

/**
 * Mapa Grupo B (painel Multicanal) → estágios do motor `cadence_stage_config`.
 * Faz o que o usuário edita virar o texto real que o motor envia.
 */
const GROUP_B_TO_STAGE: Record<string, string> = {
  b1_wa_reopen: "COLD_1",
  b_day2_wa: "COLD_2",
  b_day7_wa_easy: "COLD_3",
  b_day10_wa_final: "COLD_4",
  b4_call_1: "CALL_1",
  b_day4_call_2: "CALL_2",
  b_day10_call: "CALL_3",
  b3_sms_1: "SMS_1",
  b_day6_sms_2: "SMS_2",
};

/** Espelha textos do Grupo B em `cadence_stage_config` (consultant_id = null). */
export async function syncCadenceLibraryToStageConfig(
  lib: SavedCadenceLibrary,
): Promise<{ updated: string[]; errors: string[] }> {
  const updated: string[] = [];
  const errors: string[] = [];
  for (const [key, stage] of Object.entries(GROUP_B_TO_STAGE)) {
    const tpl = MULTICHANNEL_CADENCE_TEMPLATES.find((t) => t.key === key);
    if (!tpl) continue;
    const body = resolveBody(tpl, lib).trim();
    if (!body) continue;
    const { data: existing } = await supabase
      .from("cadence_stage_config")
      .select("id")
      .is("consultant_id", null)
      .eq("stage", stage)
      .maybeSingle();
    if (existing?.id) {
      const { error } = await supabase
        .from("cadence_stage_config")
        .update({ message_text: body, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
      if (error) { errors.push(`${stage}: ${error.message}`); continue; }
    } else {
      const { error } = await supabase
        .from("cadence_stage_config")
        .insert({ stage, message_text: body, enabled: true, delay_hours: 24 });
      if (error) { errors.push(`${stage}: ${error.message}`); continue; }
    }
    updated.push(stage);
  }
  return { updated, errors };
}

export async function loadCadenceLibraryRemote(
  consultantId: string,
): Promise<SavedCadenceLibrary | null> {
  const { data, error } = await supabase
    .from("ai_media_library")
    .select("text_content")
    .eq("consultant_id", consultantId)
    .eq("slot_key", REMOTE_LIBRARY_SLOT)
    .eq("active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data?.text_content) return null;
  try {
    const parsed = JSON.parse(String(data.text_content)) as Partial<SavedCadenceLibrary>;
    return {
      ...emptyLibrary(),
      ...parsed,
      version: 2,
      bodies: parsed.bodies ?? {},
      segmentBodies: parsed.segmentBodies ?? {},
      segmentApproved: parsed.segmentApproved ?? {},
      buttons: parsed.buttons ?? {},
      approved: parsed.approved ?? {},
      audioUrls: parsed.audioUrls ?? {},
      audioClipIds: parsed.audioClipIds ?? {},
    };
  } catch {
    return null;
  }
}

/** Liga o clip gerado no painel ao passo do fluxo (e aliases). */
export async function attachVoiceClipToCadenceSteps(
  consultantId: string,
  cadenceKey: string,
  clipId: string,
  variant: string = "A",
): Promise<void> {
  const flowId = await resolveActiveFlowId(consultantId, variant);
  if (!flowId || !clipId) return;

  const keys = new Set<string>([cadenceKey]);
  if (cadenceKey === "a3_explain_with_buttons") keys.add("a3_audio_explain");
  if (cadenceKey === "a2_audio_activate_name") keys.add("a2_text_ask_bill_value");
  if (cadenceKey === "a5_audio_club_benefits") keys.add("a5b_after_club_buttons");

  await supabase
    .from("bot_flow_steps")
    .update({
      voice_audio_clip_id: clipId,
      updated_at: new Date().toISOString(),
    })
    .eq("flow_id", flowId)
    .in("step_key", [...keys]);
}

/**
 * Espelha textos/botões do painel no fluxo ativo.
 * Preferência: o que está na lib do painel (salvo/editado) vence o template.
 */
export async function syncCadenceLibraryToBotFlow(
  consultantId: string,
  lib: SavedCadenceLibrary,
  variant: string = "A",
): Promise<{ updated: string[]; skipped: string[]; errors: string[] }> {
  const updated: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  const flowId = await resolveActiveFlowId(consultantId, variant);
  if (!flowId) {
    errors.push(`fluxo ${variant} ativo não encontrado`);
    return { updated, skipped, errors };
  }

  const syncable = MULTICHANNEL_CADENCE_TEMPLATES.filter(
    (t) =>
      t.group === "A" &&
      !t.hiddenInPanel &&
      (t.channel === "whatsapp_text" ||
        t.channel === "whatsapp_buttons" ||
        t.channel === "whatsapp_audio" ||
        !!t.buttons?.length),
  );

  for (const tpl of syncable) {
    if (tpl.channel === "whatsapp_audio" && !tpl.buttons?.length) {
      skipped.push(tpl.key);
      continue;
    }

    const { data: step, error: stepErr } = await supabase
      .from("bot_flow_steps")
      .select("id, step_key, message_text, captures, transitions")
      .eq("flow_id", flowId)
      .eq("step_key", tpl.key)
      .maybeSingle();

    if (stepErr) {
      errors.push(`${tpl.key}: ${stepErr.message}`);
      continue;
    }
    if (!step?.id) {
      skipped.push(tpl.key);
      continue;
    }

    const body = resolveBody(tpl, lib).trim();
    const buttons = resolveButtons(tpl, lib);
    const captures = Array.isArray(step.captures)
      ? ([...step.captures] as CaptureRow[])
      : [];
    const withoutButtons = captures.filter((c) => c.field !== "_buttons");
    const nextCaptures =
      buttons.length > 0
        ? [
            ...withoutButtons,
            {
              field: "_buttons",
              enabled: true,
              value: buttons.map((b) => ({ id: b.id, title: b.title })),
            },
          ]
        : withoutButtons;

    let nextTransitions = step.transitions as TransitionRow[] | null;
    if (buttons.length > 0 && Array.isArray(step.transitions)) {
      const keywordTx = (step.transitions as TransitionRow[]).filter(
        (tr) => String(tr.trigger_intent || "") === "palavra_chave",
      );
      nextTransitions = (step.transitions as TransitionRow[]).map((tr) => {
        if (String(tr.trigger_intent || "") !== "palavra_chave") return tr;
        const phrases = Array.isArray(tr.trigger_phrases) ? tr.trigger_phrases : [];
        let matchedBtn = buttons.find(
          (b) =>
            phrases.some(
              (p) =>
                String(p).toLowerCase() === b.id.toLowerCase() ||
                String(p).toLowerCase() === b.title.toLowerCase(),
            ),
        );
        // Fallback por ordem: 1º botão ↔ 1ª transition palavra_chave, etc.
        if (!matchedBtn) {
          const idx = keywordTx.indexOf(tr);
          if (idx >= 0 && idx < buttons.length) matchedBtn = buttons[idx];
        }
        if (!matchedBtn) return tr;
        const nextPhrases = Array.from(
          new Set([matchedBtn.id, matchedBtn.title, ...phrases.filter(Boolean)]),
        );
        return { ...tr, trigger_phrases: nextPhrases };
      });
    }

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (body && tpl.channel !== "whatsapp_audio") {
      patch.message_text = body;
    }
    if (buttons.length > 0 || captures.some((c) => c.field === "_buttons")) {
      patch.captures = nextCaptures;
    }
    if (nextTransitions) patch.transitions = nextTransitions;

    const clipId = lib.audioClipIds?.[tpl.key];
    if (clipId) patch.voice_audio_clip_id = clipId;

    const { error: upErr } = await supabase
      .from("bot_flow_steps")
      .update(patch as never)
      .eq("id", step.id);

    if (upErr) {
      errors.push(`${tpl.key}: ${upErr.message}`);
      continue;
    }
    updated.push(tpl.key);
  }

  return { updated, skipped, errors };
}

/** Salva local + remoto + espelha no fluxo WhatsApp (Grupo A) + motor (Grupo B). */
export async function publishCadenceLibrary(
  consultantId: string,
  lib: SavedCadenceLibrary,
  variant: string = "A",
): Promise<{ updated: string[]; errors: string[] }> {
  const errors: string[] = [];
  try {
    await persistCadenceLibraryRemote(consultantId, lib);
  } catch (e) {
    errors.push(`remote: ${(e as Error)?.message || e}`);
  }
  const sync = await syncCadenceLibraryToBotFlow(consultantId, lib, variant);
  const motor = await syncCadenceLibraryToStageConfig(lib);
  return {
    updated: [...sync.updated, ...motor.updated.map((s) => `motor:${s}`)],
    errors: [...errors, ...sync.errors, ...motor.errors],
  };
}
