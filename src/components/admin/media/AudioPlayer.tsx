import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, Download, Loader2, Repeat } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

// Player de áudio robusto para a biblioteca do admin.
//
// Problema resolvido:
// 1. Alguns áudios foram gravados como .webm (Chrome antigo) e não tocam
//    em Safari desktop/iOS. Aqui declaramos <source type="audio/ogg;codecs=opus">
//    e caímos em <audio src=...> como fallback, plus botão "baixar" quando
//    o player dispara `onError`.
// 2. Áudio .webm também é rejeitado pelo Whapi/WhatsApp como voice message —
//    oferecemos botão "Converter para OGG" que chama a edge function
//    `audio-transcode-ogg` (re-encapsulamento server-side).
// 3. Quando `active=false`, mostramos badge "Inativo — não será enviado".

interface Props {
  mediaId: string;
  url: string;
  fileName?: string | null;
  isActive?: boolean;
  className?: string;
  /** Chamado após conversão OGG bem-sucedida (novo id de media). */
  onConverted?: (newId: string) => void;
  /** Chamado após reativar/desativar o áudio. */
  onActiveChange?: (next: boolean) => void;
}

function extFromUrl(u: string): string {
  try {
    const path = new URL(u).pathname;
    const m = path.match(/\.([a-zA-Z0-9]{2,5})(?:$|\?)/);
    return (m?.[1] || "").toLowerCase();
  } catch {
    const m = u.match(/\.([a-zA-Z0-9]{2,5})(?:$|\?)/);
    return (m?.[1] || "").toLowerCase();
  }
}

function mimeFromExt(ext: string): string {
  switch (ext) {
    case "ogg":
    case "oga":
    case "opus":
      return "audio/ogg; codecs=opus";
    case "mp3":
      return "audio/mpeg";
    case "m4a":
    case "mp4":
      return "audio/mp4";
    case "wav":
      return "audio/wav";
    case "webm":
      return "audio/webm; codecs=opus";
    default:
      return "audio/ogg";
  }
}

export default function AudioPlayer({
  mediaId,
  url,
  fileName,
  isActive,
  className,
  onConverted,
  onActiveChange,
}: Props) {
  const [error, setError] = useState(false);
  const [converting, setConverting] = useState(false);
  const [toggling, setToggling] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const ext = extFromUrl(url);
  const mime = mimeFromExt(ext);
  const isWebm = ext === "webm";

  async function convertToOgg() {
    setConverting(true);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("audio-transcode-ogg", {
        body: { media_id: mediaId },
      });
      if (fnErr) throw fnErr;
      const newId = (data as any)?.new_media_id;
      if (!newId) throw new Error("Resposta inválida do transcode");
      toast.success("✅ Áudio convertido para OGG/Opus", { id: `conv-${mediaId}`, duration: 3000 });
      onConverted?.(newId);
    } catch (e: any) {
      toast.error("Falha ao converter: " + (e?.message || e), { id: `conv-${mediaId}` });
    } finally {
      setConverting(false);
    }
  }

  async function toggleActive() {
    setToggling(true);
    const next = !isActive;
    const { error: e } = await supabase
      .from("ai_media_library")
      .update({ active: next })
      .eq("id", mediaId);
    setToggling(false);
    if (e) {
      toast.error(e.message, { id: `act-${mediaId}` });
      return;
    }
    toast.success(next ? "✅ Áudio ativado" : "⏸️ Áudio desativado", { id: `act-${mediaId}`, duration: 2000 });
    onActiveChange?.(next);
  }

  return (
    <div className={`space-y-1 ${className || ""}`}>
      {!error ? (
        <audio
          ref={audioRef}
          controls
          preload="metadata"
          className="w-full h-8"
          onClick={(e) => e.stopPropagation()}
          onError={() => setError(true)}
        >
          <source src={url} type={mime} />
          <source src={url} />
          Seu navegador não suporta reprodução de áudio.
        </audio>
      ) : (
        <div className="flex items-center gap-2 rounded border border-destructive/40 bg-destructive/5 p-2 text-xs">
          <AlertCircle className="h-3.5 w-3.5 text-destructive flex-shrink-0" />
          <span className="flex-1">Este navegador não conseguiu tocar. Baixe para ouvir localmente.</span>
          <a href={url} download={fileName || undefined} onClick={(e) => e.stopPropagation()}>
            <Button type="button" size="sm" variant="outline" className="h-7 gap-1">
              <Download className="h-3 w-3" /> Baixar
            </Button>
          </a>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-[10px]">
        <Badge variant="outline" className="uppercase">{ext || "?"}</Badge>
        {isActive === false && (
          <Badge variant="destructive" className="gap-1">
            <AlertCircle className="h-3 w-3" />
            Inativo — não será enviado ao lead
          </Badge>
        )}
        {isWebm && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-6 text-[10px] gap-1"
            disabled={converting}
            onClick={(e) => { e.stopPropagation(); convertToOgg(); }}
          >
            {converting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Repeat className="h-3 w-3" />}
            Converter para OGG (necessário p/ WhatsApp)
          </Button>
        )}
        {typeof isActive === "boolean" && onActiveChange && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 text-[10px]"
            disabled={toggling}
            onClick={(e) => { e.stopPropagation(); toggleActive(); }}
          >
            {toggling ? <Loader2 className="h-3 w-3 animate-spin" /> : isActive ? "Desativar" : "Ativar"}
          </Button>
        )}
      </div>
    </div>
  );
}
