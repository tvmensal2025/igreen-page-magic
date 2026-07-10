/**
 * CopyCatalogSheet — modal com as 200 copies do catálogo local.
 * Filtra por ângulo (chips) e por texto. Ao clicar num item, envia pro campo
 * correspondente (headline / primary_text / description) do wizard.
 */
import { useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search } from "lucide-react";
import {
  HEADLINES, PRIMARY_TEXTS, DESCRIPTIONS, ANGLE_LABEL,
  renderPlaceholders, CATALOG_TOTALS, type CopyAngle, type CatalogItem,
} from "@/data/copyCatalog";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  distribuidora?: string | null;
  cidade?: string | null;
  onPickHeadline: (text: string) => void;
  onPickPrimary: (text: string) => void;
  onPickDescription: (text: string) => void;
}

type Tab = "headline" | "primary" | "description";

const ANGLES: CopyAngle[] = [
  "economia_concreta", "dor_pas", "prova_social", "quebra_objecao",
  "curiosidade", "urgencia_local", "autoridade", "storytelling",
];

export function CopyCatalogSheet({
  open, onOpenChange, distribuidora, cidade,
  onPickHeadline, onPickPrimary, onPickDescription,
}: Props) {
  const [tab, setTab] = useState<Tab>("headline");
  const [angle, setAngle] = useState<CopyAngle | "all">("all");
  const [q, setQ] = useState("");

  const ctx = { distribuidora: distribuidora ?? null, cidade: cidade ?? null };

  const items: (CatalogItem | { id: string; text: string; angle: null; framework: string; score: number })[] = useMemo(() => {
    const source: any[] = tab === "headline" ? HEADLINES
      : tab === "primary" ? PRIMARY_TEXTS
      : DESCRIPTIONS.map((t, i) => ({ id: `d-${i}`, text: t, angle: null, framework: "curta", score: 70 }));
    return source
      .filter((it) => tab === "description" || angle === "all" || it.angle === angle)
      .filter((it) => {
        if (!q.trim()) return true;
        return it.text.toLowerCase().includes(q.toLowerCase());
      });
  }, [tab, angle, q]);

  const pick = (text: string) => {
    if (tab === "headline") onPickHeadline(text);
    else if (tab === "primary") onPickPrimary(text);
    else onPickDescription(text);
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>📚 Catálogo de copies ({CATALOG_TOTALS.total})</SheetTitle>
          <SheetDescription>
            {CATALOG_TOTALS.headlines} títulos · {CATALOG_TOTALS.primary_texts} textos · {CATALOG_TOTALS.descriptions} descrições — prontos, sem IA.
          </SheetDescription>
        </SheetHeader>

        {/* Tabs simples */}
        <div className="flex gap-1 mt-4 border-b">
          {(["headline", "primary", "description"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-2 text-xs font-medium border-b-2 transition ${tab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}
            >
              {t === "headline" ? "Títulos" : t === "primary" ? "Textos" : "Descrições"}
            </button>
          ))}
        </div>

        {/* Chips de ângulo (não para descrição) */}
        {tab !== "description" && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            <button
              onClick={() => setAngle("all")}
              className={`text-[10px] px-2 py-1 rounded-full border ${angle === "all" ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border"}`}
            >Todos</button>
            {ANGLES.map((a) => (
              <button
                key={a}
                onClick={() => setAngle(a)}
                className={`text-[10px] px-2 py-1 rounded-full border ${angle === a ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border"}`}
              >{ANGLE_LABEL[a]}</button>
            ))}
          </div>
        )}

        {/* Busca */}
        <div className="relative mt-3">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
          <Input
            placeholder="Buscar por palavra..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-8 h-9 text-sm"
          />
        </div>

        {/* Lista */}
        <div className="mt-3 space-y-1.5 pb-8">
          {items.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-8">Nenhum copy corresponde ao filtro.</p>
          )}
          {items.map((it: any) => {
            const rendered = renderPlaceholders(it.text, ctx);
            const wasTemplated = rendered !== it.text;
            return (
              <button
                key={it.id}
                onClick={() => pick(rendered)}
                className="w-full text-left rounded-lg border border-border hover:border-primary bg-card p-2.5 transition-all hover:shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs leading-snug">{rendered}</p>
                  {it.score && (
                    <Badge variant="outline" className="text-[9px] shrink-0">{it.score}</Badge>
                  )}
                </div>
                {(it.angle || wasTemplated) && (
                  <div className="flex items-center gap-1.5 mt-1 text-[9px] text-muted-foreground uppercase">
                    {it.angle && <span>{ANGLE_LABEL[it.angle as CopyAngle]}</span>}
                    {wasTemplated && <span className="text-primary">· personalizado</span>}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
