import { useCallback, useEffect, useMemo, useState, type ComponentType } from "react";
import {
  RefreshCw,
  Play,
  Settings2,
  MessageSquare,
  Loader2,
  MessageCircle,
  UserPlus,
  MessagesSquare,
  Clock3,
  RotateCcw,
  Phone,
  Hourglass,
  CalendarDays,
  Sparkles,
  PhoneCall,
  Smartphone,
  Hand,
  Flag,
  Megaphone,
  History,
  CheckCheck,
  Check,
  ChevronDown,
  type LucideProps,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CadenceCostHelpModal } from "@/components/admin/CadenceCostHelpModal";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { CADENCE_CALENDAR, CHANNEL_LABEL, type CadenceChannelUi } from "@/lib/cadenceCalendarMap";
import { getTemplate } from "@/lib/multichannelCadenceTexts";
import { isLegacyInteractiveCallScript } from "@/lib/cadencePreview";
import { CadenceMissingAlert } from "@/components/admin/CadenceMissingAlert";
import ConsultantIdentityWizard from "@/components/admin/ConsultantIdentityWizard";
import { SlaBacklogLeadsBanner } from "@/components/admin/SlaBacklogLeadsDialog";
import { HandoffLeadsBanner } from "@/components/admin/HandoffLeadsDialog";
import { isCycleLeadEligible, isPausedGroupA } from "@/lib/cycleEligibility";
import { formatBrazilPhone, normalizeBrazilPhone, phonesMatch, validateBrazilPhone } from "@/lib/phone";
import { firstNameFromPublicConsultant, resolveAssistantDisplayName, resolveConsultantRoleGender } from "@/lib/consultantPublicLabel";
import { labelCadenceStage, labelNextCadenceAction } from "@/lib/cadenceStageLabels";
import {
  STAGE_CHANNEL,
  STAGE_NEXT_A as STAGE_NEXT,
  STAGE_TO_CADENCE_KEY,
  buildPersonPreview,
  loadStepPreviewTemplates,
  phoneDigits,
  previewStageForLead as previewStageForLeadShared,
  renderHistoryTemplate,
  safeFirstNameUi,
  type StepPreviewTemplate,
} from "@/lib/cadencePreview";
import { formatDurationSec, velipOutcomeLabel } from "@/components/admin/voz/voiceOutcomeLabels";

type LucideIcon = ComponentType<LucideProps>;

type SliceEditTarget = {
  label: string;
  /** Sub-aba Voz: `textos` (Multicanal) ou `kit` (Programação do ciclo). */
  sub: "textos" | "kit";
  cadenceKey?: string;
};

/** Pizza C — fatia → estágios do calendário (WA/SMS/CALL do mesmo marco). */
const C_SLICE_STAGES: Record<string, string[]> = {
  meta: ["CLOSE_LOST", "RETARGET_META", "RETARGET_ADS_15D"],
  r30: ["RECALL_60D", "RECALL_60D_SMS", "RECALL_60D_CALL"],
  r90: ["RECALL_90D", "RECALL_90D_SMS", "RECALL_90D_CALL"],
  r5m: ["RECALL_5M", "RECALL_5M_SMS", "RECALL_5M_CALL"],
  r8m: ["RECALL_8M", "RECALL_8M_SMS", "RECALL_8M_CALL"],
  r12m: ["RECALL_12M", "RECALL_12M_SMS", "RECALL_12M_CALL"],
  ryear: ["RECALL_YEARLY", "RECALL_YEARLY_SMS", "RECALL_YEARLY_CALL"],
};

function editTargetsForSlice(group: "A" | "B" | "C", stepId: string): SliceEditTarget[] {
  if (group === "A") {
    if (stepId === "ask_name") {
      return [{ label: "Textos · pedir nome", sub: "textos", cadenceKey: "a1_ask_name" }];
    }
    if (stepId === "flow") {
      return [
        { label: "Textos · pedir nome", sub: "textos", cadenceKey: "a1_ask_name" },
        { label: "Textos · áudio ativar", sub: "textos", cadenceKey: "a2_audio_activate_name" },
      ];
    }
    if (stepId === "nudge") {
      return [{ label: "Textos · Retomada WhatsApp", sub: "textos", cadenceKey: "a_nudge_wa" }];
    }
    if (stepId === "sms") {
      return [{ label: "Textos · SMS de reforço", sub: "textos", cadenceKey: "a_nudge_sms" }];
    }
    if (stepId === "call1") {
      return [{ label: "Textos · Ligação", sub: "textos", cadenceKey: "a_nudge_call" }];
    }
    if (stepId === "retry") {
      return [{ label: "Textos · Encerrar leads novos", sub: "textos", cadenceKey: "a_nudge_call_retry" }];
    }
    return [];
  }

  if (group === "B") {
    const day = CADENCE_CALENDAR.find((d) => d.id === stepId && d.group === "B");
    return (day?.steps || [])
      .filter((s) => s.templateKey)
      .map((s) => ({
        label: `${CHANNEL_LABEL[s.channel as CadenceChannelUi]} · ${getTemplate(s.templateKey!)?.title ?? s.title}`,
        sub: "textos" as const,
        cadenceKey: s.templateKey!,
      }));
  }

  const stages = C_SLICE_STAGES[stepId] || [];
  const cDay = CADENCE_CALENDAR.find((d) => d.id === "c");
  return (cDay?.steps || [])
    .filter((s) => stages.includes(s.stage) && s.templateKey)
    .map((s) => ({
      label: `${CHANNEL_LABEL[s.channel as CadenceChannelUi]} · ${getTemplate(s.templateKey!)?.title ?? s.title}`,
      sub: "textos" as const,
      cadenceKey: s.templateKey!,
    }));
}

function navigateToSliceEdit(target: SliceEditTarget) {
  const sub = target.sub === "kit" ? "kit" : "textos";
  try {
    sessionStorage.setItem("igreen-voz-subtab", sub);
    if (target.cadenceKey) {
      sessionStorage.setItem("igreen-multichannel-focus-key", target.cadenceKey);
    }
  } catch { /* noop */ }
  window.dispatchEvent(new CustomEvent("igreen-admin-nav", { detail: { tab: "voz" } }));
  window.dispatchEvent(new CustomEvent("igreen-voz-subtab", { detail: { sub } }));
  if (target.cadenceKey) {
    window.dispatchEvent(
      new CustomEvent("igreen-multichannel-focus", { detail: { key: target.cadenceKey } }),
    );
  }
}

type CycleStep = {
  id: string;
  label: string;
  short: string;
  /** Função da fatia (tooltip / legenda / sheet). */
  hint?: string;
  Icon?: LucideIcon;
};

type CycleLead = {
  id: string;
  name: string | null;
  nameSource: string | null;
  phone: string | null;
  status: string | null;
  stage: string | null;
  nextActionAt: string | null;
  pausedReason: string | null;
};

type SlicePick = {
  group: "A" | "B" | "C";
  step: CycleStep;
  people: CycleLead[];
};

type SliceHistoryItem = {
  id: string;
  customerId: string;
  name: string | null;
  phone: string | null;
  stage: string;
  channel: string;
  status: string;
  at: string;
  messageBody: string | null;
  /** exact = log; sms_log = voice_sms_log; reconstructed = template atual */
  bodySource: "exact" | "sms_log" | "conversation" | "reconstructed" | null;
  withName: boolean | null;
  /** WhatsApp: sent/delivered/read/played · SMS: DELIVRD… */
  delivery: string | null;
  deliveryLabel: string;
  mediaUrl: string | null;
  mediaType: string | null;
  /** Ligação: segundos escutados (Velip). */
  listenSec: number | null;
  /** Ligação: rótulo do resultado (Atendida / Não atendeu…). */
  callOutcome: string | null;
};

/** Fatia da pizza → estágios do motor que geram histórico. */
function stagesForSlice(group: "A" | "B" | "C", stepId: string): string[] {
  if (group === "A") {
    const map: Record<string, string[]> = {
      ask_name: ["NEW"],
      flow: ["AI_QUALIFYING"],
      wait: ["GREETED"],
      nudge: ["A_NUDGE"],
      sms: ["A_SMS"],
      call1: ["A_CALL"],
      retry: ["A_CALL_RETRY"],
    };
    return map[stepId] || [];
  }
  if (group === "B") {
    const day = CADENCE_CALENDAR.find((d) => d.id === stepId && d.group === "B");
    return (day?.steps || []).map((s) => s.stage);
  }
  return C_SLICE_STAGES[stepId] || [];
}

function formatHistoryWhen(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function labelDelivery(channel: string, delivery: string | null, status: string): string {
  const d = String(delivery || "").toUpperCase();
  const s = String(status || "").toLowerCase();
  if (channel === "sms") {
    if (d === "DELIVRD" || s === "delivered") return "SMS entregue";
    if (d === "UNDELIV" || d === "EXPIRED" || s === "failed") {
      const err = String(delivery || "").toLowerCase();
      if (err.includes("blocked text") || err.includes("#270")) return "SMS bloqueado (#270)";
      if (err.includes("mobile is not valid") || err.includes("#240")) return "Número inválido (#240)";
      return "SMS não entregue";
    }
    if (s === "sent") return "SMS enviado";
    if (s === "queued") return "Na fila / passou";
    const raw = String(delivery || "");
    if (/blocked text|#270/i.test(raw)) return "SMS bloqueado (#270)";
    if (/mobile is not valid|#240/i.test(raw)) return "Número inválido (#240)";
    return delivery || status || "—";
  }
  if (channel === "whatsapp") {
    const low = String(delivery || status || "").toLowerCase();
    if (low === "played") return "Escutou o áudio";
    if (low === "read") return "Visualizou";
    if (low === "delivered") return "Entregue (não abriu)";
    if (low === "sent") return "Enviado";
    if (low === "failed") return "Falhou";
    if (s === "sent") return "Enviado";
    if (s === "queued") return "Na fila / passou";
    return delivery || status || "—";
  }
  if (channel === "voice") {
    const raw = String(delivery || "");
    const code = raw.toUpperCase();
    // Mensagens automáticas suprimiu antes de discar (número já reprovado antes).
    if (/^velip_reproved:/i.test(raw)) {
      const inner = raw.split(":")[1]?.toUpperCase() || "";
      if (inner === "IK") return "Número inexistente — suprimido";
      if (inner === "EK") return "Número inválido — suprimido";
      if (inner === "CK") return "Bloqueio operadora — suprimido";
      if (inner === "BK") return "Não perturbe — suprimido";
      return "Suprimido (número reprovado)";
    }
    if (code === "OK") return "Atendida";
    if (code === "NA") return "Não atendeu";
    if (code === "EK") return "Número inválido";
    if (code === "CK") return "Bloqueio operadora";
    if (code === "BK") return "Não perturbe";
    if (code === "IK") return "Número inexistente";
    if (s === "completed" || s === "answered") return "Atendida";
    if (s === "no_answer") return "Não atendeu";
    if (s === "failed") return "Ligação falhou";
    if (s === "dialing" || s === "sent") return "Ligação disparada";
    if (s === "queued") return "Na fila / passou";
  }
  if (s === "sent") return "Disparado";
  if (s === "queued") return "Passou / avançou";
  if (s === "failed") return "Falhou";
  return status || "—";
}

/** Heurística p/ logs antigos sem flag with_name. */
function inferWithName(body: string | null): boolean | null {
  if (!body) return null;
  const t = body.trim();
  if (/^(Oi|Olá|Ola)\s*,/i.test(t)) return false;
  if (/^(Oi|Olá|Ola)\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ]/u.test(t)) return true;
  if (/\*[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]{1,20}\*/u.test(t.slice(0, 80))) return true;
  return null;
}

function parseDispatchVelipId(
  detail: Record<string, unknown> | null | undefined,
  kind: "call" | "sms",
): string | null {
  const d = String(detail?.dispatch || "");
  if (kind === "call") {
    const m = d.match(/^call_placed:([^:]+)/);
    return m?.[1] || null;
  }
  const m = d.match(/^sms_sent:([^:]+)/);
  return m?.[1] || null;
}

/** Wrapper pizza: resolve fatia → estágios e delega à lib compartilhada. */
function previewStageForLead(
  stage: string | null | undefined,
  sliceStepId: string,
  group: "A" | "B" | "C",
): string | null {
  return previewStageForLeadShared(stage, stagesForSlice(group, sliceStepId));
}

type StageCfgHit = {
  stage: string;
  message_text: string | null;
  media_url: string | null;
  media_type: string | null;
  voice_audio_clip_id: string | null;
  consultant_id: string | null;
};

async function loadSliceHistory(
  consultantId: string | undefined,
  group: "A" | "B" | "C",
  stepId: string,
): Promise<SliceHistoryItem[]> {
  try {
    return await loadSliceHistoryInner(consultantId, group, stepId);
  } catch (e) {
    console.warn("[ReheatCyclePizza] loadSliceHistory", (e as Error)?.message || e);
    return [];
  }
}

async function loadSliceHistoryInner(
  consultantId: string | undefined,
  group: "A" | "B" | "C",
  stepId: string,
): Promise<SliceHistoryItem[]> {
  const stages = stagesForSlice(group, stepId);
  if (!stages.length) return [];

  let q = (supabase as any)
    .from("cadence_action_log")
    .select("id, customer_id, stage, channel, status, detail, created_at")
    .in("stage", stages)
    .order("created_at", { ascending: false })
    .limit(40);
  if (consultantId) q = q.eq("consultant_id", consultantId);
  const { data: logs, error } = await q;
  if (error) {
    console.warn("[ReheatCyclePizza] cadence_action_log", error.message);
    return [];
  }
  const rows = (logs as {
    id: string;
    customer_id: string;
    stage: string;
    channel: string;
    status: string;
    detail: Record<string, unknown> | null;
    created_at: string;
  }[]) || [];
  if (!rows.length) return [];

  const custIds = [...new Set(rows.map((r) => r.customer_id))];
  const { data: custRows } = await (supabase as any)
    .from("customers")
    .select("id, name, name_source, phone_whatsapp")
    .in("id", custIds);
  const custMap = new Map<
    string,
    { name: string | null; nameSource: string | null; phone: string | null }
  >();
  for (const c of (custRows as {
    id: string;
    name: string | null;
    name_source: string | null;
    phone_whatsapp: string | null;
  }[]) || []) {
    custMap.set(c.id, { name: c.name, nameSource: c.name_source, phone: c.phone_whatsapp });
  }

  // Templates atuais (consultor > global) p/ reconstruir corpo de envios antigos.
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
    // Preferência: override do consultor sobre o global.
    if (consultantId && cfg.consultant_id === consultantId) cfgByStage.set(st, cfg);
    else if (!existing.consultant_id && cfg.consultant_id == null) cfgByStage.set(st, cfg);
  }

  let consultorFirst = "";
  let consultorPhone = "";
  let assistente = "Assistente";
  let consultorGender: "consultor" | "consultora" = "consultor";
  if (consultantId) {
    const { data: cons } = await (supabase as any)
      .from("consultants")
      .select("name, display_name, assistant_name, gender")
      .eq("id", consultantId)
      .maybeSingle();
    consultorFirst = firstNameFromPublicConsultant(cons?.name, cons?.display_name);
    assistente = resolveAssistantDisplayName(cons?.assistant_name);
    consultorGender = resolveConsultantRoleGender(
      cons?.gender,
      consultorFirst || cons?.name || cons?.display_name,
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

  // Delivery WA: conversations outbound próximas a cada envio.
  const waCustomerIds = [...new Set(rows.filter((r) => r.channel === "whatsapp").map((r) => r.customer_id))];
  type ConvHit = {
    delivery: string | null;
    body: string | null;
    at: string;
    step: string | null;
    mediaType: string | null;
  };
  const convsByCustomer = new Map<string, ConvHit[]>();
  if (waCustomerIds.length) {
    const since = new Date(Date.now() - 21 * 86400_000).toISOString();
    const { data: convs } = await (supabase as any)
      .from("conversations")
      .select("customer_id, message_text, delivery_status, created_at, conversation_step, message_direction, message_type")
      .in("customer_id", waCustomerIds)
      .eq("message_direction", "outbound")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(400);
    for (const c of (convs as {
      customer_id: string;
      message_text: string | null;
      delivery_status: string | null;
      created_at: string;
      conversation_step: string | null;
      message_type: string | null;
    }[]) || []) {
      const list = convsByCustomer.get(c.customer_id) || [];
      list.push({
        delivery: c.delivery_status,
        body: c.message_text,
        at: c.created_at,
        step: c.conversation_step,
        mediaType: c.message_type,
      });
      convsByCustomer.set(c.customer_id, list);
    }
  }

  const findWaNear = (customerId: string, stage: string, atIso: string): ConvHit | null => {
    const list = convsByCustomer.get(customerId) || [];
    const t = new Date(atIso).getTime();
    const cadenceStep = `cadence:${stage}`;
    let best: ConvHit | null = null;
    let bestDiff = Infinity;
    for (const c of list) {
      const diff = Math.abs(new Date(c.at).getTime() - t);
      const stepBonus = c.step === cadenceStep ? -60_000 : 0;
      const score = diff + stepBonus;
      if (diff < 8 * 60_000 && score < bestDiff) {
        bestDiff = score;
        best = c;
      }
    }
    return best;
  };

  // SMS: corpo/entrega em voice_sms_log.
  const smsPhones = [
    ...new Set(
      rows
        .filter((r) => r.channel === "sms")
        .map((r) => phoneDigits(custMap.get(r.customer_id)?.phone))
        .filter((p) => p.length >= 10),
    ),
  ];
  const smsLogs: {
    phone: string;
    message: string;
    status: string;
    delivery_status: string | null;
    created_at: string;
    velip_sms_id: string | null;
    error: string | null;
  }[] = [];
  if (smsPhones.length && consultantId) {
    const { data: smsRows } = await (supabase as any)
      .from("voice_sms_log")
      .select("phone, message, status, delivery_status, created_at, velip_sms_id, error")
      .eq("consultant_id", consultantId)
      .order("created_at", { ascending: false })
      .limit(80);
    for (const s of (smsRows as typeof smsLogs) || []) {
      if (smsPhones.some((p) => phonesMatch(p, s.phone))) {
        smsLogs.push(s);
      }
    }
  }

  const findSmsNear = (
    phone: string | null,
    atIso: string,
    velipSmsId: string | null,
  ) => {
    if (velipSmsId) {
      const byId = smsLogs.find((s) => s.velip_sms_id && s.velip_sms_id === velipSmsId);
      if (byId) return byId;
    }
    if (!phone) return null;
    const t = new Date(atIso).getTime();
    let best: (typeof smsLogs)[0] | null = null;
    let bestDiff = Infinity;
    for (const s of smsLogs) {
      if (!phonesMatch(phone, s.phone)) continue;
      const diff = Math.abs(new Date(s.created_at).getTime() - t);
      if (diff < bestDiff && diff < 15 * 60_000) {
        bestDiff = diff;
        best = s;
      }
    }
    return best;
  };

  // Ligação: voice_call_logs por telefone + janela (e por velip_call_id do dispatch).
  const callPhones = [
    ...new Set(
      rows
        .filter((r) => r.channel === "voice")
        .map((r) => phoneDigits(custMap.get(r.customer_id)?.phone))
        .filter((p) => p.length >= 10),
    ),
  ];
  const callLogs: {
    to_phone: string | null;
    velip_status: string | null;
    velip_time_sec: number | null;
    duration_sec: number | null;
    status: string | null;
    created_at: string;
    velip_call_id: string | null;
  }[] = [];
  if ((callPhones.length || rows.some((r) => r.channel === "voice")) && consultantId) {
    const { data: callRows } = await (supabase as any)
      .from("voice_call_logs")
      .select("to_phone, velip_status, velip_time_sec, duration_sec, status, created_at, velip_call_id")
      .eq("consultant_id", consultantId)
      .order("created_at", { ascending: false })
      .limit(100);
    for (const c of (callRows as typeof callLogs) || []) {
      if (
        callPhones.some((p) => phonesMatch(p, c.to_phone)) ||
        rows.some(
          (r) =>
            r.channel === "voice" &&
            parseDispatchVelipId(r.detail, "call") === c.velip_call_id,
        )
      ) {
        callLogs.push(c);
      }
    }
  }

  const findCallNear = (
    phone: string | null,
    atIso: string,
    velipCallId: string | null,
  ) => {
    if (velipCallId) {
      const byId = callLogs.find((c) => c.velip_call_id && c.velip_call_id === velipCallId);
      if (byId) return byId;
    }
    if (!phone) return null;
    const t = new Date(atIso).getTime();
    let best: (typeof callLogs)[0] | null = null;
    let bestDiff = Infinity;
    for (const c of callLogs) {
      if (!phonesMatch(phone, c.to_phone)) continue;
      const diff = Math.abs(new Date(c.created_at).getTime() - t);
      if (diff < bestDiff && diff < 30 * 60_000) {
        bestDiff = diff;
        best = c;
      }
    }
    return best;
  };

  return rows.map((r) => {
    const cust = custMap.get(r.customer_id);
    const detail = r.detail || {};
    const cfg = cfgByStage.get(r.stage);
    const firstName = safeFirstNameUi(cust?.name, cust?.nameSource);
    let messageBody =
      typeof detail.message_body === "string" ? detail.message_body : null;
    let bodySource: SliceHistoryItem["bodySource"] = messageBody ? "exact" : null;
    let withName =
      typeof detail.with_name === "boolean" ? detail.with_name : null;
    let delivery: string | null =
      typeof detail.delivery_status === "string" ? detail.delivery_status : null;
    let mediaUrl =
      typeof detail.media_url === "string"
        ? detail.media_url
        : cfg?.media_url ||
          (cfg?.voice_audio_clip_id ? clipUrlById.get(cfg.voice_audio_clip_id) || null : null);
    let mediaType =
      typeof detail.media_type === "string"
        ? detail.media_type
        : cfg?.media_type || (mediaUrl ? "audio" : null);
    let listenSec: number | null = null;
    let callOutcome: string | null = null;

    if (r.channel === "whatsapp") {
      const near = findWaNear(r.customer_id, r.stage, r.created_at);
      if (near) {
        delivery = near.delivery || delivery;
        if (!messageBody && near.body && near.body !== "[áudio]") {
          messageBody = near.body;
          bodySource = "conversation";
        }
        if (near.mediaType === "audio") mediaType = "audio";
      }
    } else if (r.channel === "sms") {
      const velipSmsId = parseDispatchVelipId(detail, "sms");
      const sms = findSmsNear(cust?.phone ?? null, r.created_at, velipSmsId);
      if (sms) {
        if (!messageBody) {
          messageBody = sms.message;
          bodySource = "sms_log";
        }
        delivery = sms.delivery_status || sms.error || sms.status;
      } else if (r.status === "failed" && typeof detail.dispatch === "string") {
        // Falha Velip já veio no dispatch (ex.: Mobile is not valid#240).
        delivery = detail.dispatch.replace(/^velip:/i, "") || delivery;
      }
    } else if (r.channel === "voice") {
      const velipCallId = parseDispatchVelipId(detail, "call");
      const call = findCallNear(cust?.phone ?? null, r.created_at, velipCallId);
      if (call) {
        listenSec = call.velip_time_sec ?? call.duration_sec ?? null;
        callOutcome =
          velipOutcomeLabel(call.velip_status) ||
          (call.status && !["dialing", "sent", "unknown"].includes(String(call.status).toLowerCase())
            ? labelDelivery("voice", call.velip_status, call.status)
            : null);
        delivery = call.velip_status || call.status;
      } else if (r.status === "failed" && typeof detail.dispatch === "string") {
        // Motor bloqueou antes de discar (guard IK/EK/CK/BK). Não gera log Velip.
        // Ex.: dispatch = "velip_reproved:IK" → rótulo "Número inexistente — suprimido".
        delivery = detail.dispatch.replace(/^velip:/i, "") || delivery;
      }
      if (!mediaUrl && cfg?.voice_audio_clip_id) {
        mediaUrl = clipUrlById.get(cfg.voice_audio_clip_id) || null;
        if (mediaUrl) mediaType = "audio";
      }
    }

    // Fallback: reconstrói o texto que o motor enviaria com as regras de nome.
    if (!messageBody && cfg?.message_text && (r.channel === "whatsapp" || r.channel === "sms" || r.channel === "voice")) {
      let tplText = cfg.message_text;
      if (r.channel === "voice" && isLegacyInteractiveCallScript(tplText)) {
        const catalogKey = STAGE_TO_CADENCE_KEY[r.stage];
        tplText = catalogKey ? getTemplate(catalogKey)?.body || tplText : tplText;
      }
      messageBody = renderHistoryTemplate(tplText, {
        nome: firstName,
        consultor: consultorFirst,
        consultor_phone: consultorPhone,
        assistente,
        consultorGender,
      });
      bodySource = "reconstructed";
      if (withName == null) withName = !!firstName;
    }

    if (withName == null) withName = firstName ? true : inferWithName(messageBody);
    if (withName == null && cust?.nameSource === "whatsapp_profile") withName = false;

    let deliveryLabel = labelDelivery(r.channel, delivery, r.status);
    if (r.channel === "voice" && callOutcome) {
      const dur = listenSec != null ? formatDurationSec(listenSec) : null;
      deliveryLabel = dur && dur !== "—" ? `${callOutcome} · ${dur}` : callOutcome;
    } else if (r.channel === "whatsapp" && String(delivery || "").toLowerCase() === "played") {
      deliveryLabel = "Escutou o áudio";
    }

    return {
      id: r.id,
      customerId: r.customer_id,
      name: cust?.name ?? null,
      phone: cust?.phone ?? null,
      stage: r.stage,
      channel: r.channel,
      status: r.status,
      at: r.created_at,
      messageBody,
      bodySource,
      withName,
      delivery,
      deliveryLabel,
      mediaUrl,
      mediaType,
      listenSec,
      callOutcome,
    };
  });
}

/** Countdown exato até `next_action_at` (atualiza com `nowMs`). */
function formatExactCountdown(iso: string | null | undefined, nowMs: number): {
  text: string;
  tone: "overdue" | "soon" | "later" | "none";
  ms: number | null;
} {
  if (!iso) return { text: "Sem agenda", tone: "none", ms: null };
  const target = new Date(iso).getTime();
  if (!Number.isFinite(target)) return { text: "Sem agenda", tone: "none", ms: null };
  const diff = target - nowMs;
  const abs = Math.abs(diff);
  const sec = Math.floor(abs / 1000) % 60;
  const min = Math.floor(abs / 60_000) % 60;
  const hrs = Math.floor(abs / 3_600_000) % 24;
  const days = Math.floor(abs / 86_400_000);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hrs > 0 || days > 0) parts.push(`${hrs}h`);
  if (days === 0) {
    if (min > 0 || hrs > 0) parts.push(`${min}min`);
    if (hrs === 0) parts.push(`${sec}s`);
  }
  const clock = parts.join(" ") || "0s";
  if (diff <= 0) {
    return { text: `Atrasado ${clock}`, tone: "overdue", ms: diff };
  }
  if (diff < 3_600_000) {
    return { text: `Em ${clock}`, tone: "soon", ms: diff };
  }
  return { text: `Em ${clock}`, tone: "later", ms: diff };
}

function sortCycleLeads(a: CycleLead, b: CycleLead): number {
  const ta = a.nextActionAt ? new Date(a.nextActionAt).getTime() : Number.POSITIVE_INFINITY;
  const tb = b.nextActionAt ? new Date(b.nextActionAt).getTime() : Number.POSITIVE_INFINITY;
  if (ta !== tb) return ta - tb;
  return String(a.name || "").localeCompare(String(b.name || ""), "pt-BR");
}

/**
 * Pizza A — alinhada ao motor (cadence-engine):
 * Entrada (NEW) → Ativo (AI_QUALIFYING) → Aguardando (GREETED ~2h)
 * → Retomada (A_NUDGE) → SMS (A_SMS) → Ligação (A_CALL)
 * → Fecha A (A_CALL_RETRY) → Grupo B (COLD_1).
 *
 * Fora da pizza: cadastro CRM, campanha Meta, sync iGreen, bloqueados.
 */
const CYCLE_NOVO_STEPS: CycleStep[] = [
  {
    id: "ask_name",
    label: "Entrada no ciclo",
    short: "Entrada",
    hint: "Lead acabou de entrar. Sistema pede o nome e inicia o atendimento.",
    Icon: UserPlus,
  },
  {
    id: "flow",
    label: "Ativo · início do fluxo",
    short: "Ativo",
    hint: "Em conversa no WhatsApp — coletando dados / respondendo o bot ou o consultor.",
    Icon: MessagesSquare,
  },
  {
    id: "wait",
    label: "Aguardando resposta",
    short: "Aguardando",
    hint: "Janela de silêncio (~2h). Sem resposta, sobe a escada de retomada.",
    Icon: Clock3,
  },
  {
    id: "nudge",
    label: "Retomada no WhatsApp",
    short: "Retomada",
    hint: "Toque automático no Zap para retomar quem sumiu na conversa.",
    Icon: RotateCcw,
  },
  {
    id: "sms",
    label: "SMS de reforço",
    short: "SMS",
    hint: "SMS se a retomada no Zap não teve resposta (~2h).",
    Icon: MessageSquare,
  },
  {
    id: "call1",
    label: "Ligação",
    short: "Ligação",
    hint: "1ª ligação (voz). Sem atendimento, aguarda e tenta de novo.",
    Icon: Phone,
  },
  {
    id: "retry",
    label: "Aguardando · fecha o A",
    short: "Encerra novos",
    hint: "Última janela após a ligação. Sem resposta → entra em quem esfriou.",
    Icon: Hourglass,
  },
];

/** Estágio de cadência → fatia da pizza A (lead novo). */
const CADENCE_TO_NOVO: Record<string, string> = {
  NEW: "ask_name",
  /** Já pediu o nome — contando silêncio até a retomada. */
  GREETED: "wait",
  /** Lead falando com o bot / consultor. */
  AI_QUALIFYING: "flow",
  A_NUDGE: "nudge",
  A_SMS: "sms",
  A_CALL: "call1",
  A_CALL_RETRY: "retry",
};

/** Fila diária (daily_reheat NOVO_CYCLE) → mesmas fatias da pizza A. */
const QUEUE_A_TO_NOVO: Record<string, string> = {
  open: "ask_name",
  flow: "flow",
  wait2h: "wait",
  call1: "call1",
  retry: "retry",
  sms: "sms",
  close: "retry",
  quente: "ask_name",
};

/** Estágios extras puxados do motor (PAUSED classificado via paused_reason). */
const NOVO_EXTRA_STAGES = [
  "AI_QUALIFYING",
  "PAUSED",
  "A_NUDGE",
  "A_SMS",
  "A_CALL",
  "A_CALL_RETRY",
] as const;

/**
 * Pizza B — dias reais do calendário v5 (D+1 → D10).
 * Fonte: CADENCE_CALENDAR group B + legenda igual à pizza A.
 */
const FRIO_SLICE_META: Record<string, { hint: string; Icon: LucideIcon }> = {
  d1: {
    hint: "Reabre o lead frio: Zap (faixa da conta) → SMS se silêncio → ligação Sofia.",
    Icon: CalendarDays,
  },
  d2: {
    hint: "Nova abordagem com tema rotativo no Zap; SMS do mesmo tema se não responder.",
    Icon: Sparkles,
  },
  d4: {
    hint: "2ª ligação Sofia (espaçada). Só se ainda estiver em silêncio.",
    Icon: PhoneCall,
  },
  d6: {
    hint: "SMS de novidades com link do Zap. Sem ligação neste dia.",
    Icon: Smartphone,
  },
  d7: {
    hint: "Zap de resposta fácil (1 toque) + SMS tema se silêncio.",
    Icon: Hand,
  },
  d10: {
    hint: "Fecha a onda: ligação final + WhatsApp de encerramento. Sem retorno → quem sumiu.",
    Icon: Flag,
  },
};

const CYCLE_FRIO_STEPS: CycleStep[] = CADENCE_CALENDAR.filter((d) => d.group === "B").map((d) => {
  const meta = FRIO_SLICE_META[d.id];
  return {
    id: d.id,
    label: d.label,
    short: d.id === "d1" ? "D+1" : d.id.replace("d", "D"),
    hint: meta?.hint ?? d.subtitle,
    Icon: meta?.Icon,
  };
});

/** Estágio lead_cadence_state → dia da pizza B. */
const CADENCE_TO_FRIO: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const day of CADENCE_CALENDAR) {
    if (day.group !== "B") continue;
    for (const step of day.steps) map[step.stage] = day.id;
  }
  return map;
})();

/**
 * Fila B do daily-reheat (FRIO_CYCLE) → dia v5 mais próximo.
 * O motor unitário (COLD_*) é a fonte canônica; isto só evita “buraco” visual.
 */
const QUEUE_B_TO_FRIO: Record<string, string> = {
  call1: "d1",
  open: "d1",
  retry: "d4",
  sms: "d6",
  wait: "d7",
  close: "d10",
};

/**
 * Pizza C — Meta + marcos de recall (agrega WA/SMS/CALL do mesmo marco).
 */
const CYCLE_LONGO_STEPS: CycleStep[] = [
  {
    id: "meta",
    label: "Meta / audiência / ads",
    short: "Meta",
    hint: "Após Dia 10: entra na audiência Meta e remarketing (~15d). Sem WhatsApp nesta fatia.",
    Icon: Megaphone,
  },
  {
    id: "r30",
    label: "1º recall (~30d)",
    short: "~30d",
    hint: "Zap do canal de origem → SMS (~2h) → ligação (~4h) se silêncio.",
    Icon: MessageCircle,
  },
  {
    id: "r90",
    label: "Recall ~90d",
    short: "90d",
    hint: "Mesma escada: Zap → SMS se silêncio → ligação se silêncio.",
    Icon: RotateCcw,
  },
  {
    id: "r5m",
    label: "Recall ~5 meses",
    short: "5m",
    hint: "Zap → SMS → ligação. Conta no teto diário de frio.",
    Icon: Clock3,
  },
  {
    id: "r8m",
    label: "Recall ~8 meses",
    short: "8m",
    hint: "Zap → SMS → ligação no mesmo canal de origem do lead.",
    Icon: Hourglass,
  },
  {
    id: "r12m",
    label: "Recall ~12 meses",
    short: "12m",
    hint: "Zap → SMS → ligação. Depois segue para o loop anual.",
    Icon: CalendarDays,
  },
  {
    id: "ryear",
    label: "Recall anual",
    short: "Ano",
    hint: "Loop anual: Zap → SMS → ligação e reinicia o ciclo longo.",
    Icon: Flag,
  },
];

const CADENCE_TO_LONGO: Record<string, string> = {
  CLOSE_LOST: "meta",
  RETARGET_META: "meta",
  RETARGET_ADS_15D: "meta",
  RECALL_60D: "r30",
  RECALL_60D_SMS: "r30",
  RECALL_60D_CALL: "r30",
  RECALL_90D: "r90",
  RECALL_90D_SMS: "r90",
  RECALL_90D_CALL: "r90",
  RECALL_5M: "r5m",
  RECALL_5M_SMS: "r5m",
  RECALL_5M_CALL: "r5m",
  RECALL_8M: "r8m",
  RECALL_8M_SMS: "r8m",
  RECALL_8M_CALL: "r8m",
  RECALL_12M: "r12m",
  RECALL_12M_SMS: "r12m",
  RECALL_12M_CALL: "r12m",
  RECALL_YEARLY: "ryear",
  RECALL_YEARLY_SMS: "ryear",
  RECALL_YEARLY_CALL: "ryear",
};

const ALL_CADENCE_STAGES = [
  ...new Set([
    ...Object.keys(CADENCE_TO_NOVO),
    ...NOVO_EXTRA_STAGES,
    ...Object.keys(CADENCE_TO_FRIO),
    ...Object.keys(CADENCE_TO_LONGO),
  ]),
];

function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

function cycleDateBRT(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

function modeStep(agg: Record<string, number>): string | null {
  let best: string | null = null;
  let bestN = 0;
  for (const [k, v] of Object.entries(agg)) {
    if (v > bestN) {
      best = k;
      bestN = v;
    }
  }
  return best;
}

function indexOfStep(steps: CycleStep[], id: string | null): number | null {
  if (!id) return null;
  const i = steps.findIndex((s) => s.id === id);
  return i >= 0 ? i : null;
}

function PizzaRing({
  title,
  subtitle,
  steps,
  activeIndex,
  peopleCount,
  perStep,
  compact,
  onSliceClick,
}: {
  title: string;
  subtitle: string;
  steps: CycleStep[];
  activeIndex: number;
  peopleCount: number;
  perStep: Record<string, number>;
  compact?: boolean;
  onSliceClick?: (step: CycleStep) => void;
}) {
  const n = steps.length;
  const size = compact ? 360 : 440;
  const cx = size / 2;
  const cy = size / 2;
  const r = compact ? 96 : 118;
  const hole = compact ? 48 : 58;
  const labelR = compact ? 148 : 178;
  const svgMax = compact ? 320 : 420;
  const iconBox = compact ? 14 : 16;
  const detailedLegend = steps.some((s) => s.hint);
  const [legendOpen, setLegendOpen] = useState(false);

  return (
    <div className="flex flex-col items-center gap-2.5 min-w-0 w-full">
      <div className="text-center px-1">
        <p className="font-heading font-bold text-base text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground leading-tight">{subtitle}</p>
        <p className="mt-1 text-sm font-semibold tabular-nums text-primary">
          {peopleCount === 1 ? "1 pessoa" : `${peopleCount} pessoas`} no ciclo
        </p>
        {onSliceClick && (
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Clique na fatia · quem está agora + histórico de envios
          </p>
        )}
      </div>

      <svg
        width={svgMax}
        height={svgMax}
        viewBox={`0 0 ${size} ${size}`}
        className="shrink-0 w-full max-w-[min(100%,420px)] h-auto"
        role="img"
        aria-label={title}
      >
        {steps.map((s, i) => {
          const a0 = (360 / n) * i + 1;
          const a1 = (360 / n) * (i + 1) - 1;
          const p1 = polar(cx, cy, r, a0);
          const p2 = polar(cx, cy, r, a1);
          const large = a1 - a0 > 180 ? 1 : 0;
          const has = (perStep[s.id] || 0) > 0;
          const current = activeIndex >= 0 && i === activeIndex;
          const clickable = !!onSliceClick;
          const count = perStep[s.id] || 0;
          const tip = s.hint
            ? `${s.label} · ${count} ${count === 1 ? "pessoa" : "pessoas"} — ${s.hint}`
            : `${s.label}: ${count}`;
          return (
            <path
              key={s.id}
              d={`M ${cx} ${cy} L ${p1.x} ${p1.y} A ${r} ${r} 0 ${large} 1 ${p2.x} ${p2.y} Z`}
              className={cn(
                "transition-all duration-500 ease-out",
                has ? "fill-primary" : "fill-muted",
                clickable && "cursor-pointer hover:brightness-110",
              )}
              style={{ opacity: current ? 1 : has ? 0.7 : 0.22 }}
              onClick={() => clickable && onSliceClick?.(s)}
              role={clickable ? "button" : undefined}
              tabIndex={clickable ? 0 : undefined}
              aria-label={tip}
              onKeyDown={(e) => {
                if (clickable && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  onSliceClick?.(s);
                }
              }}
            >
              <title>{tip}</title>
            </path>
          );
        })}

        <circle cx={cx} cy={cy} r={hole} className="fill-card pointer-events-none" />

        {steps.map((s, i) => {
          const ang = (360 / n) * i + 360 / n / 2;
          const p = polar(cx, cy, labelR, ang);
          const has = (perStep[s.id] || 0) > 0;
          const current = activeIndex >= 0 && i === activeIndex;
          const count = perStep[s.id] || 0;
          const Icon = s.Icon;
          const tip = s.hint
            ? `${s.label} · ${count} ${count === 1 ? "pessoa" : "pessoas"} — ${s.hint}`
            : `${s.label}: ${count}`;
          const fill = current
            ? "hsl(var(--foreground))"
            : has
              ? "hsl(var(--foreground) / 0.85)"
              : "hsl(var(--muted-foreground))";
          return (
            <g
              key={`l-${s.id}`}
              className={cn(onSliceClick && "cursor-pointer")}
              onClick={() => onSliceClick?.(s)}
            >
              <title>{tip}</title>
              {Icon && (
                <foreignObject
                  x={p.x - iconBox / 2}
                  y={p.y - (compact ? 22 : 26)}
                  width={iconBox}
                  height={iconBox}
                  className="pointer-events-none overflow-visible"
                >
                  <div className="flex h-full w-full items-center justify-center">
                    <Icon
                      style={{ color: fill, width: iconBox, height: iconBox }}
                      strokeWidth={current ? 2.25 : 1.75}
                      aria-hidden
                    />
                  </div>
                </foreignObject>
              )}
              <text
                x={p.x}
                y={p.y + (Icon ? (compact ? 2 : 3) : -7)}
                textAnchor="middle"
                dominantBaseline="middle"
                style={{
                  fontSize: current ? (compact ? 10.5 : 12) : compact ? 9 : 10.5,
                  fontWeight: current ? 650 : 550,
                  letterSpacing: "0.015em",
                  fill,
                }}
              >
                {s.short}
              </text>
              <text
                x={p.x}
                y={p.y + (Icon ? (compact ? 15 : 17) : 9)}
                textAnchor="middle"
                dominantBaseline="middle"
                style={{
                  fontSize: compact ? 10 : 11,
                  fontWeight: 700,
                  fontVariantNumeric: "tabular-nums",
                  fill: has ? "hsl(var(--primary))" : "hsl(var(--muted-foreground) / 0.45)",
                }}
              >
                {count}
              </text>
            </g>
          );
        })}

        <text
          x={cx}
          y={cy - 10}
          textAnchor="middle"
          className="pointer-events-none"
          style={{ fontSize: compact ? 22 : 28, fontWeight: 800, fill: "hsl(var(--foreground))" }}
        >
          {peopleCount}
        </text>
        <text
          x={cx}
          y={cy + 12}
          textAnchor="middle"
          className="pointer-events-none"
          style={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
        >
          {peopleCount === 1 ? "pessoa" : "pessoas"}
        </text>
        <text
          x={cx}
          y={cy + 28}
          textAnchor="middle"
          className="pointer-events-none"
          style={{ fontSize: 10, fontWeight: 600, fill: "hsl(var(--primary))" }}
        >
          {activeIndex >= 0 ? (steps[activeIndex]?.short ?? "—") : "—"}
        </text>
      </svg>

      <div className="w-full max-w-[380px] px-1">
        {/* Sempre compacto: short + contagem (fácil de clicar sem ocupar a tela) */}
        <div className="flex flex-wrap justify-center gap-x-2 gap-y-1">
          {steps.map((s) => {
            const nStep = perStep[s.id] || 0;
            return (
              <button
                type="button"
                key={`b-${s.id}`}
                disabled={!onSliceClick}
                onClick={() => onSliceClick?.(s)}
                title={s.hint || s.label}
                className={cn(
                  "text-[10px] tracking-wide tabular-nums transition-colors",
                  nStep > 0
                    ? "text-foreground/90 hover:text-primary cursor-pointer"
                    : onSliceClick
                      ? "text-muted-foreground/70 hover:text-primary cursor-pointer"
                      : "text-muted-foreground/50 cursor-default",
                )}
              >
                <span className="font-medium">{s.short}</span>
                <span className={cn("ml-1", nStep > 0 ? "text-primary font-semibold" : "")}>{nStep}</span>
              </button>
            );
          })}
        </div>

        {detailedLegend && (
          <Collapsible open={legendOpen} onOpenChange={setLegendOpen} className="mt-1.5">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="mx-auto flex w-full max-w-[280px] items-center justify-center gap-1 rounded-md px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
              >
                {legendOpen ? "Ocultar" : "Ver"} o que cada fatia faz
                <ChevronDown
                  className={cn("h-3 w-3 shrink-0 transition-transform", legendOpen && "rotate-180")}
                  aria-hidden
                />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-1 flex flex-col gap-1.5">
              {steps.map((s) => {
                const nStep = perStep[s.id] || 0;
                const Icon = s.Icon;
                return (
                  <button
                    type="button"
                    key={`d-${s.id}`}
                    disabled={!onSliceClick}
                    onClick={() => onSliceClick?.(s)}
                    title={s.hint || s.label}
                    className={cn(
                      "flex items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                      onSliceClick ? "hover:bg-primary/10 cursor-pointer" : "cursor-default",
                      nStep <= 0 && "opacity-55",
                    )}
                  >
                    {Icon ? (
                      <Icon
                        className={cn(
                          "mt-0.5 h-3.5 w-3.5 shrink-0",
                          nStep > 0 ? "text-primary" : "text-muted-foreground",
                        )}
                        aria-hidden
                      />
                    ) : (
                      <span className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="text-[11px] font-semibold text-foreground">{s.short}</span>
                        <span
                          className={cn(
                            "text-[11px] tabular-nums font-bold",
                            nStep > 0 ? "text-primary" : "text-muted-foreground/60",
                          )}
                        >
                          {nStep}
                        </span>
                      </span>
                      {s.hint && (
                        <span className="block text-[10px] leading-snug text-muted-foreground">{s.hint}</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
    </div>
  );
}

type ToggleRow = { key: string; enabled: boolean };
type Settings = {
  enabled: boolean;
  live_dispatch_enabled: boolean;
  /** Cap canônico do Grupo B (espelha em daily_whapi_cap no save). */
  cap_b: number;
  priority_queue: "A_then_B" | "B_then_A" | "A_only" | "B_only";
};

interface ReheatCyclePizzaProps {
  activeNovo?: number;
  activeFrio?: number;
  activeLongo?: number;
  demoSpin?: boolean;
  consultantId?: string;
  /** Mostrar cockpit administrativo (switches, cap, prioridade, botões de admin). */
  admin?: boolean;
  /** Abre conversa interna (WhatsApp da plataforma). */
  onOpenChat?: (phone: string, suggestedMessage?: string) => void;
}

export function ReheatCyclePizza({
  activeNovo,
  activeFrio,
  activeLongo,
  demoSpin = false,
  consultantId,
  admin = false,
  onOpenChat,
}: ReheatCyclePizzaProps) {
  const { toast } = useToast();
  const controlled = activeNovo != null || activeFrio != null || activeLongo != null;
  const [demoNovo, setDemoNovo] = useState(0);
  const [demoFrio, setDemoFrio] = useState(0);
  const [demoLongo, setDemoLongo] = useState(0);
  const [liveNovo, setLiveNovo] = useState<number | null>(null);
  const [liveFrio, setLiveFrio] = useState<number | null>(null);
  const [liveLongo, setLiveLongo] = useState<number | null>(null);
  const [perStepA, setPerStepA] = useState<Record<string, number>>({});
  const [perStepB, setPerStepB] = useState<Record<string, number>>({});
  const [perStepC, setPerStepC] = useState<Record<string, number>>({});
  const [peopleA, setPeopleA] = useState<Record<string, CycleLead[]>>({});
  const [peopleB, setPeopleB] = useState<Record<string, CycleLead[]>>({});
  const [peopleC, setPeopleC] = useState<Record<string, CycleLead[]>>({});
  const [slicePick, setSlicePick] = useState<SlicePick | null>(null);
  /** Relógio vivo no sheet — countdown exato até a próxima fase. */
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [sliceHistory, setSliceHistory] = useState<SliceHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [sheetTab, setSheetTab] = useState<"now" | "history">("now");
  const [stepPreviews, setStepPreviews] = useState<Record<string, StepPreviewTemplate>>({});
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    if (!slicePick) return;
    setNowMs(Date.now());
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [slicePick]);

  useEffect(() => {
    if (!slicePick) {
      setSliceHistory([]);
      setStepPreviews({});
      setHistoryLoading(false);
      setPreviewLoading(false);
      setSheetTab("now");
      return;
    }
    let cancelled = false;
    setHistoryLoading(true);
    setPreviewLoading(true);
    const preferHistory = (slicePick.people?.length || 0) === 0;
    setSheetTab(preferHistory ? "history" : "now");

    const group = slicePick.group;
    const stepId = slicePick.step.id;
    const people = slicePick.people;

    const previewStages = new Set<string>();
    for (const s of stagesForSlice(group, stepId)) previewStages.add(s);
    for (const p of people) {
      const ps = previewStageForLead(p.stage, stepId, group);
      if (ps) previewStages.add(ps);
      if (p.stage && STAGE_NEXT[p.stage]) previewStages.add(STAGE_NEXT[p.stage]);
    }

    void loadSliceHistory(consultantId, group, stepId)
      .then((items) => {
        if (cancelled) return;
        setSliceHistory(items);
      })
      .catch((e) => {
        console.warn("[ReheatCyclePizza] histórico", (e as Error)?.message || e);
        if (!cancelled) setSliceHistory([]);
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });

    void loadStepPreviewTemplates(consultantId, [...previewStages])
      .then((map) => {
        if (cancelled) return;
        setStepPreviews(map);
      })
      .catch((e) => {
        console.warn("[ReheatCyclePizza] preview", (e as Error)?.message || e);
        if (!cancelled) setStepPreviews({});
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // Só re-carrega ao trocar fatia/consultor — não a cada refresh da fila.
  }, [consultantId, slicePick?.group, slicePick?.step.id]);
  const [countNovo, setCountNovo] = useState(0);
  const [countFrio, setCountFrio] = useState(0);
  const [countLongo, setCountLongo] = useState(0);
  const [cadenceDueToday, setCadenceDueToday] = useState(0);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);

  const [settings, setSettings] = useState<Settings | null>(null);
  const [toggleCadence, setToggleCadence] = useState(false);
  const [toggleReheat, setToggleReheat] = useState(false);
  const [toggleLive, setToggleLive] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    const cycleDate = cycleDateBRT();
    const counted = new Set<string>();

    const aggA: Record<string, number> = {};
    const aggB: Record<string, number> = {};
    const aggC: Record<string, number> = {};
    const idsA: Record<string, string[]> = {};
    const idsB: Record<string, string[]> = {};
    const idsC: Record<string, string[]> = {};

    const bump = (
      agg: Record<string, number>,
      ids: Record<string, string[]>,
      slice: string,
      customerId: string,
    ) => {
      if (!slice || counted.has(customerId)) return;
      counted.add(customerId);
      agg[slice] = (agg[slice] || 0) + 1;
      if (!ids[slice]) ids[slice] = [];
      ids[slice].push(customerId);
    };

    // 1) Fila diária (A/B) — prioridade sobre cadência no mesmo lead
    let q = (supabase as any)
      .from("daily_reheat_queue")
      .select("customer_id, queue, step, status, consultant_id")
      .eq("cycle_date", cycleDate)
      .in("status", ["planned", "claimed"])
      .limit(5000);
    if (consultantId) q = q.eq("consultant_id", consultantId);
    const { data: qRows } = await q;
    const rows =
      (qRows as { customer_id: string; queue: string; step: string }[]) || [];

    // 2) Motor unitário — A (NEW/GREETED/AI_QUALIFYING/PAUSED-A) + B/C.
    let qCad = (supabase as any)
      .from("lead_cadence_state")
      .select("customer_id, stage, consultant_id, next_action_at, paused_reason")
      .in("stage", ALL_CADENCE_STAGES)
      .limit(5000);
    if (consultantId) qCad = qCad.eq("consultant_id", consultantId);
    const { data: cadRows, error: cadErr } = await qCad;
    if (cadErr) {
      console.warn("[ReheatCyclePizza] lead_cadence_state query failed", cadErr.message);
    }
    const cadList =
      (cadRows as {
        customer_id: string;
        stage: string;
        next_action_at: string | null;
        paused_reason: string | null;
      }[]) || [];

    // Elegibilidade: só lead WhatsApp/manual — exclui sync, bloqueados, congelados, encerrados
    const allIds = [...new Set([...rows.map((r) => r.customer_id), ...cadList.map((c) => c.customer_id)])];
    const pauseByCustomer = new Map<string, string | null>();
    const cadenceByCustomer = new Map<
      string,
      { stage: string; nextActionAt: string | null; pausedReason: string | null }
    >();
    for (const c of cadList) {
      pauseByCustomer.set(c.customer_id, c.paused_reason);
      cadenceByCustomer.set(c.customer_id, {
        stage: c.stage,
        nextActionAt: c.next_action_at,
        pausedReason: c.paused_reason,
      });
    }
    const eligible = new Set<string>();
    const custById = new Map<string, CycleLead>();
    if (allIds.length > 0) {
      const { data: custRows } = await (supabase as any)
        .from("customers")
        .select("id, name, name_source, phone_whatsapp, customer_origin, status, conversation_step, portal_submitted_at, do_not_contact, is_converted, pos_venda_stage, andamento_igreen, pos_venda_recadastro_at")
        .in("id", allIds.slice(0, 5000));
      for (const c of (custRows as {
        id: string;
        name: string | null;
        name_source: string | null;
        phone_whatsapp: string | null;
        customer_origin: string | null;
        status: string | null;
        conversation_step: string | null;
        portal_submitted_at: string | null;
        do_not_contact: boolean | null;
        is_converted: boolean | null;
        pos_venda_stage: string | null;
        andamento_igreen: string | null;
        pos_venda_recadastro_at: string | null;
      }[]) || []) {
        if (
          isCycleLeadEligible({
            ...c,
            paused_reason: pauseByCustomer.get(c.id) ?? null,
            active_cadence: cadList.some((r) => r.customer_id === c.id && !!r.next_action_at),
          })
        ) {
          eligible.add(c.id);
          const cad = cadenceByCustomer.get(c.id);
          custById.set(c.id, {
            id: c.id,
            name: c.name,
            nameSource: c.name_source,
            phone: c.phone_whatsapp,
            status: c.status,
            stage: cad?.stage ?? null,
            nextActionAt: cad?.nextActionAt ?? null,
            pausedReason: cad?.pausedReason ?? null,
          });
        }
      }
    }

    for (const r of rows) {
      if (!eligible.has(r.customer_id)) continue;
      if (r.queue === "A") {
        bump(aggA, idsA, QUEUE_A_TO_NOVO[r.step] || r.step, r.customer_id);
      } else if (r.queue === "B") {
        bump(aggB, idsB, QUEUE_B_TO_FRIO[r.step] || r.step, r.customer_id);
      }
    }

    for (const c of cadList) {
      if (!eligible.has(c.customer_id)) continue;
      // PAUSED do Grupo A = lead novo em conversa (Miriam etc.) → fatia Fluxo
      if (c.stage === "PAUSED") {
        if (isPausedGroupA(c.paused_reason)) {
          bump(aggA, idsA, "flow", c.customer_id);
        } else {
          // Retorno B/C: tenta recolocar no estágio salvo em paused_reason
          const prev = /^lead_responded:(.+)$/.exec(String(c.paused_reason || ""))?.[1];
          if (prev) {
            const sliceB = CADENCE_TO_FRIO[prev];
            if (sliceB) {
              bump(aggB, idsB, sliceB, c.customer_id);
              continue;
            }
            const sliceC = CADENCE_TO_LONGO[prev];
            if (sliceC) bump(aggC, idsC, sliceC, c.customer_id);
          }
        }
        continue;
      }
      const sliceA = CADENCE_TO_NOVO[c.stage];
      if (sliceA) {
        bump(aggA, idsA, sliceA, c.customer_id);
        continue;
      }
      const sliceB = CADENCE_TO_FRIO[c.stage];
      if (sliceB) {
        bump(aggB, idsB, sliceB, c.customer_id);
        continue;
      }
      const sliceC = CADENCE_TO_LONGO[c.stage];
      if (sliceC) bump(aggC, idsC, sliceC, c.customer_id);
    }

    const toPeople = (idsMap: Record<string, string[]>): Record<string, CycleLead[]> => {
      const out: Record<string, CycleLead[]> = {};
      for (const [slice, ids] of Object.entries(idsMap)) {
        out[slice] = ids
          .map((id) => custById.get(id))
          .filter((x): x is CycleLead => !!x)
          .sort(sortCycleLeads);
      }
      return out;
    };

    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    const due = cadList.filter(
      (c) => eligible.has(c.customer_id) && c.next_action_at && new Date(c.next_action_at) <= todayEnd,
    ).length;
    setCadenceDueToday(due);

    setPerStepA(aggA);
    setPerStepB(aggB);
    setPerStepC(aggC);
    setPeopleA(toPeople(idsA));
    setPeopleB(toPeople(idsB));
    setPeopleC(toPeople(idsC));
    setCountNovo(Object.values(aggA).reduce((a, b) => a + b, 0));
    setCountFrio(Object.values(aggB).reduce((a, b) => a + b, 0));
    setCountLongo(Object.values(aggC).reduce((a, b) => a + b, 0));

    setLiveNovo(indexOfStep(CYCLE_NOVO_STEPS, modeStep(aggA)));
    setLiveFrio(indexOfStep(CYCLE_FRIO_STEPS, modeStep(aggB)));
    setLiveLongo(indexOfStep(CYCLE_LONGO_STEPS, modeStep(aggC)));
    setLoading(false);
  }, [consultantId]);

  const loadAdmin = useCallback(async () => {
    if (!admin) return;
    const { data: s } = await (supabase as any)
      .from("daily_reheat_settings")
      .select("enabled, live_dispatch_enabled, cap_b, daily_whapi_cap, priority_queue")
      .eq("id", "global")
      .maybeSingle();
    if (s) {
      const capB = Number(s.cap_b ?? s.daily_whapi_cap ?? 150);
      setSettings({
        enabled: !!s.enabled,
        live_dispatch_enabled: !!s.live_dispatch_enabled,
        cap_b: Number.isFinite(capB) ? capB : 150,
        priority_queue: (s.priority_queue as Settings["priority_queue"]) || "A_then_B",
      });
      setToggleReheat(!!s.enabled);
      setToggleLive(!!s.live_dispatch_enabled);
    }
    const { data: tg } = await (supabase as any)
      .from("automation_toggles")
      .select("key, enabled")
      .in("key", ["cadence_engine", "daily_reheat"]);
    for (const t of (tg as ToggleRow[]) || []) {
      if (t.key === "cadence_engine") setToggleCadence(!!t.enabled);
      if (t.key === "daily_reheat") setToggleReheat((prev) => !!t.enabled || prev);
    }
  }, [admin]);

  useEffect(() => {
    void loadQueue();
    void loadAdmin();
    const t = setInterval(() => void loadQueue(), 30_000);
    return () => clearInterval(t);
  }, [loadQueue, loadAdmin]);

  useEffect(() => {
    if (controlled || !demoSpin || liveNovo != null || liveFrio != null || liveLongo != null) return;
    const t = setInterval(() => {
      setDemoNovo((i) => (i + 1) % CYCLE_NOVO_STEPS.length);
      setDemoFrio((i) => (i + 1) % CYCLE_FRIO_STEPS.length);
      setDemoLongo((i) => (i + 1) % CYCLE_LONGO_STEPS.length);
    }, 2400);
    return () => clearInterval(t);
  }, [controlled, demoSpin, liveNovo, liveFrio, liveLongo]);

  const idxNovo = activeNovo ?? liveNovo ?? (demoSpin ? demoNovo : -1);
  const idxFrio = activeFrio ?? liveFrio ?? (demoSpin ? demoFrio : -1);
  const idxLongo = activeLongo ?? liveLongo ?? (demoSpin ? demoLongo : -1);
  const total = countNovo + countFrio + countLongo;

  const statusBadge = useMemo(() => {
    if (!admin || !settings) return null;
    if (!settings.enabled || !toggleReheat) return { label: "Desligado", cls: "bg-muted text-muted-foreground" };
    if (!settings.live_dispatch_enabled) return { label: "Só planejando", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400" };
    return { label: "Ao vivo", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" };
  }, [admin, settings, toggleReheat]);

  const saveToggle = async (key: "cadence_engine" | "daily_reheat", value: boolean) => {
    setSavingKey(key);
    try {
      // RLS: `automation_toggles`/`daily_reheat_settings` só aceitam admin.
      // Negado = 0 linhas SEM erro → precisamos exigir a linha de volta,
      // senão a tela diz "Desligado" com o motor ainda ligado no banco.
      const { data: tRow, error: tErr } = await (supabase as any)
        .from("automation_toggles")
        .update({ enabled: value, updated_at: new Date().toISOString() })
        .eq("key", key)
        .select("key")
        .maybeSingle();
      if (tErr) throw tErr;
      if (!tRow) throw new Error("O banco recusou a gravação (sem permissão de administrador). Nada mudou.");
      if (key === "cadence_engine") setToggleCadence(value);
      if (key === "daily_reheat") {
        const { data: sRow, error: sErr } = await (supabase as any)
          .from("daily_reheat_settings")
          .update({ enabled: value, updated_at: new Date().toISOString() })
          .eq("id", "global")
          .select("id")
          .maybeSingle();
        if (sErr) throw sErr;
        if (!sRow) throw new Error("Toggle mudou, mas daily_reheat_settings NÃO foi gravado (sem permissão). Estado inconsistente.");
        setToggleReheat(value);
        setSettings((prev) => (prev ? { ...prev, enabled: value } : prev));
      }

      toast({ title: value ? "Ligado" : "Desligado", description: key });
    } catch (e: any) {
      toast({
        title: value ? "NÃO foi ligado" : "NÃO foi desligado",
        description: String(e?.message || e),
        variant: "destructive",
      });
      await loadAdmin();
    } finally {
      setSavingKey(null);
    }
  };

  const saveSettings = async (patch: Partial<Settings>) => {
    setSavingKey("settings");
    try {
      const dbPatch: Record<string, unknown> = {
        ...patch,
        updated_at: new Date().toISOString(),
      };
      // Cap canônico B + espelho legado (daily-reheat ainda lê daily_whapi_cap).
      if (patch.cap_b != null) {
        dbPatch.cap_b = patch.cap_b;
        dbPatch.daily_whapi_cap = patch.cap_b;
      }
      const { data: sRow, error } = await (supabase as any)
        .from("daily_reheat_settings")
        .update(dbPatch)
        .eq("id", "global")
        .select("id")
        .maybeSingle();
      if (error) throw error;
      // 0 linhas sem erro = RLS negou; não pode dizer "Salvo".
      if (!sRow) throw new Error("O banco recusou a gravação (sem permissão de administrador). Os valores antigos continuam valendo.");

      setSettings((prev) => (prev ? { ...prev, ...patch } : prev));
      if (patch.live_dispatch_enabled != null) setToggleLive(!!patch.live_dispatch_enabled);
      toast({ title: "Salvo" });
    } catch (e: any) {
      toast({ title: "Falha ao salvar", description: String(e?.message || e), variant: "destructive" });
      await loadAdmin();
    } finally {
      setSavingKey(null);
    }
  };

  const runNow = async () => {
    setRunning(true);
    try {
      const { data, error } = await (supabase as any).functions.invoke("daily-reheat-cron", {
        body: { source: "admin-cockpit" },
      });
      if (error) throw error;
      toast({
        title: "Ciclo executado",
        description: `Planejados: ${data?.planned ?? 0} · Despachados: ${data?.dispatched ?? 0}`,
      });
      await loadQueue();
    } catch (e: any) {
      toast({ title: "Falha ao rodar", description: String(e?.message || e), variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="premium-card h-full">
      <ConsultantIdentityWizard consultantId={consultantId || undefined} className="mb-3" hideWhenReady />
      <CadenceMissingAlert className="mb-3" />
      {consultantId && (
        <>
          <HandoffLeadsBanner consultantId={consultantId} onOpenChat={onOpenChat} onChanged={() => void loadQueue()} />
          <SlaBacklogLeadsBanner consultantId={consultantId} onOpenChat={onOpenChat} />
        </>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="min-w-0">
          <h3 className="font-heading font-bold text-foreground flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-primary shrink-0" />
            Ciclo A · B · C
            <CadenceCostHelpModal />
            {statusBadge && (
              <Badge className={cn("ml-1 text-[10px] font-semibold", statusBadge.cls)}>
                {statusBadge.label}
              </Badge>
            )}
          </h3>
          <p className="text-xs text-muted-foreground">
            {loading
              ? "Carregando filas…"
              : total > 0
                ? `${total} no radar · A ${countNovo} · B ${countFrio} · C ${countLongo}${
                    admin ? ` · mensagens devidas hoje: ${cadenceDueToday}` : ""
                  }`
                : "Ninguém no ciclo A/B/C agora"}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {admin && (
            <Button
              type="button"
              size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={() => void runNow()}
              disabled={running}
            >
              {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              Rodar ciclo agora
            </Button>
          )}
          {admin && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 text-xs gap-1.5"
              onClick={() => { window.location.href = "/admin/motor"; }}
            >
              <Settings2 className="w-3.5 h-3.5" />
              Estágios
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 text-xs gap-1.5"
            onClick={() => void loadQueue()}
          >
            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
            Atualizar
          </Button>
        </div>
      </div>

      {admin && settings && (
        <div className="mb-4 rounded-lg border bg-muted/20 p-3 grid grid-cols-1 md:grid-cols-4 gap-3">
          <label className="flex items-center gap-2 text-xs">
            <Switch
              checked={toggleCadence}
              onCheckedChange={(v) => void saveToggle("cadence_engine", v)}
              disabled={savingKey === "cadence_engine"}
            />
            <div>
              <div className="font-semibold text-foreground">Mensagens automáticas</div>
              <div className="text-[10px] text-muted-foreground">Quem esfriou + quem sumiu (24/7)</div>
            </div>
          </label>
          <label className="flex items-center gap-2 text-xs">
            <Switch
              checked={toggleReheat && settings.enabled}
              onCheckedChange={(v) => void saveToggle("daily_reheat", v)}
              disabled={savingKey === "daily_reheat"}
            />
            <div>
              <div className="font-semibold text-foreground">Ciclo diário em lote</div>
              <div className="text-[10px] text-muted-foreground">A ilimitado · B no cap · 09h–18h30</div>
            </div>
          </label>
          <label className="flex items-center gap-2 text-xs">
            <Switch
              checked={toggleLive}
              onCheckedChange={(v) => void saveSettings({ live_dispatch_enabled: v })}
              disabled={savingKey === "settings"}
            />
            <div>
              <div className="font-semibold text-foreground">Envio ao vivo</div>
              <div className="text-[10px] text-muted-foreground">Off = só planeja</div>
            </div>
          </label>
          <div className="flex items-center gap-2 text-xs">
            <div className="flex flex-col gap-1">
              <Label className="text-[10px] text-muted-foreground">Cap B (frio)/dia</Label>
              <Input
                type="number"
                min={10}
                max={500}
                value={settings.cap_b}
                onChange={(e) => setSettings((prev) => prev ? { ...prev, cap_b: Number(e.target.value) || 150 } : prev)}
                onBlur={() => void saveSettings({ cap_b: Math.min(500, Math.max(10, settings.cap_b || 150)) })}
                className="h-8 w-24"
              />
            </div>
            <div className="flex flex-col gap-1 flex-1">
              <Label className="text-[10px] text-muted-foreground">Prioridade</Label>
              <Select
                value={settings.priority_queue}
                onValueChange={(v) => void saveSettings({ priority_queue: v as Settings["priority_queue"] })}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="A_then_B">Novo → Frio</SelectItem>
                  <SelectItem value="B_then_A">Frio → Novo</SelectItem>
                  <SelectItem value="A_only">Só novo</SelectItem>
                  <SelectItem value="B_only">Só frio</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 lg:gap-5 items-start justify-items-center">
        <PizzaRing
          title="Leads novos"
          subtitle="Entrada → ativo → aguardando → retomada → SMS → ligação → fecha A → B"
          steps={CYCLE_NOVO_STEPS}
          activeIndex={idxNovo}
          peopleCount={countNovo}
          perStep={perStepA}
          compact
          onSliceClick={(step) =>
            setSlicePick({ group: "A", step, people: peopleA[step.id] || [] })
          }
        />
        <PizzaRing
          title="Quem esfriou"
          subtitle="D+1→D10 · conta no teto diário · estado real"
          steps={CYCLE_FRIO_STEPS}
          activeIndex={idxFrio}
          peopleCount={countFrio}
          perStep={perStepB}
          compact
          onSliceClick={(step) =>
            setSlicePick({ group: "B", step, people: peopleB[step.id] || [] })
          }
        />
        <PizzaRing
          title="Quem sumiu"
          subtitle="Meta + recalls · Zap do canal de origem · conta no teto"
          steps={CYCLE_LONGO_STEPS}
          activeIndex={idxLongo}
          peopleCount={countLongo}
          perStep={perStepC}
          compact
          onSliceClick={(step) =>
            setSlicePick({ group: "C", step, people: peopleC[step.id] || [] })
          }
        />
      </div>

      <Sheet open={!!slicePick} onOpenChange={(open) => !open && setSlicePick(null)}>
        <SheetContent side="right" className="w-full sm:max-w-md flex flex-col">
          <SheetHeader>
            <SheetTitle className="pr-6">
              Grupo {slicePick?.group} · {slicePick?.step.label}
            </SheetTitle>
            <SheetDescription>
              {slicePick?.step.hint ? (
                <span className="block mb-1.5 text-muted-foreground">{slicePick.step.hint}</span>
              ) : null}
              {slicePick?.people.length === 1
                ? "1 pessoa nesta etapa agora"
                : `${slicePick?.people.length ?? 0} pessoas nesta etapa agora`}
              {sliceHistory.length > 0
                ? ` · ${sliceHistory.length} no histórico recente`
                : ""}
            </SheetDescription>
          </SheetHeader>

          {slicePick && (() => {
            const targets = editTargetsForSlice(slicePick.group, slicePick.step.id);
            if (!targets.length) return null;
            return (
              <div className="mt-3 space-y-1.5 rounded-lg border border-border/60 bg-muted/20 p-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Editar toques desta fatia
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {targets.map((t) => (
                    <Button
                      key={`${t.sub}-${t.cadenceKey || t.label}`}
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 text-[11px] gap-1"
                      onClick={() => {
                        navigateToSliceEdit(t);
                        setSlicePick(null);
                      }}
                    >
                      <MessageSquare className="w-3 h-3" />
                      {t.label}
                    </Button>
                  ))}
                </div>
                {slicePick.group === "A" &&
                  (slicePick.step.id === "call1" ||
                    slicePick.step.id === "retry" ||
                    slicePick.step.id === "sms") && (
                    <p className="text-[10px] text-muted-foreground leading-snug">
                      Leads novos (ciclo diário): ligação/SMS vêm do Kit — não dos textos de quem esfriou/sumiu.
                    </p>
                  )}
              </div>
            );
          })()}

          <Tabs
            value={sheetTab}
            onValueChange={(v) => setSheetTab(v as "now" | "history")}
            className="mt-3 flex-1 flex flex-col min-h-0"
          >
            <TabsList className="grid w-full grid-cols-2 h-9">
              <TabsTrigger value="now" className="text-xs gap-1">
                Agora
                <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                  {slicePick?.people.length ?? 0}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="history" className="text-xs gap-1">
                <History className="w-3 h-3" />
                Histórico
                <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                  {historyLoading ? "…" : sliceHistory.length}
                </Badge>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="now" className="mt-3 flex-1 overflow-y-auto space-y-2 pr-1 data-[state=inactive]:hidden">
              {(slicePick?.people || []).length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  Ninguém nesta fatia agora.
                  <button
                    type="button"
                    className="block mx-auto mt-2 text-xs text-primary underline-offset-2 hover:underline"
                    onClick={() => setSheetTab("history")}
                  >
                    Ver quem já passou
                  </button>
                </p>
              ) : (
                (slicePick?.people || []).map((p) => {
                  const phoneCheck = p.phone ? validateBrazilPhone(p.phone) : { valid: false };
                  const canChat = !!onOpenChat && phoneCheck.valid;
                  const countdown = formatExactCountdown(p.nextActionAt, nowMs);
                  const nextLabel = labelNextCadenceAction(p.stage);
                  const stageLabel = p.stage ? labelCadenceStage(p.stage, "short") : null;
                  const phoneLabel = p.phone ? formatBrazilPhone(p.phone) || p.phone : "Sem WhatsApp";
                  const whenExact = p.nextActionAt
                    ? new Date(p.nextActionAt).toLocaleString("pt-BR", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : null;
                  const previewStage = slicePick
                    ? previewStageForLead(p.stage, slicePick.step.id, slicePick.group)
                    : null;
                  const preview = buildPersonPreview(
                    previewStage ? stepPreviews[previewStage] : undefined,
                    { name: p.name, nameSource: p.nameSource },
                  );
                  const previewIsCurrent =
                    !!p.stage && !!previewStage && p.stage === previewStage;
                  const channelLabel =
                    preview?.channel === "sms"
                      ? "SMS"
                      : preview?.channel === "voice"
                        ? "Ligação"
                        : preview?.channel === "whatsapp"
                          ? "WhatsApp"
                          : "Toque";
                  return (
                    <div
                      key={p.id}
                      className={cn(
                        "rounded-lg border px-3 py-2.5 space-y-2",
                        countdown.tone === "overdue"
                          ? "border-amber-500/50 bg-amber-500/5"
                          : countdown.tone === "soon"
                            ? "border-sky-500/40 bg-sky-500/5"
                            : "border-border/60 bg-card/50",
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <p className="text-sm font-medium truncate sensitive-name">
                              {p.name || "Sem nome"}
                            </p>
                            {stageLabel ? (
                              <Badge
                                variant="secondary"
                                className="h-5 shrink-0 px-1.5 text-[10px] font-normal"
                                title={p.stage || undefined}
                              >
                                {stageLabel}
                              </Badge>
                            ) : null}
                          </div>
                          <p className="text-[11px] text-muted-foreground truncate">{phoneLabel}</p>
                          <p
                            className={cn(
                              "text-[11px] font-medium truncate flex items-center gap-1",
                              countdown.tone === "overdue" && "text-amber-700 dark:text-amber-400",
                              countdown.tone === "soon" && "text-sky-700 dark:text-sky-400",
                              countdown.tone === "later" && "text-foreground/80",
                              countdown.tone === "none" && "text-muted-foreground font-normal",
                            )}
                            title={whenExact ? `Agenda: ${whenExact}` : undefined}
                          >
                            <Clock3 className="w-3 h-3 shrink-0 opacity-70" />
                            <span className="truncate">
                              {countdown.text}
                              {nextLabel ? ` · próximo: ${nextLabel}` : ""}
                              {whenExact && countdown.tone !== "none" ? ` · ${whenExact}` : ""}
                            </span>
                          </p>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 gap-1.5 shrink-0"
                          disabled={!canChat}
                          title={canChat ? "Abrir conversa interna" : "Sem telefone válido"}
                          onClick={() => {
                            if (!canChat || !p.phone) return;
                            onOpenChat?.(normalizeBrazilPhone(p.phone));
                            setSlicePick(null);
                          }}
                        >
                          <MessageCircle className="w-3.5 h-3.5" />
                          Conversar
                        </Button>
                      </div>

                      {previewLoading ? (
                        <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          Carregando prévia…
                        </p>
                      ) : preview && (preview.body || preview.mediaUrl) ? (
                        <div className="rounded-md bg-background/80 border border-border/50 px-2.5 py-2 space-y-1.5">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                              {previewIsCurrent
                                ? `Prévia · ${channelLabel} que será enviado`
                                : `Prévia · próximo ${channelLabel}`}
                            </p>
                            {preview.withName ? (
                              <Badge className="h-4 shrink-0 px-1 text-[9px] bg-emerald-600/15 text-emerald-800 dark:text-emerald-300 border-0">
                                Com nome
                              </Badge>
                            ) : (
                              <Badge className="h-4 shrink-0 px-1 text-[9px] bg-amber-600/15 text-amber-800 dark:text-amber-300 border-0">
                                Sem nome
                              </Badge>
                            )}
                          </div>
                          {preview.mediaUrl &&
                          (preview.mediaType === "audio" || preview.channel === "voice") ? (
                            <div className="space-y-1">
                              <p className="text-[10px] text-muted-foreground">Áudio da ligação</p>
                              <audio
                                controls
                                preload="metadata"
                                src={preview.mediaUrl}
                                className="w-full h-8"
                              />
                            </div>
                          ) : null}
                          {preview.body ? (
                            <p className="text-[12px] leading-snug whitespace-pre-wrap break-words text-foreground">
                              {preview.body}
                            </p>
                          ) : null}
                        </div>
                      ) : previewStage ? (
                        <p className="text-[11px] text-muted-foreground italic">
                          Sem template configurado para {labelCadenceStage(previewStage, "short")}.
                        </p>
                      ) : null}
                    </div>
                  );
                })
              )}
            </TabsContent>

            <TabsContent value="history" className="mt-3 flex-1 overflow-y-auto space-y-2 pr-1 data-[state=inactive]:hidden">
              {historyLoading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Carregando histórico…
                </div>
              ) : sliceHistory.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  Ainda sem registro nesta fatia.
                  <span className="block text-[11px] mt-1">
                    Envios futuros gravam horário, visualização e o texto exato (com/sem nome).
                  </span>
                </p>
              ) : (
                sliceHistory.map((h) => {
                  const phoneCheck = h.phone ? validateBrazilPhone(h.phone) : { valid: false };
                  const canChat = !!onOpenChat && phoneCheck.valid;
                  const phoneLabel = h.phone ? formatBrazilPhone(h.phone) || h.phone : "Sem WhatsApp";
                  const saw =
                    h.channel === "whatsapp" &&
                    (String(h.delivery || "").toLowerCase() === "read" ||
                      String(h.delivery || "").toLowerCase() === "played");
                  return (
                    <div
                      key={h.id}
                      className="rounded-lg border border-border/60 bg-card/50 px-3 py-2.5 space-y-1.5"
                    >
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                            <p className="text-sm font-medium truncate sensitive-name">
                              {h.name || "Sem nome"}
                            </p>
                            <Badge variant="outline" className="h-5 shrink-0 px-1.5 text-[10px]">
                              {labelCadenceStage(h.stage, "short")}
                            </Badge>
                            {h.withName === true && (
                              <Badge className="h-5 shrink-0 px-1.5 text-[10px] bg-emerald-600/15 text-emerald-800 dark:text-emerald-300 border-0">
                                Com nome
                              </Badge>
                            )}
                            {h.withName === false && (
                              <Badge className="h-5 shrink-0 px-1.5 text-[10px] bg-amber-600/15 text-amber-800 dark:text-amber-300 border-0">
                                Sem nome
                              </Badge>
                            )}
                          </div>
                          <p className="text-[11px] text-muted-foreground truncate">{phoneLabel}</p>
                          <p className="text-[11px] flex items-center gap-1 text-foreground/80">
                            <Clock3 className="w-3 h-3 shrink-0 opacity-70" />
                            {formatHistoryWhen(h.at)}
                            <span className="text-muted-foreground">·</span>
                            {saw ? (
                              <span className="inline-flex items-center gap-0.5 text-sky-700 dark:text-sky-400 font-medium">
                                <CheckCheck className="w-3 h-3" />
                                Visualizou
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-0.5">
                                {h.channel === "whatsapp" && h.status === "sent" ? (
                                  <Check className="w-3 h-3 opacity-70" />
                                ) : null}
                                {h.deliveryLabel}
                              </span>
                            )}
                          </p>
                        </div>
                        {canChat && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 gap-1.5 shrink-0"
                            onClick={() => {
                              if (!h.phone) return;
                              onOpenChat?.(normalizeBrazilPhone(h.phone));
                              setSlicePick(null);
                            }}
                          >
                            <MessageCircle className="w-3.5 h-3.5" />
                            Conversar
                          </Button>
                        )}
                      </div>
                      {h.mediaUrl && (h.mediaType === "audio" || h.channel === "voice") ? (
                        <div className="rounded-md bg-muted/40 border border-border/40 px-2.5 py-2 space-y-1.5">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                            {h.channel === "voice" ? "Ligação" : "Áudio enviado"}
                            {h.callOutcome
                              ? ` · ${h.callOutcome}`
                              : String(h.delivery || "").toLowerCase() === "played"
                                ? " · escutou"
                                : String(h.delivery || "").toLowerCase() === "read"
                                  ? " · visualizou"
                                  : h.channel === "voice" && h.status === "sent"
                                    ? " · disparada"
                                    : ""}
                            {h.listenSec != null && h.listenSec > 0
                              ? ` · ${formatDurationSec(h.listenSec)}`
                              : ""}
                          </p>
                          <audio controls preload="metadata" src={h.mediaUrl} className="w-full h-8" />
                          {h.channel === "voice" && !h.callOutcome && h.status === "sent" ? (
                            <p className="text-[10px] text-muted-foreground">
                              Aguardando retorno da operadora (atendeu / recusou / tempo).
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                      {h.messageBody ? (
                        <div className="rounded-md bg-muted/40 border border-border/40 px-2.5 py-2">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                            {h.channel === "sms"
                              ? "SMS enviado"
                              : h.channel === "whatsapp"
                                ? "WhatsApp enviado"
                                : "Mensagem"}
                            {h.bodySource === "reconstructed"
                              ? " · reconstruído do template"
                              : h.bodySource === "sms_log"
                                ? " · log Velip"
                                : ""}
                          </p>
                          <p className="text-[12px] leading-snug whitespace-pre-wrap break-words text-foreground">
                            {h.messageBody}
                          </p>
                        </div>
                      ) : h.channel === "whatsapp" || h.channel === "sms" ? (
                        <p className="text-[11px] text-muted-foreground italic">
                          Sem texto neste toque (pode ter sido só áudio/sistema).
                        </p>
                      ) : null}
                    </div>
                  );
                })
              )}
            </TabsContent>
          </Tabs>
        </SheetContent>
      </Sheet>
    </div>
  );
}
