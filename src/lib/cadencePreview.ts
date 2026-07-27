/**
 * Prévia segura de envios do motor (WA / SMS / voz).
 * Extraído da ReheatCyclePizza para reuso em Futuros e pizza.
 */
import { supabase } from "@/integrations/supabase/client";
import { getTemplate, renderCadenceBody } from "@/lib/multichannelCadenceTexts";
import { firstNameFromPublicConsultant, resolveAssistantDisplayName, resolveConsultantRoleGender } from "@/lib/consultantPublicLabel";
import {
  formatPersonName,
  isAddressableNameSource,
  isUsableCustomerName,
} from "@/lib/customerDisplayName";

export type CadencePreviewChannel = "whatsapp" | "sms" | "voice" | "system" | "meta_audience";

/** Canal do estágio no motor (espelho enxuto do STAGE_MAP). */
export const STAGE_CHANNEL: Record<string, CadencePreviewChannel> = {
  NEW: "system",
  GREETED: "system",
  AI_QUALIFYING: "system",
  A_NUDGE: "whatsapp",
  A_SMS: "sms",
  A_CALL: "voice",
  A_CALL_RETRY: "voice",
  COLD_1: "whatsapp",
  SMS_1: "sms",
  CALL_1: "voice",
  COLD_2: "whatsapp",
  SMS_TEMA_2: "sms",
  CALL_2: "voice",
  SMS_2: "sms",
  COLD_3: "whatsapp",
  SMS_TEMA_7: "sms",
  CALL_3: "voice",
  COLD_4: "whatsapp",
  RECALL_60D: "whatsapp",
  RECALL_60D_SMS: "sms",
  RECALL_60D_CALL: "voice",
  RECALL_90D: "whatsapp",
  RECALL_90D_SMS: "sms",
  RECALL_90D_CALL: "voice",
  RECALL_5M: "whatsapp",
  RECALL_5M_SMS: "sms",
  RECALL_5M_CALL: "voice",
  RECALL_8M: "whatsapp",
  RECALL_8M_SMS: "sms",
  RECALL_8M_CALL: "voice",
  RECALL_12M: "whatsapp",
  RECALL_12M_SMS: "sms",
  RECALL_12M_CALL: "voice",
  RECALL_YEARLY: "whatsapp",
  RECALL_YEARLY_SMS: "sms",
  RECALL_YEARLY_CALL: "voice",
};

/** Escada A: próximo estágio outbound quando o atual é “espera”. */
export const STAGE_NEXT_A: Record<string, string> = {
  NEW: "GREETED",
  GREETED: "A_NUDGE",
  AI_QUALIFYING: "A_NUDGE",
  A_NUDGE: "A_SMS",
  A_SMS: "A_CALL",
  A_CALL: "A_CALL_RETRY",
  A_CALL_RETRY: "COLD_1",
};

/** Stage do motor → key do catálogo Multicanal (fallback de prévia). */
export const STAGE_TO_CADENCE_KEY: Record<string, string> = {
  A_NUDGE: "a_nudge_wa",
  A_SMS: "a_nudge_sms",
  A_CALL: "a_nudge_call",
  A_CALL_RETRY: "a_nudge_call_retry",
  COLD_1: "b1_wa_reopen",
  SMS_1: "b3_sms_1",
  CALL_1: "b4_call_1",
  COLD_2: "b_day2_wa",
  SMS_TEMA_2: "b_day2_sms_tema",
  CALL_2: "b_day4_call_2",
  SMS_2: "b_day6_sms_2",
  COLD_3: "b_day7_wa_easy",
  SMS_TEMA_7: "b_day7_sms_tema",
  CALL_3: "b_day10_call",
  COLD_4: "b_day10_wa_final",
  RECALL_60D: "c_recall_60d_wa",
  RECALL_60D_SMS: "c_recall_60d_sms",
  RECALL_60D_CALL: "c_recall_60d_call",
  RECALL_90D: "c_recall_90d_wa",
  RECALL_90D_SMS: "c_recall_90d_sms",
  RECALL_90D_CALL: "c_recall_90d_call",
  RECALL_5M: "c_recall_5m_wa",
  RECALL_5M_SMS: "c_recall_5m_sms",
  RECALL_5M_CALL: "c_recall_5m_call",
  RECALL_8M: "c_recall_8m_wa",
  RECALL_8M_SMS: "c_recall_8m_sms",
  RECALL_8M_CALL: "c_recall_8m_call",
  RECALL_12M: "c_recall_12m_wa",
  RECALL_12M_SMS: "c_recall_12m_sms",
  RECALL_12M_CALL: "c_recall_12m_call",
  RECALL_YEARLY: "c_recall_yearly_wa",
  RECALL_YEARLY_SMS: "c_recall_yearly_sms",
  RECALL_YEARLY_CALL: "c_recall_yearly_call",
};

export type StepPreviewTemplate = {
  stage: string;
  channel: CadencePreviewChannel;
  template: string | null;
  mediaUrl: string | null;
  mediaType: string | null;
  consultor: string;
  consultorPhone: string;
  assistente: string;
  consultorGender: "consultor" | "consultora";
};

export type PersonPreview = {
  body: string | null;
  withName: boolean;
  mediaUrl: string | null;
  mediaType: string | null;
  channel: string;
  stage: string;
};

type StageCfgHit = {
  stage: string;
  message_text: string | null;
  media_url: string | null;
  media_type: string | null;
  voice_audio_clip_id: string | null;
  consultant_id: string | null;
};

export function isOutboundChannel(ch: string | undefined): ch is "whatsapp" | "sms" | "voice" {
  return ch === "whatsapp" || ch === "sms" || ch === "voice";
}

export function phoneDigits(raw: string | null | undefined): string {
  return String(raw ?? "").replace(/\D/g, "");
}

/** Roteiro de ligação gravada antigo (interativo) — não pode ir pra prévia/TTS. */
export function isLegacyInteractiveCallScript(text: string): boolean {
  return /você prefere|explicar agora|30 segundos|se estiver ocupado|se demonstrar desconfiança/i.test(
    text,
  );
}

/**
 * Qual estágio pré-visualizar.
 * Se o atual já dispara WA/SMS/voz → esse. Senão, o próximo toque da escada A.
 * `sliceStages` opcional (pizza): fallback pela fatia.
 */
export function previewStageForLead(
  stage: string | null | undefined,
  sliceStages: string[] = [],
): string | null {
  const st = String(stage || "").trim();
  if (st && isOutboundChannel(STAGE_CHANNEL[st])) return st;
  if (st && STAGE_NEXT_A[st] && isOutboundChannel(STAGE_CHANNEL[STAGE_NEXT_A[st]])) {
    return STAGE_NEXT_A[st];
  }
  for (const s of sliceStages) {
    if (isOutboundChannel(STAGE_CHANNEL[s])) return s;
  }
  for (const s of sliceStages) {
    const n = STAGE_NEXT_A[s];
    if (n && isOutboundChannel(STAGE_CHANNEL[n])) return n;
  }
  return sliceStages[0] || (st || null);
}

export function safeFirstNameUi(
  name: string | null | undefined,
  nameSource: string | null | undefined,
): string {
  if (!isAddressableNameSource(nameSource)) return "";
  if (!isUsableCustomerName(name)) return "";
  const first = String(name || "").trim().split(/\s+/)[0] || "";
  return first ? formatPersonName(first).split(/\s+/)[0] || "" : "";
}

/** Espelho enxuto do scrub do motor — remove saudação com {{nome}} vazio. */
export function scrubEmptyNameUi(template: string): string {
  let out = String(template || "");
  const greet = "(?:Oi|Ol[aá]|Hey|Eae|E a[ií]|Bom dia|Boa tarde|Boa noite)";
  out = out.replace(
    new RegExp(`^\\*?\\s*${greet}\\s*,?\\s*\\*?\\s*\\{\\{\\s*nome\\s*\\}\\}\\s*\\*?\\s*[,.!]?\\s*\\*?\\s*`, "gimsu"),
    "",
  );
  out = out.replace(new RegExp(`\\b${greet}\\s*,?\\s*\\*?\\s*\\{\\{\\s*nome\\s*\\}\\}\\s*\\*?\\s*[,.!]?\\s*`, "gi"), "");
  out = out.replace(/\*?\s*\{\{\s*nome\s*\}\}\s*\*?/gi, " ");
  out = out.replace(/\{\{\s*nome\s*\}\}/gi, "");
  return out;
}

export function renderHistoryTemplate(
  tpl: string,
  vars: {
    nome: string;
    consultor: string;
    consultor_phone: string;
    assistente?: string;
    consultorGender?: "consultor" | "consultora";
  },
): string {
  let out = tpl;
  if (!vars.nome.trim()) out = scrubEmptyNameUi(out);
  out = renderCadenceBody(out, {
    nome: vars.nome,
    consultor: vars.consultor,
    consultorPhone: vars.consultor_phone,
    assistente: vars.assistente || "Assistente",
    consultorGender: vars.consultorGender || "consultor",
  });
  if (!vars.nome.trim()) out = scrubEmptyNameUi(out);
  return out
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\*Oi,\s*\*!\s*/i, "")
    .replace(/^\*,\s*/gm, "")
    .trim();
}

export function buildPersonPreview(
  tpl: StepPreviewTemplate | undefined,
  person: { name: string | null; nameSource: string | null },
): PersonPreview | null {
  if (!tpl) return null;
  const first = safeFirstNameUi(person.name, person.nameSource);
  const body = tpl.template
    ? renderHistoryTemplate(tpl.template, {
        nome: first,
        consultor: tpl.consultor,
        consultor_phone: tpl.consultorPhone,
        assistente: tpl.assistente,
        consultorGender: tpl.consultorGender,
      })
    : null;
  return {
    body,
    withName: !!first,
    mediaUrl: tpl.mediaUrl,
    mediaType: tpl.mediaType,
    channel: tpl.channel,
    stage: tpl.stage,
  };
}

export async function loadStepPreviewTemplates(
  consultantId: string | undefined,
  stages: string[],
): Promise<Record<string, StepPreviewTemplate>> {
  const out: Record<string, StepPreviewTemplate> = {};
  if (!stages.length) return out;

  const { data: cfgRows } = await (supabase as any)
    .from("cadence_stage_config")
    .select("stage, message_text, media_url, media_type, voice_audio_clip_id, consultant_id")
    .in("stage", stages);

  const cfgByStage = new Map<string, StageCfgHit>();
  for (const cfg of (cfgRows as StageCfgHit[]) || []) {
    const st = String(cfg.stage);
    const existing = cfgByStage.get(st);
    if (!existing) {
      cfgByStage.set(st, cfg);
      continue;
    }
    if (consultantId && cfg.consultant_id === consultantId) cfgByStage.set(st, cfg);
    else if (!existing.consultant_id && cfg.consultant_id == null) cfgByStage.set(st, cfg);
  }

  let consultor = "";
  let consultorPhone = "";
  let assistente = "Assistente";
  let consultorGender: "consultor" | "consultora" = "consultor";
  if (consultantId) {
    const { data: cons } = await (supabase as any)
      .from("consultants")
      .select("name, display_name, assistant_name, gender")
      .eq("id", consultantId)
      .maybeSingle();
    consultor = firstNameFromPublicConsultant(cons?.name, cons?.display_name);
    assistente = resolveAssistantDisplayName(cons?.assistant_name);
    consultorGender = resolveConsultantRoleGender(
      cons?.gender,
      consultor || cons?.name || cons?.display_name,
    );
    const { data: waInst } = await (supabase as any)
      .from("whatsapp_instances")
      .select("connected_phone")
      .eq("consultant_id", consultantId)
      .order("updated_at", { ascending: false })
      .limit(5);
    for (const w of (waInst as { connected_phone: string | null }[]) || []) {
      const dig = phoneDigits(w.connected_phone);
      if (dig.length >= 10) {
        consultorPhone = dig.startsWith("55") ? dig : `55${dig}`;
        break;
      }
    }
  }

  const clipIds = [
    ...new Set(
      [...cfgByStage.values()]
        .map((c) => c.voice_audio_clip_id)
        .filter((id): id is string => !!id),
    ),
  ];
  const clipUrlById = new Map<string, string>();
  if (clipIds.length) {
    const { data: clips } = await (supabase as any)
      .from("voice_audio_clips")
      .select("id, audio_url")
      .in("id", clipIds);
    for (const cl of (clips as { id: string; audio_url: string | null }[]) || []) {
      if (cl.audio_url) clipUrlById.set(cl.id, cl.audio_url);
    }
  }

  for (const stage of stages) {
    const cfg = cfgByStage.get(stage);
    const ch = STAGE_CHANNEL[stage] || "system";
    const catalogKey = STAGE_TO_CADENCE_KEY[stage];
    const catalogBody = catalogKey ? getTemplate(catalogKey)?.body?.trim() || null : null;
    let template = cfg?.message_text?.trim() || null;
    if (ch === "voice" && (!template || isLegacyInteractiveCallScript(template))) {
      template = catalogBody;
    } else if (!template) {
      template = catalogBody;
    }
    const mediaUrl =
      cfg?.media_url ||
      (cfg?.voice_audio_clip_id ? clipUrlById.get(cfg.voice_audio_clip_id) || null : null);
    out[stage] = {
      stage,
      channel: ch,
      template,
      mediaUrl,
      mediaType: cfg?.media_type || (mediaUrl ? "audio" : null),
      consultor,
      consultorPhone,
      assistente,
      consultorGender,
    };
  }
  return out;
}
