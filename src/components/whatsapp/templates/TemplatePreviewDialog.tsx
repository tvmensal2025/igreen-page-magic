import { File, Play } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { MessageTemplate, TemplateMediaType, TemplateItem } from "@/types/whatsapp";
import { mediaIcon, mediaBadge } from "./templateUtils";

interface Props {
  template: MessageTemplate | null;
  onClose: () => void;
}

function ItemPreview({ item, index }: { item: TemplateItem; index: number }) {
  return (
    <div className="rounded-lg border border-border/40 bg-secondary/20 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-muted-foreground font-bold">#{index + 1}</span>
        {mediaBadge((item.message_type as TemplateMediaType) || "text")}
        {index > 0 && item.delay_seconds > 0 && (
          <span className="text-[10px] text-muted-foreground">⏱ {item.delay_seconds}s</span>
        )}
      </div>
      {item.media_url && item.message_type === "image" && (
        <img src={item.media_url} alt="" className="rounded-lg max-h-40 object-contain" />
      )}
      {item.media_url && item.message_type === "video" && (
        <video src={item.media_url} controls className="rounded-lg max-h-40 w-full object-contain bg-black" />
      )}
      {item.media_url && item.message_type === "audio" && (
        <audio controls src={item.media_url} className="w-full h-10" />
      )}
      {item.media_url && item.message_type === "document" && (
        <a href={item.media_url} target="_blank" rel="noopener noreferrer" className="text-xs text-info hover:underline flex items-center gap-1">
          <File className="w-3.5 h-3.5" /> Abrir documento
        </a>
      )}
      {item.message_text && (
        <p className="text-sm text-foreground whitespace-pre-wrap">{item.message_text}</p>
      )}
    </div>
  );
}

export function TemplatePreviewDialog({ template, onClose }: Props) {
  const items = template?.items && template.items.length > 0 ? template.items : null;

  return (
    <Dialog open={!!template} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {template && mediaIcon((template.media_type as TemplateMediaType) || "text")}
            {template?.name}
          </DialogTitle>
        </DialogHeader>
        {template && (
          <div className="space-y-3">
            {/* Multi-item: mostra cada arquivo em ordem */}
            {items ? (
              <>
                <p className="text-[10px] text-muted-foreground font-bold">
                  {items.length} {items.length === 1 ? "item" : "itens"} — enviados nesta ordem:
                </p>
                {items.map((it, i) => (
                  <ItemPreview key={it.id || i} item={it} index={i} />
                ))}
              </>
            ) : (
              /* Legado: template de mídia única */
              <>
                <div className="flex items-center gap-2">
                  {mediaBadge((template.media_type as TemplateMediaType) || "text")}
                  {template.media_type === "text" && (
                    <span className="text-[10px] text-primary/80 flex items-center gap-1">
                      <Play className="w-3 h-3" /> Simulação de digitação
                    </span>
                  )}
                </div>

                {template.media_url && (
                  <div className="rounded-lg border border-border/40 bg-secondary/20 p-3">
                    <p className="text-[10px] text-muted-foreground mb-1 font-bold">Mídia anexada:</p>
                    {template.media_type === "image" && (
                      <img src={template.media_url} alt="Preview" className="rounded-lg max-h-40 object-contain" />
                    )}
                    {template.media_type === "audio" && (
                      <audio controls src={template.media_url} className="w-full h-10" />
                    )}
                    {template.media_type === "document" && (
                      <a href={template.media_url} target="_blank" rel="noopener noreferrer" className="text-xs text-info hover:underline flex items-center gap-1">
                        <File className="w-3.5 h-3.5" /> Abrir documento
                      </a>
                    )}
                  </div>
                )}

                {template.image_url && (
                  <div className="rounded-lg border border-info/20 bg-info/5 p-3">
                    <p className="text-[10px] text-muted-foreground mb-1 font-bold">📷 Imagem anexa:</p>
                    <img src={template.image_url} alt="Imagem anexa" className="rounded-lg max-h-40 object-contain" />
                  </div>
                )}

                {template.content && (
                  <div className="rounded-xl bg-primary/20 border border-primary/10 px-4 py-3 max-w-[280px]">
                    <p className="text-sm text-foreground whitespace-pre-wrap">{template.content}</p>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
