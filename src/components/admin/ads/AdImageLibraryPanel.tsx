import { useEffect, useState } from "react";
import { Loader2, Trash2, Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  listAdImageLibrary, removeFromAdImageLibrary,
  type AdImageLibraryItem, type AdImageFormat,
} from "@/services/adImageLibrary";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/ui/confirm-dialog";

interface Props {
  consultantId: string;
  format: AdImageFormat; // formato ativo do step — destacamos os compatíveis
  selectedUrls: Set<string>;
  onPick: (item: AdImageLibraryItem) => void;
}

const FORMAT_LABEL: Record<AdImageFormat, string> = {
  square: "Quadrado 1:1",
  vertical: "Vertical 4:5",
  story: "Story 9:16",
};

export function AdImageLibraryPanel({ consultantId, format, selectedUrls, onPick }: Props) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [items, setItems] = useState<AdImageLibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | AdImageFormat>(format);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => { setFilter(format); }, [format]);

  async function reload() {
    setLoading(true);
    try { setItems(await listAdImageLibrary(consultantId)); }
    catch (e: any) { toast({ title: "Falha ao listar imagens", description: e.message, variant: "destructive" }); }
    finally { setLoading(false); }
  }
  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [consultantId]);

  async function handleRemove(it: AdImageLibraryItem) {
    const ok = await confirm({ title: "Excluir essa imagem da biblioteca?", confirmText: "Excluir", tone: "danger" });
    if (!ok) return;
    setDeletingId(it.id);
    try {
      await removeFromAdImageLibrary(it.id, it.storage_path);
      setItems((prev) => prev.filter((x) => x.id !== it.id));
    } catch (e: any) {
      toast({ title: "Falha ao excluir", description: e.message, variant: "destructive" });
    } finally { setDeletingId(null); }
  }

  const filtered = items.filter((it) => filter === "all" || it.format === filter);
  const counts: Record<string, number> = { all: items.length, square: 0, vertical: 0, story: 0 };
  items.forEach((it) => { counts[it.format]++; });

  if (loading) {
    return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }
  if (items.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-muted-foreground border border-dashed rounded-lg">
        Nenhuma imagem na biblioteca ainda. Envie uma imagem na aba "Enviar novo" — ela fica salva aqui pra reusar.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5 flex-wrap">
        {(["all","square","vertical","story"] as const).map((f) => (
          <Button key={f} type="button" size="sm" variant={filter === f ? "default" : "outline"}
            className="h-7 text-xs" onClick={() => setFilter(f)}>
            {f === "all" ? "Todas" : FORMAT_LABEL[f as AdImageFormat]} ({counts[f] || 0})
          </Button>
        ))}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
        {filtered.map((it) => {
          const picked = selectedUrls.has(it.url);
          const compatible = it.format === format;
          return (
            <div key={it.id} className={`relative group rounded-lg overflow-hidden border ${picked ? "border-primary ring-2 ring-primary/40" : "border-border"} ${!compatible ? "opacity-50" : ""}`}>
              <button type="button" onClick={() => compatible && onPick(it)} disabled={!compatible}
                className="block w-full aspect-square bg-muted">
                <img src={it.url} alt={it.filename || ""} className="w-full h-full object-cover" />
              </button>
              <div className="absolute top-1 left-1 flex gap-1">
                <Badge variant="secondary" className="text-[9px] px-1 py-0">{FORMAT_LABEL[it.format].split(" ")[0]}</Badge>
                {it.fb_image_hash && (
                  <Badge className="text-[9px] px-1 py-0 bg-emerald-600 hover:bg-emerald-600 gap-0.5">
                    <Sparkles className="w-2.5 h-2.5" /> Meta
                  </Badge>
                )}
              </div>
              {picked && (
                <div className="absolute top-1 right-1 bg-primary text-primary-foreground rounded-full p-1">
                  <Check className="w-3 h-3" />
                </div>
              )}
              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent p-1.5 flex items-center justify-between">
                <span className="text-[10px] text-white/90">
                  {it.width}×{it.height}{it.usage_count > 0 ? ` · ${it.usage_count}×` : ""}
                </span>
                <Button type="button" size="icon" variant="ghost" className="h-6 w-6 text-white/80 hover:text-red-300"
                  disabled={deletingId === it.id} onClick={(e) => { e.stopPropagation(); handleRemove(it); }}>
                  {deletingId === it.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
      {!filtered.length && filter !== "all" && (
        <div className="text-xs text-center text-muted-foreground py-4">
          Nenhuma imagem em {FORMAT_LABEL[filter as AdImageFormat]}.
        </div>
      )}
    </div>
  );
}
