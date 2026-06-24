import type { SolarMetrics } from "../lib/types";
import { formatBRLFromCents } from "@/features/produtos/lib/money";
import { Sun, Zap, PiggyBank, Layers } from "lucide-react";

const QUALITY_LABEL: Record<string, { label: string; className: string }> = {
  HIGH: { label: "Alta precisão", className: "text-emerald-600 dark:text-emerald-400" },
  MEDIUM: { label: "Boa precisão", className: "text-amber-600 dark:text-amber-400" },
  BASE: { label: "Vistoria recomendada", className: "text-orange-600 dark:text-orange-400" },
  UNKNOWN: { label: "Estimativa", className: "text-muted-foreground" },
};

export function SolarMetricsPanel({
  metrics,
  imageryQuality,
}: {
  metrics: SolarMetrics;
  imageryQuality: string;
}) {
  const q = QUALITY_LABEL[imageryQuality] ?? QUALITY_LABEL.UNKNOWN;

  const cards = [
    {
      icon: Sun,
      label: "Potência",
      value: `${metrics.systemSizeKwp} kWp`,
      sub: `${metrics.panelsCount} módulos · máx. ${metrics.maxPanels}`,
      accent: "from-amber-500/15 to-orange-500/5 border-amber-500/20",
      iconClass: "text-amber-600",
    },
    {
      icon: Zap,
      label: "Geração anual",
      value: `${metrics.yearlyEnergyKwh.toLocaleString("pt-BR")}`,
      sub: "kWh estimados",
      accent: "from-sky-500/15 to-blue-500/5 border-sky-500/20",
      iconClass: "text-sky-600",
    },
    {
      icon: PiggyBank,
      label: "Economia mensal",
      value: formatBRLFromCents(metrics.estimatedMonthlySavingsCents),
      sub: "estimativa na conta*",
      accent: "from-emerald-500/15 to-green-500/5 border-emerald-500/20",
      iconClass: "text-emerald-600",
    },
    {
      icon: Layers,
      label: "Qualidade",
      value: q.label,
      sub: `${metrics.panelCapacityWatts} W por módulo`,
      accent: "from-violet-500/10 to-purple-500/5 border-violet-500/20",
      iconClass: q.className,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3">
      {cards.map((c) => (
        <div
          key={c.label}
          className={`rounded-xl border bg-gradient-to-br p-3.5 ${c.accent}`}
        >
          <div className="flex items-center gap-2 mb-2">
            <c.icon className={`h-4 w-4 shrink-0 ${c.iconClass}`} />
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {c.label}
            </span>
          </div>
          <div className="text-lg font-bold leading-tight tracking-tight">{c.value}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">{c.sub}</div>
        </div>
      ))}
    </div>
  );
}
