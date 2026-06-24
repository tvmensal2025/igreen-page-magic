import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Ruler, Loader2 } from "lucide-react";

export function SolarSketchFallback({
  onSave,
}: {
  onSave: (widthM: number, depthM: number) => void | Promise<void>;
}) {
  const [width, setWidth] = useState("10");
  const [depth, setDepth] = useState("8");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const widthM = Math.max(1, Number(width) || 10);
    const depthM = Math.max(1, Number(depth) || 8);
    setSaving(true);
    try {
      await onSave(widthM, depthM);
    } finally {
      setSaving(false);
    }
  };

  const area = (Math.max(1, Number(width) || 10) * Math.max(1, Number(depth) || 8)).toFixed(0);

  return (
    <div className="rounded-xl border border-dashed border-amber-500/40 bg-amber-50/50 dark:bg-amber-950/20 p-4 space-y-4">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/15">
          <Ruler className="h-4 w-4 text-amber-700 dark:text-amber-400" />
        </div>
        <div>
          <p className="text-sm font-semibold">Imagem limitada nesta região</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Informe as dimensões aproximadas da área útil do telhado para continuar a análise.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="sketch-w" className="text-xs">
            Largura (m)
          </Label>
          <Input id="sketch-w" value={width} onChange={(e) => setWidth(e.target.value)} className="h-10" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sketch-d" className="text-xs">
            Profundidade (m)
          </Label>
          <Input id="sketch-d" value={depth} onChange={(e) => setDepth(e.target.value)} className="h-10" />
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Área estimada: <span className="font-semibold text-foreground">{area} m²</span>
        </p>
        <Button type="button" size="sm" onClick={handleSave} disabled={saving} className="gap-2">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Aplicar medidas
        </Button>
      </div>
    </div>
  );
}
