/**
 * LEGADO / NÃO MONTADO na UI (Admin → Ligação usa só PSTN Twilio).
 * Mantido no repo; não importar em VozTab.
 * Painel A — campanha de áudio WhatsApp (~20s) via bulk_campaigns.
 */
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Loader2, Mic, Square, Upload, Send, Users, X } from "lucide-react";
import { toast } from "sonner";
import { uploadMedia } from "@/services/minioUpload";
import { createCampaign } from "@/components/whatsapp/bulk-pro/useCampaignPersistence";
import type { CampaignTarget } from "@/components/whatsapp/bulk-pro/types";
import { loadOpusRecorder } from "@/lib/opusRecorderLoader";
import type { BulkContact } from "@/types/whatsapp";
import { VozCampaignShell, VozSection } from "./VozCampaignShell";
import { VozContactPickerDialog, type VozCustomer } from "./VozContactPickerDialog";

interface Props {
  consultantId: string;
  customers: VozCustomer[];
}

export function AudioWhatsAppCampaignPanel({ consultantId, customers }: Props) {
  const [name, setName] = useState("Áudio WhatsApp");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioName, setAudioName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recSec, setRecSec] = useState(0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [recorder, setRecorder] = useState<any>(null);
  const [contacts, setContacts] = useState<BulkContact[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  const [windowStart, setWindowStart] = useState("09:00");
  const [windowEnd, setWindowEnd] = useState("20:00");
  const [weekdaysOnly, setWeekdaysOnly] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setRecSec((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);

  const handleUploadFile = async (file: File) => {
    setUploading(true);
    try {
      const res = await uploadMedia(file, undefined, {
        scope: "admin",
        consultant_id: consultantId,
        kind: "audio",
        slug: "voz-whatsapp",
      });
      setAudioUrl(res.url);
      setAudioName(file.name);
      toast.success("Áudio enviado");
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
        const file = new File([blob], `voz-${Date.now()}.ogg`, { type: "audio/ogg" });
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

  const removeContact = useCallback((id: string) => {
    setContacts((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const submit = async () => {
    if (!audioUrl) {
      toast.error("Grave ou envie um áudio (~20s) primeiro");
      return;
    }
    if (contacts.length === 0) {
      toast.error("Selecione clientes ou leads parados");
      return;
    }
    setSubmitting(true);
    try {
      const targets: CampaignTarget[] = contacts.map((c) => ({
        id: c.id,
        phone: c.phone.replace(/\D/g, ""),
        name: c.name,
        status: "queued",
      }));
      const id = await createCampaign({
        consultantId,
        name: name.trim() || "Áudio WhatsApp",
        messageText: "",
        mediaUrl: audioUrl,
        mediaType: "audio",
        mediaFilename: audioName || "audio.ogg",
        config: {
          windowStart,
          windowEnd,
          weekdaysOnly,
          mediaOrder: "media_first",
        },
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
        targets,
      });
      if (!id) {
        toast.error("Falha ao criar campanha");
        return;
      }
      toast.success(`Campanha criada: ${targets.length} áudios na fila`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <VozCampaignShell
        title="Áudio no WhatsApp"
        subtitle="Grave ~20s e dispare como mensagem de voz — mesmo motor do Disparo PRO."
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-[#064e3b]">
              {contacts.length} contato(s) · {audioUrl ? "áudio pronto" : "sem áudio"}
            </span>
            <Button
              type="button"
              onClick={() => void submit()}
              disabled={submitting || !audioUrl || contacts.length === 0}
              className="gap-1.5 text-white"
              style={{ background: "var(--gradient-green, #064e3b)" }}
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Disparar áudio
            </Button>
          </div>
        }
      >
        <VozSection title="Campanha">
          <div className="space-y-1.5">
            <Label className="text-foreground">Nome</Label>
            <Input className="bg-white" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        </VozSection>

        <VozSection title="Áudio (~20 segundos)">
          <div className="flex flex-wrap gap-2">
            {!recording ? (
              <Button type="button" variant="outline" className="bg-white" onClick={() => void startRec()} disabled={uploading}>
                <Mic className="h-4 w-4 mr-2" /> Gravar
              </Button>
            ) : (
              <Button type="button" variant="destructive" onClick={stopRec}>
                <Square className="h-4 w-4 mr-2" /> Parar ({recSec}s)
              </Button>
            )}
            <label className="inline-flex">
              <Button type="button" variant="outline" className="bg-white" asChild disabled={uploading}>
                <span>
                  {uploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
                  Upload OGG/MP3
                </span>
              </Button>
              <input
                type="file"
                accept="audio/ogg,audio/mpeg,audio/mp4,.ogg,.mp3,.m4a"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleUploadFile(f);
                }}
              />
            </label>
          </div>
          {audioUrl && <audio controls src={audioUrl} className="w-full mt-1" />}
        </VozSection>

        <VozSection title="Destinatários">
          <Button
            type="button"
            variant="outline"
            className="bg-white gap-2"
            onClick={() => setPickerOpen(true)}
          >
            <Users className="h-4 w-4" />
            Selecionar clientes / leads parados
          </Button>
          {contacts.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {contacts.slice(0, 12).map((c) => (
                <Badge key={c.id} variant="secondary" className="gap-1 pr-1 bg-primary/10 text-primary border-primary/20">
                  <span className="max-w-[120px] truncate">{c.name || c.phone}</span>
                  <button type="button" className="rounded p-0.5 hover:bg-primary/20" onClick={() => removeContact(c.id)}>
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
              {contacts.length > 12 && (
                <Badge variant="outline">+{contacts.length - 12}</Badge>
              )}
            </div>
          )}
        </VozSection>

        <VozSection title="Janela e agendamento">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Agendar</Label>
              <Input className="bg-white" type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Início</Label>
              <Input className="bg-white" type="time" value={windowStart} onChange={(e) => setWindowStart(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Fim</Label>
              <Input className="bg-white" type="time" value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} />
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <Switch checked={weekdaysOnly} onCheckedChange={setWeekdaysOnly} id="wa-weekdays" />
            <Label htmlFor="wa-weekdays">Somente dias úteis</Label>
          </div>
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
