import type { ProposalLineItem } from "@/features/produtos/orcamento/types";
import type { SolarAnalyzeResult } from "../lib/types";

export function solarDesignToLineItems(result: SolarAnalyzeResult): ProposalLineItem[] {
  const m = result.metrics;
  return [
    {
      label: "Sistema fotovoltaico (estimativa)",
      value: `${m.systemSizeKwp} kWp · ${m.panelsCount} módulos · ~${m.yearlyEnergyKwh.toLocaleString("pt-BR")} kWh/ano`,
      kind: "solar_design",
    },
    {
      label: "Economia estimada",
      value: `~R$ ${(m.estimatedMonthlySavingsCents / 100).toFixed(0)}/mês na conta*`,
      kind: "solar_design",
    },
  ];
}

export function suggestProjectAmountCents(systemKwp: number): number {
  return Math.round(systemKwp * 420_000);
}
