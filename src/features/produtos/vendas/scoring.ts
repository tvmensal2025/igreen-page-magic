// =============================================================================
// Vendas — Cálculo de pontos kWh-equivalente
// =============================================================================
// Funções puras (testáveis) que traduzem uma venda em pontos kWh-equivalente
// conforme a regra de pontuação do produto (products.scoring_rule), seguindo
// os manuais iGreen (qualificação-igreen, manual-conexao-placas,
// manual-conexao-igreen-telecom).
//
// Tabela de referência (manual de qualificação):
//   Conexão Green:   100% do kWh contratado enquanto ativo
//   Conexão Solar:   100% do kWh gerado na proposta enquanto ativo
//   Conexão Placas:  4x o kWh da proposta por 12 meses
//   Conexão Livre:   até 100% do kWh contratado
//   Conexão Telecom: 200 kWh por cliente conectado (portabilidade)
// =============================================================================

import type { ScoringRule } from "../catalogo/types";
import type { CaptureData, TelecomCaptureData } from "./types";

export interface ScoringInput {
  /** kWh contratado/gerado informado na venda (energia, placas, livre). */
  kwh?: number;
  /** Quantidade de unidades (telecom: nº de planos/chips conectados). */
  units?: number;
  /** Dados de captura — usados p/ regras condicionais (ex.: portabilidade). */
  captureData?: CaptureData;
}

/**
 * Calcula os pontos kWh-equivalente de uma venda.
 * Retorna 0 quando a regra não pontua ou faltam dados.
 */
export function computePointsKwh(rule: ScoringRule, input: ScoringInput): number {
  switch (rule.mode) {
    case "contracted_kwh": {
      const kwh = input.kwh ?? 0;
      return round2(kwh * rule.multiplier);
    }
    case "proposal_kwh": {
      const kwh = input.kwh ?? 0;
      return round2(kwh * rule.multiplier);
    }
    case "fixed_per_unit": {
      // Telecom: só clientes de portabilidade contam como ativos/pontuáveis.
      if (rule.only_portability) {
        const telecom = input.captureData as TelecomCaptureData | undefined;
        const isPortability = telecom?.portabilidade === true;
        if (!isPortability) return 0;
      }
      const units = input.units ?? 1;
      return round2(units * rule.kwh_per_unit);
    }
    case "none":
    default:
      return 0;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
