/**
 * Painel B — ligação PSTN (Twilio).
 * Visual Disparo PRO + modal de seleção de clientes/leads parados.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Mic, Square, Upload, Phone, PhoneCall, RefreshCw, Users, X } from "lucide-react";
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
}

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
      .select("id, name, status, total, dialed, answered, failed, scheduled_at, created_at")
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

  /** Twilio Play: preferir mp3/wav (OGG Opus costuma falhar na PSTN). */
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
        // Grava OGG e converte para MP3 antes do upload (compatível com Twilio Play)
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
        audio_clip_id: clipId || null,
        audio_url: audioUrl,
        campaign_name: "Teste PSTN",
      });
      toast.success(`Ligação iniciada (${data.twilio_sid || data.campaign_id})`);
      await loadCampaigns();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const createCampaign = async () => {
    if (!audioUrl && !clipId) {
      toast.error("Grave ou escolha um clipe primeiro");
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
      const data = await invokeEnqueue({
        action: "create_campaign",
        campaign_name: campaignName.trim() || "Campanha de ligação",
        audio_clip_id: clipId || null,
        audio_url: audioUrl,
        phones,
        scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
        config: {
          windowStart,
          windowEnd,
          weekdaysOnly,
          leaveVoicemail: false,
        },
      });
      toast.success(`Campanha criada: ${data.total} alvos (${data.status})`);
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

  return (
    <>
      <VozCampaignShell
        title="Ligação telefônica"
        subtitle="Número da empresa (Twilio) · áudio MP3/WAV ~20s · caixa postal sem recado."
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm" style={{ color: "var(--pe-text-muted)" }}>
              {contacts.length} contato(s)
            </span>
            <Button
              type="button"
              onClick={() => void createCampaign()}
              disabled={busy || contacts.length === 0 || (!audioUrl && !clipId)}
              className="gap-1.5"
              style={{ background: "var(--pe-emerald)", color: "#fff" }}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Phone className="h-4 w-4" />}
              Criar campanha
            </Button>
          </div>
        }
      >
        <VozSection title="Clipe de voz">
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
        </VozSection>

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
              {campaigns.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-2 rounded-[var(--pe-radius)] border px-3 py-2 text-sm" style={{ borderColor: "var(--pe-border)", background: "var(--pe-surface)" }}>
                  <span className="font-medium truncate flex-1" style={{ color: "var(--pe-text)" }}>{c.name}</span>
                  <Badge variant="secondary">{c.status}</Badge>
                  <span className="text-muted-foreground text-xs">
                    {c.dialed}/{c.total} · ok {c.answered} · falha {c.failed}
                  </span>
                </li>
              ))}
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
