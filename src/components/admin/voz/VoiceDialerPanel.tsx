/**
 * Painel B — ligação PSTN (Velip).
 * Visual Disparo PRO + modal de seleção de clientes/leads parados.
 * Modo de disparo: Auto (default), Single (1-a-1 pelo cron) ou Batch (CreateCampaign Velip).
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Mic, Square, Upload, Phone, PhoneCall, RefreshCw, Users, X, Pause, Play, XCircle } from "lucide-react";
import { toast } from "sonner";
import { uploadMedia } from "@/services/minioUpload";
import { loadOpusRecorder } from "@/lib/opusRecorderLoader";
import { decodeAudioBlob, encodeMp3 } from "@/lib/audioProcessing";
import { normalizeBrazilPhone } from "@/lib/phone";
import type { BulkContact } from "@/types/whatsapp";
import { VozCampaignShell, VozSection } from "./VozCampaignShell";
import { VozContactPickerDialog, type VozCustomer } from "./VozContactPickerDialog";

interface Props {
  consultantId: string;
  customers: VozCustomer[];
}

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

type VelipMode = "auto" | "single" | "batch";

export function VoiceDialerPanel({ consultantId, customers }: Props) {
  const [clips, setClips] = useState<ClipRow[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [clipId, setClipId] = useState("");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [clipName, setClipName] = useState("Mensagem de 20s");
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recSec, setRecSec] = useState(0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [recorder, setRecorder] = useState<any>(null);

  const [campaignName, setCampaignName] = useState("Campanha de ligação");
  const [contacts, setContacts] = useState<BulkContact[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  const [windowStart, setWindowStart] = useState("09:00");
  const [windowEnd, setWindowEnd] = useState("18:00");
  const [weekdaysOnly, setWeekdaysOnly] = useState(true);
  const [testPhone, setTestPhone] = useState("");
  const [velipMode, setVelipMode] = useState<VelipMode>("auto");
  const [dispatchKind, setDispatchKind] = useState<"audio" | "tts">("audio");
  const [ttsText, setTtsText] = useState("");
  const [callerId, setCallerId] = useState("");
  const [maxAttempts, setMaxAttempts] = useState(2);
  const [smsFallback, setSmsFallback] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setRecSec((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);

  const loadClips = useCallback(async () => {
    const { data } = await (supabase as any)
      .from("voice_audio_clips")
      .select("id, name, audio_url, duration_sec, created_at")
      .eq("consultant_id", consultantId)
      .order("created_at", { ascending: false })
      .limit(20);
    setClips((data as ClipRow[]) ?? []);
  }, [consultantId]);

  const loadCampaigns = useCallback(async () => {
    const { data } = await (supabase as any)
      .from("voice_campaigns")
      .select("id, name, status, total, dialed, answered, failed, scheduled_at, created_at, velip_mode, velip_campaign_id")
      .eq("consultant_id", consultantId)
      .order("created_at", { ascending: false })
      .limit(15);
    setCampaigns((data as CampaignRow[]) ?? []);
  }, [consultantId]);

  useEffect(() => {
    void loadClips();
    void loadCampaigns();
  }, [loadClips, loadCampaigns]);

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

  /** PSTN Velip: preferir MP3 (Opus na PSTN pode falhar; a Velip aceita MP3/WAV). */
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
        // Grava OGG e converte para MP3 antes do upload (compatível com Velip PlayAudioFile)
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

  const runTestCall = async () => {
    const phone = normalizeBrazilPhone(testPhone);
    if (!phone) {
      toast.error("Informe um celular válido para o teste");
      return;
    }
    if (!audioUrl && !clipId) {
      toast.error("Grave ou escolha um clipe primeiro");
      return;
    }
    setBusy(true);
    try {
      const data = await invokeEnqueue({
        action: "test_call",
        test_phone: phone,
        audio_clip_id: dispatchKind === "audio" ? (clipId || null) : null,
        audio_url: dispatchKind === "audio" ? audioUrl : null,
        dispatch_kind: dispatchKind,
        tts_text: dispatchKind === "tts" ? ttsText.trim() : null,
        caller_id: callerId.trim() || null,
        campaign_name: "Teste PSTN",
      });
      toast.success(`Ligação iniciada (ID Velip: ${data.velip_call_id || data.campaign_id})`);
      await loadCampaigns();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const createCampaign = async () => {
    if (dispatchKind === "audio" && !audioUrl && !clipId) {
      toast.error("Grave ou escolha um clipe primeiro");
      return;
    }
    if (dispatchKind === "tts" && !ttsText.trim()) {
      toast.error("Escreva o texto que a voz vai falar");
      return;
    }
    if (contacts.length === 0) {
      toast.error("Selecione clientes ou leads parados");
      return;
    }
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
      toast.success(`Campanha criada: ${data.total} alvos · modo ${data.velip_mode || "auto"} (${data.status})`);
      await loadCampaigns();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const removeContact = (id: string) => {
    setContacts((prev) => prev.filter((c) => c.id !== id));
  };

  const controlCampaign = async (campaignId: string, action: "pause" | "resume" | "cancel") => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("voice-campaign-control", {
        body: { campaign_id: campaignId, action },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      toast.success(`Campanha ${action === "pause" ? "pausada" : action === "resume" ? "retomada" : "cancelada"}`);
      await loadCampaigns();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <VozCampaignShell
        title="Ligação telefônica"
        subtitle="Número da empresa (Velip) · áudio MP3/WAV ~20s · retry inteligente para não atendidas."
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm" style={{ color: "var(--pe-text-muted)" }}>
              {contacts.length} contato(s)
            </span>
            <Button
              type="button"
              onClick={() => void createCampaign()}
              disabled={busy || contacts.length === 0 || (dispatchKind === "audio" ? (!audioUrl && !clipId) : !ttsText.trim())}
              className="gap-1.5"
              style={{ background: "var(--pe-emerald)", color: "#fff" }}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Phone className="h-4 w-4" />}
              Criar campanha
            </Button>
          </div>
        }
      >
        <VozSection title="Como falar com o cliente">
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant={dispatchKind === "audio" ? "default" : "outline"} onClick={() => setDispatchKind("audio")}>
              🎙 Áudio gravado
            </Button>
            <Button type="button" size="sm" variant={dispatchKind === "tts" ? "default" : "outline"} onClick={() => setDispatchKind("tts")}>
              💬 Texto (voz sintetizada)
            </Button>
          </div>
          {dispatchKind === "tts" && (
            <div className="space-y-1.5">
              <Label>Texto que a voz vai falar</Label>
              <Textarea value={ttsText} onChange={(e) => setTtsText(e.target.value)} rows={4} placeholder="Olá {{nome}}, tudo bem? Sou consultor da iGreen…" />
              <p className="text-[11px]" style={{ color: "var(--pe-text-muted)" }}>Até ~500 caracteres. A Velip gera o áudio automaticamente.</p>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>BINA (número que aparece)</Label>
              <Input value={callerId} onChange={(e) => setCallerId(e.target.value)} placeholder="55DDNNNNNNNN (opcional)" />
            </div>
            <div className="space-y-1.5">
              <Label>Tentativas por contato</Label>
              <Input type="number" min={1} max={5} value={maxAttempts} onChange={(e) => setMaxAttempts(Math.max(1, Math.min(5, Number(e.target.value) || 1)))} />
            </div>
          </div>
        </VozSection>

        {dispatchKind === "audio" && <VozSection title="Clipe de voz">
          <div className="space-y-1.5">
            <Label>Nome do clipe</Label>
            <Input value={clipName} onChange={(e) => setClipName(e.target.value)} />
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
          {clips.length > 0 && (
            <Select
              value={clipId || "__none__"}
              onValueChange={(v) => {
                if (v === "__none__") {
                  setClipId("");
                  return;
                }
                setClipId(v);
                const c = clips.find((x) => x.id === v);
                if (c) setAudioUrl(c.audio_url);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Escolher clipe salvo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">—</SelectItem>
                {clips.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}{c.duration_sec ? ` (${c.duration_sec}s)` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {audioUrl && <audio controls src={audioUrl} className="w-full" />}
        </VozSection>}

        <VozSection title="Teste (obrigatório antes da massa)">
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              className="flex-1"
              placeholder="Seu celular com DDD"
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
            />
            <Button type="button" variant="outline" className="gap-1.5" onClick={() => void runTestCall()} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PhoneCall className="h-4 w-4" />}
              Ligar teste
            </Button>
          </div>
        </VozSection>

        <VozSection title="Campanha">
          <Input value={campaignName} onChange={(e) => setCampaignName(e.target.value)} placeholder="Nome da campanha" />
          <Button type="button" variant="outline" className="gap-2" onClick={() => setPickerOpen(true)}>
            <Users className="h-4 w-4" />
            Selecionar clientes / leads parados
          </Button>
          {contacts.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {contacts.slice(0, 12).map((c) => (
                <Badge key={c.id} variant="secondary" className="gap-1 pr-1" style={{ background: "var(--pe-emerald-10)", color: "var(--pe-emerald-strong)", borderColor: "var(--pe-emerald-20)" }}>
                  <span className="max-w-[120px] truncate">{c.name || c.phone}</span>
                  <button type="button" className="rounded p-0.5" onClick={() => removeContact(c.id)}>
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
              {contacts.length > 12 && <Badge variant="outline">+{contacts.length - 12}</Badge>}
            </div>
          )}
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
            <p className="text-[11px] text-muted-foreground">
              1‑a‑1 respeita janela local. Lote entrega mais rápido, mas segue as regras da conta Velip.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>SMS automático se não atender</Label>
            <Textarea
              value={smsFallback}
              onChange={(e) => setSmsFallback(e.target.value.slice(0, 160))}
              rows={2}
              placeholder="Oi {nome}, tentei ligar. Me chama no WhatsApp quando puder 🌱 iGreen"
            />
            <p className="text-[11px] text-muted-foreground">
              Opcional. Enviado só depois das tentativas terminarem em "não atendeu". {smsFallback.length}/160
            </p>
          </div>
        </VozSection>


        <VozSection title="Janela e agendamento">
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
            <Switch checked={weekdaysOnly} onCheckedChange={setWeekdaysOnly} id="pstn-weekdays" />
            <Label htmlFor="pstn-weekdays">Somente dias úteis (09–18 recomendado)</Label>
          </div>
        </VozSection>

        <VozSection title="Campanhas recentes">
          <div className="flex justify-end">
            <Button type="button" variant="ghost" size="sm" onClick={() => void loadCampaigns()}>
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
          {campaigns.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma ainda.</p>
          ) : (
            <ul className="space-y-2">
              {campaigns.map((c) => {
                const isBatch = c.velip_mode === "batch" && !!c.velip_campaign_id;
                const canPause = isBatch && c.status === "running";
                const canResume = isBatch && c.status === "paused";
                const canCancel = isBatch && (c.status === "running" || c.status === "paused" || c.status === "scheduled");
                return (
                  <li key={c.id} className="flex flex-wrap items-center gap-2 rounded-[var(--pe-radius)] border px-3 py-2 text-sm" style={{ borderColor: "var(--pe-border)", background: "var(--pe-surface)" }}>
                    <span className="font-medium truncate flex-1" style={{ color: "var(--pe-text)" }}>{c.name}</span>
                    <Badge variant="secondary">{c.status}</Badge>
                    {c.velip_mode && <Badge variant="outline" className="text-[10px]">{c.velip_mode}</Badge>}
                    <span className="text-muted-foreground text-xs">
                      {c.dialed}/{c.total} · ok {c.answered} · falha {c.failed}
                    </span>
                    {canPause && (
                      <Button size="sm" variant="ghost" className="h-7 px-2" disabled={busy} onClick={() => void controlCampaign(c.id, "pause")}>
                        <Pause className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {canResume && (
                      <Button size="sm" variant="ghost" className="h-7 px-2" disabled={busy} onClick={() => void controlCampaign(c.id, "resume")}>
                        <Play className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {canCancel && (
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive" disabled={busy} onClick={() => void controlCampaign(c.id, "cancel")}>
                        <XCircle className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </VozSection>
      </VozCampaignShell>

      <VozContactPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        consultantId={consultantId}
        customers={customers}
        value={contacts}
        onConfirm={setContacts}
      />
    </>
  );
}
