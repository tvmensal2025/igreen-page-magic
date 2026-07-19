/**
 * Exporta payloads de publishCadenceLibrary (sem Supabase).
 * Saída: JSON em stdout — usado pelo agente/MCP para aplicar no banco.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  MULTICHANNEL_CADENCE_TEMPLATES,
  OCR_RETRY_PARENT,
  emptyLibrary,
  resolveBody,
  resolveButtons,
  type SavedCadenceLibrary,
} from "@/lib/multichannelCadenceTexts";
import {
  STAGE_TEXT_SYNC_MAP,
  buildStageConfigPatch,
  resolveLibAudioClipId,
} from "@/lib/syncCadenceToBotFlow";

const CONSULTANT_ID = "0c2711ad-4836-41e6-afba-edd94f698ae3";
const VARIANT = "A";

function buildBotFlowPayload(lib: SavedCadenceLibrary) {
  const syncable = MULTICHANNEL_CADENCE_TEMPLATES.filter(
    (t) =>
      t.group === "A" &&
      !t.hiddenInPanel &&
      (t.channel === "whatsapp_text" ||
        t.channel === "whatsapp_buttons" ||
        t.channel === "whatsapp_audio" ||
        !!t.buttons?.length),
  );

  const steps: Array<{
    step_key: string;
    message_text?: string;
    buttons?: Array<{ id: string; title: string }>;
    voice_audio_clip_id?: string;
  }> = [];

  for (const tpl of syncable) {
    if (OCR_RETRY_PARENT[tpl.key]) continue;
    if (tpl.channel === "whatsapp_audio" && !tpl.buttons?.length) continue;

    const body = resolveBody(tpl, lib).trim();
    const buttons = resolveButtons(tpl, lib);
    const clipId = resolveLibAudioClipId(lib, tpl.key);

    const row: (typeof steps)[number] = { step_key: tpl.key };
    if (body && tpl.channel !== "whatsapp_audio") row.message_text = body;
    if (buttons.length) row.buttons = buttons;
    if (clipId) row.voice_audio_clip_id = clipId;
    if (row.message_text || row.buttons || row.voice_audio_clip_id) steps.push(row);
  }

  const ocrRetries: Array<{
    retry_key: string;
    parent_key: string;
    retry_text: string;
    retry_audio_clip_id?: string;
  }> = [];

  for (const [retryKey, meta] of Object.entries(OCR_RETRY_PARENT)) {
    const tpl = MULTICHANNEL_CADENCE_TEMPLATES.find((t) => t.key === retryKey);
    if (!tpl) continue;
    const body = resolveBody(tpl, lib).trim();
    const clipId = lib.audioClipIds?.[retryKey] || undefined;
    ocrRetries.push({
      retry_key: retryKey,
      parent_key: meta.parentKey,
      retry_text: body || tpl.body,
      retry_audio_clip_id: clipId,
    });
  }

  return { consultant_id: CONSULTANT_ID, variant: VARIANT, steps, ocr_retries: ocrRetries };
}

function buildStagePayload(lib: SavedCadenceLibrary) {
  const stages: Array<{
    stage: string;
    template_key: string;
    message_text: string;
    buttons?: Array<{ id: string; title: string }> | null;
    voice_audio_clip_id?: string;
  }> = [];

  for (const [key, stage] of Object.entries(STAGE_TEXT_SYNC_MAP)) {
    const tpl = MULTICHANNEL_CADENCE_TEMPLATES.find((t) => t.key === key);
    if (!tpl) continue;
    const { body, patch, buttonErrors } = buildStageConfigPatch(tpl, lib);
    if (buttonErrors.length) {
      console.error(`buttonErrors ${key}:`, buttonErrors);
    }
    if (!body) continue;
    const row: (typeof stages)[number] = {
      stage,
      template_key: key,
      message_text: body,
    };
    if ("buttons" in patch) row.buttons = patch.buttons as typeof row.buttons;
    if (patch.voice_audio_clip_id) {
      row.voice_audio_clip_id = String(patch.voice_audio_clip_id);
    }
    stages.push(row);
  }

  return { stages };
}

const lib = emptyLibrary();
const payload = {
  bot_flow: buildBotFlowPayload(lib),
  stage_config: buildStagePayload(lib),
  generated_at: new Date().toISOString(),
};

const outPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "tmp_cadence_publish_payload.json",
);
writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");
console.log(JSON.stringify(payload));
