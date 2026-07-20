/**
 * Lacunas Multicanal / motor — textos em linguagem humana (sem códigos técnicos).
 */
import { supabase } from "@/integrations/supabase/client";
import { STAGE_TEXT_SYNC_MAP } from "@/lib/syncCadenceToBotFlow";
import { getTemplate } from "@/lib/multichannelCadenceTexts";
import { labelCadenceStage } from "@/lib/cadenceStageLabels";
import { stepByStage } from "@/lib/cadenceCalendarMap";

export type CadenceGap = {
  id: string;
  severity: "high" | "medium";
  title: string;
  detail: string;
  cadenceKey?: string;
};

/** Stages de voz que precisam de clip Sofia no motor. */
const VOICE_STAGES = Object.entries(STAGE_TEXT_SYNC_MAP)
  .filter(([key]) => getTemplate(key)?.channel === "call_script")
  .map(([key, stage]) => ({ key, stage }));

const STAGE_TO_TOGGLE: Record<string, string> = {
  CALL_1: "cadence_call_1",
  CALL_2: "cadence_call_2",
  CALL_3: "cadence_call_3",
  SMS_1: "cadence_sms_1",
  SMS_2: "cadence_sms_2",
  COLD_1: "cadence_cold_1",
  RECALL_60D: "cadence_recall_60d",
  RECALL_60D_SMS: "cadence_recall_60d",
  RECALL_60D_CALL: "cadence_recall_60d",
  RECALL_90D: "cadence_recall_90d",
  RECALL_90D_SMS: "cadence_recall_90d",
  RECALL_90D_CALL: "cadence_recall_90d",
  RECALL_5M: "cadence_recall_5m",
  RECALL_5M_SMS: "cadence_recall_5m",
  RECALL_5M_CALL: "cadence_recall_5m",
  RECALL_8M: "cadence_recall_8m",
  RECALL_8M_SMS: "cadence_recall_8m",
  RECALL_8M_CALL: "cadence_recall_8m",
  RECALL_12M: "cadence_recall_12m",
  RECALL_12M_SMS: "cadence_recall_12m",
  RECALL_12M_CALL: "cadence_recall_12m",
  RECALL_YEARLY: "cadence_recall_yearly",
  RECALL_YEARLY_SMS: "cadence_recall_yearly",
  RECALL_YEARLY_CALL: "cadence_recall_yearly",
};

/** Nome real do toque (Multicanal / calendário), nunca o código interno. */
function humanStepName(stage: string, cadenceKey?: string): string {
  if (cadenceKey) {
    const tpl = getTemplate(cadenceKey);
    if (tpl?.title) return tpl.title;
  }
  const key = Object.entries(STAGE_TEXT_SYNC_MAP).find(([, s]) => s === stage)?.[0];
  if (key) {
    const tpl = getTemplate(key);
    if (tpl?.title) return tpl.title;
  }
  const step = stepByStage(stage);
  if (step?.title) return step.title;
  return labelCadenceStage(stage, "long");
}

function channelWord(stage: string): string {
  const step = stepByStage(stage);
  if (step?.channel === "voice") return "ligação";
  if (step?.channel === "sms") return "SMS";
  if (step?.channel === "whatsapp") return "WhatsApp";
  if (stage.includes("CALL") || stage.startsWith("CALL_")) return "ligação";
  if (stage.includes("SMS")) return "SMS";
  return "mensagem";
}

export async function loadCadenceGaps(): Promise<CadenceGap[]> {
  const gaps: CadenceGap[] = [];
  const voiceStages = VOICE_STAGES.map((v) => v.stage);
  const stageKeys = [
    ...new Set([
      ...voiceStages,
      "SMS_1",
      "COLD_1",
      "RECALL_12M",
      "RECALL_YEARLY",
      "RECALL_YEARLY_SMS",
      "RECALL_YEARLY_CALL",
    ]),
  ];

  const [cfgRes, tgRes, userRes] = await Promise.all([
    (supabase as any)
      .from("cadence_stage_config")
      .select("stage, enabled, voice_audio_clip_id, message_text, consultant_id")
      .in("stage", stageKeys),
    (supabase as any)
      .from("automation_toggles")
      .select("key, enabled")
      .in("key", [...new Set(Object.values(STAGE_TO_TOGGLE))]),
    supabase.auth.getUser(),
  ]);

  const userId = userRes.data.user?.id ?? null;
  const rows = (cfgRes.data || []) as Array<{
    stage: string;
    enabled: boolean | null;
    voice_audio_clip_id: string | null;
    message_text: string | null;
    consultant_id: string | null;
  }>;
  const byStage = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (row.consultant_id !== null && row.consultant_id !== userId) continue;
    const current = byStage.get(row.stage);
    if (!current || row.consultant_id === userId) byStage.set(row.stage, row);
  }
  const toggles = new Map(
    ((tgRes.data || []) as Array<{ key: string; enabled: boolean }>).map((t) => [
      t.key,
      !!t.enabled,
    ]),
  );

  for (const { key, stage } of VOICE_STAGES) {
    const toggleKey = STAGE_TO_TOGGLE[stage];
    if (toggleKey && toggles.get(toggleKey) === false) continue;
    const row = byStage.get(stage);
    const name = humanStepName(stage, key);
    const hasClip = !!(row?.voice_audio_clip_id && String(row.voice_audio_clip_id).trim());
    if (!hasClip) {
      gaps.push({
        id: `clip:${stage}`,
        severity: "high",
        title: `Falta o áudio da ligação: ${name}`,
        detail: "Gere o áudio Sofia neste toque e publique — sem áudio a ligação não sai.",
        cadenceKey: key,
      });
    }
  }

  // Toggle ON + estágio OFF — linguagem humana, sem códigos
  const watchStages = [
    "CALL_1",
    "SMS_1",
    "RECALL_12M",
    "RECALL_12M_CALL",
    "RECALL_YEARLY",
    "RECALL_YEARLY_SMS",
    "RECALL_YEARLY_CALL",
  ];
  for (const stage of watchStages) {
    const toggleKey = STAGE_TO_TOGGLE[stage];
    if (!toggleKey) continue;
    const toggleOn = toggles.get(toggleKey) === true;
    const row = byStage.get(stage);
    if (toggleOn && row && row.enabled === false) {
      const name = humanStepName(stage);
      const ch = channelWord(stage);
      gaps.push({
        id: `off:${stage}`,
        severity: "medium",
        title: `${name} — envio desligado`,
        detail: `O ${ch} está com o interruptor da Central ligado, mas o passo ainda está desligado no motor — por isso não envia.`,
        cadenceKey: Object.entries(STAGE_TEXT_SYNC_MAP).find(([, s]) => s === stage)?.[0],
      });
    }
  }

  const sms1 = byStage.get("SMS_1");
  if (sms1 && !String(sms1.message_text || "").trim()) {
    gaps.push({
      id: "sms1:empty",
      severity: "high",
      title: "Falta o texto do SMS do Dia 1",
      detail: "Abra o toque de SMS do Dia 1, escreva a mensagem e publique.",
      cadenceKey: "b3_sms_1",
    });
  }

  return gaps;
}
