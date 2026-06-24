import type { SolarMetrics } from "../lib/types";
import { formatBRLFromCents } from "@/features/produtos/lib/money";

const QUALITY_LABEL: Record<string, { label: string; className: string }> = {
  HIGH: { label: "Alta precisão", className: "text-emerald-600" },
  MEDIUM: { label: "Boa precisão", className: "text-amber-600" },
  BASE: { label: "Precisão básica — vistoria recomendada", className: "text-orange-600" },
  UNKNOWN: { label: "Qualidade desconhecida", className: "text-muted-foreground" },
};

export function SolarMetricsPanel({
  metrics,
  imageryQuality,
}: {
  metrics: SolarMetrics;
  imageryQuality: string;
}) {
  const q = QUALITY_LABEL[imageryQuality] ?? QUALITY_LABEL.UNKNOWN;
  return (
    <div className="grid grid-cols-2 gap-3 text-sm">
      <div className="rounded-lg border bg-card p-3">
        <div className="text-muted-foreground text-xs">Sistema</div>
        <div className="font-semibold">{metrics.systemSizeKwp} kWp</div>
        <div className="text-xs text-muted-foreground">{metrics.panelsCount} módulos</div>
      </div>
      <div className="rounded-lg border bg-card p-3">
        <div className="text-muted-foreground text-xs">Geração/ano</div>
        <div className="font-semibold">{metrics.yearlyEnergyKwh.toLocaleString("pt-BR")} kWh</div>
      </div>
      <div className="rounded-lg border bg-card p-3">
        <div className="text-muted-foreground text-xs">Economia/mês*</div>
        <div className="font-semibold text-primary">
          {formatBRLFromCents(metrics.estimatedMonthlySavingsCents)}
        </div>
      </div>
      <div className="rounded-lg border bg-card p-3">
        <div className="text-muted-foreground text-xs">Imagem</div>
        <div className={`font-medium text-xs ${q.className}`}>{q.label}</div>
        <div className="text-xs text-muted-foreground">Máx. {metrics.maxPanels} módulos</div>
      </div>
    </div>
  );
}
