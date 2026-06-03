import { useState } from "react";
import { Download, Copy, Check, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import type { MaterialItem } from "@/lib/materialsCatalog";
import { SendViaWhatsAppPopover } from "./SendViaWhatsAppPopover";

interface Props {
  item: MaterialItem;
  consultantId: string | null;
}

export function MaterialCard({ item, consultantId }: Props) {
  const { toast } = useToast();
  const [playing, setPlaying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);

  async function handleDownload(e: React.MouseEvent) {
    e.preventDefault();
    setDownloading(true);
    try {
      const response = await fetch(item.url);
      if (!response.ok) throw new Error("Falha ao baixar");
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch {
      window.open(item.url, "_blank", "noopener,noreferrer");
      toast({ title: "Não foi possível baixar direto", description: "Abrimos em nova aba — use 'Salvar como'" });
    } finally {
      setDownloading(false);
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(item.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({ title: "Não foi possível copiar", variant: "destructive" });
    }
  }

  const filename = item.url.split("/").pop() || `${item.id}.${item.type === "video" ? "mp4" : "jpg"}`;

  return (
    <div className="rounded-lg overflow-hidden border border-border bg-card flex flex-col">
      <div className="relative bg-muted aspect-video">
        {item.type === "video" ? (
          playing ? (
            <video src={item.url} controls autoPlay className="w-full h-full object-contain bg-black" />
          ) : (
            <button
              type="button"
              onClick={() => setPlaying(true)}
              className="w-full h-full flex items-center justify-center bg-black/80 hover:bg-black/70 transition-colors"
            >
              <div className="w-12 h-12 rounded-full bg-primary/90 flex items-center justify-center">
                <Play className="w-5 h-5 text-primary-foreground ml-0.5" fill="currentColor" />
              </div>
            </button>
          )
        ) : (
          <img src={item.url} alt={item.title} loading="lazy" className="w-full h-full object-contain" />
        )}
      </div>
      <div className="p-2.5 space-y-2 flex-1 flex flex-col">
        <div className="flex-1">
          <p className="text-xs font-medium text-foreground line-clamp-1">{item.title}</p>
          <p className="text-[10px] text-muted-foreground uppercase">{item.type}</p>
        </div>
        <div className="flex gap-1.5">
          <Button type="button" size="sm" variant="outline" className="flex-1 gap-1.5" onClick={handleDownload} disabled={downloading}>
            <Download className="w-3.5 h-3.5" />
            {downloading ? "Baixando..." : "Baixar"}
          </Button>
          <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={handleCopy}>
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
          </Button>
        </div>
        <SendViaWhatsAppPopover item={item} consultantId={consultantId} />
      </div>
    </div>
  );
}
