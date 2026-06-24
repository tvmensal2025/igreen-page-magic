import type { ProposalLineItem } from "@/features/produtos/orcamento/types";
import type { SolarAnalyzeResult } from "../lib/types";

export function solarDesignToLineItems(result: SolarAnalyzeResult): ProposalLineItem[] {
  const m = result.metrics;
  const items: ProposalLineItem[] = [
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
  if (m.paybackYears) {
    items.push({
      label: "Retorno do investimento",
      value: `~${m.paybackYears.toLocaleString("pt-BR")} anos (payback estimado)*`,
      kind: "solar_design",
    });
  }
  if (m.yearlyCo2OffsetKg) {
    items.push({
      label: "Impacto ambiental",
      value: `~${m.yearlyCo2OffsetKg.toLocaleString("pt-BR")} kg de CO₂ evitados por ano`,
      kind: "solar_design",
    });
  }
  return items;
}

export function suggestProjectAmountCents(systemKwp: number): number {
  return Math.round(systemKwp * 420_000);
}
