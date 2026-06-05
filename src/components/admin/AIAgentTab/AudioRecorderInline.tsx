import { useEffect, useRef, useState } from "react";
import { Mic, Square, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { loadOpusRecorder } from "@/lib/opusRecorderLoader";
import { toast } from "sonner";

type Props = {
  onRecorded: (blob: Blob, durationSec: number) => Promise<void> | void;
  disabled?: boolean;
};

export function AudioRecorderInline({ onRecorded, disabled }: Props) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [saving, setSaving] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recorderRef = useRef<any>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

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
      recorder.ondataavailable = (arrayBuffer: ArrayBuffer) => {
        const blob = new Blob([arrayBuffer], { type: "audio/ogg; codecs=opus" });
        setPreviewBlob(blob);
        setPreviewUrl(URL.createObjectURL(blob));
      };
      await recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch (e) {
      console.error("mic error", e);
      toast.error("Falha ao iniciar gravação. Verifique a permissão do microfone.");
    }
  }

  function stop() {
    const rec = recorderRef.current;
    if (rec) { try { rec.stop(); } catch {} }
    setRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
  }

  function discard() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setPreviewBlob(null);
    setSeconds(0);
  }

  async function save() {
    if (!previewBlob) return;
    if (seconds < 3) { toast.error("Áudio muito curto (mínimo 3s)."); return; }
    if (seconds > 600) { toast.error("Áudio muito longo (máximo 10 minutos)."); return; }
    setSaving(true);
    try {
      await onRecorded(previewBlob, seconds);
      discard();
    } finally {
      setSaving(false);
    }
  }

  if (previewUrl) {
    return (
      <div className="flex flex-col gap-2 p-3 rounded-lg border border-border bg-muted/30">
        <audio src={previewUrl} controls className="w-full h-9" />
        <div className="flex gap-2">
          <Button size="sm" onClick={save} disabled={saving} className="flex-1">
            {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Salvar e ativar
          </Button>
          <Button size="sm" variant="outline" onClick={discard} disabled={saving}>
            <Trash2 className="w-4 h-4 mr-1" /> Regravar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Button
      size="sm"
      variant={recording ? "destructive" : "outline"}
      onClick={recording ? stop : start}
      disabled={disabled}
      className="gap-2"
    >
      {recording ? (
        <>
          <Square className="w-4 h-4" /> Gravando {Math.floor(seconds / 60)}:{(seconds % 60).toString().padStart(2, "0")} — toque para parar
        </>
      ) : (
        <>
          <Mic className="w-4 h-4" /> Gravar o meu
        </>
      )}
    </Button>
  );
}
