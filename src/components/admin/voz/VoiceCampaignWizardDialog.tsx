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
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { uploadMedia } from "@/services/minioUpload";
import { loadOpusRecorder } from "@/lib/opusRecorderLoader";
import { decodeAudioBlob, encodeMp3 } from "@/lib/audioProcessing";
import type { BulkContact } from "@/types/whatsapp";
import { VozContactPickerPanel, type VozCustomer } from "./VozContactPickerDialog";
import { crmClosingSummary, resolveCrmByPhoneOrId, statusCrmLabel } from "./voiceCrmContext";
import { velipOutcomeLabel } from "./voiceOutcomeLabels";

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
}

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

  const [campaignName, setCampaignName] = useState("Campanha de ligação");
  const [dispatchKind, setDispatchKind] = useState<"audio" | "tts">("audio");
  const [ttsText, setTtsText] = useState("");
  const [callerId, setCallerId] = useState("");
  const [maxAttempts, setMaxAttempts] = useState(2);
  const [smsFallback, setSmsFallback] = useState("");
  const [velipMode, setVelipMode] = useState<VelipMode>("auto");
  const [scheduledAt, setScheduledAt] = useState("");
  const [windowStart, setWindowStart] = useState("09:00");
  const [windowEnd, setWindowEnd] = useState("18:00");
  const [weekdaysOnly, setWeekdaysOnly] = useState(true);
  const [busy, setBusy] = useState(false);

  const [activeCampaignId, setActiveCampaignId] = useState<string | null>(null);
  const [campaign, setCampaign] = useState<CampaignRow | null>(null);
  const [targets, setTargets] = useState<TargetRow[]>([]);
  const [filterStatus, setFilterStatus] = useState<"all" | "answered" | "failed" | "queued">("all");
  const autoPickedClip = useRef(false);

  const resetDraft = useCallback(() => {
    setStep(1);
    setContacts([]);
    setCampaignName("Campanha de ligação");
    setDispatchKind("audio");
    setTtsText("");
    setSmsFallback("");
    setVelipMode("auto");
    setScheduledAt("");
    setWindowStart("09:00");
    setWindowEnd("18:00");
    setWeekdaysOnly(true);
    setActiveCampaignId(null);
    setCampaign(null);
    setTargets([]);
    setFilterStatus("all");
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
    autoPickedClip.current = true;
    if (!clipId) {
      setClipId(clips[0].id);
      setAudioUrl(clips[0].audio_url);
    }
  }, [clips, clipId]);

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setRecSec((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);

  const refreshMonitor = useCallback(async (campaignId: string) => {
    const [{ data: camp }, { data: tgs }] = await Promise.all([
      (supabase as any)
        .from("voice_campaigns")
        .select("id, name, status, total, dialed, answered, failed, scheduled_at, created_at, velip_mode, velip_campaign_id")
        .eq("id", campaignId)
        .maybeSingle(),
      (supabase as any)
        .from("voice_campaign_targets")
        .select("id, phone, name, status, error, attempts, velip_status")
        .eq("campaign_id", campaignId)
        .order("created_at", { ascending: true })
        .limit(500),
    ]);
    if (camp) setCampaign(camp as CampaignRow);
    setTargets((tgs as TargetRow[]) ?? []);
  }, []);

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

  const persistClip = async (url: string, durationHint?: number) => {
    const { data, error } = await (supabase as any)
      .from("voice_audio_clips")
      .insert({
        consultant_id: consultantId,
        name: clipName.trim() || "Clipe de voz",
        audio_url: url,
        duration_sec: durationHint ?? null,
      })
      .select("id, name, audio_url, duration_sec, created_at")
      .single();
    if (error) throw new Error(error.message);
    setAudioUrl(url);
    setClipId(data.id);
    await loadClips();
    toast.success("Clipe salvo");
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
  const canNextFrom2 =
    dispatchKind === "audio" ? !!(audioUrl || clipId) : ttsText.trim().length > 0;

  const createCampaign = async () => {
    if (!canNextFrom1 || !canNextFrom2) return;
    setBusy(true);
    try {
      const phones = contacts.map((c) => ({
        phone: c.phone,
        name: c.name,
        customer_id: c.source === "database" ? c.id : null,
      }));
      const enqueueBody: Record<string, unknown> = {
        action: "create_campaign",
        campaign_name: campaignName.trim() || "Campanha de ligação",
        audio_clip_id: dispatchKind === "audio" ? (clipId || null) : null,
        audio_url: dispatchKind === "audio" ? audioUrl : null,
        dispatch_kind: dispatchKind,
        tts_text: dispatchKind === "tts" ? ttsText.trim() : null,
        caller_id: callerId.trim() || null,
        max_attempts: maxAttempts,
        sms_on_no_answer_text: smsFallback.trim() || null,
        phones,
        scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
        config: {
          windowStart,
          windowEnd,
          weekdaysOnly,
          leaveVoicemail: false,
        },
      };
      if (velipMode !== "auto") enqueueBody.velip_mode = velipMode;
      const data = await invokeEnqueue(enqueueBody);
      const cid = data.campaign_id as string;
      setActiveCampaignId(cid);
      setStep(4);
      toast.success(`Campanha criada: ${data.total} alvos · modo ${data.velip_mode || "auto"}`);
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
              return (
                <div key={s.n} className="relative z-10 flex flex-col items-center gap-1.5">
                  <span
                    className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
                    style={
                      active
                        ? { background: "var(--pe-emerald)", color: "#fff", boxShadow: "0 0 0 4px var(--pe-emerald-20)" }
                        : past
                          ? { background: "var(--pe-emerald-20)", color: "var(--pe-emerald-strong)" }
                          : { background: "var(--pe-surface)", color: "var(--pe-text-muted)", border: "1px solid var(--pe-border)" }
                    }
                  >
                    {past ? "✓" : s.n}
                  </span>
                  <span className="text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: active ? "var(--pe-text)" : "var(--pe-text-muted)" }}>
                    <Icon className="w-3 h-3 inline mr-1 -mt-0.5" />
                    {s.label}
                  </span>
                </div>
              );
            })}
          </div>
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
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant={dispatchKind === "audio" ? "default" : "outline"} onClick={() => setDispatchKind("audio")}>
                  Áudio gravado
                </Button>
                <Button type="button" size="sm" variant={dispatchKind === "tts" ? "default" : "outline"} onClick={() => setDispatchKind("tts")}>
                  Texto (voz sintetizada)
                </Button>
              </div>

              {dispatchKind === "tts" ? (
                <div className="space-y-1.5">
                  <Label>Texto que a voz vai falar</Label>
                  <Textarea
                    value={ttsText}
                    onChange={(e) => setTtsText(e.target.value)}
                    rows={4}
                    placeholder="Olá {{nome}}, tudo bem? Sou consultor da iGreen…"
                  />
                  <p className="text-[11px]" style={{ color: "var(--pe-text-muted)" }}>
                    Use {"{{nome}}"} para personalizar. Até ~500 caracteres.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label>Nome ao gravar / salvar novo</Label>
                    <Input value={clipName} onChange={(e) => setClipName(e.target.value)} placeholder="Ex: Follow-up 20s" />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {!recording ? (
                      <Button type="button" variant="outline" onClick={() => void startRec()} disabled={uploading}>
                        <Mic className="h-4 w-4 mr-2" /> Gravar
                      </Button>
                    ) : (
                      <Button type="button" variant="destructive" onClick={stopRec}>
                        <Square className="h-4 w-4 mr-2" /> Parar ({recSec}s)
                      </Button>
                    )}
                    <label className="inline-flex">
                      <Button type="button" variant="outline" asChild disabled={uploading}>
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
                      Nenhum áudio salvo ainda. Grave ou faça upload.
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
              )}

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
                    <SelectItem value="auto">Automático (≥30 alvos = Lote Velip)</SelectItem>
                    <SelectItem value="single">1‑a‑1 (cron a cada 5 min)</SelectItem>
                    <SelectItem value="batch">Lote (CreateCampaign Velip)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label>Agendar</Label>
                  <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Início</Label>
                  <Input type="time" value={windowStart} onChange={(e) => setWindowStart(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Fim</Label>
                  <Input type="time" value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={weekdaysOnly} onCheckedChange={setWeekdaysOnly} id="wiz-weekdays" />
                <Label htmlFor="wiz-weekdays">Somente dias úteis</Label>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-[var(--pe-radius)] border p-3 text-center" style={{ borderColor: "var(--pe-emerald-20)", background: "var(--pe-emerald-10)" }}>
                  <p className="text-[10px] uppercase font-semibold" style={{ color: "var(--pe-text-muted)" }}>Contatos</p>
                  <p className="text-2xl font-bold" style={{ color: "var(--pe-emerald-strong)" }}>{contacts.length}</p>
                </div>
                <div className="rounded-[var(--pe-radius)] border p-3 text-center" style={{ borderColor: "var(--pe-border)", background: "var(--pe-surface-muted)" }}>
                  <p className="text-[10px] uppercase font-semibold" style={{ color: "var(--pe-text-muted)" }}>Mensagem</p>
                  <p className="text-sm font-bold mt-1" style={{ color: "var(--pe-text)" }}>
                    {dispatchKind === "audio" ? "Áudio" : "TTS"}
                  </p>
                </div>
                <div className="rounded-[var(--pe-radius)] border p-3 text-center" style={{ borderColor: "var(--pe-border)", background: "var(--pe-surface-muted)" }}>
                  <p className="text-[10px] uppercase font-semibold" style={{ color: "var(--pe-text-muted)" }}>Modo</p>
                  <p className="text-sm font-bold mt-1" style={{ color: "var(--pe-text)" }}>{velipMode}</p>
                </div>
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
                    {campaign && <Badge variant="secondary">{campaign.status}</Badge>}
                    {campaign?.velip_mode && (
                      <Badge variant="outline" className="text-[10px]">{campaign.velip_mode}</Badge>
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

                  <div className="grid grid-cols-4 gap-2">
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

                  <Progress value={progressPct} className="h-2.5" />
                  <p className="text-[11px] text-center" style={{ color: "var(--pe-text-muted)" }}>
                    {progressPct}% · atualiza a cada 4s
                    {isTerminal ? " · finalizada" : ""}
                  </p>

                  {(canPause || canResume || canCancel) && (
                    <div className="flex gap-2">
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

                  <div className="flex items-center gap-2 flex-wrap">
                    {([
                      ["all", "Todos"],
                      ["queued", "Fila"],
                      ["answered", "Atendidos"],
                      ["failed", "Falhas"],
                    ] as const).map(([k, label]) => (
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
                        {label}
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
                        return (
                          <div
                            key={t.id}
                            className="flex flex-col gap-0.5 px-3 py-1.5 border-b text-xs last:border-0"
                            style={{ borderColor: "var(--pe-border)" }}
                          >
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-[10px] shrink-0">
                                {t.velip_status
                                  ? velipOutcomeLabel(t.velip_status)
                                  : t.status}
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
