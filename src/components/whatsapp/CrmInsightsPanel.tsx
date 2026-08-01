import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  Headphones, Phone, Smartphone, Users, RefreshCw,
  Loader2, CheckCircle2, XCircle, Eye, Volume2, Video,
} from "lucide-react";
import { formatDurationSec } from "@/components/admin/voz/voiceOutcomeLabels";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { toUserFacingError } from "@/lib/userFacingError";
import { isNuncaMaisContatar } from "@/lib/crmVsLeadAnalysis";

type Focus = "leads" | "clientes";

type CustomerLite = {
  id: string;
  name: string | null;
  phone_whatsapp: string | null;
  conversation_step: string | null;
  portal_submitted_at: string | null;
  do_not_contact: boolean | null;
  bot_paused_reason: string | null;
  customer_origin: string | null;
  pos_venda_stage: string | null;
  status: string | null;
};

type DealLite = { customer_id: string | null; stage: string };
type StageLite = { stage_key: string; label: string; position: number };

type WaRow = {
  id: string;
  customer_id: string;
  message_direction: string;
  message_type: string | null;
  delivery_status: string | null;
  created_at: string;
  media_id: string | null;
  media_duration_sec?: number | null;
};

type SmsRow = {
  id: string;
  phone: string;
  status: string;
  delivery_status: string | null;
  created_at: string;
};

type CallRow = {
  id: string;
  to_phone: string;
  status: string | null;
  velip_status: string | null;
  duration_sec: number | null;
  velip_time_sec: number | null;
  created_at: string;
};

type PersonRow = {
  id: string;
  name: string;
  phone: string;
  detail: string;
  when?: string;
  durationSec?: number | null;
};

type FunnelRow = { key: string; name: string; value: number };

type ListKind =
  | "audio_ok"
  | "audio_nao"
  | "audio_sem_conf"
  | "video_ok"
  | "video_nao"
  | "video_sem_conf"
  | "leu"
  | "nao_leu"
  | "sem_conf_leitura"
  | "sms_ok"
  | "sms_nao"
  | "liga_ok"
  | "liga_nao"
  | "passo"
  | "pessoas"
  | "bloqueados";

type ChartSegment = {
  key: string;
  label: string;
  value: number;
  color: string;
  listKind: ListKind;
};

const CHART = {
  ok: "hsl(142, 70%, 42%)",
  warn: "hsl(38, 92%, 50%)",
  muted: "hsl(220, 10%, 72%)",
  sky: "hsl(210, 78%, 52%)",
  bad: "hsl(0, 72%, 55%)",
  violet: "hsl(262, 58%, 58%)",
  teal: "hsl(174, 62%, 42%)",
};

const FUNNEL_PALETTE = [
  CHART.ok, CHART.sky, CHART.warn, CHART.violet, CHART.teal,
  CHART.bad, "hsl(200, 70%, 50%)", "hsl(280, 55%, 55%)", "hsl(25, 85%, 55%)",
];

const STEP_LABELS: Record<string, string> = {
  welcome: "Boas-vindas",
  menu_inicial: "Menu inicial",
  pos_video: "Depois do vídeo",
  aguardando_humano: "Esperando você",
  aguardando_conta: "Pediu conta de luz",
  processando_ocr_conta: "Lendo a conta",
  confirmando_dados_conta: "Confirmando a conta",
  ask_tipo_documento: "Escolhendo documento",
  aguardando_doc_frente: "Foto frente do documento",
  aguardando_doc_verso: "Foto verso do documento",
  confirmando_dados_doc: "Confirmando documento",
  ask_name: "Pedindo nome",
  ask_cpf: "Pedindo CPF",
  ask_rg: "Pedindo RG",
  ask_birth_date: "Pedindo nascimento",
  ask_phone_confirm: "Confirmando telefone",
  ask_phone: "Pedindo telefone",
  ask_email: "Pedindo e-mail",
  ask_cep: "Pedindo CEP",
  ask_finalizar: "Pedir para finalizar",
  finalizando: "Finalizando",
  portal_submitting: "Enviando cadastro",
  aguardando_otp: "Código do celular",
  validando_otp: "Validando código",
  aguardando_facial: "Foto do rosto",
  aguardando_assinatura: "Assinatura",
  cadastro_em_analise: "Cadastro em análise",
  complete: "Cadastro completo",
};

const POS_LABELS: Record<string, string> = {
  espera: "Aguardando classificação",
  aprovado: "Aprovado",
  reprovado: "Reprovado",
  retentativa: "Retentativa",
  d30: "30 dias",
  d60: "60 dias",
  d90: "90 dias",
  d120: "120 dias",
  d150: "150 dias",
  d180: "180 dias",
  d210: "210 dias",
};

function fmtPhone(raw: string | null | undefined): string {
  const d = String(raw || "").replace(/\D/g, "");
  const local = d.startsWith("55") && d.length >= 12 ? d.slice(2) : d;
  if (local.length < 10) return raw || "—";
  return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
}

function phoneKey(raw: string | null | undefined): string {
  const d = String(raw || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("55") && d.length >= 12) return d.slice(2);
  return d;
}

function phoneVariants(raw: string | null | undefined): string[] {
  const d = String(raw || "").replace(/\D/g, "");
  if (!d) return [];
  const out = new Set<string>([d]);
  if (d.startsWith("55") && d.length >= 12) out.add(d.slice(2));
  else if (d.length >= 10 && d.length <= 11) out.add(`55${d}`);
  return [...out];
}

function isAudioMsg(t: string | null | undefined): boolean {
  const s = String(t || "").toLowerCase();
  return s === "audio" || s === "ptt" || s === "voice";
}

function isVideoMsg(t: string | null | undefined): boolean {
  const s = String(t || "").toLowerCase();
  return s === "video" || s === "gif" || s === "short";
}

function isPlayedStatus(st: string | null | undefined): boolean {
  const s = String(st || "").toLowerCase();
  return s === "played" || s === "read";
}

function isWatchedStatus(st: string | null | undefined): boolean {
  const s = String(st || "").toLowerCase();
  return s === "read" || s === "played";
}

function isReadStatus(st: string | null | undefined): boolean {
  const s = String(st || "").toLowerCase();
  return s === "read" || s === "played";
}

function callListenSec(row: CallRow): number | null {
  const sec = row.velip_time_sec ?? row.duration_sec;
  return sec != null && Number.isFinite(sec) && sec > 0 ? sec : null;
}

function fmtMediaAction(action: string, durSec: number | null | undefined): string {
  const dur = formatDurationSec(durSec);
  return dur !== "—" ? `${action} · ${dur}` : action;
}

function isDeliveredOnly(st: string | null | undefined): boolean {
  const s = String(st || "").toLowerCase();
  return s === "delivered" || s === "delivery_ack";
}

function isAnsweredCall(row: CallRow): boolean {
  const s = `${row.status || ""} ${row.velip_status || ""}`.toLowerCase();
  if (/(no.?answer|nao.?atend|busy|failed|cancel|undeliv|rejected)/.test(s)) return false;
  if ((row.duration_sec || 0) > 0) return true;
  return /(answer|atendid|completed|ok|success)/.test(s);
}

function friendlyStep(step: string | null | undefined): string {
  if (!step) return "Sem passo";
  if (STEP_LABELS[step]) return STEP_LABELS[step];
  const low = String(step).toLowerCase();
  if (STEP_LABELS[low]) return STEP_LABELS[low];
  return String(step).replace(/_/g, " ");
}

function pct(part: number, total: number): string {
  if (total <= 0) return "0%";
  return `${Math.round((part / total) * 100)}%`;
}

type Props = {
  consultantId: string;
  initialFocus?: Focus | "tudo";
};

/**
 * Análise do CRM — contagem por PESSOA, linguagem simples, barras legíveis.
 */
export function CrmInsightsPanel({ consultantId, initialFocus = "leads" }: Props) {
  const { toast } = useToast();
  const normalizedFocus: Focus = initialFocus === "clientes" ? "clientes" : "leads";
  const [focus, setFocus] = useState<Focus>(normalizedFocus);
  const [periodDays, setPeriodDays] = useState(30);
  const [loading, setLoading] = useState(true);

  const [leadCustomers, setLeadCustomers] = useState<CustomerLite[]>([]);
  const [clientCustomers, setClientCustomers] = useState<CustomerLite[]>([]);
  const [deals, setDeals] = useState<DealLite[]>([]);
  const [stages, setStages] = useState<StageLite[]>([]);
  const [wa, setWa] = useState<WaRow[]>([]);
  const [sms, setSms] = useState<SmsRow[]>([]);
  const [calls, setCalls] = useState<CallRow[]>([]);

  const [listKind, setListKind] = useState<ListKind | null>(null);
  const [listStep, setListStep] = useState<string | null>(null);

  useEffect(() => {
    setFocus(initialFocus === "clientes" ? "clientes" : "leads");
  }, [initialFocus]);

  const load = useCallback(async () => {
    if (!consultantId) return;
    setLoading(true);
    try {
      const since = new Date(Date.now() - periodDays * 86400000).toISOString();

      const [dealsRes, stagesRes, clientsRes, smsRes, callsRes] = await Promise.all([
        supabase
          .from("crm_deals")
          .select("customer_id, stage")
          .eq("consultant_id", consultantId)
          .limit(5000),
        supabase
          .from("kanban_stages")
          .select("stage_key, label, position")
          .eq("consultant_id", consultantId)
          .order("position", { ascending: true }),
        supabase
          .from("customers")
          .select(
            "id, name, phone_whatsapp, conversation_step, portal_submitted_at, do_not_contact, bot_paused_reason, customer_origin, pos_venda_stage, status",
          )
          .eq("customer_origin", "igreen_sync")
          .or(`consultant_id.eq.${consultantId},assigned_consultant_id.eq.${consultantId}`)
          .order("portal_submitted_at", { ascending: false, nullsFirst: false })
          .limit(3000),
        supabase
          .from("voice_sms_log")
          .select("id, phone, status, delivery_status, created_at")
          .eq("consultant_id", consultantId)
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(2000),
        supabase
          .from("voice_call_logs")
          .select("id, to_phone, status, velip_status, duration_sec, velip_time_sec, created_at")
          .eq("consultant_id", consultantId)
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(2000),
      ]);

      if (dealsRes.error) throw dealsRes.error;
      if (stagesRes.error) throw stagesRes.error;
      if (clientsRes.error) throw clientsRes.error;
      if (smsRes.error) throw smsRes.error;
      if (callsRes.error) throw callsRes.error;

      const dealRows = (dealsRes.data as DealLite[]) || [];
      setDeals(dealRows);
      setStages((stagesRes.data as StageLite[]) || []);
      const clients = (clientsRes.data as CustomerLite[]) || [];
      setClientCustomers(clients);
      setSms((smsRes.data as SmsRow[]) || []);
      setCalls((callsRes.data as CallRow[]) || []);

      const leadIds = [
        ...new Set(dealRows.map((d) => d.customer_id).filter((id): id is string => !!id)),
      ];
      const leadAcc: CustomerLite[] = [];
      for (let i = 0; i < leadIds.length; i += 120) {
        const slice = leadIds.slice(i, i + 120);
        const { data, error } = await supabase
          .from("customers")
          .select(
            "id, name, phone_whatsapp, conversation_step, portal_submitted_at, do_not_contact, bot_paused_reason, customer_origin, pos_venda_stage, status",
          )
          .in("id", slice);
        if (error) throw error;
        leadAcc.push(...((data as CustomerLite[]) || []));
      }
      setLeadCustomers(leadAcc);

      // WhatsApp: último áudio/vídeo/texto por pessoa (interessados + clientes)
      const allIds = [...new Set([...leadIds, ...clients.map((c) => c.id)])];
      const waByCustomer = new Map<string, { audio?: WaRow; video?: WaRow; text?: WaRow }>();
      const mediaIds = new Set<string>();

      for (let i = 0; i < allIds.length; i += 80) {
        const chunk = allIds.slice(i, i + 80);
        if (!chunk.length) break;
        const { data, error } = await supabase
          .from("conversations")
          .select("id, customer_id, message_direction, message_type, delivery_status, created_at, media_id, media_duration_sec")
          .in("customer_id", chunk)
          .eq("message_direction", "outbound")
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(2000);
        if (error) throw error;
        for (const row of (data as WaRow[]) || []) {
          const cur = waByCustomer.get(row.customer_id) || {};
          if (isAudioMsg(row.message_type)) {
            if (!cur.audio) cur.audio = row;
          } else if (isVideoMsg(row.message_type)) {
            if (!cur.video) cur.video = row;
          } else if (!cur.text) {
            cur.text = row;
          }
          waByCustomer.set(row.customer_id, cur);
          if (row.media_id) mediaIds.add(row.media_id);
        }
      }

      const mediaDurById = new Map<string, number>();
      const mediaIdList = [...mediaIds];
      for (let i = 0; i < mediaIdList.length; i += 100) {
        const slice = mediaIdList.slice(i, i + 100);
        const [libRes, clipRes] = await Promise.all([
          supabase.from("ai_media_library").select("id, duration_sec").in("id", slice),
          supabase.from("voice_audio_clips").select("id, duration_sec").in("id", slice),
        ]);
        for (const row of (libRes.data as { id: string; duration_sec: number | null }[]) || []) {
          if (row.duration_sec && row.duration_sec > 0) mediaDurById.set(row.id, row.duration_sec);
        }
        for (const row of (clipRes.data as { id: string; duration_sec: number | null }[]) || []) {
          if (row.duration_sec && row.duration_sec > 0) mediaDurById.set(row.id, row.duration_sec);
        }
      }

      const enrichWa = (row?: WaRow): WaRow | undefined => {
        if (!row) return undefined;
        const fromCol = row.media_duration_sec;
        const fromLib = row.media_id ? mediaDurById.get(row.media_id) : undefined;
        const media_duration_sec = (fromCol && fromCol > 0 ? fromCol : fromLib) ?? null;
        return { ...row, media_duration_sec };
      };

      // Materializa só o último áudio/vídeo/texto por pessoa (lista plana p/ filtros)
      const flat: WaRow[] = [];
      for (const [, pack] of waByCustomer) {
        const audio = enrichWa(pack.audio);
        const video = enrichWa(pack.video);
        const text = enrichWa(pack.text);
        if (audio) flat.push(audio);
        if (video) flat.push(video);
        if (text) flat.push(text);
      }
      setWa(flat);
    } catch (e) {
      console.error("[CrmInsightsPanel]", e);
      toast({
        title: "Não deu para carregar a análise",
        description: toUserFacingError(e, "Tente de novo em alguns segundos."),
        variant: "destructive",
        duration: 14000,
      });
    } finally {
      setLoading(false);
    }
  }, [consultantId, periodDays, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const people = useMemo(() => {
    if (focus === "clientes") return clientCustomers;
    return leadCustomers;
  }, [focus, leadCustomers, clientCustomers]);

  const peopleIds = useMemo(() => new Set(people.map((p) => p.id)), [people]);

  const byPhone = useMemo(() => {
    const m = new Map<string, CustomerLite>();
    for (const c of people) {
      for (const p of phoneVariants(c.phone_whatsapp)) m.set(p, c);
    }
    return m;
  }, [people]);

  const mediaByPerson = useMemo(() => {
    const map = new Map<string, { audio?: WaRow; video?: WaRow; text?: WaRow }>();
    for (const w of wa) {
      if (!peopleIds.has(w.customer_id)) continue;
      const cur = map.get(w.customer_id) || {};
      if (isAudioMsg(w.message_type)) cur.audio = w;
      else if (isVideoMsg(w.message_type)) cur.video = w;
      else cur.text = w;
      map.set(w.customer_id, cur);
    }
    return map;
  }, [wa, peopleIds]);

  const audioStats = useMemo(() => {
    const ok: PersonRow[] = [];
    const nao: PersonRow[] = [];
    const semConf: PersonRow[] = [];
    for (const p of people) {
      const a = mediaByPerson.get(p.id)?.audio;
      if (!a) continue;
      const dur = a.media_duration_sec ?? null;
      const base = {
        id: p.id,
        name: p.name || "Sem nome",
        phone: fmtPhone(p.phone_whatsapp),
        when: a.created_at,
        durationSec: dur,
      };
      if (isPlayedStatus(a.delivery_status)) {
        ok.push({ ...base, detail: fmtMediaAction("Escutou o áudio", dur) });
      } else if (isDeliveredOnly(a.delivery_status)) {
        nao.push({ ...base, detail: fmtMediaAction("Áudio chegou, não escutou", dur) });
      } else {
        semConf.push({ ...base, detail: dur ? `Áudio de ${formatDurationSec(dur)} — sem confirmação` : "Áudio enviado — WhatsApp ainda não confirmou" });
      }
    }
    const comAudio = ok.length + nao.length + semConf.length;
    return { ok, nao, semConf, comAudio, semAudio: people.length - comAudio };
  }, [people, mediaByPerson]);

  const videoStats = useMemo(() => {
    const ok: PersonRow[] = [];
    const nao: PersonRow[] = [];
    const semConf: PersonRow[] = [];
    for (const p of people) {
      const v = mediaByPerson.get(p.id)?.video;
      if (!v) continue;
      const dur = v.media_duration_sec ?? null;
      const base = {
        id: p.id,
        name: p.name || "Sem nome",
        phone: fmtPhone(p.phone_whatsapp),
        when: v.created_at,
        durationSec: dur,
      };
      if (isWatchedStatus(v.delivery_status)) {
        ok.push({ ...base, detail: fmtMediaAction("Assistiu o vídeo", dur) });
      } else if (isDeliveredOnly(v.delivery_status)) {
        nao.push({ ...base, detail: fmtMediaAction("Vídeo chegou, não assistiu", dur) });
      } else {
        semConf.push({ ...base, detail: dur ? `Vídeo de ${formatDurationSec(dur)} — sem confirmação` : "Vídeo enviado — WhatsApp ainda não confirmou" });
      }
    }
    const comVideo = ok.length + nao.length + semConf.length;
    return { ok, nao, semConf, comVideo, semVideo: people.length - comVideo };
  }, [people, mediaByPerson]);

  const readStats = useMemo(() => {
    const ok: PersonRow[] = [];
    const nao: PersonRow[] = [];
    const semConf: PersonRow[] = [];
    for (const p of people) {
      const pack = mediaByPerson.get(p.id);
      if (!pack?.text && !pack?.audio && !pack?.video) continue;
      const audioRead = pack.audio && isPlayedStatus(pack.audio.delivery_status);
      const videoRead = pack.video && isWatchedStatus(pack.video.delivery_status);
      const textRead = pack.text && isReadStatus(pack.text.delivery_status);
      const anyDelivered =
        (pack.text && (isDeliveredOnly(pack.text.delivery_status) || isReadStatus(pack.text.delivery_status))) ||
        (pack.audio && (isDeliveredOnly(pack.audio.delivery_status) || isPlayedStatus(pack.audio.delivery_status))) ||
        (pack.video && (isDeliveredOnly(pack.video.delivery_status) || isWatchedStatus(pack.video.delivery_status)));
      const when = pack.text?.created_at || pack.video?.created_at || pack.audio?.created_at;
      const base = {
        id: p.id,
        name: p.name || "Sem nome",
        phone: fmtPhone(p.phone_whatsapp),
        when,
      };
      if (audioRead || videoRead || textRead) {
        const detail = videoRead
          ? fmtMediaAction("Assistiu o vídeo", pack.video?.media_duration_sec)
          : audioRead
            ? fmtMediaAction("Escutou o áudio", pack.audio?.media_duration_sec)
            : "Abriu a mensagem";
        ok.push({ ...base, detail });
      } else if (anyDelivered) {
        nao.push({ ...base, detail: "Chegou no celular, mas não abriu" });
      } else {
        semConf.push({ ...base, detail: "Enviado — ainda sem confirmação" });
      }
    }
    const comMsg = ok.length + nao.length + semConf.length;
    return { ok, nao, semConf, comMsg, semMsg: people.length - comMsg };
  }, [people, mediaByPerson]);

  const smsStats = useMemo(() => {
    // Último SMS por pessoa (telefone)
    const latest = new Map<string, SmsRow>();
    for (const s of sms) {
      const key = phoneKey(s.phone);
      if (!key) continue;
      // só se estiver no escopo atual (ou se ainda não carregou people)
      const inScope =
        people.length === 0 ||
        phoneVariants(s.phone).some((p) => byPhone.has(p));
      if (!inScope) continue;
      const prev = latest.get(key);
      if (!prev || s.created_at > prev.created_at) latest.set(key, s);
    }
    const ok: PersonRow[] = [];
    const nao: PersonRow[] = [];
    for (const s of latest.values()) {
      const person = phoneVariants(s.phone).map((p) => byPhone.get(p)).find(Boolean);
      const delivered =
        s.status === "delivered" || String(s.delivery_status || "").toUpperCase() === "DELIVRD";
      const failed = s.status === "failed";
      const row: PersonRow = {
        id: person?.id || s.id,
        name: person?.name || "Contato",
        phone: fmtPhone(s.phone),
        detail: delivered ? "SMS chegou" : failed ? "SMS não chegou" : `SMS: ${s.status}`,
        when: s.created_at,
      };
      if (delivered) ok.push(row);
      else if (failed) nao.push(row);
    }
    return { ok, nao, pessoasComSms: latest.size };
  }, [sms, people, byPhone]);

  const callStats = useMemo(() => {
    // Última ligação por pessoa
    const latest = new Map<string, CallRow>();
    for (const c of calls) {
      const key = phoneKey(c.to_phone);
      if (!key) continue;
      const inScope =
        people.length === 0 ||
        phoneVariants(c.to_phone).some((p) => byPhone.has(p));
      if (!inScope) continue;
      const prev = latest.get(key);
      if (!prev || c.created_at > prev.created_at) latest.set(key, c);
    }
    const ok: PersonRow[] = [];
    const nao: PersonRow[] = [];
    let totalListenSec = 0;
    let answeredCount = 0;
    for (const c of latest.values()) {
      const person = phoneVariants(c.to_phone).map((p) => byPhone.get(p)).find(Boolean);
      const answered = isAnsweredCall(c);
      const listenSec = callListenSec(c);
      if (answered && listenSec) {
        totalListenSec += listenSec;
        answeredCount++;
      }
      const row: PersonRow = {
        id: person?.id || c.id,
        name: person?.name || "Contato",
        phone: fmtPhone(c.to_phone),
        detail: answered
          ? listenSec
            ? `Atendeu · ${formatDurationSec(listenSec)} no fone`
            : "Atendeu"
          : "Não atendeu",
        when: c.created_at,
        durationSec: listenSec,
      };
      if (answered) ok.push(row);
      else nao.push(row);
    }
    const avgListenSec = answeredCount > 0 ? Math.round(totalListenSec / answeredCount) : null;
    return { ok, nao, pessoasComLigacao: latest.size, avgListenSec };
  }, [calls, people, byPhone]);

  const leadFunnel = useMemo((): FunnelRow[] => {
    if (focus !== "leads") return [];
    // 1 pessoa = 1 contagem (customer_id único por coluna)
    const byStage = new Map<string, Set<string>>();
    for (const d of deals) {
      if (!d.customer_id) continue;
      if (!byStage.has(d.stage)) byStage.set(d.stage, new Set());
      byStage.get(d.stage)!.add(d.customer_id);
    }
    const rows = (stages.length ? stages : [...byStage.keys()].map((k, i) => ({
      stage_key: k,
      label: friendlyStep(k),
      position: i,
    }))).map((s) => ({
      key: s.stage_key,
      name: s.label || s.stage_key,
      value: byStage.get(s.stage_key)?.size || 0,
    }));
    return rows.filter((r) => r.value > 0);
  }, [deals, stages, focus]);

  const leadStepFunnel = useMemo((): FunnelRow[] => {
    if (focus !== "leads") return [];
    const counts = new Map<string, number>();
    for (const c of leadCustomers) {
      const step = c.conversation_step || "sem_passo";
      counts.set(step, (counts.get(step) || 0) + 1);
    }
    return [...counts.entries()]
      .map(([key, value]) => ({
        key,
        name: friendlyStep(key === "sem_passo" ? null : key),
        value,
      }))
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 12);
  }, [leadCustomers, focus]);

  const clientFunnel = useMemo((): FunnelRow[] => {
    if (focus !== "clientes") return [];
    const counts = new Map<string, number>();
    for (const c of clientCustomers) {
      const st = c.pos_venda_stage || "espera";
      counts.set(st, (counts.get(st) || 0) + 1);
    }
    return Object.keys(POS_LABELS)
      .map((key) => ({ key, name: POS_LABELS[key], value: counts.get(key) || 0 }))
      .filter((r) => r.value > 0);
  }, [clientCustomers, focus]);

  const bloqueados = useMemo(
    () =>
      people.filter((c) =>
        isNuncaMaisContatar({ do_not_contact: c.do_not_contact, paused_reason: c.bot_paused_reason }),
      ),
    [people],
  );

  const listPeople: PersonRow[] = useMemo(() => {
    if (!listKind) return [];
    if (listKind === "pessoas") {
      return people.map((c) => ({
        id: c.id,
        name: c.name || "Sem nome",
        phone: fmtPhone(c.phone_whatsapp),
        detail: c.pos_venda_stage
          ? POS_LABELS[c.pos_venda_stage] || c.pos_venda_stage
          : friendlyStep(c.conversation_step),
      }));
    }
    if (listKind === "bloqueados") {
      return bloqueados.map((c) => ({
        id: c.id,
        name: c.name || "Sem nome",
        phone: fmtPhone(c.phone_whatsapp),
        detail: "Bloqueado / nunca mais contatar",
      }));
    }
    if (listKind === "audio_ok") return audioStats.ok;
    if (listKind === "audio_nao") return audioStats.nao;
    if (listKind === "audio_sem_conf") return audioStats.semConf;
    if (listKind === "video_ok") return videoStats.ok;
    if (listKind === "video_nao") return videoStats.nao;
    if (listKind === "video_sem_conf") return videoStats.semConf;
    if (listKind === "leu") return readStats.ok;
    if (listKind === "nao_leu") return readStats.nao;
    if (listKind === "sem_conf_leitura") return readStats.semConf;
    if (listKind === "sms_ok") return smsStats.ok;
    if (listKind === "sms_nao") return smsStats.nao;
    if (listKind === "liga_ok") return callStats.ok;
    if (listKind === "liga_nao") return callStats.nao;
    if (listKind === "passo" && listStep) {
      if (leadFunnel.some((f) => f.key === listStep)) {
        const ids = new Set(
          deals.filter((d) => d.stage === listStep && d.customer_id).map((d) => d.customer_id as string),
        );
        return leadCustomers
          .filter((c) => ids.has(c.id))
          .map((c) => ({
            id: c.id,
            name: c.name || "Sem nome",
            phone: fmtPhone(c.phone_whatsapp),
            detail: stages.find((s) => s.stage_key === listStep)?.label || listStep,
          }));
      }
      if (clientFunnel.some((f) => f.key === listStep)) {
        return clientCustomers
          .filter((c) => (c.pos_venda_stage || "espera") === listStep)
          .map((c) => ({
            id: c.id,
            name: c.name || "Sem nome",
            phone: fmtPhone(c.phone_whatsapp),
            detail: POS_LABELS[listStep] || listStep,
          }));
      }
      return leadCustomers
        .filter((c) => (c.conversation_step || "sem_passo") === listStep)
        .map((c) => ({
          id: c.id,
          name: c.name || "Sem nome",
          phone: fmtPhone(c.phone_whatsapp),
          detail: friendlyStep(c.conversation_step),
        }));
    }
    return [];
  }, [
    listKind, listStep, people, bloqueados, audioStats, videoStats, readStats, smsStats, callStats,
    leadFunnel, clientFunnel, deals, leadCustomers, clientCustomers, stages,
  ]);

  const listTitle = useMemo(() => {
    const map: Record<ListKind, string> = {
      pessoas: "Todas as pessoas desta visão",
      bloqueados: "Bloqueados",
      audio_ok: "Quem escutou o áudio",
      audio_nao: "Áudio chegou, mas não escutou",
      audio_sem_conf: "Áudio sem confirmação do WhatsApp",
      video_ok: "Quem assistiu o vídeo",
      video_nao: "Vídeo chegou, mas não assistiu",
      video_sem_conf: "Vídeo sem confirmação do WhatsApp",
      leu: "Quem abriu a mensagem",
      nao_leu: "Chegou, mas não abriu",
      sem_conf_leitura: "Mensagem sem confirmação",
      sms_ok: "SMS que chegou",
      sms_nao: "SMS que não chegou",
      liga_ok: "Quem atendeu a ligação",
      liga_nao: "Quem não atendeu",
      passo:
        stages.find((s) => s.stage_key === listStep)?.label ||
        POS_LABELS[listStep || ""] ||
        friendlyStep(listStep),
    };
    return listKind ? map[listKind] : "Lista";
  }, [listKind, listStep, stages]);

  const focusLabel = focus === "clientes" ? "Clientes ativos" : "Clientes interessados";
  const focusHint =
    focus === "clientes"
      ? "Carteira iGreen (pós-venda) — separado do quadro de interessados."
      : "Quadro de interessados — separado dos clientes ativos da carteira.";

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-10" data-tour="crm-insights-page">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-bold font-heading text-foreground">Análise do CRM</h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            <strong>{focusLabel}</strong> — números por <strong>pessoa</strong> (não por mensagem). Toque em qualquer gráfico para ver a lista.
          </p>
          <p className="text-[11px] text-muted-foreground mt-1">{focusHint}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={focus} onValueChange={(v) => setFocus(v as Focus)}>
            <SelectTrigger className="h-9 w-[210px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="leads">Clientes interessados</SelectItem>
              <SelectItem value="clientes">Clientes ativos (carteira)</SelectItem>
            </SelectContent>
          </Select>
          <Select value={String(periodDays)} onValueChange={(v) => setPeriodDays(Number(v))}>
            <SelectTrigger className="h-9 w-[140px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Últimos 7 dias</SelectItem>
              <SelectItem value="15">Últimos 15 dias</SelectItem>
              <SelectItem value="30">Últimos 30 dias</SelectItem>
              <SelectItem value="90">Últimos 90 dias</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-7 h-7 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard
              label="Interessados"
              value={leadCustomers.length}
              onClick={() => setFocus("leads")}
              accent={focus === "leads" ? "primary" : "sky"}
              active={focus === "leads"}
            />
            <StatCard
              label="Clientes ativos"
              value={clientCustomers.length}
              onClick={() => setFocus("clientes")}
              accent={focus === "clientes" ? "primary" : "violet"}
              active={focus === "clientes"}
            />
            <StatCard
              label={`Nesta visão`}
              value={people.length}
              onClick={() => setListKind("pessoas")}
              accent="default"
            />
            <StatCard
              label="Bloqueados"
              value={bloqueados.length}
              onClick={() => setListKind("bloqueados")}
              accent="warn"
            />
          </div>

          <Section
            icon={Headphones}
            title="Áudio do WhatsApp"
            hint={`Quem recebeu áudio nos últimos ${periodDays} dias: ${audioStats.comAudio} pessoa(s).`}
            variant="emerald"
          >
            {audioStats.comAudio === 0 ? (
              <Empty text="Ninguém desta visão recebeu áudio neste período." />
            ) : (
              <DonutPanel
                centerTitle="com áudio"
                centerValue={audioStats.comAudio}
                segments={[
                  { key: "ok", label: "Escutou", value: audioStats.ok.length, color: CHART.ok, listKind: "audio_ok" },
                  { key: "nao", label: "Chegou e não escutou", value: audioStats.nao.length, color: CHART.warn, listKind: "audio_nao" },
                  { key: "sem", label: "Sem confirmação", value: audioStats.semConf.length, color: CHART.muted, listKind: "audio_sem_conf" },
                ]}
                onPick={(k) => setListKind(k)}
              />
            )}
            <p className="text-[11px] text-muted-foreground mt-3">
              Sem áudio no período: <strong>{audioStats.semAudio}</strong> de {people.length} pessoa(s) desta visão.
              {" "}Duração = tamanho do áudio. O WhatsApp confirma escuta com status <code className="text-[10px]">played</code> (não informa tempo parcial).
            </p>
          </Section>

          <Section
            icon={Video}
            title="Vídeo do WhatsApp"
            hint={`Quem recebeu vídeo nos últimos ${periodDays} dias: ${videoStats.comVideo} pessoa(s).`}
            variant="violet"
          >
            {videoStats.comVideo === 0 ? (
              <Empty text="Ninguém desta visão recebeu vídeo neste período." />
            ) : (
              <DonutPanel
                centerTitle="com vídeo"
                centerValue={videoStats.comVideo}
                segments={[
                  { key: "ok", label: "Assistiu", value: videoStats.ok.length, color: CHART.ok, listKind: "video_ok" },
                  { key: "nao", label: "Chegou e não assistiu", value: videoStats.nao.length, color: CHART.warn, listKind: "video_nao" },
                  { key: "sem", label: "Sem confirmação", value: videoStats.semConf.length, color: CHART.muted, listKind: "video_sem_conf" },
                ]}
                onPick={(k) => setListKind(k)}
              />
            )}
            <p className="text-[11px] text-muted-foreground mt-3">
              Sem vídeo no período: <strong>{videoStats.semVideo}</strong> de {people.length} pessoa(s) desta visão.
              {" "}Duração = tamanho do vídeo. Confirmação de visualização vem com status <code className="text-[10px]">read</code> no WhatsApp.
            </p>
          </Section>

          <Section
            icon={Eye}
            title="Abriu a mensagem?"
            hint={`Quem recebeu mensagem nos últimos ${periodDays} dias: ${readStats.comMsg} pessoa(s).`}
            variant="sky"
          >
            {readStats.comMsg === 0 ? (
              <Empty text="Ninguém desta visão recebeu mensagem neste período." />
            ) : (
              <DonutPanel
                centerTitle="com mensagem"
                centerValue={readStats.comMsg}
                segments={[
                  { key: "ok", label: "Abriu / leu", value: readStats.ok.length, color: CHART.ok, listKind: "leu" },
                  { key: "nao", label: "Chegou e não abriu", value: readStats.nao.length, color: CHART.warn, listKind: "nao_leu" },
                  { key: "sem", label: "Sem confirmação", value: readStats.semConf.length, color: CHART.muted, listKind: "sem_conf_leitura" },
                ]}
                onPick={(k) => setListKind(k)}
              />
            )}
          </Section>

          <div className="grid md:grid-cols-2 gap-4">
            <Section
              icon={Smartphone}
              title="SMS"
              hint={`${smsStats.pessoasComSms} pessoa(s) com SMS no período`}
              variant="cyan"
            >
              {smsStats.pessoasComSms === 0 ? (
                <Empty text="Nenhum SMS neste período." />
              ) : (
                <GaugePanel
                  rate={smsStats.pessoasComSms > 0 ? Math.round((smsStats.ok.length / smsStats.pessoasComSms) * 100) : 0}
                  rateLabel="chegaram"
                  left={{ label: "Chegou", value: smsStats.ok.length, color: CHART.sky, listKind: "sms_ok" }}
                  right={{ label: "Não chegou", value: smsStats.nao.length, color: CHART.bad, listKind: "sms_nao" }}
                  onPick={(k) => setListKind(k)}
                />
              )}
            </Section>

            <Section
              icon={Phone}
              title="Ligações"
              hint={`${callStats.pessoasComLigacao} pessoa(s) com ligação no período${callStats.avgListenSec ? ` · média ${formatDurationSec(callStats.avgListenSec)} no fone` : ""}`}
              variant="violet"
            >
              {callStats.pessoasComLigacao === 0 ? (
                <Empty text="Nenhuma ligação neste período." />
              ) : (
                <GaugePanel
                  rate={callStats.pessoasComLigacao > 0 ? Math.round((callStats.ok.length / callStats.pessoasComLigacao) * 100) : 0}
                  rateLabel="atenderam"
                  left={{ label: "Atendeu", value: callStats.ok.length, color: CHART.ok, listKind: "liga_ok" }}
                  right={{ label: "Não atendeu", value: callStats.nao.length, color: CHART.warn, listKind: "liga_nao" }}
                  onPick={(k) => setListKind(k)}
                />
              )}
            </Section>
          </div>

          {focus === "leads" && (
            <Section
              icon={Users}
              title="Passo a passo — Interessados (quadro)"
              hint={`${leadFunnel.reduce((s, r) => s + r.value, 0)} pessoa(s) no quadro — cada uma conta 1 vez.`}
              variant="emerald"
            >
              {leadFunnel.length === 0 ? (
                <Empty text="Nenhum interessado no quadro." />
              ) : (
                <FunnelChart
                  rows={leadFunnel}
                  total={leadCustomers.length || leadFunnel.reduce((s, r) => s + r.value, 0)}
                  onPick={(key) => {
                    setListStep(key);
                    setListKind("passo");
                  }}
                />
              )}
            </Section>
          )}

          {focus === "leads" && leadStepFunnel.length > 0 && (
            <Section
              icon={Volume2}
              title="Onde parou na conversa"
              hint="Passo atual do atendimento automático."
              variant="amber"
            >
              <FunnelChart
                rows={leadStepFunnel}
                total={leadCustomers.length || leadStepFunnel.reduce((s, r) => s + r.value, 0)}
                palette="warm"
                onPick={(key) => {
                  setListStep(key);
                  setListKind("passo");
                }}
              />
            </Section>
          )}

          {focus === "clientes" && (
            <Section
              icon={Users}
              title="Passo a passo — Clientes ativos"
              hint={`${clientCustomers.length} cliente(s) no total.`}
              variant="violet"
            >
              {clientFunnel.length === 0 ? (
                <Empty text="Nenhum cliente ativo nesta visão." />
              ) : (
                <FunnelChart
                  rows={clientFunnel}
                  total={clientCustomers.length}
                  palette="cool"
                  onPick={(key) => {
                    setListStep(key);
                    setListKind("passo");
                  }}
                />
              )}
            </Section>
          )}

          {listKind && (
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 bg-muted/30">
                <div className="flex items-center gap-2 min-w-0">
                  <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
                  <p className="text-sm font-semibold truncate">{listTitle}</p>
                  <Badge variant="secondary" className="text-[10px] tabular-nums">
                    {listPeople.length} pessoa(s)
                  </Badge>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => {
                    setListKind(null);
                    setListStep(null);
                  }}
                >
                  Fechar
                </Button>
              </div>
              <div className="max-h-[380px] overflow-y-auto divide-y divide-border/40">
                {listPeople.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-10">Ninguém neste filtro.</p>
                ) : (
                  listPeople.slice(0, 400).map((row) => (
                    <div key={`${row.id}-${row.when || ""}`} className="px-4 py-2.5 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{row.name}</p>
                        <p className="text-[11px] text-muted-foreground">{row.phone}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{row.detail}</p>
                        {row.durationSec ? (
                          <p className="text-[10px] text-primary/80 mt-0.5 tabular-nums">
                            Tempo: {formatDurationSec(row.durationSec)}
                          </p>
                        ) : null}
                      </div>
                      {row.when ? (
                        <time className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
                          {new Date(row.when).toLocaleString("pt-BR", {
                            day: "2-digit",
                            month: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </time>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
            <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            “Sem confirmação” = o WhatsApp ainda não avisou se a pessoa abriu/escutou/assistiu. Ligações mostram o tempo real no fone (Velip). Áudio e vídeo mostram a duração do arquivo — o WhatsApp não informa quantos segundos a pessoa ouviu/assistiu.
          </p>
        </>
      )}
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  hint,
  children,
  variant = "default",
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  hint?: string;
  children: React.ReactNode;
  variant?: "default" | "emerald" | "sky" | "cyan" | "violet" | "amber";
}) {
  const accents: Record<string, string> = {
    default: "from-primary/8 to-transparent border-border",
    emerald: "from-primary/10 via-primary/5 to-transparent border-primary/20",
    sky: "from-sky-500/10 via-sky-500/5 to-transparent border-sky-500/20",
    cyan: "from-cyan-500/10 via-cyan-500/5 to-transparent border-cyan-500/20",
    violet: "from-violet-500/10 via-violet-500/5 to-transparent border-violet-500/20",
    amber: "from-amber-500/10 via-amber-500/5 to-transparent border-amber-500/20",
  };
  return (
    <section className={`rounded-xl border bg-gradient-to-br p-4 sm:p-5 ${accents[variant]}`}>
      <div className="flex items-start gap-2 mb-4">
        <div className="w-8 h-8 rounded-lg bg-background/80 border border-border/50 flex items-center justify-center shrink-0">
          <Icon className="w-4 h-4 text-primary" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {hint ? <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

function StatCard({
  label,
  value,
  onClick,
  accent = "primary",
  active = false,
}: {
  label: string;
  value: number;
  onClick?: () => void;
  accent?: "primary" | "warn" | "sky" | "violet" | "default";
  active?: boolean;
}) {
  const styles = {
    primary: "border-primary/20 bg-primary/5",
    warn: "border-amber-500/20 bg-amber-500/5",
    sky: "border-sky-500/20 bg-sky-500/5",
    violet: "border-violet-500/20 bg-violet-500/5",
    default: "border-border bg-card",
  };
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`rounded-xl border p-4 text-left transition-colors ${styles[accent]} ${onClick ? "hover:border-primary/40 cursor-pointer" : ""} ${active ? "ring-2 ring-primary/40 border-primary/50" : ""}`}
    >
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-2xl sm:text-3xl font-bold tabular-nums text-foreground mt-1">{value}</p>
    </Tag>
  );
}

/** Rosca com legenda clicável — sem rótulos quebrados no gráfico */
function DonutPanel({
  segments,
  centerTitle,
  centerValue,
  onPick,
}: {
  segments: ChartSegment[];
  centerTitle: string;
  centerValue: number;
  onPick: (kind: ListKind) => void;
}) {
  const data = segments.filter((s) => s.value > 0);
  return (
    <div className="grid sm:grid-cols-[200px_1fr] gap-4 items-center">
      <div className="relative h-[200px] w-full max-w-[200px] mx-auto">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="label"
              cx="50%"
              cy="50%"
              innerRadius={58}
              outerRadius={78}
              paddingAngle={data.length > 1 ? 3 : 0}
              stroke="none"
              onClick={(_, i) => onPick(data[i].listKind)}
            >
              {data.map((s) => (
                <Cell key={s.key} fill={s.color} className="cursor-pointer outline-none" />
              ))}
            </Pie>
            <Tooltip
              formatter={(v: number) => [`${v} pessoa(s)`, ""]}
              contentStyle={{
                background: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 10,
                fontSize: 12,
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-3xl font-bold tabular-nums text-foreground">{centerValue}</span>
          <span className="text-[10px] text-muted-foreground text-center px-2">{centerTitle}</span>
        </div>
      </div>
      <div className="space-y-2">
        {segments.map((s) => (
          <LegendChip
            key={s.key}
            color={s.color}
            label={s.label}
            value={s.value}
            total={centerValue}
            onClick={() => onPick(s.listKind)}
          />
        ))}
      </div>
    </div>
  );
}

/** Rosca compacta — SMS e ligações */
function GaugePanel({
  rate,
  rateLabel,
  left,
  right,
  onPick,
}: {
  rate: number;
  rateLabel: string;
  left: { label: string; value: number; color: string; listKind: ListKind };
  right: { label: string; value: number; color: string; listKind: ListKind };
  onPick: (kind: ListKind) => void;
}) {
  const total = left.value + right.value;
  const segments: ChartSegment[] = [
    { key: "l", label: left.label, value: left.value, color: left.color, listKind: left.listKind },
    { key: "r", label: right.label, value: right.value, color: right.color, listKind: right.listKind },
  ];

  return (
    <div className="space-y-3">
      <div className="relative h-[150px] w-full max-w-[150px] mx-auto">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={segments.filter((s) => s.value > 0)}
              dataKey="value"
              nameKey="label"
              cx="50%"
              cy="50%"
              innerRadius={44}
              outerRadius={58}
              paddingAngle={segments.filter((s) => s.value > 0).length > 1 ? 4 : 0}
              stroke="none"
              onClick={(_, i) => onPick(segments.filter((s) => s.value > 0)[i].listKind)}
            >
              {segments.filter((s) => s.value > 0).map((s) => (
                <Cell key={s.key} fill={s.color} className="cursor-pointer" />
              ))}
            </Pie>
            <Tooltip
              formatter={(v: number) => [`${v} pessoa(s)`, ""]}
              contentStyle={{
                background: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 10,
                fontSize: 12,
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-xl font-bold tabular-nums text-foreground">{rate}%</span>
          <span className="text-[9px] text-muted-foreground text-center px-1">{rateLabel}</span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 w-full">
        <LegendChip color={left.color} label={left.label} value={left.value} total={total} onClick={() => onPick(left.listKind)} />
        <LegendChip color={right.color} label={right.label} value={right.value} total={total} onClick={() => onPick(right.listKind)} />
      </div>
    </div>
  );
}

/** Barras horizontais coloridas — funil passo a passo */
function FunnelChart({
  rows,
  total,
  onPick,
  palette = "default",
}: {
  rows: FunnelRow[];
  total: number;
  onPick: (key: string) => void;
  palette?: "default" | "warm" | "cool";
}) {
  const warm = [CHART.warn, CHART.bad, "hsl(25, 85%, 55%)", CHART.violet, CHART.teal];
  const cool = [CHART.sky, CHART.violet, CHART.teal, CHART.ok, CHART.muted];
  const colors = palette === "warm" ? warm : palette === "cool" ? cool : FUNNEL_PALETTE;
  const height = Math.min(480, Math.max(200, rows.length * 42));

  return (
    <div className="space-y-3">
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={rows} layout="vertical" margin={{ left: 4, right: 12, top: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
          <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
          <YAxis
            type="category"
            dataKey="name"
            width={155}
            tick={{ fontSize: 11, fill: "hsl(var(--foreground))" }}
            tickFormatter={(v: string) => (v.length > 22 ? `${v.slice(0, 20)}…` : v)}
          />
          <Tooltip
            formatter={(v: number) => [`${v} pessoa(s)`, "Total"]}
            contentStyle={{
              background: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: 10,
              fontSize: 12,
            }}
          />
          <Bar
            dataKey="value"
            radius={[0, 8, 8, 0]}
            cursor="pointer"
            onClick={(d: FunnelRow) => onPick(d.key)}
          >
            {rows.map((row, i) => (
              <Cell key={row.key} fill={colors[i % colors.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap gap-2">
        {rows.slice(0, 8).map((row, i) => (
          <button
            key={row.key}
            type="button"
            onClick={() => onPick(row.key)}
            className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/60 px-2.5 py-1 text-[10px] hover:border-primary/40 transition-colors"
          >
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: colors[i % colors.length] }} />
            <span className="truncate max-w-[120px]">{row.name}</span>
            <span className="font-semibold tabular-nums">{row.value}</span>
          </button>
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground text-right">
        Base: {total} pessoa(s) · clique na barra ou na etiqueta para ver a lista
      </p>
    </div>
  );
}

function LegendChip({
  color,
  label,
  value,
  total,
  onClick,
}: {
  color: string;
  label: string;
  value: number;
  total: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-2 rounded-lg border border-border/50 bg-background/50 hover:border-primary/30 hover:bg-primary/5 px-3 py-2 text-left transition-colors"
    >
      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
      <span className="text-xs text-foreground flex-1 truncate">{label}</span>
      <span className="text-xs font-semibold tabular-nums shrink-0">
        {value}
        <span className="text-muted-foreground font-normal"> · {pct(value, total)}</span>
      </span>
    </button>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-sm text-muted-foreground py-8 text-center">{text}</p>;
}
