/**
 * Painel Multicanal ↔ bot_flow_steps + rascunho remoto.
 * O WhatsApp só lê message_text / captures._buttons / slot_key / ai_media_library.
 * localStorage é cache local — a fonte da verdade é o fluxo + biblioteca remota.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  MULTICHANNEL_CADENCE_TEMPLATES,
  OCR_RETRY_PARENT,
  cadenceAudioUrlKey,
  emptyLibrary,
  resolveBody,
  resolveButtons,
  validateWhapiButtons,
  type CadenceButton,
  type CadenceTemplate,
  type SavedCadenceLibrary,
} from "@/lib/multichannelCadenceTexts";

/** Clip Sofia do toque (chave plain ou sufixo M/F). */
export function resolveLibAudioClipId(
  lib: SavedCadenceLibrary,
  key: string,
): string | null {
  const ids = lib.audioClipIds || {};
  const raw =
    ids[key] ||
    ids[cadenceAudioUrlKey(key, "feminino")] ||
    ids[cadenceAudioUrlKey(key, "masculino")] ||
    "";
  const clip = String(raw).trim();
  return clip || null;
}

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
  fallback?: {
    mode?: string;
    max_retries?: number;
    retry_text?: string;
    then?: string;
    retry_audio_clip_id?: string | null;
  } | null;
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
  return (cap.value as Array<{
    id?: string;
    title?: string;
    goto_step_key?: string | null;
    goto_special?: string | null;
  }>)
    .map((b) => ({
      id: String(b?.id || "").trim(),
      title: String(b?.title || "").trim(),
      goto_step_key: b?.goto_step_key ? String(b.goto_step_key) : null,
      goto_special: (b?.goto_special as CadenceButton["goto_special"]) || null,
    }))
    .filter((b) => b.id && b.title);
}

/** Cruza captures._buttons com transitions do passo → destino legível (step_key). */
function attachGotoFromTransitions(
  buttons: CadenceButton[],
  transitions: TransitionRow[] | null | undefined,
  keyById: Map<string, string>,
): CadenceButton[] {
  if (!buttons.length || !transitions?.length) return buttons;
  const keywordTx = transitions.filter(
    (tr) => String(tr.trigger_intent || "") === "palavra_chave",
  );
  return buttons.map((b, idx) => {
    if (b.goto_step_key || b.goto_special) return b;
    const phrasesMatch = (tr: TransitionRow) => {
      const phrases = Array.isArray(tr.trigger_phrases)
        ? tr.trigger_phrases.map(String)
        : [];
      const intent = String(tr.trigger_intent || "");
      return (
        intent === b.id ||
        phrases.some(
          (p) =>
            p.toLowerCase() === b.id.toLowerCase() ||
            p.toLowerCase() === b.title.toLowerCase(),
        )
      );
    };
    let matched =
      transitions.find(phrasesMatch) ||
      keywordTx.find(phrasesMatch) ||
      null;
    if (!matched && idx < keywordTx.length) matched = keywordTx[idx];
    if (!matched) return b;
    return {
      ...b,
      goto_special: (matched.goto_special as CadenceButton["goto_special"]) || null,
      goto_step_key: matched.goto_step_id
        ? keyById.get(String(matched.goto_step_id)) ?? null
        : null,
    };
  });
}

/** Carrega textos/botões já gravados no fluxo ativo → biblioteca do painel. */
export async function loadCadenceLibraryFromBotFlow(
  consultantId: string,
  variant: string = "A",
): Promise<Partial<SavedCadenceLibrary>> {
  const flowId = await resolveActiveFlowId(consultantId, variant);
  if (!flowId) return {};

  const keys = MULTICHANNEL_CADENCE_TEMPLATES.filter(
    (t) => t.group === "A" && !t.hiddenInPanel && !(t.key in STAGE_TEXT_SYNC_MAP),
  ).map((t) => t.key);

  const parentKeys = Object.values(OCR_RETRY_PARENT).map((p) => p.parentKey);
  const loadKeys = Array.from(new Set([...keys, ...parentKeys]));

  const { data: allSteps, error: allErr } = await supabase
    .from("bot_flow_steps")
    .select("id, step_key, message_text, captures, transitions, voice_audio_clip_id, fallback")
    .eq("flow_id", flowId);

  if (allErr || !allSteps?.length) return {};

  const keyById = new Map(
    (allSteps as FlowStepRow[]).map((s) => [String(s.id), String(s.step_key || "")]),
  );
  const steps = (allSteps as FlowStepRow[]).filter((s) =>
    loadKeys.includes(String(s.step_key || "")),
  );
  if (!steps.length) return {};

  const bodies: Record<string, string> = {};
  const buttons: Record<string, CadenceButton[]> = {};
  const audioClipIds: Record<string, string> = {};

  for (const raw of steps) {
    const key = String(raw.step_key || "");
    const tpl = MULTICHANNEL_CADENCE_TEMPLATES.find((t) => t.key === key);
    if (tpl) {
      if (tpl.channel !== "whatsapp_audio" && String(raw.message_text || "").trim()) {
        bodies[key] = String(raw.message_text);
      }
      const btns = attachGotoFromTransitions(
        buttonsFromCaptures(raw.captures),
        raw.transitions as TransitionRow[] | null,
        keyById,
      );
      if (btns.length) buttons[key] = btns;
      if (raw.voice_audio_clip_id) audioClipIds[key] = String(raw.voice_audio_clip_id);
    }

    // Erro OCR: fallback do passo pai → toques a6_ocr_retry / a7_ocr_retry
    const retryKey = Object.entries(OCR_RETRY_PARENT).find(
      ([, p]) => p.parentKey === key,
    )?.[0];
    if (retryKey) {
      const fb = raw.fallback;
      if (fb?.mode === "retry" && String(fb.retry_text || "").trim()) {
        bodies[retryKey] = String(fb.retry_text);
      }
      if (fb?.retry_audio_clip_id) {
        audioClipIds[retryKey] = String(fb.retry_audio_clip_id);
      }
    }
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

/** Grupo A — escada de silêncio (pizza Retomada → Fecha A). Só motor, não grafo Sofia. */
const GROUP_A_TO_STAGE: Record<string, string> = {
  a_nudge_wa: "A_NUDGE",
  a_nudge_sms: "A_SMS",
  a_nudge_call: "A_CALL",
  a_nudge_call_retry: "A_CALL_RETRY",
};

/**
 * Mapa Grupo B (painel Multicanal) → estágios do motor `cadence_stage_config`.
 * Faz o que o usuário edita virar o texto real que o motor envia.
 */
const GROUP_B_TO_STAGE: Record<string, string> = {
  b1_wa_reopen: "COLD_1",
  b_day2_wa: "COLD_2",
  b_day2_sms_tema: "SMS_TEMA_2",
  b_day7_wa_easy: "COLD_3",
  b_day7_sms_tema: "SMS_TEMA_7",
  b_day10_wa_final: "COLD_4",
  b4_call_1: "CALL_1",
  b_day4_call_2: "CALL_2",
  b_day10_call: "CALL_3",
  b3_sms_1: "SMS_1",
  b_day6_sms_2: "SMS_2",
};

/** Grupo C (Meta informativo não entra) → WA / SMS / CALL de cada marco. */
const GROUP_C_TO_STAGE: Record<string, string> = {
  c_recall_60d_wa: "RECALL_60D",
  c_recall_60d_sms: "RECALL_60D_SMS",
  c_recall_60d_call: "RECALL_60D_CALL",
  c_recall_90d_wa: "RECALL_90D",
  c_recall_90d_sms: "RECALL_90D_SMS",
  c_recall_90d_call: "RECALL_90D_CALL",
  c_recall_5m_wa: "RECALL_5M",
  c_recall_5m_sms: "RECALL_5M_SMS",
  c_recall_5m_call: "RECALL_5M_CALL",
  c_recall_8m_wa: "RECALL_8M",
  c_recall_8m_sms: "RECALL_8M_SMS",
  c_recall_8m_call: "RECALL_8M_CALL",
  c_recall_12m_wa: "RECALL_12M",
  c_recall_12m_sms: "RECALL_12M_SMS",
  c_recall_12m_call: "RECALL_12M_CALL",
  c_recall_yearly_wa: "RECALL_YEARLY",
  c_recall_yearly_sms: "RECALL_YEARLY_SMS",
  c_recall_yearly_call: "RECALL_YEARLY_CALL",
};

export const STAGE_TEXT_SYNC_MAP: Record<string, string> = {
  ...GROUP_A_TO_STAGE,
  ...GROUP_B_TO_STAGE,
  ...GROUP_C_TO_STAGE,
};

/**
 * ContentContract: patch de conteúdo do motor a partir do painel (função pura,
 * testável). Botões só entram para canal `whatsapp_buttons`, validados
 * (máx 3, título ≤ 25). Inválidos → campo fica de fora (motor mantém o que
 * tem; runtime ainda tem fallback hardcoded). Botões vazios → null (volta ao
 * fallback hardcoded do motor).
 */
export function buildStageConfigPatch(
  tpl: CadenceTemplate,
  lib: SavedCadenceLibrary,
): { body: string; patch: Record<string, unknown>; buttonErrors: string[] } {
  const body = resolveBody(tpl, lib).trim();
  const patch: Record<string, unknown> = {};
  const buttonErrors: string[] = [];
  if (body) patch.message_text = body;
  if (tpl.channel === "whatsapp_buttons") {
    const buttons = resolveButtons(tpl, lib);
    const v = validateWhapiButtons(buttons);
    if (!v.ok) {
      buttonErrors.push(...v.errors.map((e) => `${tpl.key}: ${e}`));
    } else {
      patch.buttons = buttons.length > 0
        ? buttons.map((b) => ({ id: b.id, title: b.title }))
        : null;
    }
  }
  // Ligação: roteiro em message_text + clip Sofia para o dialer (cadence-tick).
  if (tpl.channel === "call_script") {
    const clipId = resolveLibAudioClipId(lib, tpl.key);
    if (clipId) patch.voice_audio_clip_id = clipId;
  }
  return { body, patch, buttonErrors };
}

/**
 * Espelha textos do Multicanal (Grupo A escada + B + C) em `cadence_stage_config`
 * **do consultor** (isolado). Não sobrescreve o global nem o de outro parceiro.
 * Botões (ContentContract) vão junto para os stages WhatsApp.
 */
export async function syncCadenceLibraryToStageConfig(
  lib: SavedCadenceLibrary,
  consultantId: string,
): Promise<{ updated: string[]; errors: string[] }> {
  const updated: string[] = [];
  const errors: string[] = [];
  if (!consultantId) {
    errors.push("motor: consultant_id ausente");
    return { updated, errors };
  }
  for (const [key, stage] of Object.entries(STAGE_TEXT_SYNC_MAP)) {
    const tpl = MULTICHANNEL_CADENCE_TEMPLATES.find((t) => t.key === key);
    if (!tpl) continue;
    const { body, patch, buttonErrors } = buildStageConfigPatch(tpl, lib);
    if (buttonErrors.length) errors.push(...buttonErrors);
    if (!body) continue;
    const { data: existing } = await supabase
      .from("cadence_stage_config")
      .select("id")
      .eq("consultant_id", consultantId)
      .eq("stage", stage)
      .maybeSingle();
    if (existing?.id) {
      let { error } = await supabase
        .from("cadence_stage_config")
        .update({ ...patch, updated_at: new Date().toISOString() } as never)
        .eq("id", existing.id);
      if (error && "buttons" in patch) {
        ({ error } = await supabase
          .from("cadence_stage_config")
          .update({ message_text: body, updated_at: new Date().toISOString() })
          .eq("id", existing.id));
      }
      if (error) { errors.push(`${stage}: ${error.message}`); continue; }
    } else {
      let { error } = await supabase
        .from("cadence_stage_config")
        .insert({
          stage,
          consultant_id: consultantId,
          enabled: true,
          delay_hours: 24,
          ...patch,
        } as never);
      if (error && "buttons" in patch) {
        ({ error } = await supabase
          .from("cadence_stage_config")
          .insert({
            stage,
            consultant_id: consultantId,
            message_text: body,
            enabled: true,
            delay_hours: 24,
          }));
      }
      if (error) { errors.push(`${stage}: ${error.message}`); continue; }
    }
    updated.push(stage);
  }
  return { updated, errors };
}

/** Lê textos + botões + clips de ligação do motor (Grupo B + C) para hidratar o painel.
 * Prefere config do consultor; se vazia, cai no global (fallback).
 */
export async function loadCadenceLibraryFromStageConfig(
  consultantId?: string | null,
): Promise<Partial<SavedCadenceLibrary>> {
  const stages = Object.values(STAGE_TEXT_SYNC_MAP);
  type StageRow = {
    stage: string | null;
    message_text: string | null;
    buttons?: unknown;
    voice_audio_clip_id?: string | null;
    consultant_id?: string | null;
  };

  async function fetchRows(filterConsultant: string | null): Promise<StageRow[]> {
    let q = supabase
      .from("cadence_stage_config")
      .select("stage, message_text, buttons, voice_audio_clip_id, consultant_id")
      .in("stage", stages);
    q = filterConsultant
      ? q.eq("consultant_id", filterConsultant)
      : q.is("consultant_id", null);
    const full = await q;
    if (!full.error && full.data?.length) return full.data as StageRow[];
    let q2 = supabase
      .from("cadence_stage_config")
      .select("stage, message_text, consultant_id")
      .in("stage", stages);
    q2 = filterConsultant
      ? q2.eq("consultant_id", filterConsultant)
      : q2.is("consultant_id", null);
    const legacy = await q2;
    if (legacy.error || !legacy.data?.length) return [];
    return legacy.data as StageRow[];
  }

  let rows: StageRow[] = [];
  if (consultantId) {
    rows = await fetchRows(consultantId);
  }
  if (!rows.length) {
    rows = await fetchRows(null);
  }
  if (!rows.length) return {};

  const stageToKey: Record<string, string> = {};
  for (const [k, s] of Object.entries(STAGE_TEXT_SYNC_MAP)) stageToKey[s] = k;
  const bodies: Record<string, string> = {};
  const buttons: Record<string, CadenceButton[]> = {};
  const audioClipIds: Record<string, string> = {};
  for (const row of rows) {
    const key = stageToKey[String(row.stage || "")];
    if (!key) continue;
    const text = String(row.message_text || "").trim();
    if (text) bodies[key] = text;
    const raw = row.buttons;
    if (Array.isArray(raw)) {
      const parsed = (raw as Array<{ id?: unknown; title?: unknown }>)
        .map((b) => ({
          id: String(b?.id ?? "").trim(),
          title: String(b?.title ?? "").trim(),
        }))
        .filter((b) => b.id && b.title);
      if (parsed.length) buttons[key] = parsed;
    }
    const clip = String(row.voice_audio_clip_id || "").trim();
    if (clip) audioClipIds[key] = clip;
  }
  return { bodies, buttons, audioClipIds };
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

  // OCR retry: clip vai em fallback.retry_audio_clip_id do passo pai (não voice_audio_clip_id).
  const ocrParent = OCR_RETRY_PARENT[cadenceKey];
  if (ocrParent) {
    const { data: step } = await supabase
      .from("bot_flow_steps")
      .select("id, fallback")
      .eq("flow_id", flowId)
      .eq("step_key", ocrParent.parentKey)
      .maybeSingle();
    if (!step?.id) return;
    const prev = (step as FlowStepRow).fallback && typeof (step as FlowStepRow).fallback === "object"
      ? { ...(step as FlowStepRow).fallback! }
      : { mode: "retry", max_retries: 2, then: "humano" };
    await supabase
      .from("bot_flow_steps")
      .update({
        fallback: {
          ...prev,
          mode: "retry",
          max_retries: Number(prev.max_retries ?? 2),
          then: String(prev.then || "humano"),
          retry_audio_clip_id: clipId,
        },
        updated_at: new Date().toISOString(),
      } as never)
      .eq("id", step.id);
    return;
  }

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

/** Publica texto/áudio dos toques 5b/6b no fallback do capture_conta/documento. */
async function syncOcrRetryFallbacks(
  flowId: string,
  lib: SavedCadenceLibrary,
): Promise<{ updated: string[]; errors: string[] }> {
  const updated: string[] = [];
  const errors: string[] = [];

  for (const [retryKey, meta] of Object.entries(OCR_RETRY_PARENT)) {
    const tpl = MULTICHANNEL_CADENCE_TEMPLATES.find((t) => t.key === retryKey);
    if (!tpl) continue;
    const body = resolveBody(tpl, lib).trim();
    const clipId = lib.audioClipIds?.[retryKey] || null;

    const { data: step, error: stepErr } = await supabase
      .from("bot_flow_steps")
      .select("id, fallback")
      .eq("flow_id", flowId)
      .eq("step_key", meta.parentKey)
      .maybeSingle();

    if (stepErr) {
      errors.push(`${retryKey}: ${stepErr.message}`);
      continue;
    }
    if (!step?.id) {
      // Pai ainda não existe neste fluxo — não quebra publish.
      continue;
    }

    const prevFb =
      (step as FlowStepRow).fallback && typeof (step as FlowStepRow).fallback === "object"
        ? { ...(step as FlowStepRow).fallback! }
        : {};

    const fallback = {
      ...prevFb,
      mode: "retry",
      max_retries: Number(prevFb.max_retries ?? 2),
      then: String(prevFb.then || "humano"),
      retry_text: body || String(prevFb.retry_text || tpl.body),
      retry_audio_clip_id: clipId || prevFb.retry_audio_clip_id || null,
    };

    const { error: upErr } = await supabase
      .from("bot_flow_steps")
      .update({
        fallback,
        updated_at: new Date().toISOString(),
      } as never)
      .eq("id", step.id);

    if (upErr) {
      errors.push(`${retryKey}: ${upErr.message}`);
      continue;
    }
    updated.push(retryKey);
  }

  return { updated, errors };
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

  const { data: flowStepRows } = await supabase
    .from("bot_flow_steps")
    .select("id, step_key")
    .eq("flow_id", flowId);
  const idByKey = new Map(
    ((flowStepRows || []) as Array<{ id: string; step_key: string | null }>).map((s) => [
      String(s.step_key || ""),
      String(s.id),
    ]),
  );

  const syncable = MULTICHANNEL_CADENCE_TEMPLATES.filter(
    (t) =>
      t.group === "A" &&
      !t.hiddenInPanel &&
      !(t.key in STAGE_TEXT_SYNC_MAP) &&
      (t.channel === "whatsapp_text" ||
        t.channel === "whatsapp_buttons" ||
        t.channel === "whatsapp_audio" ||
        !!t.buttons?.length),
  );

  for (const tpl of syncable) {
    // Toques OCR retry: sync dedicado (fallback do passo pai), não step_key próprio.
    if (OCR_RETRY_PARENT[tpl.key]) {
      continue;
    }

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
    if (buttons.length > 0) {
      const existing = Array.isArray(step.transitions)
        ? (step.transitions as TransitionRow[])
        : [];
      const defaults = existing.filter(
        (tr) => String(tr.trigger_intent || "") === "default",
      );
      const other = existing.filter((tr) => {
        const intent = String(tr.trigger_intent || "");
        if (intent === "default" || intent === "palavra_chave") return false;
        if (buttons.some((b) => b.id === intent)) return false;
        const phrases = Array.isArray(tr.trigger_phrases)
          ? tr.trigger_phrases.map(String)
          : [];
        if (
          buttons.some((b) =>
            phrases.some(
              (p) =>
                p.toLowerCase() === b.id.toLowerCase() ||
                p.toLowerCase() === b.title.toLowerCase(),
            ),
          )
        ) {
          return false;
        }
        return true;
      });
      const buttonTx: TransitionRow[] = buttons.map((b, i) => {
        const phrases = Array.from(
          new Set(
            [b.id, b.title, String(i + 1)].filter((x) => String(x || "").trim()),
          ),
        );
        return {
          trigger_intent: "palavra_chave",
          trigger_phrases: phrases,
          goto_step_id: b.goto_step_key
            ? idByKey.get(b.goto_step_key) ?? null
            : null,
          goto_special: b.goto_special || null,
        };
      });
      nextTransitions = [...other, ...buttonTx, ...defaults];
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

    const clipId = resolveLibAudioClipId(lib, tpl.key);
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

  const ocrSync = await syncOcrRetryFallbacks(flowId, lib);
  updated.push(...ocrSync.updated);
  errors.push(...ocrSync.errors);

  return { updated, skipped, errors };
}

/** Salva local + remoto + espelha no fluxo WhatsApp (Grupo A Sofia) + motor (escada A + B + C). */
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
  const motor = await syncCadenceLibraryToStageConfig(lib, consultantId);
  return {
    updated: [...sync.updated, ...motor.updated.map((s) => `motor:${s}`)],
    errors: [...errors, ...sync.errors, ...motor.errors],
  };
}
