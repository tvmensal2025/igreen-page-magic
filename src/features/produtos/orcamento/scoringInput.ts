// =============================================================================
// Orçamento → pontuação: extrai/grava input de scoring nos line_items
// =============================================================================
// A edge proposal-respond não importa de src/; a lógica de parse é espelhada
// lá. Aqui o builder grava um item kind:"scoring_input" e o front/teste leem.
// =============================================================================

import type { ProposalLineItem } from "./types";

export interface ScoringInputPayload {
  kwh?: number;
  units?: number;
  portabilidade?: boolean;
  plano?: string;
  consumo_kwh?: number;
}

/** Monta o line item oculto com dados para pontuar na aceite. */
export function buildScoringLineItem(input: ScoringInputPayload): ProposalLineItem {
  const parts: string[] = [];
  if (input.kwh != null) parts.push(`${input.kwh} kWh`);
  if (input.units != null) parts.push(`${input.units} un.`);
  if (input.portabilidade === true) parts.push("portabilidade");
  if (input.portabilidade === false) parts.push("sem portabilidade");
  if (input.plano) parts.push(input.plano);

  return {
    label: "Pontuação (interno)",
    value: parts.join(" · ") || "base",
    kind: "scoring_input",
    kwh: input.kwh ?? null,
    units: input.units ?? null,
    portabilidade: input.portabilidade ?? null,
    plano: input.plano ?? null,
    consumo_kwh: input.consumo_kwh ?? null,
  };
}

/** Lê o input de scoring a partir dos line_items da proposta. */
export function extractScoringInputFromLineItems(
  lineItems: unknown,
): ScoringInputPayload {
  const items = Array.isArray(lineItems) ? lineItems : [];
  const scored = items.find(
    (it) => it && typeof it === "object" && (it as { kind?: string }).kind === "scoring_input",
  ) as ProposalLineItem | undefined;

  if (scored) {
    const kwh =
      typeof scored.kwh === "number" && Number.isFinite(scored.kwh)
        ? scored.kwh
        : typeof scored.consumo_kwh === "number" && Number.isFinite(scored.consumo_kwh)
          ? scored.consumo_kwh
          : undefined;
    return {
      kwh,
      units:
        typeof scored.units === "number" && Number.isFinite(scored.units)
          ? scored.units
          : undefined,
      portabilidade:
        typeof scored.portabilidade === "boolean" ? scored.portabilidade : undefined,
      plano: typeof scored.plano === "string" ? scored.plano : undefined,
      consumo_kwh:
        typeof scored.consumo_kwh === "number" && Number.isFinite(scored.consumo_kwh)
          ? scored.consumo_kwh
          : undefined,
    };
  }

  // Fallback: gera/ano em item solar_design → kWh mensal aproximado.
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const it = raw as { kind?: string; value?: string };
    if (it.kind !== "solar_design" || typeof it.value !== "string") continue;
    const m = it.value.match(/([\d.]+)\s*kWh\/ano/i);
    if (m) {
      const yearly = Number(m[1].replace(/\./g, "").replace(",", "."));
      if (Number.isFinite(yearly) && yearly > 0) {
        return { kwh: Math.round(yearly / 12) };
      }
    }
  }

  // Fallback: Portabilidade nos detalhes.
  let portabilidade: boolean | undefined;
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const it = raw as { label?: string; value?: string };
    if (it.label === "Portabilidade" && typeof it.value === "string") {
      portabilidade = /com portabilidade/i.test(it.value);
    }
  }
  if (portabilidade !== undefined) {
    return { units: 1, portabilidade };
  }

  return {};
}

/**
 * Estima kWh mensal a partir da conta de luz em centavos.
 * Tarifa média BR ~ R$ 0,85/kWh (centavos: 85).
 */
export function estimateKwhFromBillCents(billCents: number, tariffCentsPerKwh = 85): number {
  if (!Number.isFinite(billCents) || billCents <= 0 || tariffCentsPerKwh <= 0) return 0;
  return Math.round(billCents / tariffCentsPerKwh);
}
