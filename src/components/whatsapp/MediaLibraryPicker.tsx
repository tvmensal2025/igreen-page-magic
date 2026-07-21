import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Library,
  Mic,
  Image as ImageIcon,
  Video,
  FileText,
  Search,
  Check,
  Loader2,
  Play,
  Pause,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { dedupeMediaLibraryPreferLightest } from "@/lib/dedupeMediaLibrary";

export type MediaKind = "audio" | "image" | "video";

interface MediaItem {
  id: string;
  source: "library" | "template";
  kind: MediaKind;
  label: string;
  url: string;
  duration_sec?: number | null;
  is_public?: boolean;
  consultant_id?: string | null;
  original_size_bytes?: number | null;
  final_size_bytes?: number | null;
}

interface MediaLibraryPickerProps {
  /** Tipo de mídia que o consultor está procurando. Filtra automaticamente. */
  kind: MediaKind;
  /** ID do consultor (usado para filtrar mídias dele + as públicas). */
  consultantId: string;
  /** Callback ao escolher um item. Recebe a URL pública da mídia. */
  onSelect: (url: string, label: string) => void;
  /** Customiza o label do botão que abre o dialog. */
  triggerLabel?: string;
  /** Quando true, força o dialog aberto (controlado externamente). */
  open?: boolean;
  /** Callback de mudança de visibilidade (modo controlado). */
  onOpenChange?: (open: boolean) => void;
}

const KIND_ICON: Record<MediaKind, typeof Mic> = {
  audio: Mic,
  image: ImageIcon,
  video: Video,
};

const KIND_LABEL: Record<MediaKind, string> = {
  audio: "Áudios",
  image: "Imagens",
  video: "Vídeos",
};

function fmtDuration(sec: number | null | undefined): string {
  if (!sec || sec <= 0) return "";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function MediaPreview({ item }: { item: MediaItem }) {
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      audioEl?.pause();
    };
  }, [audioEl]);

  if (item.kind === "image") {
    return (
      <img
        src={item.url}
        alt={item.label}
        className="w-full h-24 object-cover rounded-md border border-border/40"
        loading="lazy"
        onError={(e) => {
          (e.target as HTMLImageElement).style.opacity = "0.3";
        }}
      />
    );
  }

  if (item.kind === "video") {
    return (
      <video
        src={item.url}
        className="w-full h-24 object-cover rounded-md border border-border/40 bg-black"
        muted
        playsInline
        preload="metadata"
      />
    );
  }

  // Audio
  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!audioEl) {
      const a = new Audio(item.url);
      a.addEventListener("ended", () => setAudioPlaying(false));
      a.play().then(() => setAudioPlaying(true)).catch(() => {});
      setAudioEl(a);
      return;
    }
    if (audioPlaying) {
      audioEl.pause();
      setAudioPlaying(false);
    } else {
      audioEl.play();
      setAudioPlaying(true);
    }
  };

  return (
    <div className="w-full h-24 rounded-md border border-border/40 bg-muted/30 flex items-center justify-center gap-2 px-2">
      <Button
        variant="secondary"
        size="icon"
        className="h-10 w-10 rounded-full shrink-0"
        onClick={toggle}
      >
        {audioPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
      </Button>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] text-muted-foreground truncate">
          {fmtDuration(item.duration_sec) || "Áudio"}
        </p>
        <div className="h-1 bg-muted rounded-full mt-1">
          <div className={cn("h-full bg-primary rounded-full transition-all", audioPlaying ? "w-1/3" : "w-0")} />
        </div>
      </div>
    </div>
  );
}

export function MediaLibraryPicker({
  kind,
  consultantId,
  onSelect,
  triggerLabel,
  open: openProp,
  onOpenChange,
}: MediaLibraryPickerProps) {
  const [openInternal, setOpenInternal] = useState(false);
  const open = openProp ?? openInternal;
  const setOpen = (v: boolean) => {
    setOpenInternal(v);
    onOpenChange?.(v);
  };

  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<"mine" | "public" | "all">("all");
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const queries: PromiseLike<MediaItem[]>[] = [];

        // 1) ai_media_library — mídias do consultor + públicas
        queries.push(
          supabase
            .from("ai_media_library")
            .select("id, kind, label, url, duration_sec, is_public, consultant_id, active, original_size_bytes, final_size_bytes")
            .eq("kind", kind)
            .eq("active", true)
            .not("url", "is", null)
            .or(`consultant_id.eq.${consultantId},and(consultant_id.is.null,is_public.eq.true)`)
            .order("created_at", { ascending: false })
            .limit(200)
            .then(({ data }) =>
              (data || []).map((d: any) => ({
                id: `lib-${d.id}`,
                source: "library" as const,
                kind: d.kind as MediaKind,
                label: d.label || "Sem nome",
                url: d.url,
                duration_sec: d.duration_sec,
                is_public: !!d.is_public,
                consultant_id: d.consultant_id,
                original_size_bytes: d.original_size_bytes ?? null,
                final_size_bytes: d.final_size_bytes ?? null,
              })),
            ),
        );

        // 2) message_templates — templates de mensagem do consultor (apenas com mídia)
        queries.push(
          supabase
            .from("message_templates")
            .select("id, name, media_url, media_type, consultant_id")
            .eq("consultant_id", consultantId)
            .eq("media_type", kind)
            .not("media_url", "is", null)
            .order("created_at", { ascending: false })
            .limit(200)
            .then(({ data }) =>
              (data || []).map((d: any) => ({
                id: `tpl-${d.id}`,
                source: "template" as const,
                kind: d.media_type as MediaKind,
                label: d.name || "Template",
                url: d.media_url,
                consultant_id: d.consultant_id,
              })),
            ),
        );

        const [lib, tpl] = await Promise.all(queries);
        if (cancelled) return;

        // 1) Mesma URL → uma entrada
        // 2) Mesmo título (reuploads) → só a cópia mais leve
        const byUrl = new Map<string, MediaItem>();
        for (const it of [...lib, ...tpl]) {
          const prev = byUrl.get(it.url);
          if (!prev) {
            byUrl.set(it.url, it);
            continue;
          }
          const prevSize = prev.final_size_bytes ?? prev.original_size_bytes ?? Number.MAX_SAFE_INTEGER;
          const nextSize = it.final_size_bytes ?? it.original_size_bytes ?? Number.MAX_SAFE_INTEGER;
          if (nextSize < prevSize) byUrl.set(it.url, it);
        }
        setItems(dedupeMediaLibraryPreferLightest(Array.from(byUrl.values())));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [open, kind, consultantId]);

  const filtered = useMemo(() => {
    let list = items;
    if (scope === "mine") list = list.filter((i) => i.consultant_id === consultantId);
    else if (scope === "public") list = list.filter((i) => i.is_public);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((i) => i.label.toLowerCase().includes(q));
    }
    return list;
  }, [items, scope, search, consultantId]);

  const Icon = KIND_ICON[kind];

  const handleConfirm = () => {
    const item = items.find((i) => i.id === selected);
    if (item) {
      onSelect(item.url, item.label);
      setOpen(false);
      setSelected(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-[10px] gap-1 px-2"
        >
          <Library className="h-3 w-3" />
          {triggerLabel || `Biblioteca`}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-sm flex items-center gap-2">
            <Icon className="h-4 w-4 text-primary" />
            Biblioteca de {KIND_LABEL[kind]}
          </DialogTitle>
        </DialogHeader>

        {/* Toolbar */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar pelo nome..."
              className="pl-7 h-8 text-xs"
            />
          </div>
          <Tabs value={scope} onValueChange={(v) => setScope(v as any)}>
            <TabsList className="h-8 bg-muted/30">
              <TabsTrigger value="all" className="text-[10px] h-6 px-2">Todos</TabsTrigger>
              <TabsTrigger value="mine" className="text-[10px] h-6 px-2">Meus</TabsTrigger>
              <TabsTrigger value="public" className="text-[10px] h-6 px-2">Públicos</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <ScrollArea className="flex-1 -mx-2 px-2">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-xs text-muted-foreground">
              <FileText className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p>Nenhuma {KIND_LABEL[kind].toLowerCase()} encontrado.</p>
              <p className="text-[10px] mt-1">
                Faça upload na aba "IA Agente" → Mídias para reutilizar aqui.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pb-2">
              {filtered.map((item) => {
                const isSelected = selected === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelected(item.id)}
                    className={cn(
                      "relative rounded-lg border p-2 text-left transition-all text-xs space-y-1.5",
                      isSelected
                        ? "border-primary bg-primary/5 ring-2 ring-primary/30"
                        : "border-border/50 hover:border-primary/40 hover:bg-muted/30",
                    )}
                  >
                    <MediaPreview item={item} />
                    <p className="font-medium text-[11px] truncate">{item.label}</p>
                    <div className="flex items-center gap-1 flex-wrap">
                      {item.source === "template" ? (
                        <Badge variant="outline" className="text-[8px] py-0 h-3.5">Template</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[8px] py-0 h-3.5">Biblioteca</Badge>
                      )}
                      {item.is_public && (
                        <Badge variant="secondary" className="text-[8px] py-0 h-3.5 bg-warning/15 text-warning">Público</Badge>
                      )}
                      {item.duration_sec && (
                        <span className="text-[9px] text-muted-foreground tabular-nums">
                          {fmtDuration(item.duration_sec)}
                        </span>
                      )}
                    </div>
                    {isSelected && (
                      <div className="absolute top-1.5 right-1.5 bg-primary text-primary-foreground rounded-full h-5 w-5 flex items-center justify-center shadow-md">
                        <Check className="h-3 w-3" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </ScrollArea>

        <div className="flex justify-between items-center pt-2 border-t">
          <p className="text-[10px] text-muted-foreground">
            {filtered.length} {filtered.length === 1 ? "item" : "itens"} disponível
            {filtered.length === 1 ? "" : "is"}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => setOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              className="h-8 text-xs gap-1"
              disabled={!selected}
              onClick={handleConfirm}
            >
              <Check className="h-3 w-3" />
              Selecionar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
