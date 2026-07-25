/**
 * Apoio à cobrança de gasto Meta.
 *
 * A aritmética do dinheiro (delta, taxa, total) vive NO BANCO, dentro de
 * `debit_campaign_spend_observation`, para ser atômica com o checkpoint e com a
 * observação única. Aqui ficam só coisas de apresentação e o contrato de
 * resposta do RPC — nada que decida valor cobrado.
 */

export interface SpendActivityDeltas {
  impressions: number;
  clicks: number;
  leads: number;
}

/**
 * Rótulo legível do que aconteceu desde a última cobrança, usado na descrição
 * da transação da carteira ("3 impr., 1 clique"). Só conta variação positiva:
 * a Meta às vezes revisa números para baixo e "-2 cliques" não ajuda ninguém.
 */
export function buildSpendActivityLabel(deltas: SpendActivityDeltas): string {
  const impressions = Math.max(0, Math.trunc(deltas.impressions || 0));
  const clicks = Math.max(0, Math.trunc(deltas.clicks || 0));
  const leads = Math.max(0, Math.trunc(deltas.leads || 0));

  const parts = [
    impressions > 0 ? `${impressions} impr.` : null,
    clicks > 0 ? `${clicks} clique${clicks > 1 ? "s" : ""}` : null,
    leads > 0 ? `${leads} lead${leads > 1 ? "s" : ""}` : null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(", ") : "sem novas interações";
}

/** Retorno de `debit_campaign_spend_observation`. */
export interface SpendChargeResult {
  charged: boolean;
  reason:
    | "charged"
    | "no_delta"
    | "duplicate_observation"
    | "campaign_not_found"
    | "invalid_arguments"
    | "invalid_observation"
    | string;
  delta_spend_cents?: number;
  fee_cents?: number;
  charged_cents?: number;
  synced_to_wallet_cents?: number;
  balance_after_cents?: number;
  observation_id?: string;
}

/**
 * Normaliza a resposta do RPC. Resposta ausente/ilegível NÃO é tratada como
 * cobrança feita — o próximo ciclo tenta de novo com segurança, porque a
 * unicidade da observação impede cobrar duas vezes.
 */
export function parseSpendChargeResult(raw: unknown): SpendChargeResult {
  if (!raw || typeof raw !== "object") {
    return { charged: false, reason: "invalid_rpc_response" };
  }
  const row = raw as Record<string, unknown>;
  return {
    charged: row.charged === true,
    reason: typeof row.reason === "string" ? row.reason : "unknown",
    delta_spend_cents: Number(row.delta_spend_cents ?? 0),
    fee_cents: Number(row.fee_cents ?? 0),
    charged_cents: Number(row.charged_cents ?? 0),
    synced_to_wallet_cents: Number(row.synced_to_wallet_cents ?? 0),
    balance_after_cents: row.balance_after_cents === null ||
        row.balance_after_cents === undefined
      ? undefined
      : Number(row.balance_after_cents),
    observation_id: typeof row.observation_id === "string"
      ? row.observation_id
      : undefined,
  };
}
