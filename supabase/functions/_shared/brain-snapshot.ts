/**
 * Snapshot imutável por campanha — a única entrada da camada de DECISÃO.
 *
 * A separação existe para resolver um problema concreto: hoje
 * `facebook-auto-pause` lê métrica, decide e chama a Meta no mesmo laço, então
 * não há como testar a decisão sem mockar a Graph API, nem como saber depois
 * com quais números uma escala foi autorizada.
 *
 * O snapshot carrega a versão (`snapshotVersion`), que é hash do conteúdo
 * medido. Duas leituras com os mesmos números produzem a mesma versão — é isso
 * que impede a mesma amostra autorizar dois aumentos seguidos.
 *
 * Puro: monta a partir de linhas já lidas. Nenhum I/O, nenhuma chamada Meta.
 */
import { canonicalHash } from "./canonical-json.ts";
import type {
  AttributionAggregate,
  CampaignAttributionTotals,
} from "./brain-attribution.ts";
import { totalsForCampaign } from "./brain-attribution.ts";
import type { BrainDataQuality } from "./brain-data-quality.ts";

export const BRAIN_SNAPSHOT_SCHEMA_VERSION = 1;

/** Métricas Meta agregadas na janela. */
export type CampaignMetaMetrics = {
  spendCents: number;
  conversations: number;
  clicks: number;
  impressions: number;
  /** Custo por conversa em centavos. `null` sem conversa. */
  cplCents: number | null;
  ctrBps: number;
  cpmCents: number;
  frequencyX100: number;
};

/** Estado da campanha no momento da medição. */
export type CampaignState = {
  id: string;
  consultantId: string;
  name: string;
  status: string;
  fbCampaignId: string | null;
  dailyBudgetCents: number;
  isAnchor: boolean;
  /** Idade em horas desde `started_at` (ou `created_at`). */
  ageHours: number;
  rejectionReason: string | null;
  brainScaleEnabled: boolean;
  /** ISO da última execução de escala nesta campanha. */
  lastExecutionAtIso: string | null;
};

/** Carteira e queima do consultor. */
export type WalletState = {
  liquidCents: number;
  /** Soma do budget diário de TODAS as campanhas ativas. */
  dailyBurnCents: number;
  /** Queima com a taxa da plataforma aplicada. */
  dailyBurnWithFeeCents: number;
  /** Dias de saldo no ritmo atual. */
  runwayDays: number;
};

/** Decisão anterior relevante para a mesma campanha. */
export type PriorDecisionRef = {
  decidedAtIso: string;
  action: string;
  snapshotVersion: string;
  executed: boolean;
};

export type CampaignBrainSnapshot = {
  schemaVersion: number;
  /** Hash determinístico do conteúdo medido. */
  version: string;
  /** ISO de quando a medição foi montada. */
  measuredAtIso: string;
  campaign: CampaignState;
  meta: CampaignMetaMetrics;
  commercial: CampaignAttributionTotals;
  wallet: WalletState;
  dataQuality: BrainDataQuality;
  priorDecisions: PriorDecisionRef[];
  targetCplCents: number;
};

export type BuildSnapshotInput = {
  measuredAtIso: string;
  campaign: CampaignState;
  meta: CampaignMetaMetrics;
  attribution: AttributionAggregate;
  wallet: WalletState;
  dataQuality: BrainDataQuality;
  priorDecisions?: readonly PriorDecisionRef[];
  targetCplCents: number;
};

/**
 * Campos que entram no hash de versão.
 *
 * Deliberadamente NÃO inclui `measuredAtIso`: o relógio andando não pode
 * transformar a mesma amostra numa amostra nova, senão a trava de "um aumento
 * por snapshot" cai sozinha a cada tick. Inclui a janela e a completude porque
 * mudar a janela muda o que está sendo julgado.
 */
function versionPayload(input: BuildSnapshotInput) {
  return {
    schema: BRAIN_SNAPSHOT_SCHEMA_VERSION,
    campaign_id: input.campaign.id,
    budget: input.campaign.dailyBudgetCents,
    status: input.campaign.status,
    spend: input.meta.spendCents,
    conversations: input.meta.conversations,
    clicks: input.meta.clicks,
    impressions: input.meta.impressions,
    leads_trusted: 0,
    window_start: input.dataQuality.windowStart,
    window_end: input.dataQuality.windowEnd,
    completeness: input.dataQuality.completenessPct,
    target_cpl: input.targetCplCents,
  };
}

export async function buildCampaignSnapshot(
  input: BuildSnapshotInput,
): Promise<CampaignBrainSnapshot> {
  const commercial = totalsForCampaign(input.attribution, input.campaign.id);
  const payload = versionPayload(input);
  payload.leads_trusted = commercial.leadsTrusted;
  const version = await canonicalHash(payload);

  return {
    schemaVersion: BRAIN_SNAPSHOT_SCHEMA_VERSION,
    version,
    measuredAtIso: input.measuredAtIso,
    campaign: input.campaign,
    meta: input.meta,
    commercial,
    wallet: input.wallet,
    dataQuality: input.dataQuality,
    priorDecisions: [...(input.priorDecisions ?? [])],
    targetCplCents: input.targetCplCents,
  };
}

/** Métricas Meta a partir das linhas de `facebook_metrics_daily`. */
export type MetricDailyRow = {
  spend_cents?: number | string | null;
  messaging_conversations_started?: number | string | null;
  clicks?: number | string | null;
  impressions?: number | string | null;
  ctr_bps?: number | string | null;
  cpm_cents?: number | string | null;
  frequency_x100?: number | string | null;
};

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Soma linhas diárias numa métrica de janela.
 *
 * CTR/CPM/frequência são médias ponderadas recalculadas a partir dos totais —
 * somar as colunas diárias produziria "CTR 900 bps" numa janela de 3 dias.
 */
export function aggregateMetaMetrics(
  rows: readonly MetricDailyRow[],
): CampaignMetaMetrics {
  let spendCents = 0;
  let conversations = 0;
  let clicks = 0;
  let impressions = 0;
  let frequencySum = 0;
  let frequencyDays = 0;

  for (const row of rows) {
    spendCents += num(row.spend_cents);
    conversations += num(row.messaging_conversations_started);
    clicks += num(row.clicks);
    impressions += num(row.impressions);
    const freq = num(row.frequency_x100);
    if (freq > 0) {
      frequencySum += freq;
      frequencyDays++;
    }
  }

  return {
    spendCents: Math.round(spendCents),
    conversations: Math.round(conversations),
    clicks: Math.round(clicks),
    impressions: Math.round(impressions),
    cplCents: conversations > 0 ? Math.round(spendCents / conversations) : null,
    ctrBps: impressions > 0 ? Math.round((clicks * 10000) / impressions) : 0,
    cpmCents: impressions > 0
      ? Math.round((spendCents * 1000) / impressions)
      : 0,
    frequencyX100: frequencyDays > 0
      ? Math.round(frequencySum / frequencyDays)
      : 0,
  };
}

/** Runway com a taxa da plataforma já aplicada. */
export const PLATFORM_FEE_MULTIPLIER = 1.2;

export function buildWalletState(input: {
  liquidCents: number;
  activeDailyBudgetCents: number;
}): WalletState {
  const burn = Math.max(0, Math.round(input.activeDailyBudgetCents));
  const withFee = Math.round(burn * PLATFORM_FEE_MULTIPLIER);
  const liquid = Math.max(0, Math.round(input.liquidCents));
  return {
    liquidCents: liquid,
    dailyBurnCents: burn,
    dailyBurnWithFeeCents: withFee,
    // Sem queima o runway é ilimitado; 999 evita dividir por zero no painel.
    runwayDays: withFee > 0 ? Number((liquid / withFee).toFixed(1)) : 999,
  };
}
