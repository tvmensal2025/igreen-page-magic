import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import type { SolarMetrics } from "../lib/types";

export function SolarPanelSlider({
  metrics,
  presets,
  onChange,
  onApplyPreset,
}: {
  metrics: SolarMetrics;
  presets?: { eco: { panels: number } | null; ideal: { panels: number } | null };
  onChange: (count: number) => void;
  onApplyPreset?: (count: number) => void;
}) {
  const min = Math.min(4, metrics.maxPanels);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Quantidade de módulos</span>
        <span className="font-semibold">{metrics.panelsCount}</span>
      </div>
      <Slider
        min={min}
        max={metrics.maxPanels}
        step={1}
        value={[metrics.panelsCount]}
        onValueChange={([v]) => onChange(v)}
      />
      {presets && (
        <div className="flex gap-2 flex-wrap">
          {presets.eco && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onApplyPreset?.(presets.eco!.panels)}
            >
              Econômico ({presets.eco.panels})
            </Button>
          )}
          {presets.ideal && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onApplyPreset?.(presets.ideal!.panels)}
            >
              Ideal ({presets.ideal.panels})
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
