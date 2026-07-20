/**
 * Wizard de campanha de ligação — padrão Disparo automático:
 * Contatos → Mensagem → Revisar → Acompanhar (poll ao vivo).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Loader2,
  Mic,
  Square,
  Upload,
  Phone,
  Pause,
  Play,
  XCircle,
  Check,
  AudioLines,
  Users,
  MessageSquare,
  ClipboardCheck,
  Activity,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Clock,
  CircleDot,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { uploadMedia } from "@/services/minioUpload";
import { loadOpusRecorder } from "@/lib/opusRecorderLoader";
import { decodeAudioBlob, encodeMp3 } from "@/lib/audioProcessing";
import {
  MODEL_V3,
  prepareTtsSegment,
  voiceSettingsForModel,
} from "@/lib/ttsEnhanceV3";
import type { BulkContact } from "@/types/whatsapp";
import { BRASILIA_TZ, brasiliaWallToUtcIso, inBrasiliaCallWindow, nowBrasiliaHm } from "@/lib/brasiliaTime";
import {
  estimateCampaignCost,
  formatBrl,
  VOICE_PRICE_FULL,
  VOICE_PRICE_HALF,
} from "@/lib/voiceCallCost";
import { VozContactPickerPanel, type VozCustomer } from "./VozContactPickerDialog";
import { crmClosingSummary, resolveCrmByPhoneOrId, statusCrmLabel } from "./voiceCrmContext";
import { velipOutcomeLabel } from "./voiceOutcomeLabels";

type PipelineStepState = "done" | "active" | "pending" | "blocked";

type PipelineStep = {
  id: string;
  label: string;
  detail: string;
  state: PipelineStepState;
};

function targetStatusLabel(status: string, velipStatus?: string | null): string {
  if (velipStatus) return velipOutcomeLabel(velipStatus);
  return (
    {
      queued: "Na fila",
      pending: "Na fila",
      dialing: "Ligando agora",
      ringing: "Tocando",
      answered: "Atendeu",
      completed: "Concluído",
      no_answer: "Não atendeu",
      busy: "Ocupado",
      machine: "Caixa postal",
      failed: "Falhou",
      canceled: "Cancelado",
      cancelled: "Cancelado",
    }[status] || status
  );
}

/** Voz Sofia (ElevenLabs) — mesma do Estúdio. */
const VOICE_SOFIA = "EJV7H2baGt5ab95tOoSG";
const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || "https://zlzasfhcxcznaprrragl.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsemFzZmhjeGN6bmFwcnJyYWdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzQ1NzAsImV4cCI6MjA4Njg1MDU3MH0.OJzRdi_Z_1TFZjQXmK8rJofBeHVZc27VSo2vMMw9Spo";

const DEFAULT_SOFIA_BODY =
  "Aqui é da iGreen Energia. Queria falar rapidinho sobre a economia na sua conta de luz. Pode me retornar no WhatsApp quando puder?";

type VelipMode = "auto" | "single" | "batch";
type WizardStep = 1 | 2 | 3 | 4;

interface ClipRow {
  id: string;
  name: string;
  audio_url: string;
  duration_sec: number | null;
  created_at: string;
}

interface CampaignRow {
  id: string;
  name: string;
  status: string;
  total: number;
  dialed: number;
  answered: number;
  failed: number;
  scheduled_at: string | null;
  created_at: string;
  velip_mode: string | null;
  velip_campaign_id: string | null;
  audio_clip_id?: string | null;
  config?: {
    personalize_name?: boolean;
    timezone?: string;
    windowStart?: string;
    windowEnd?: string;
    weekdaysOnly?: boolean;
  } | null;
}

type PrewarmStats = {
  ready: number;
  total: number;
  remaining: number;
  created: number;
  failed: number;
  done: boolean;
  error?: string | null;
  skippedNoName?: number;
};

interface TargetRow {
  id: string;
  phone: string;
  name: string | null;
  status: string;
  error: string | null;
  attempts: number;
  velip_status?: string | null;
}

const STEPS: { n: WizardStep; label: string; icon: typeof Users }[] = [
  { n: 1, label: "Contatos", icon: Users },
  { n: 2, label: "Mensagem", icon: MessageSquare },
  { n: 3, label: "Revisar", icon: ClipboardCheck },
  { n: 4, label: "Acompanhar", icon: Activity },
];

const TERMINAL = new Set(["done", "canceled", "cancelled", "failed", "completed"]);

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  consultantId: string;
  customers: VozCustomer[];
  /** Abrir direto no acompanhamento desta campanha. */
  monitorCampaignId?: string | null;
  onCampaignsChanged?: () => void;
}

export function VoiceCampaignWizardDialog({
  open,
  onOpenChange,
  consultantId,
  customers,
  monitorCampaignId = null,
  onCampaignsChanged,
}: Props) {
  const [step, setStep] = useState<WizardStep>(1);
  const [contacts, setContacts] = useState<BulkContact[]>([]);
  const [clips, setClips] = useState<ClipRow[]>([]);
  const [clipId, setClipId] = useState("");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [clipName, setClipName] = useState("Mensagem de 20s");
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recSec, setRecSec] = useState(0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [recorder, setRecorder] = useState<any>(null);
  const [sofiaBodyText, setSofiaBodyText] = useState(DEFAULT_SOFIA_BODY);
  const [generatingSofia, setGeneratingSofia] = useState(false);
  const [prewarmStats, setPrewarmStats] = useState<PrewarmStats | null>(null);
  const prewarmBusyRef = useRef(false);

  const [campaignName, setCampaignName] = useState("Campanha de ligação");
  const [callerId, setCallerId] = useState("");
  const [maxAttempts, setMaxAttempts] = useState(2);
  const [smsFallback, setSmsFallback] = useState("");
  const [velipMode, setVelipMode] = useState<VelipMode>("auto");
  const [scheduledAt, setScheduledAt] = useState("");
  const [windowStart, setWindowStart] = useState("09:00");
  const [windowEnd, setWindowEnd] = useState("18:00");
  const [weekdaysOnly, setWeekdaysOnly] = useState(true);
  const [personalizeName, setPersonalizeName] = useState(true);
  const [prewarming, setPrewarming] = useState(false);
  const [busy, setBusy] = useState(false);

  const [activeCampaignId, setActiveCampaignId] = useState<string | null>(null);
  const [campaign, setCampaign] = useState<CampaignRow | null>(null);
  const [targets, setTargets] = useState<TargetRow[]>([]);
  const [filterStatus, setFilterStatus] = useState<"all" | "answered" | "failed" | "queued">("all");
  const [cronCountdownSec, setCronCountdownSec] = useState(0);
  /** Duração medida do áudio (s) quando o clip não tem duration_sec. */
  const [probedDurationSec, setProbedDurationSec] = useState<number | null>(null);
  const autoPickedClip = useRef(false);

  const resetDraft = useCallback(() => {
    setStep(1);
    setContacts([]);
    setCampaignName("Campanha de ligação");
    setSmsFallback("");
    setVelipMode("auto");
    setScheduledAt("");
    setWindowStart("09:00");
    setWindowEnd("18:00");
    setWeekdaysOnly(true);
    setPersonalizeName(true);
    setActiveCampaignId(null);
    setCampaign(null);
    setTargets([]);
    setFilterStatus("all");
    setSofiaBodyText(DEFAULT_SOFIA_BODY);
    setPrewarmStats(null);
    autoPickedClip.current = false;
  }, []);

  useEffect(() => {
    if (!open) return;
    if (monitorCampaignId) {
      setActiveCampaignId(monitorCampaignId);
      setStep(4);
    } else {
      resetDraft();
    }
  }, [open, monitorCampaignId, resetDraft]);

  const loadClips = useCallback(async () => {
    const { data } = await (supabase as any)
      .from("voice_audio_clips")
      .select("id, name, audio_url, duration_sec, created_at")
      .eq("consultant_id", consultantId)
      .order("created_at", { ascending: false })
      .limit(20);
    setClips((data as ClipRow[]) ?? []);
  }, [consultantId]);

  useEffect(() => {
    if (!open) return;
    void loadClips();
  }, [open, loadClips]);

  useEffect(() => {
    if (autoPickedClip.current || clips.length === 0) return;
    // Não roubar o clipe da campanha em acompanhamento.
    if (monitorCampaignId || step === 4 || activeCampaignId) return;
    autoPickedClip.current = true;
    if (!clipId) {
      setClipId(clips[0].id);
      setAudioUrl(clips[0].audio_url);
    }
  }, [clips, clipId, monitorCampaignId, step, activeCampaignId]);

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setRecSec((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);

  const refreshMonitor = useCallback(async (campaignId: string) => {
    const [{ data: camp }, { data: tgs }] = await Promise.all([
      (supabase as any)
        .from("voice_campaigns")
        .select("id, name, status, total, dialed, answered, failed, scheduled_at, created_at, velip_mode, velip_campaign_id, audio_clip_id, config")
        .eq("id", campaignId)
        .maybeSingle(),
      (supabase as any)
        .from("voice_campaign_targets")
        .select("id, phone, name, status, error, attempts, velip_status")
        .eq("campaign_id", campaignId)
        .order("created_at", { ascending: true })
        .limit(500),
    ]);
    if (camp) {
      const row = camp as CampaignRow;
      setCampaign(row);
      // Sempre alinha ao clipe da campanha (evita pegar o 1º da biblioteca).
      if (row.audio_clip_id) setClipId(row.audio_clip_id);
      if (row.config?.personalize_name != null) setPersonalizeName(!!row.config.personalize_name);
    }
    setTargets((tgs as TargetRow[]) ?? []);
  }, []);

  /** Gera à frente os áudios “Olá, Nome! Tudo bem?” + corpo (ElevenLabs) até zerar a fila. */
  const runPrewarmBatch = useCallback(
    async (campaignId: string, bodyClipId: string): Promise<PrewarmStats | null> => {
      const { data, error } = await supabase.functions.invoke("voice-call-stitch", {
        body: {
          action: "prewarm",
          body_clip_id: bodyClipId,
          campaign_id: campaignId,
          limit: 25,
        },
      });
      if (error) {
        // non-2xx: tenta ler corpo
        let detail = error.message;
        try {
          const ctx = (error as { context?: Response })?.context;
          if (ctx && typeof ctx.json === "function") {
            const body = (await ctx.json()) as { error?: string; message?: string };
            detail = body.message || body.error || detail;
          }
        } catch { /* ignore */ }
        throw new Error(detail);
      }
      if (!data || typeof data !== "object") {
        throw new Error("Resposta vazia do pré-aquecimento");
      }
      if ((data as { error?: string })?.error) {
        throw new Error(String((data as { error: string }).error));
      }
      const d = data as {
        ready?: number;
        total_unique?: number;
        remaining?: number;
        created?: number;
        failed?: number;
        done?: boolean;
        already_cached?: number;
        skipped_no_name?: number;
      };
      const total = Number(d.total_unique ?? 0);
      const remaining = Number(d.remaining ?? 0);
      const ready = Number(
        d.ready ?? Math.max(0, total - remaining),
      );
      // Nunca tratar 0/0 como “pronto” — isso travava a barra.
      const done = remaining === 0 && total > 0;
      const stats: PrewarmStats = {
        ready,
        total,
        remaining,
        created: Number(d.created ?? 0),
        failed: Number(d.failed ?? 0),
        skippedNoName: Number(d.skipped_no_name ?? 0),
        done,
        error: total === 0 ? "Nenhum nome utilizável na fila (verifique clip e contatos)" : null,
      };
      setPrewarmStats(stats);
      return stats;
    },
    [],
  );

  // Enquanto acompanha: pré-aquece em loop (inteligente) até todos os nomes terem áudio.
  useEffect(() => {
    if (!open || step !== 4 || !activeCampaignId) return;
    // Sempre o clipe da campanha (não o 1º da biblioteca).
    const bodyClip = String(campaign?.audio_clip_id || clipId || "").trim();
    const wantsPersonalize = personalizeName || !!campaign?.config?.personalize_name;
    if (!bodyClip || !wantsPersonalize) return;
    if (campaign && TERMINAL.has(campaign.status)) return;
    if (prewarmStats?.done) return;

    let alive = true;
    const tick = async () => {
      if (!alive || prewarmBusyRef.current) return;
      prewarmBusyRef.current = true;
      setPrewarming(true);
      try {
        const stats = await runPrewarmBatch(activeCampaignId, bodyClip);
        if (!alive) return;
        if (stats?.done) {
          setPrewarming(false);
          return;
        }
        // Continua mesmo se total ainda 0 (clip/campanha carregando) — retry.
        setTimeout(() => {
          void tick();
        }, stats && stats.total > 0 ? 800 : 2500);
      } catch (e) {
        console.warn("[wizard] prewarm loop:", e);
        if (alive) {
          setPrewarmStats((prev) => ({
            ready: prev?.ready ?? 0,
            total: prev?.total ?? 0,
            remaining: prev?.remaining ?? 0,
            created: prev?.created ?? 0,
            failed: (prev?.failed ?? 0) + 1,
            done: false,
            error: (e as Error)?.message || "Falha ao gerar áudios",
          }));
          setTimeout(() => {
            void tick();
          }, 8_000);
        }
      } finally {
        prewarmBusyRef.current = false;
      }
    };
    void tick();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    open,
    step,
    activeCampaignId,
    campaign?.audio_clip_id,
    campaign?.status,
    campaign?.config?.personalize_name,
    clipId,
    personalizeName,
    runPrewarmBatch,
    prewarmStats?.done,
  ]);

  useEffect(() => {
    if (!open || step !== 4 || !activeCampaignId) return;
    let alive = true;
    const tick = async () => {
      await refreshMonitor(activeCampaignId);
      if (!alive) return;
    };
    void tick();
    const id = setInterval(() => {
      void tick();
    }, 4000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [open, step, activeCampaignId, refreshMonitor]);

  // Contagem regressiva até o próximo tick do cron (*/5 min: :00, :05, :10…).
  useEffect(() => {
    if (!open || step !== 4) return;
    const calc = () => {
      const now = Date.now();
      const period = 5 * 60_000;
      const next = Math.ceil(now / period) * period;
      setCronCountdownSec(Math.max(0, Math.ceil((next - now) / 1000)));
    };
    calc();
    const id = setInterval(calc, 1000);
    return () => clearInterval(id);
  }, [open, step]);

  // Mede duração do áudio selecionado (necessário p/ custo — muitos clips vêm sem duration_sec).
  useEffect(() => {
    const url = audioUrl?.trim();
    if (!url) {
      setProbedDurationSec(null);
      return;
    }
    const fromClip = clips.find((c) => c.id === clipId)?.duration_sec;
    if (fromClip && fromClip > 0) {
      setProbedDurationSec(fromClip);
      return;
    }
    let cancelled = false;
    const audio = new Audio();
    audio.preload = "metadata";
    const onMeta = () => {
      if (cancelled) return;
      const d = Number(audio.duration);
      if (Number.isFinite(d) && d > 0) setProbedDurationSec(Math.round(d * 10) / 10);
    };
    audio.addEventListener("loadedmetadata", onMeta);
    audio.src = url;
    return () => {
      cancelled = true;
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.src = "";
    };
  }, [audioUrl, clipId, clips]);

  const persistClip = async (
    url: string,
    durationHint?: number,
    meta?: { voice_id?: string; model_id?: string; is_call_body?: boolean; name?: string },
  ) => {
    const { data, error } = await (supabase as any)
      .from("voice_audio_clips")
      .insert({
        consultant_id: consultantId,
        name: meta?.name?.trim() || clipName.trim() || "Clipe de voz",
        audio_url: url,
        duration_sec: durationHint ?? null,
        voice_id: meta?.voice_id ?? null,
        model_id: meta?.model_id ?? null,
        is_call_body: meta?.is_call_body ?? false,
      })
      .select("id, name, audio_url, duration_sec, created_at")
      .single();
    if (error) throw new Error(error.message);
    setAudioUrl(url);
    setClipId(data.id);
    if (meta?.name?.trim()) setClipName(meta.name.trim());
    await loadClips();
    toast.success(meta?.is_call_body ? "Corpo Sofia salvo — pronto para ligar" : "Clipe salvo");
  };

  /** Gera na hora: Sofia + eleven_v3 com pontuação corrigida (corpo fixo, sem nome). */
  const generateSofiaNow = async () => {
    const raw = sofiaBodyText.trim();
    if (raw.length < 8) {
      toast.error("Digite o texto do corpo (mín. 8 caracteres)");
      return;
    }
    setGeneratingSofia(true);
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) throw new Error("Sessão expirada. Faça login novamente.");

      // edgePad: corrige pontos/reticências e dá respiro no início/fim (melhor no v3).
      const prepared = prepareTtsSegment(raw, MODEL_V3, { edgePad: true });
      toast.message("Gerando Sofia (v3)…");

      const res = await fetch(`${SUPABASE_URL}/functions/v1/tts-proxy`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          text: prepared,
          voice_id: VOICE_SOFIA,
          model_id: MODEL_V3,
          voice_settings: voiceSettingsForModel(MODEL_V3),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error || `Geração Sofia falhou (${res.status})`);
      }
      const blob = await res.blob();
      const file = new File([blob], `sofia-corpo-${Date.now()}.mp3`, { type: "audio/mpeg" });
      let durationHint: number | undefined;
      try {
        const buf = await decodeAudioBlob(file);
        durationHint = Math.round(buf.duration * 10) / 10;
      } catch { /* ignore */ }
      const up = await uploadMedia(file, undefined, {
        scope: "admin",
        consultant_id: consultantId,
        kind: "audio",
        slug: "sofia-call-body",
      });
      const label =
        clipName.trim() && clipName.trim() !== "Mensagem de 20s"
          ? clipName.trim()
          : `Sofia corpo · ${new Date().toLocaleString("pt-BR")}`;
      await persistClip(up.url, durationHint, {
        voice_id: VOICE_SOFIA,
        model_id: MODEL_V3,
        is_call_body: true,
        name: label,
      });
      if (durationHint) setProbedDurationSec(durationHint);
    } catch (e) {
      toast.error((e as Error)?.message || "Falha ao gerar Sofia");
    } finally {
      setGeneratingSofia(false);
    }
  };

  const toPstnAudioFile = async (file: File): Promise<File> => {
    const name = file.name.toLowerCase();
    const type = (file.type || "").toLowerCase();
    if (
      type.includes("mpeg") ||
      type.includes("mp3") ||
      type.includes("wav") ||
      name.endsWith(".mp3") ||
      name.endsWith(".wav")
    ) {
      return file;
    }
    const buffer = await decodeAudioBlob(file);
    const mp3 = await encodeMp3(buffer, 128);
    return new File([mp3], `pstn-${Date.now()}.mp3`, { type: "audio/mpeg" });
  };

  const handleUploadFile = async (file: File) => {
    setUploading(true);
    try {
      const pstnFile = await toPstnAudioFile(file);
      const res = await uploadMedia(pstnFile, undefined, {
        scope: "admin",
        consultant_id: consultantId,
        kind: "audio",
        slug: "voz-pstn",
      });
      await persistClip(res.url, recSec || undefined);
    } catch (e) {
      toast.error((e as Error)?.message || "Falha no upload");
    } finally {
      setUploading(false);
    }
  };

  const startRec = async () => {
    try {
      const Recorder = await loadOpusRecorder();
      const rec = new Recorder({
        encoderPath: "/opus/encoderWorker.min.js",
        encoderApplication: 2048,
        encoderSampleRate: 16000,
        encoderFrameSize: 20,
        numberOfChannels: 1,
        streamPages: false,
        rawOpus: false,
      });
      rec.ondataavailable = async (buf: ArrayBuffer) => {
        const blob = new Blob([buf], { type: "audio/ogg; codecs=opus" });
        const file = new File([blob], `pstn-${Date.now()}.ogg`, { type: "audio/ogg" });
        await handleUploadFile(file);
      };
      await rec.start();
      setRecorder(rec);
      setRecording(true);
      setRecSec(0);
    } catch {
      toast.error("Não foi possível gravar. Verifique o microfone.");
    }
  };

  const stopRec = () => {
    try {
      recorder?.stop();
    } catch { /* ignore */ }
    setRecording(false);
    setRecorder(null);
  };

  const invokeEnqueue = async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("voice-dialer-enqueue", { body });
    if (error) throw new Error(error.message);
    if (data?.error) {
      const msg = data.message || data.detail || data.error;
      throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
    }
    return data;
  };

  const canNextFrom1 = contacts.length > 0;
  const canNextFrom2 = !!(audioUrl || clipId);

  const createCampaign = async () => {
    if (!canNextFrom1 || !canNextFrom2) return;
    setBusy(true);
    try {
      const phones = contacts.map((c) => ({
        phone: c.phone,
        name: c.name,
        customer_id: c.source === "database" ? c.id : null,
      }));
      const scheduledIso = scheduledAt.trim()
        ? brasiliaWallToUtcIso(scheduledAt.trim())
        : null;
      if (scheduledAt.trim() && !scheduledIso) {
        toast.error("Data/hora de agendamento inválida (use horário de Brasília)");
        setBusy(false);
        return;
      }
      const enqueueBody: Record<string, unknown> = {
        action: "create_campaign",
        campaign_name: campaignName.trim() || "Campanha de ligação",
        audio_clip_id: clipId || null,
        audio_url: audioUrl,
        dispatch_kind: "audio",
        tts_text: null,
        caller_id: callerId.trim() || null,
        max_attempts: maxAttempts,
        sms_on_no_answer_text: smsFallback.trim() || null,
        phones,
        scheduled_at: scheduledIso,
        config: {
          windowStart,
          windowEnd,
          weekdaysOnly,
          leaveVoicemail: false,
          personalize_name: personalizeName,
          sofia_only: true,
          timezone: BRASILIA_TZ,
        },
      };
      if (velipMode !== "auto") enqueueBody.velip_mode = velipMode;
      // Personalização por nome força single no enqueue
      if (personalizeName) enqueueBody.velip_mode = "single";
      const data = await invokeEnqueue(enqueueBody);
      const cid = data.campaign_id as string;
      setActiveCampaignId(cid);
      setPrewarmStats(null);
      setStep(4);
      toast.success(
        `Campanha criada com ${data.total} contato${Number(data.total) === 1 ? "" : "s"}.` +
          (personalizeName
            ? " Gerando áudios Sofia (Olá + nome) em segundo plano…"
            : " Acompanhe na lista abaixo."),
      );
      onCampaignsChanged?.();
      await refreshMonitor(cid);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const controlCampaign = async (action: "pause" | "resume" | "cancel") => {
    if (!activeCampaignId) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("voice-campaign-control", {
        body: { campaign_id: activeCampaignId, action },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      toast.success(`Campanha ${action === "pause" ? "pausada" : action === "resume" ? "retomada" : "cancelada"}`);
      await refreshMonitor(activeCampaignId);
      onCampaignsChanged?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const runNow = async () => {
    if (!activeCampaignId) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("voice-dialer-enqueue", {
        body: { action: "run_now", campaign_id: activeCampaignId },
      });
      if (error) {
        let detail = error.message;
        try {
          const ctx = (error as { context?: Response })?.context;
          if (ctx && typeof ctx.json === "function") {
            const body = (await ctx.json()) as { error?: string; message?: string };
            detail = body.message || body.error || detail;
          }
        } catch { /* ignore */ }
        throw new Error(detail);
      }
      if (data?.error) throw new Error(data.message || data.error);
      toast.success(data?.message || "Disparo iniciado");
      await refreshMonitor(activeCampaignId);
      onCampaignsChanged?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const filteredTargets = targets.filter((t) => {
    if (filterStatus === "all") return true;
    if (filterStatus === "answered") return t.status === "answered" || t.status === "completed";
    if (filterStatus === "failed") {
      return ["failed", "busy", "no_answer", "machine", "canceled"].includes(t.status);
    }
    return t.status === "queued" || t.status === "pending" || t.status === "dialing" || t.status === "ringing";
  });

  const isBatch = campaign?.velip_mode === "batch" && !!campaign?.velip_campaign_id;
  const canPause = isBatch && campaign?.status === "running";
  const canResume = isBatch && campaign?.status === "paused";
  const canCancel =
    isBatch &&
    (campaign?.status === "running" || campaign?.status === "paused" || campaign?.status === "scheduled");
  const progressPct = campaign?.total
    ? Math.round(((campaign.dialed || 0) / campaign.total) * 100)
    : 0;
  const isTerminal = campaign ? TERMINAL.has(campaign.status) : false;

  const wantsPersonalize = !!(personalizeName || campaign?.config?.personalize_name);
  const prewarmDone = !wantsPersonalize || !!prewarmStats?.done;
  // Só “gerando” com evidência: loop ativo ou stats conhecidos incompletos (não null).
  const prewarmBusy =
    wantsPersonalize &&
    !prewarmDone &&
    (prewarming || (prewarmStats != null && !prewarmStats.done));

  const countBy = {
    queued: targets.filter((t) => ["queued", "pending"].includes(t.status)).length,
    dialing: targets.filter((t) => ["dialing", "ringing"].includes(t.status)).length,
    answered: targets.filter((t) => ["answered", "completed"].includes(t.status)).length,
    failed: targets.filter((t) =>
      ["failed", "busy", "no_answer", "machine", "canceled", "cancelled"].includes(t.status),
    ).length,
  };
  const canRunNow =
    !!activeCampaignId &&
    !isTerminal &&
    !isBatch &&
    !prewarmBusy &&
    countBy.queued > 0 &&
    campaign?.status !== "paused";
  const nowDialing = targets.find((t) => t.status === "dialing" || t.status === "ringing") ?? null;
  const scheduledAtIso = campaign?.scheduled_at ? Date.parse(campaign.scheduled_at) : NaN;
  const waitingSchedule = Number.isFinite(scheduledAtIso) && scheduledAtIso > Date.now();
  const insideWindow = inBrasiliaCallWindow(campaign?.config ?? null);
  const windowLabel = `${campaign?.config?.windowStart || "09:00"}–${campaign?.config?.windowEnd || "18:00"}`;
  const modeSingle = campaign?.velip_mode === "single" || (!isBatch && campaign?.velip_mode !== "batch");

  const bodyDurationSec =
    probedDurationSec ??
    clips.find((c) => c.id === clipId)?.duration_sec ??
    null;
  const costContacts =
    step === 4 && campaign?.total
      ? Math.max(countBy.queued, 0)
      : contacts.length;
  const costEstimate = estimateCampaignCost({
    contacts: step === 4 && campaign?.total ? campaign.total : contacts.length,
    bodyDurationSec,
    personalizeName: personalizeName || !!campaign?.config?.personalize_name,
    timeLimitSec: 60,
  });
  const costRemaining = estimateCampaignCost({
    contacts: costContacts,
    bodyDurationSec,
    personalizeName: personalizeName || !!campaign?.config?.personalize_name,
    timeLimitSec: 60,
  });

  const liveHeadline = (() => {
    if (!campaign) return { title: "Carregando campanha…", detail: "Buscando fila e status." };
    if (isTerminal) {
      return {
        title: "Campanha finalizada",
        detail: `${campaign.answered} atendidos · ${campaign.failed} falhas · ${campaign.dialed}/${campaign.total} discados`,
      };
    }
    if (campaign.status === "paused") {
      return { title: "Pausada", detail: "Nenhuma ligação nova até retomar." };
    }
    if (prewarmBusy) {
      const ready = prewarmStats?.ready ?? 0;
      const total = prewarmStats?.total ?? 0;
      return {
        title: "Etapa 1 — Gerando áudios Sofia",
        detail:
          total > 0
            ? `ElevenLabs: ${ready}/${total} prenomes prontos. Só depois disso o cron começa a ligar.`
            : "Preparando cache “Olá, Nome! Tudo bem?” + corpo…",
      };
    }
    if (waitingSchedule) {
      const when = new Date(scheduledAtIso).toLocaleString("pt-BR", {
        timeZone: BRASILIA_TZ,
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
      return {
        title: "Etapa 2 — Aguardando horário agendado",
        detail: `Disparo liberado a partir de ${when} (Brasília). Agora: ${nowBrasiliaHm()}.`,
      };
    }
    if (!insideWindow) {
      return {
        title: "Etapa 2 — Fora da janela de ligação",
        detail: `Janela ${windowLabel} (Brasília). Agora ${nowBrasiliaHm()} — o cron só discará dentro da janela.`,
      };
    }
    if (nowDialing) {
      return {
        title: "Etapa 3 — Ligando agora",
        detail: `${nowDialing.name || "Contato"} · ${nowDialing.phone} · ${targetStatusLabel(nowDialing.status, nowDialing.velip_status)}`,
      };
    }
    if (countBy.dialing === 0 && countBy.queued > 0 && (campaign.dialed || 0) === 0) {
      const mm = String(Math.floor(cronCountdownSec / 60)).padStart(1, "0");
      const ss = String(cronCountdownSec % 60).padStart(2, "0");
      return {
        title: modeSingle
          ? "Etapa 3 — Na fila (1 a 1)"
          : "Etapa 3 — Na fila (lote)",
        detail: modeSingle
          ? `Áudios ok · ${countBy.queued} na fila. Próximo ciclo do cron em ${mm}:${ss} (até ~40 lig./ciclo) — ou use “Iniciar agora” (até 50).`
          : `Áudios ok · ${countBy.queued} na fila. Lote iGreen Fone discando do lado da operadora (até 100/min).`,
      };
    }
    if (countBy.queued > 0) {
      const mm = String(Math.floor(cronCountdownSec / 60));
      const ss = String(cronCountdownSec % 60).padStart(2, "0");
      return {
        title: "Etapa 3 — Discando a fila",
        detail: `${campaign.dialed}/${campaign.total} discados · ${countBy.queued} na fila · próximo ciclo em ${mm}:${ss}`,
      };
    }
    return {
      title: "Processando retornos",
      detail: "Fila zerada — consolidando atendidos e falhas.",
    };
  })();

  const pipelineSteps: PipelineStep[] = (() => {
    const steps: PipelineStep[] = [];

    steps.push({
      id: "fila",
      label: "Fila criada",
      detail: `${campaign?.total ?? targets.length} contatos prontos`,
      state: (campaign?.total ?? targets.length) > 0 ? "done" : "pending",
    });

    if (wantsPersonalize) {
      const ready = prewarmStats?.ready ?? 0;
      const total = prewarmStats?.total ?? 0;
      steps.push({
        id: "audios",
        label: "Áudios Sofia",
        detail: prewarmDone
          ? `Prontos ${ready}/${total || ready}`
          : prewarmStats == null
            ? "Verificando cache…"
            : total > 0
              ? `Gerando ${ready}/${total}`
              : "Gerando…",
        state: prewarmDone ? "done" : "active",
      });
    } else {
      steps.push({
        id: "audios",
        label: "Áudio único",
        detail: "Mesmo corpo para todos",
        state: "done",
      });
    }

    let scheduleState: PipelineStepState = "pending";
    let scheduleDetail = `Janela ${windowLabel}`;
    if (isTerminal) {
      scheduleState = "done";
      scheduleDetail = "Janela cumprida";
    } else if (!prewarmDone) {
      scheduleState = "pending";
      scheduleDetail = "Depois dos áudios";
    } else if (waitingSchedule) {
      scheduleState = "active";
      scheduleDetail = "Aguardando horário agendado";
    } else if (!insideWindow) {
      scheduleState = "blocked";
      scheduleDetail = `Fora da janela · agora ${nowBrasiliaHm()}`;
    } else {
      scheduleState = "done";
      scheduleDetail = `Dentro da janela · ${nowBrasiliaHm()}`;
    }
    steps.push({
      id: "janela",
      label: "Horário (Brasília)",
      detail: scheduleDetail,
      state: scheduleState,
    });

    let dialState: PipelineStepState = "pending";
    let dialDetail = modeSingle ? "Cron 1 a 1 (~5 min)" : "Lote iGreen Fone";
    if (isTerminal) {
      dialState = "done";
      dialDetail = `${campaign?.dialed ?? 0} discados`;
    } else if (!prewarmDone || waitingSchedule || !insideWindow || campaign?.status === "paused") {
      dialState = "pending";
      dialDetail = !prewarmDone
        ? "Esperando áudios"
        : waitingSchedule
          ? "Esperando agendamento"
          : !insideWindow
            ? "Esperando janela"
            : "Pausada";
    } else if (nowDialing || countBy.dialing > 0) {
      dialState = "active";
      dialDetail = nowDialing
        ? `Ligando: ${nowDialing.name || nowDialing.phone}`
        : `${countBy.dialing} em curso`;
    } else if ((campaign?.dialed || 0) > 0 && countBy.queued > 0) {
      dialState = "active";
      dialDetail = `${campaign?.dialed}/${campaign?.total} · restam ${countBy.queued}`;
    } else if (countBy.queued > 0) {
      dialState = "active";
      const mm = String(Math.floor(cronCountdownSec / 60));
      const ss = String(cronCountdownSec % 60).padStart(2, "0");
      dialDetail = modeSingle
        ? `${countBy.queued} na fila · próximo em ${mm}:${ss}`
        : `${countBy.queued} na fila do lote`;
    } else {
      dialState = "done";
      dialDetail = "Fila esgotada";
    }
    steps.push({
      id: "ligar",
      label: "Ligações",
      detail: dialDetail,
      state: dialState,
    });

    steps.push({
      id: "resultado",
      label: "Resultado",
      detail: `${countBy.answered} atendidos · ${countBy.failed} falhas`,
      state: isTerminal
        ? "done"
        : countBy.answered + countBy.failed > 0
          ? "active"
          : "pending",
    });

    return steps;
  })();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="painel-elite max-w-4xl max-h-[90vh] overflow-hidden flex flex-col p-0 gap-0">
        <DialogHeader className="px-5 pt-5 pb-4 border-b" style={{ borderColor: "var(--pe-border)", background: "var(--pe-surface-muted)" }}>
          <DialogTitle className="flex items-center gap-2" style={{ color: "var(--pe-text)" }}>
            <Phone className="w-4 h-4" style={{ color: "var(--pe-emerald)" }} />
            Campanha de ligação
          </DialogTitle>
          <DialogDescription>
            Monte a campanha em passos e acompanhe as ligações ao vivo — igual ao disparo automático.
          </DialogDescription>

          <div className="mt-4 flex items-center justify-between max-w-2xl mx-auto relative w-full">
            <div className="absolute top-4 left-0 w-full h-0.5 -translate-y-1/2" style={{ background: "var(--pe-border)" }} />
            {STEPS.map((s) => {
              const Icon = s.icon;
              const active = step === s.n;
              const past = step > s.n;
              const dialingLive = s.n === 4 && step === 4 && (countBy.dialing > 0 || busy);
              return (
                <div key={s.n} className="relative z-10 flex flex-col items-center gap-1.5">
                  <span
                    className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
                    style={
                      dialingLive
                        ? { background: "var(--pe-emerald)", color: "#fff", boxShadow: "0 0 0 4px var(--pe-emerald-20)", animation: "pulse 1.4s ease-in-out infinite" }
                        : active
                          ? { background: "var(--pe-emerald)", color: "#fff", boxShadow: "0 0 0 4px var(--pe-emerald-20)" }
                          : past
                            ? { background: "var(--pe-emerald-20)", color: "var(--pe-emerald-strong)" }
                            : { background: "var(--pe-surface)", color: "var(--pe-text-muted)", border: "1px solid var(--pe-border)" }
                    }
                  >
                    {dialingLive ? <Phone className="w-3.5 h-3.5 animate-pulse" /> : past ? "✓" : s.n}
                  </span>
                  <span className="text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: active || dialingLive ? "var(--pe-text)" : "var(--pe-text-muted)" }}>
                    <Icon className="w-3 h-3 inline mr-1 -mt-0.5" />
                    {s.label}
                  </span>
                </div>
              );
            })}
          </div>

          {step === 4 && activeCampaignId && (
            <div
              className="mt-3 rounded-md border px-3 py-2 flex items-center gap-2"
              style={
                countBy.dialing > 0 || busy
                  ? { borderColor: "var(--pe-emerald)", background: "var(--pe-emerald-10)" }
                  : isTerminal
                    ? { borderColor: "var(--pe-border)", background: "var(--pe-surface)" }
                    : { borderColor: "var(--pe-border)", background: "var(--pe-surface)" }
              }
            >
              {countBy.dialing > 0 || busy ? (
                <>
                  <span className="relative flex h-2.5 w-2.5 shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: "var(--pe-emerald)" }} />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5" style={{ background: "var(--pe-emerald)" }} />
                  </span>
                  <Phone className="w-3.5 h-3.5 shrink-0 animate-pulse" style={{ color: "var(--pe-emerald)" }} />
                  <p className="text-xs font-semibold flex-1 min-w-0 truncate" style={{ color: "var(--pe-text)" }}>
                    {busy && countBy.dialing === 0
                      ? "Disparando agora…"
                      : nowDialing
                        ? `Ligando agora: ${nowDialing.name || "Contato"} · ${nowDialing.phone}`
                        : `Ligando agora · ${countBy.dialing} em curso`}
                    {countBy.queued > 0 ? ` · ${countBy.queued} na fila` : ""}
                  </p>
                </>
              ) : isTerminal ? (
                <>
                  <Check className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--pe-emerald)" }} />
                  <p className="text-xs font-medium" style={{ color: "var(--pe-text-muted)" }}>
                    Finalizada · {campaign?.answered ?? 0} atendidos · {campaign?.failed ?? 0} falhas
                  </p>
                </>
              ) : prewarmBusy ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" style={{ color: "var(--pe-emerald)" }} />
                  <p className="text-xs font-medium" style={{ color: "var(--pe-text-muted)" }}>
                    Gerando áudios Sofia… ainda não está ligando
                  </p>
                </>
              ) : (
                <>
                  <Clock className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--pe-text-muted)" }} />
                  <p className="text-xs font-medium flex-1" style={{ color: "var(--pe-text-muted)" }}>
                    {countBy.queued > 0
                      ? `Em espera · ${countBy.queued} na fila (não está discando neste segundo)`
                      : "Aguardando status…"}
                  </p>
                </>
              )}
            </div>
          )}
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-5 space-y-4" style={{ background: "var(--pe-surface)" }}>
          {step === 1 && (
            <VozContactPickerPanel
              consultantId={consultantId}
              customers={customers}
              value={contacts}
              onChange={setContacts}
              active={open && step === 1}
              showPeriodSelect
            />
          )}

          {step === 2 && (
            <div className="space-y-4">
              <p className="text-sm" style={{ color: "var(--pe-text-muted)" }}>
                Regra: ligações usam só <strong>áudio Sofia</strong>. Gere na hora (v3) ou escolha um clipe já salvo.
                O nome (<em>Olá, Nome! Tudo bem?</em>) entra depois, se personalizar estiver ligado.
              </p>

              <div
                className="rounded-[var(--pe-radius)] border p-3 space-y-3"
                style={{ borderColor: "var(--pe-emerald)", background: "var(--pe-emerald-10)" }}
              >
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4" style={{ color: "var(--pe-emerald)" }} />
                  <Label className="text-sm font-semibold" style={{ color: "var(--pe-text)" }}>
                    Gerar agora · Sofia (eleven_v3)
                  </Label>
                </div>
                <Textarea
                  value={sofiaBodyText}
                  onChange={(e) => setSofiaBodyText(e.target.value)}
                  rows={4}
                  placeholder="Texto do corpo da ligação (sem o nome — o nome é costurado na discagem)…"
                  className="bg-background"
                />
                <p className="text-[11px]" style={{ color: "var(--pe-text-muted)" }}>
                  Pontuação é corrigida automaticamente (reticências, pontos, respiro no início/fim) para a Sofia falar melhor.
                  {sofiaBodyText.trim().length >= 8 && (
                    <>
                      {" "}Prévia TTS:{" "}
                      <span className="italic">
                        {prepareTtsSegment(sofiaBodyText.trim(), MODEL_V3, { edgePad: true }).slice(0, 160)}
                        {sofiaBodyText.trim().length > 140 ? "…" : ""}
                      </span>
                    </>
                  )}
                </p>
                <Button
                  type="button"
                  onClick={() => void generateSofiaNow()}
                  disabled={generatingSofia || uploading || recording}
                  className="w-full sm:w-auto gap-2"
                >
                  {generatingSofia ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Gerando Sofia…
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" /> Gerar áudio Sofia (v3)
                    </>
                  )}
                </Button>
              </div>

              <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label>Nome ao gravar / salvar novo</Label>
                    <Input value={clipName} onChange={(e) => setClipName(e.target.value)} placeholder="Ex: Follow-up 20s" />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {!recording ? (
                      <Button type="button" variant="outline" onClick={() => void startRec()} disabled={uploading || generatingSofia}>
                        <Mic className="h-4 w-4 mr-2" /> Gravar
                      </Button>
                    ) : (
                      <Button type="button" variant="destructive" onClick={stopRec}>
                        <Square className="h-4 w-4 mr-2" /> Parar ({recSec}s)
                      </Button>
                    )}
                    <label className="inline-flex">
                      <Button type="button" variant="outline" asChild disabled={uploading || generatingSofia}>
                        <span>
                          {uploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
                          Upload
                        </span>
                      </Button>
                      <input
                        type="file"
                        accept="audio/mpeg,audio/wav,audio/mp4,.mp3,.wav,.m4a"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void handleUploadFile(f);
                        }}
                      />
                    </label>
                  </div>
                  {clips.length === 0 ? (
                    <p className="text-sm" style={{ color: "var(--pe-text-muted)" }}>
                      Nenhum áudio salvo ainda. Gere com Sofia acima, grave ou faça upload.
                    </p>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {clips.map((c) => {
                        const selected = clipId === c.id;
                        return (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => {
                              setClipId(c.id);
                              setAudioUrl(c.audio_url);
                              setClipName(c.name);
                            }}
                            className="flex items-start gap-2 rounded-[var(--pe-radius)] border p-2.5 text-left transition"
                            style={{
                              borderColor: selected ? "var(--pe-emerald)" : "var(--pe-border)",
                              background: selected ? "var(--pe-emerald-10)" : "var(--pe-surface)",
                            }}
                          >
                            <span
                              className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                              style={{
                                background: selected ? "var(--pe-emerald)" : "var(--pe-muted)",
                                color: selected ? "#fff" : "var(--pe-text-muted)",
                              }}
                            >
                              {selected ? <Check className="h-4 w-4" /> : <AudioLines className="h-4 w-4" />}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium" style={{ color: "var(--pe-text)" }}>
                                {c.name}
                              </span>
                              <span className="text-[11px]" style={{ color: "var(--pe-text-muted)" }}>
                                {c.duration_sec ? `${c.duration_sec}s · ` : ""}
                                {new Date(c.created_at).toLocaleDateString("pt-BR")}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {audioUrl && (
                    <div className="space-y-1">
                      <Label className="text-[11px]">Prévia</Label>
                      <audio controls src={audioUrl} className="w-full" />
                    </div>
                  )}
                </div>

              <div className="space-y-1.5">
                <Label>SMS automático se não atender (opcional)</Label>
                <Textarea
                  value={smsFallback}
                  onChange={(e) => setSmsFallback(e.target.value.slice(0, 160))}
                  rows={2}
                  placeholder="Oi {{nome}}, tentei ligar. Me chama no WhatsApp quando puder. iGreen"
                />
                <p className="text-[11px] text-muted-foreground">{smsFallback.length}/160</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>BINA (número que aparece)</Label>
                  <Input value={callerId} onChange={(e) => setCallerId(e.target.value)} placeholder="55DDNNNNNNNN (opcional)" />
                </div>
                <div className="space-y-1.5">
                  <Label>Tentativas por contato</Label>
                  <Input
                    type="number"
                    min={1}
                    max={5}
                    value={maxAttempts}
                    onChange={(e) => setMaxAttempts(Math.max(1, Math.min(5, Number(e.target.value) || 1)))}
                  />
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Nome da campanha</Label>
                <Input value={campaignName} onChange={(e) => setCampaignName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Modo de disparo</Label>
                <Select value={velipMode} onValueChange={(v) => setVelipMode(v as VelipMode)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Automático (≥30 alvos = Lote iGreen Fone)</SelectItem>
                    <SelectItem value="single">1‑a‑1 (cron a cada 5 min)</SelectItem>
                    <SelectItem value="batch">Lote (campanha iGreen Fone)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label>Agendar (Brasília)</Label>
                  <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Início janela (Brasília)</Label>
                  <Input type="time" value={windowStart} onChange={(e) => setWindowStart(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Fim janela (Brasília)</Label>
                  <Input type="time" value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} />
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground -mt-2">
                Horário padrão Brasil — fuso <strong>America/Sao_Paulo</strong> (Brasília). Independente do relógio do computador.
              </p>
              <div className="flex items-center gap-2">
                <Switch checked={weekdaysOnly} onCheckedChange={setWeekdaysOnly} id="wiz-weekdays" />
                <Label htmlFor="wiz-weekdays">Somente dias úteis (seg–sex, Brasília)</Label>
              </div>
              <div className="flex items-start gap-2 rounded-lg border border-border/50 p-3 bg-muted/20">
                  <Switch
                    checked={personalizeName}
                    onCheckedChange={setPersonalizeName}
                    id="wiz-personalize"
                    className="mt-0.5"
                  />
                  <div>
                    <Label htmlFor="wiz-personalize">Personalizar com nome (Sofia)</Label>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Costura &quot;Olá, {"{Nome}"}! Tudo bem?&quot; + áudio do corpo (cache 1x por nome). Força modo single.
                    </p>
                  </div>
                </div>
              {prewarming && (
                <p className="text-xs text-muted-foreground flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Pré-aquecendo nomes…
                </p>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-[var(--pe-radius)] border p-3 text-center" style={{ borderColor: "var(--pe-emerald-20)", background: "var(--pe-emerald-10)" }}>
                  <p className="text-[10px] uppercase font-semibold" style={{ color: "var(--pe-text-muted)" }}>Contatos</p>
                  <p className="text-2xl font-bold" style={{ color: "var(--pe-emerald-strong)" }}>{contacts.length}</p>
                </div>
                <div className="rounded-[var(--pe-radius)] border p-3 text-center" style={{ borderColor: "var(--pe-border)", background: "var(--pe-surface-muted)" }}>
                  <p className="text-[10px] uppercase font-semibold" style={{ color: "var(--pe-text-muted)" }}>Mensagem</p>
                  <p className="text-sm font-bold mt-1" style={{ color: "var(--pe-text)" }}>
                    Áudio Sofia
                  </p>
                </div>
                <div className="rounded-[var(--pe-radius)] border p-3 text-center" style={{ borderColor: "var(--pe-border)", background: "var(--pe-surface-muted)" }}>
                  <p className="text-[10px] uppercase font-semibold" style={{ color: "var(--pe-text-muted)" }}>Modo</p>
                  <p className="text-sm font-bold mt-1" style={{ color: "var(--pe-text)" }}>{velipMode}</p>
                </div>
              </div>

              <div
                className="rounded-[var(--pe-radius)] border p-3 space-y-2"
                style={{
                  borderColor: costEstimate.band === "full" ? "var(--pe-border)" : "var(--pe-emerald-20)",
                  background: costEstimate.band === "full" ? "var(--pe-surface-muted)" : "var(--pe-emerald-10)",
                }}
              >
                <div className="flex items-center gap-2">
                  <Wallet className="h-4 w-4 shrink-0" style={{ color: "var(--pe-emerald)" }} />
                  <p className="text-sm font-semibold" style={{ color: "var(--pe-text)" }}>
                    Custo estimado desta campanha
                  </p>
                </div>
                <p className="text-[11px] leading-relaxed" style={{ color: "var(--pe-text-muted)" }}>
                  Cobrança só em <strong>atendidas</strong>. Faixa: 1–30s = {formatBrl(VOICE_PRICE_HALF)} (metade) · 30–60s = {formatBrl(VOICE_PRICE_FULL)} (inteiro).
                  {personalizeName ? " Personalizar nome soma ~2,5s no áudio." : ""}
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                  <div className="rounded-md border px-2 py-1.5" style={{ borderColor: "var(--pe-border)", background: "var(--pe-surface)" }}>
                    <p className="text-[9px] uppercase" style={{ color: "var(--pe-text-muted)" }}>Áudio</p>
                    <p className="text-sm font-bold" style={{ color: "var(--pe-text)" }}>
                      ~{costEstimate.durationSec}s
                    </p>
                  </div>
                  <div className="rounded-md border px-2 py-1.5" style={{ borderColor: "var(--pe-border)", background: "var(--pe-surface)" }}>
                    <p className="text-[9px] uppercase" style={{ color: "var(--pe-text-muted)" }}>Faixa</p>
                    <p className="text-sm font-bold" style={{ color: "var(--pe-text)" }}>
                      {costEstimate.band === "half" ? "Metade" : "Inteiro"}
                    </p>
                  </div>
                  <div className="rounded-md border px-2 py-1.5" style={{ borderColor: "var(--pe-border)", background: "var(--pe-surface)" }}>
                    <p className="text-[9px] uppercase" style={{ color: "var(--pe-text-muted)" }}>Por atendida</p>
                    <p className="text-sm font-bold" style={{ color: "var(--pe-text)" }}>
                      {formatBrl(costEstimate.priceEach)}
                    </p>
                  </div>
                  <div className="rounded-md border px-2 py-1.5" style={{ borderColor: "var(--pe-emerald-20)", background: "var(--pe-emerald-10)" }}>
                    <p className="text-[9px] uppercase" style={{ color: "var(--pe-text-muted)" }}>Se todos atenderem</p>
                    <p className="text-sm font-bold" style={{ color: "var(--pe-emerald-strong)" }}>
                      {formatBrl(costEstimate.maxTotal)}
                    </p>
                  </div>
                </div>
                <p className="text-[11px]" style={{ color: "var(--pe-text-muted)" }}>
                  Cenário ~30% atendimento: <strong style={{ color: "var(--pe-text)" }}>{formatBrl(costEstimate.likelyTotal)}</strong>
                  {!costEstimate.durationKnown ? " · duração estimada (áudio sem metadado)" : ""}
                  {costEstimate.band === "full"
                    ? " · áudio passou de 30s → cobra valor inteiro"
                    : " · áudio até 30s → metade do valor"}
                </p>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              {!activeCampaignId ? (
                <p className="text-sm text-muted-foreground text-center py-8">Nenhuma campanha em acompanhamento.</p>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="font-semibold flex-1 truncate" style={{ color: "var(--pe-text)" }}>
                      {campaign?.name || "Campanha"}
                    </h4>
                    {campaign && (
                      <Badge
                        variant="secondary"
                        className={countBy.dialing > 0 || busy ? "animate-pulse" : undefined}
                        style={
                          countBy.dialing > 0 || busy
                            ? { background: "var(--pe-emerald)", color: "#fff" }
                            : undefined
                        }
                      >
                        {countBy.dialing > 0 || busy
                          ? "Ligando agora"
                          : ({
                              running: "Em andamento",
                              scheduled: "Agendada",
                              finished: "Finalizada",
                              paused: "Pausada",
                              cancelled: "Cancelada",
                              canceled: "Cancelada",
                            }[campaign.status] || campaign.status)}
                      </Badge>
                    )}
                    {campaign?.velip_mode && (
                      <Badge variant="outline" className="text-[10px]">
                        {campaign.velip_mode === "single"
                          ? "1 a 1"
                          : campaign.velip_mode === "batch"
                            ? "Em lote"
                            : campaign.velip_mode}
                      </Badge>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => activeCampaignId && void refreshMonitor(activeCampaignId)}
                    >
                      Atualizar
                    </Button>
                  </div>

                  <div
                    className="rounded-[var(--pe-radius)] border p-3 space-y-3"
                    style={{ borderColor: "var(--pe-emerald-20)", background: "var(--pe-emerald-10)" }}
                  >
                    <div className="flex items-start gap-2">
                      {!isTerminal && liveHeadline.title.includes("Ligando") ? (
                        <Phone className="h-4 w-4 mt-0.5 shrink-0 animate-pulse" style={{ color: "var(--pe-emerald)" }} />
                      ) : !isTerminal && (prewarmBusy || liveHeadline.title.includes("fila")) ? (
                        <Loader2 className="h-4 w-4 mt-0.5 shrink-0 animate-spin" style={{ color: "var(--pe-emerald)" }} />
                      ) : isTerminal ? (
                        <Check className="h-4 w-4 mt-0.5 shrink-0" style={{ color: "var(--pe-emerald)" }} />
                      ) : (
                        <Clock className="h-4 w-4 mt-0.5 shrink-0" style={{ color: "var(--pe-emerald)" }} />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold" style={{ color: "var(--pe-text)" }}>
                          {liveHeadline.title}
                        </p>
                        <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: "var(--pe-text-muted)" }}>
                          {liveHeadline.detail}
                        </p>
                      </div>
                    </div>

                    <div className="grid gap-1.5 sm:grid-cols-5">
                      {pipelineSteps.map((s) => {
                        const tone =
                          s.state === "done"
                            ? { border: "var(--pe-emerald-20)", bg: "var(--pe-surface)", icon: "done" as const }
                            : s.state === "active"
                              ? { border: "var(--pe-emerald)", bg: "var(--pe-surface)", icon: "active" as const }
                              : s.state === "blocked"
                                ? { border: "var(--pe-border)", bg: "var(--pe-surface-muted)", icon: "blocked" as const }
                                : { border: "var(--pe-border)", bg: "var(--pe-surface-muted)", icon: "pending" as const };
                        return (
                          <div
                            key={s.id}
                            className="rounded-md border px-2 py-1.5 min-w-0"
                            style={{ borderColor: tone.border, background: tone.bg }}
                          >
                            <div className="flex items-center gap-1 mb-0.5">
                              {tone.icon === "done" ? (
                                <Check className="h-3 w-3 shrink-0" style={{ color: "var(--pe-emerald)" }} />
                              ) : tone.icon === "active" ? (
                                <CircleDot className="h-3 w-3 shrink-0 animate-pulse" style={{ color: "var(--pe-emerald)" }} />
                              ) : tone.icon === "blocked" ? (
                                <Clock className="h-3 w-3 shrink-0" style={{ color: "var(--pe-text-muted)" }} />
                              ) : (
                                <span
                                  className="h-2 w-2 rounded-full shrink-0"
                                  style={{ background: "var(--pe-border)" }}
                                />
                              )}
                              <span
                                className="text-[10px] font-semibold uppercase tracking-wide truncate"
                                style={{
                                  color:
                                    s.state === "active" || s.state === "done"
                                      ? "var(--pe-text)"
                                      : "var(--pe-text-muted)",
                                }}
                              >
                                {s.label}
                              </span>
                            </div>
                            <p className="text-[10px] leading-snug truncate" style={{ color: "var(--pe-text-muted)" }} title={s.detail}>
                              {s.detail}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {[
                      { label: "Total", val: campaign?.total ?? 0 },
                      { label: "Discados", val: campaign?.dialed ?? 0 },
                      { label: "Atendidos", val: campaign?.answered ?? 0 },
                      { label: "Falhas", val: campaign?.failed ?? 0 },
                    ].map((s) => (
                      <div
                        key={s.label}
                        className="rounded-[var(--pe-radius)] border p-2 text-center"
                        style={{ borderColor: "var(--pe-border)", background: "var(--pe-surface-muted)" }}
                      >
                        <p className="text-[10px] uppercase" style={{ color: "var(--pe-text-muted)" }}>{s.label}</p>
                        <p className="text-lg font-bold" style={{ color: "var(--pe-text)" }}>{s.val}</p>
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {[
                      { label: "Na fila", val: countBy.queued },
                      { label: "Ligando", val: countBy.dialing },
                      { label: "Atendeu (lista)", val: countBy.answered },
                      { label: "Falhou (lista)", val: countBy.failed },
                    ].map((s) => (
                      <div
                        key={s.label}
                        className="rounded-[var(--pe-radius)] border px-2 py-1.5 text-center"
                        style={{ borderColor: "var(--pe-border)", background: "var(--pe-surface)" }}
                      >
                        <p className="text-[9px] uppercase" style={{ color: "var(--pe-text-muted)" }}>{s.label}</p>
                        <p className="text-sm font-bold" style={{ color: "var(--pe-text)" }}>{s.val}</p>
                      </div>
                    ))}
                  </div>

                  <Progress value={progressPct} className="h-2.5" />
                  <p className="text-[11px] text-center" style={{ color: "var(--pe-text-muted)" }}>
                    {progressPct}% · atualiza a cada 4s
                    {isTerminal ? " · finalizada" : ""}
                  </p>

                  <div
                    className="rounded-[var(--pe-radius)] border p-3 space-y-1.5"
                    style={{ borderColor: "var(--pe-border)", background: "var(--pe-surface-muted)" }}
                  >
                    <div className="flex items-center gap-2">
                      <Wallet className="h-3.5 w-3.5" style={{ color: "var(--pe-emerald)" }} />
                      <p className="text-xs font-semibold" style={{ color: "var(--pe-text)" }}>
                        Custo · {costEstimate.bandLabel} · {formatBrl(costEstimate.priceEach)}/atendida
                      </p>
                    </div>
                    <p className="text-[11px]" style={{ color: "var(--pe-text-muted)" }}>
                      Áudio ~{costEstimate.durationSec}s
                      {personalizeName || campaign?.config?.personalize_name ? " (com nome)" : ""}
                      {" · "}
                      Campanha toda (se 100% atender): <strong style={{ color: "var(--pe-text)" }}>{formatBrl(costEstimate.maxTotal)}</strong>
                      {countBy.queued > 0 && (
                        <>
                          {" · "}
                          Restante na fila (~30% atendimento):{" "}
                          <strong style={{ color: "var(--pe-text)" }}>{formatBrl(costRemaining.likelyTotal)}</strong>
                        </>
                      )}
                    </p>
                    <p className="text-[10px]" style={{ color: "var(--pe-text-muted)" }}>
                      1–30s = {formatBrl(VOICE_PRICE_HALF)} · 30–60s = {formatBrl(VOICE_PRICE_FULL)} · só paga quem atendeu
                    </p>
                  </div>

                  {(personalizeName || campaign?.config?.personalize_name) && (campaign?.audio_clip_id || clipId) && (
                    <div
                      className="rounded-[var(--pe-radius)] border p-3 space-y-1.5"
                      style={{ borderColor: "var(--pe-emerald-20)", background: "var(--pe-emerald-10)" }}
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-xs font-semibold flex items-center gap-1.5 flex-1" style={{ color: "var(--pe-text)" }}>
                          {(prewarming || (prewarmStats && !prewarmStats.done)) && (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: "var(--pe-emerald)" }} />
                          )}
                          Áudios Sofia (ElevenLabs)
                        </p>
                        {!prewarmStats?.done && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 text-[11px]"
                            disabled={prewarming}
                            onClick={() => {
                              setPrewarmStats(null);
                              prewarmBusyRef.current = false;
                            }}
                          >
                            Retomar geração
                          </Button>
                        )}
                      </div>
                      <p className="text-[11px]" style={{ color: "var(--pe-text-muted)" }}>
                        {prewarmStats?.done
                          ? `Prontos ${prewarmStats.ready}/${prewarmStats.total} — mesmo prenome reaproveita o cache (só gera o que faltar).`
                          : prewarmStats && prewarmStats.total > 0
                            ? `Gerando “Olá, Nome! Tudo bem?”: ${prewarmStats.ready}/${prewarmStats.total} · faltam ${prewarmStats.remaining}`
                            : prewarmStats?.error
                              ? prewarmStats.error
                              : "Preparando áudios personalizados em segundo plano…"}
                        {prewarmStats && prewarmStats.failed > 0 && !prewarmStats.done
                          ? ` · retentando falhas`
                          : ""}
                      </p>
                      <p className="text-[10px]" style={{ color: "var(--pe-text-muted)" }}>
                        Cache por prenome + este corpo. Lead novo com nome já gerado (ex.: Maria) não gasta ElevenLabs de novo.
                      </p>
                      {prewarmStats && prewarmStats.total > 0 && (
                        <Progress
                          value={Math.round((prewarmStats.ready / Math.max(prewarmStats.total, 1)) * 100)}
                          className="h-1.5"
                        />
                      )}
                    </div>
                  )}

                  {(canRunNow || canPause || canResume || canCancel) && (
                    <div className="flex gap-2 flex-wrap">
                      {canRunNow && (
                        <Button
                          className="flex-1 gap-1.5 min-w-[140px]"
                          disabled={busy}
                          style={{ background: "var(--pe-emerald)", color: "#fff" }}
                          onClick={() => void runNow()}
                        >
                          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Phone className="w-4 h-4" />}
                          Iniciar agora
                        </Button>
                      )}
                      {canPause && (
                        <Button variant="outline" className="flex-1 gap-1.5" disabled={busy} onClick={() => void controlCampaign("pause")}>
                          <Pause className="w-4 h-4" /> Pausar
                        </Button>
                      )}
                      {canResume && (
                        <Button variant="outline" className="flex-1 gap-1.5" disabled={busy} onClick={() => void controlCampaign("resume")}>
                          <Play className="w-4 h-4" /> Retomar
                        </Button>
                      )}
                      {canCancel && (
                        <Button variant="destructive" className="flex-1 gap-1.5" disabled={busy} onClick={() => void controlCampaign("cancel")}>
                          <XCircle className="w-4 h-4" /> Cancelar
                        </Button>
                      )}
                    </div>
                  )}
                  {canRunNow && (
                    <p className="text-[11px] -mt-2" style={{ color: "var(--pe-text-muted)" }}>
                      Dispara até 50 ligações agora (Velip aceita até 100/min em lote). Clique de novo para a próxima leva — não precisa esperar o cron.
                    </p>
                  )}

                  <div className="flex items-center gap-2 flex-wrap">
                    {([
                      ["all", "Todos", targets.length],
                      ["queued", "Fila / ligando", countBy.queued + countBy.dialing],
                      ["answered", "Atendidos", countBy.answered],
                      ["failed", "Falhas", countBy.failed],
                    ] as const).map(([k, label, n]) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setFilterStatus(k)}
                        className="text-[11px] px-2.5 py-1 rounded-md font-medium"
                        style={
                          filterStatus === k
                            ? { background: "var(--pe-emerald)", color: "#fff" }
                            : { background: "var(--pe-surface-muted)", color: "var(--pe-text-muted)" }
                        }
                      >
                        {label} ({n})
                      </button>
                    ))}
                  </div>

                  <div
                    className="rounded-[var(--pe-radius)] border max-h-72 overflow-auto"
                    style={{ borderColor: "var(--pe-border)", background: "var(--pe-surface-muted)" }}
                  >
                    {filteredTargets.length === 0 ? (
                      <p className="p-4 text-center text-xs text-muted-foreground">Nada para mostrar</p>
                    ) : (
                      filteredTargets.map((t) => {
                        const crm = resolveCrmByPhoneOrId(t.phone, null, customers);
                        const live = t.status === "dialing" || t.status === "ringing";
                        return (
                          <div
                            key={t.id}
                            className="flex flex-col gap-0.5 px-3 py-1.5 border-b text-xs last:border-0"
                            style={{
                              borderColor: "var(--pe-border)",
                              background: live ? "var(--pe-emerald-10)" : undefined,
                            }}
                          >
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-[10px] shrink-0">
                                {live && <Phone className="w-2.5 h-2.5 mr-1 inline animate-pulse" />}
                                {targetStatusLabel(t.status, t.velip_status)}
                              </Badge>
                              {crm?.status && (
                                <Badge variant="secondary" className="text-[10px] shrink-0">
                                  {statusCrmLabel(crm.status)}
                                </Badge>
                              )}
                              <span className="flex-1 truncate" style={{ color: "var(--pe-text)" }}>
                                {t.name || crm?.name || "—"}
                              </span>
                              <span className="font-mono text-muted-foreground">{t.phone}</span>
                              {t.error && (
                                <span className="text-destructive text-[10px] truncate max-w-[120px]" title={t.error}>
                                  {t.error}
                                </span>
                              )}
                            </div>
                            {crm && (
                              <p className="text-[10px] truncate pl-0.5" style={{ color: "var(--pe-text-muted)" }}>
                                {crmClosingSummary(crm)}
                              </p>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <div
          className="flex items-center justify-between gap-3 border-t px-5 py-3"
          style={{ borderColor: "var(--pe-border)", background: "var(--pe-surface-muted)" }}
        >
          <div>
            {step > 1 && step < 4 && (
              <Button type="button" variant="outline" className="gap-1" onClick={() => setStep((s) => (s - 1) as WizardStep)}>
                <ChevronLeft className="h-4 w-4" /> Voltar
              </Button>
            )}
            {step === 4 && !monitorCampaignId && (
              <Button type="button" variant="outline" onClick={resetDraft}>
                Nova campanha
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Fechar
            </Button>
            {step === 1 && (
              <Button
                type="button"
                disabled={!canNextFrom1}
                className="gap-1"
                style={{ background: "var(--pe-emerald)", color: "#fff" }}
                onClick={() => setStep(2)}
              >
                Continuar <ChevronRight className="h-4 w-4" />
              </Button>
            )}
            {step === 2 && (
              <Button
                type="button"
                disabled={!canNextFrom2}
                className="gap-1"
                style={{ background: "var(--pe-emerald)", color: "#fff" }}
                onClick={() => setStep(3)}
              >
                Continuar <ChevronRight className="h-4 w-4" />
              </Button>
            )}
            {step === 3 && (
              <Button
                type="button"
                disabled={busy || !canNextFrom1 || !canNextFrom2}
                className="gap-1.5"
                style={{ background: "var(--pe-emerald)", color: "#fff" }}
                onClick={() => void createCampaign()}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Phone className="h-4 w-4" />}
                Iniciar ligações
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
