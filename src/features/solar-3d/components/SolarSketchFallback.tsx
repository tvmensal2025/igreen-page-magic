import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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

  return (
    <div className="rounded-lg border border-dashed p-4 space-y-3 bg-muted/30">
      <p className="text-sm text-muted-foreground">
        Imagem de baixa qualidade ou sem cobertura. Informe dimensões aproximadas da área útil do telhado (metros).
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="sketch-w">Largura (m)</Label>
          <Input id="sketch-w" value={width} onChange={(e) => setWidth(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="sketch-d">Profundidade (m)</Label>
          <Input id="sketch-d" value={depth} onChange={(e) => setDepth(e.target.value)} />
        </div>
      </div>
      <Button type="button" variant="secondary" size="sm" onClick={handleSave} disabled={saving}>
        {saving ? "Salvando…" : "Usar estimativa manual"}
      </Button>
    </div>
  );
}
