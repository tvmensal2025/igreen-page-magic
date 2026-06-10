import { Facebook, Instagram, MoreHorizontal, ThumbsUp, MessageCircle, Share2, Send } from "lucide-react";
import { useState } from "react";

export type AdFormat = "square" | "vertical" | "story";

interface Props {
  /** Imagens disponíveis por formato. Cada chave usa a primeira foto da lista para o preview. */
  imagesByFormat: Partial<Record<AdFormat, string>>;
  pageName: string;
  headline: string;
  primaryText: string;
  description?: string;
  whatsappNumber: string; // só dígitos
}

/**
 * Renderiza um mockup fiel de como o anúncio aparece no Feed do Facebook
 * e nos Stories do Instagram. CTA fixo: "Enviar mensagem" → WhatsApp.
 */
export function AdPreview({ imagesByFormat, pageName, headline, primaryText, description, whatsappNumber }: Props) {
  const feedImage = imagesByFormat.vertical || imagesByFormat.square || null;
  const feedFormat: "square" | "vertical" = imagesByFormat.vertical ? "vertical" : "square";
  const storyImage = imagesByFormat.story || null;
  const [tab, setTab] = useState<"feed" | "story">("feed");

  return (
    <div className="rounded-2xl border border-border/60 bg-card/60 backdrop-blur-sm p-4 space-y-3 sticky top-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider">📱 Preview do anúncio</div>
        <div className="flex gap-1 text-[11px]">
          <button
            type="button"
            onClick={() => setTab("feed")}
            className={`px-2 py-1 rounded-full flex items-center gap-1 transition ${tab === "feed" ? "bg-primary text-primary-foreground" : "bg-secondary hover:bg-primary/10"}`}
          >
            <Facebook className="w-3 h-3" /> Feed
          </button>
          <button
            type="button"
            onClick={() => setTab("story")}
            className={`px-2 py-1 rounded-full flex items-center gap-1 transition ${tab === "story" ? "bg-primary text-primary-foreground" : "bg-secondary hover:bg-primary/10"}`}
          >
            <Instagram className="w-3 h-3" /> Story
          </button>
        </div>
      </div>

      {tab === "feed" ? (
        <FeedPreview
          imageUrl={feedImage}
          format={feedFormat}
          pageName={pageName}
          headline={headline}
          primaryText={primaryText}
          description={description}
        />
      ) : (
        <StoryPreview imageUrl={storyImage} pageName={pageName} primaryText={primaryText} />
      )}

      <div className="text-[11px] text-muted-foreground rounded-md bg-primary/5 border border-primary/20 p-2 leading-relaxed">
        ↳ Ao tocar em <strong className="text-primary">"Enviar mensagem"</strong>, abre o WhatsApp em <strong className="text-foreground">+{formatWhats(whatsappNumber)}</strong> com a mensagem inicial pronta.
      </div>
    </div>
  );
}

function FeedPreview({
  imageUrl, format, pageName, headline, primaryText, description,
}: { imageUrl: string | null; format: "square" | "vertical"; pageName: string; headline: string; primaryText: string; description?: string }) {
  return (
    <div className="bg-white text-neutral-900 rounded-lg overflow-hidden shadow-lg max-w-[340px] mx-auto font-sans">
      {/* header */}
      <div className="flex items-center gap-2 p-2.5">
        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary to-primary flex items-center justify-center text-white font-bold text-sm">iG</div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold leading-tight truncate">{pageName || "iGreen Energy"}</div>
          <div className="text-[11px] text-neutral-500 leading-tight">Patrocinado · 🌐</div>
        </div>
        <MoreHorizontal className="w-4 h-4 text-neutral-500" />
      </div>
      {/* primary text */}
      {primaryText && (
        <div className="px-2.5 pb-2 text-[13px] leading-snug whitespace-pre-line line-clamp-4">
          {primaryText}
        </div>
      )}
      {/* image */}
      <div className={`bg-neutral-100 ${format === "vertical" ? "aspect-[4/5]" : "aspect-square"} flex items-center justify-center`}>
        {imageUrl ? (
          <img src={imageUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="text-xs text-neutral-400">Suba uma foto para ver aqui</div>
        )}
      </div>
      {/* link card / cta */}
      <div className="px-2.5 py-2 bg-neutral-50 border-t border-neutral-200 flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] text-neutral-500 uppercase">WA.ME</div>
          <div className="text-[13px] font-bold leading-tight truncate">{headline || "Economize na conta de luz"}</div>
          {description && <div className="text-[11px] text-neutral-500 leading-tight truncate">{description}</div>}
        </div>
        <button className="bg-neutral-200 text-neutral-900 text-[12px] font-semibold px-3 py-1.5 rounded-md whitespace-nowrap">
          Enviar mensagem
        </button>
      </div>
      {/* footer reactions */}
      <div className="flex items-center justify-around py-1.5 border-t border-neutral-200 text-neutral-600">
        <button className="flex items-center gap-1 text-[12px]"><ThumbsUp className="w-4 h-4" /> Curtir</button>
        <button className="flex items-center gap-1 text-[12px]"><MessageCircle className="w-4 h-4" /> Comentar</button>
        <button className="flex items-center gap-1 text-[12px]"><Share2 className="w-4 h-4" /> Compartilhar</button>
      </div>
    </div>
  );
}

function StoryPreview({ imageUrl, pageName, primaryText }: { imageUrl: string | null; pageName: string; primaryText: string }) {
  return (
    <div className="relative bg-black rounded-2xl overflow-hidden shadow-lg max-w-[260px] mx-auto aspect-[9/16] text-white">
      {imageUrl ? (
        <img src={imageUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-white/60">Suba uma foto 9:16 para ver aqui</div>
      )}
      <div className="absolute inset-x-0 top-0 p-2.5 bg-gradient-to-b from-black/60 to-transparent">
        <div className="h-0.5 bg-white/60 rounded-full mb-2" />
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary to-primary flex items-center justify-center text-white font-bold text-[11px]">iG</div>
          <div className="text-[11px] font-semibold">{pageName || "iGreen Energy"}</div>
          <div className="text-[10px] text-white/70">· Patrocinado</div>
        </div>
      </div>
      {primaryText && (
        <div className="absolute inset-x-2 bottom-16 text-[12px] leading-snug bg-black/40 backdrop-blur-sm rounded-md p-2 line-clamp-3">
          {primaryText}
        </div>
      )}
      <div className="absolute inset-x-3 bottom-3">
        <button className="w-full bg-white text-black text-[12px] font-bold py-2 rounded-full flex items-center justify-center gap-1.5">
          <Send className="w-3.5 h-3.5" /> Enviar mensagem
        </button>
      </div>
    </div>
  );
}

function formatWhats(d: string): string {
  const x = (d || "").replace(/\D/g, "");
  if (x.length < 12) return x || "—";
  return `${x.slice(0, 2)} ${x.slice(2, 4)} ${x.slice(4, x.length - 4)}-${x.slice(-4)}`;
}