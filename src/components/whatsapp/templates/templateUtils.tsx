import { Image, Mic, File, Type, Video } from "lucide-react";
import type { TemplateMediaType } from "@/types/whatsapp";

export const MEDIA_TYPES: { value: TemplateMediaType; label: string; icon: React.ElementType; desc: string }[] = [
  { value: "text", label: "Texto", icon: Type, desc: "Mensagem de texto com simulação de digitação" },
  { value: "image", label: "Imagem", icon: Image, desc: "Envia imagem com legenda opcional" },
  { value: "audio", label: "Áudio", icon: Mic, desc: "Envia áudio MP3/OGG como mensagem de voz" },
  { value: "video", label: "Vídeo", icon: Video, desc: "Envia vídeo MP4 com legenda opcional" },
  { value: "document", label: "Documento", icon: File, desc: "Envia PDF ou outro documento" },
];

export function mediaIcon(type: TemplateMediaType) {
  switch (type) {
    case "image": return <Image className="w-3.5 h-3.5 text-blue-400" />;
    case "audio": return <Mic className="w-3.5 h-3.5 text-orange-400" />;
    case "video": return <Video className="w-3.5 h-3.5 text-pink-400" />;
    case "document": return <File className="w-3.5 h-3.5 text-red-400" />;
    default: return <Type className="w-3.5 h-3.5 text-purple-400" />;
  }
}

export function mediaBadge(type: TemplateMediaType) {
  const colors: Record<TemplateMediaType, string> = {
    text: "bg-purple-500/15 text-purple-400 border-purple-500/20",
    image: "bg-blue-500/15 text-blue-400 border-blue-500/20",
    audio: "bg-orange-500/15 text-orange-400 border-orange-500/20",
    video: "bg-pink-500/15 text-pink-400 border-pink-500/20",
    document: "bg-red-500/15 text-red-400 border-red-500/20",
  };
  const labels: Record<TemplateMediaType, string> = { text: "Texto", image: "Imagem", audio: "Áudio", video: "Vídeo", document: "PDF" };
  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md border ${colors[type]}`}>
      {labels[type]}
    </span>
  );
}

export function formatRecordingTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}