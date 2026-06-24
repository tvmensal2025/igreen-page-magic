import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SolarMap2D } from "./SolarMap2D";
import { SolarMetricsPanel } from "./SolarMetricsPanel";
import { SolarPanelSlider } from "./SolarPanelSlider";
import { SolarDisclaimer } from "./SolarDisclaimer";
import { SolarSketchFallback } from "./SolarSketchFallback";
import type { SolarAnalyzeResult } from "../lib/types";
import { Sparkles } from "lucide-react";

const QUALITY_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  HIGH: { label: "Alta precisão", variant: "default" },
  MEDIUM: { label: "Boa precisão", variant: "secondary" },
  BASE: { label: "Vistoria recomendada", variant: "outline" },
  UNKNOWN: { label: "Estimativa", variant: "outline" },
};

export function SolarAnalysisResults({
  result,
  view3d,
  onView3dChange,
  manualApplied,
  onManualSketch,
  onPanelsChange,
  onUseInProposal,
  showProposalAction = true,
  applyLabel = "Usar na proposta Placas",
  compact = false,
}: {
  result: SolarAnalyzeResult;
  view3d: boolean;
  onView3dChange: (v: boolean) => void;
  manualApplied: boolean;
  onManualSketch: (widthM: number, depthM: number) => void | Promise<void>;
  onPanelsChange: (count: number) => void | Promise<void>;
  onUseInProposal?: () => void;
  showProposalAction?: boolean;
  applyLabel?: string;
  compact?: boolean;
}) {
  const q = QUALITY_BADGE[result.imageryQuality] ?? QUALITY_BADGE.UNKNOWN;

  return (
    <div className={`space-y-4 ${compact ? "" : "pt-1"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant={q.variant} className="text-[10px] font-medium">
            {q.label}
          </Badge>
          {result.mock && (
            <Badge variant="outline" className="text-[10px]">
              Demonstração
            </Badge>
          )}
        </div>
        <div className="flex rounded-lg border bg-muted/40 p-0.5">
          <button
            type="button"
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${!view3d ? "bg-background shadow-sm" : "text-muted-foreground"}`}
            onClick={() => onView3dChange(false)}
          >
            Mapa 2D
          </button>
          <button
            type="button"
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${view3d ? "bg-background shadow-sm" : "text-muted-foreground"}`}
            onClick={() => onView3dChange(true)}
          >
            Vista 3D
          </button>
        </div>
      </div>

      {result.imageryQuality === "BASE" && !manualApplied && (
        <SolarSketchFallback onSave={onManualSketch} />
      )}

      {view3d ? (
        <div className="rounded-xl border bg-gradient-to-br from-slate-900 to-slate-800 p-6 text-center text-sm text-slate-200">
          <p className="mb-3">Visualização 3D interativa disponível na página de detalhe.</p>
          <Button asChild size="sm" variant="secondary">
            <Link to={`/admin/solar-design/${result.snapshotId}`}>Abrir visualização 3D</Link>
          </Button>
        </div>
      ) : (
        <SolarMap2D
          panelPositions={result.panelPositions}
          roofSegments={result.roofSegments}
          className="shadow-md ring-1 ring-black/5"
        />
      )}

      <SolarMetricsPanel metrics={result.metrics} imageryQuality={result.imageryQuality} />

      <div className="rounded-xl border bg-card p-4 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Ajuste o sistema
        </p>
        <SolarPanelSlider
          metrics={result.metrics}
          presets={result.presets}
          onChange={onPanelsChange}
          onApplyPreset={onPanelsChange}
        />
      </div>

      <div className="rounded-xl bg-gradient-to-br from-amber-50 to-emerald-50 dark:from-amber-950/30 dark:to-emerald-950/20 border border-amber-200/50 dark:border-amber-800/30 p-4 space-y-2">
        <div className="flex items-center gap-2 text-amber-800 dark:text-amber-200">
          <Sparkles className="h-4 w-4 shrink-0" />
          <span className="text-xs font-semibold uppercase tracking-wide">Resumo comercial</span>
        </div>
        <p className="text-sm leading-relaxed text-foreground/90">{result.salesBlurb}</p>
      </div>

      <SolarDisclaimer />

      {showProposalAction && onUseInProposal && (
        <Button className="w-full h-11 text-base font-semibold shadow-lg shadow-primary/20" onClick={onUseInProposal}>
          {applyLabel}
        </Button>
      )}
    </div>
  );
}
