import { useState, useRef, useEffect } from "react";
import { Mic, Square, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { loadOpusRecorder } from "@/lib/opusRecorderLoader";
import { uploadMedia } from "@/services/minioUpload";
import { toast } from "@/components/ui/sonner";

interface Props {
  consultantId: string;
  /** Slug usado no MinIO (ex: voz-bloco-1, voz-nome-ana). */
  slug: string;
  /** Label do botão quando ocioso. */
  idleLabel?: string;
  /** Texto mostrado quando já tem áudio (se reusar com replace). */
  hasAudioLabel?: string;
  size?: "sm" | "default";
  /** Chamado após upload bem-sucedido com a URL pública. */
  onUploaded: (url: string) => Promise<void> | void;
  disabled?: boolean;
}

/**
 * Gravador de um único clipe (parte fixa ou nome).
 * Grava OGG/Opus 16 kHz mono — MESMOS parâmetros das mensagens de áudio
 * pra que a concatenação no servidor produza um arquivo válido.
 */
export function VoiceClipRecorder({ consultantId, slug, idleLabel = "Gravar", hasAudioLabel, size = "sm", onUploaded, disabled }: Props) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [uploading, setUploading] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recRef = useRef<any>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  async function start() {
    try {
      const Recorder = await loadOpusRecorder();
      const recorder = new Recorder({
        encoderPath: "/opus/encoderWorker.min.js",
        encoderApplication: 2048,
        encoderSampleRate: 16000,
        encoderFrameSize: 20,
        numberOfChannels: 1,
        streamPages: false,
        rawOpus: false,
      });
      recorder.ondataavailable = async (buf: ArrayBuffer) => {
        try {
          setUploading(true);
          const blob = new Blob([buf], { type: "audio/ogg; codecs=opus" });
          const file = new File([blob], `${slug}.ogg`, { type: blob.type });
          const res = await uploadMedia(file, undefined, {
            scope: "template", consultant_id: consultantId, kind: "voice-clip", slug,
          });
          await onUploaded(res.url);
          toast.success("Áudio salvo");
        } catch (e: any) {
          toast.error(e?.message || "Falha ao subir áudio");
        } finally {
          setUploading(false);
        }
      };
      await recorder.start();
      recRef.current = recorder;
      setRecording(true);
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch (e) {
      console.error(e);
      toast.error("Não foi possível acessar o microfone");
    }
  }

  function stop() {
    try { recRef.current?.stop(); } catch {}
    setRecording(false);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }

  return (
    <Button
      type="button" size={size}
      variant={recording ? "destructive" : "outline"}
      onClick={recording ? stop : start}
      disabled={disabled || uploading}
      className="gap-2"
    >
      {uploading ? (<><Loader2 className="w-3.5 h-3.5 animate-spin" /> Enviando…</>)
      : recording ? (<><Square className="w-3.5 h-3.5" /> {Math.floor(seconds/60)}:{(seconds%60).toString().padStart(2,"0")} — parar</>)
      : (<><Mic className="w-3.5 h-3.5" /> {hasAudioLabel || idleLabel}</>)}
    </Button>
  );
}
