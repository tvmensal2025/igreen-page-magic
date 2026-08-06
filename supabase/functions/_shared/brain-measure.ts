/**
 * Camada de MEDIÇÃO — a única parte do Cérebro que lê o banco.
 *
 * Só lê e normaliza: métricas Meta, leads atribuídos, carteira, orçamento e
 * decisões anteriores. Não recomenda e não executa. A saída é uma lista de
 * snapshots imutáveis, que é tudo que a camada de decisão precisa.
 *
 * Reaproveita o que já existia:
 *  - `facebook_metrics_daily` / `facebook_campaigns` / `consultant_wallet`
 *    (mesmas tabelas de `campaign-brain-rank` e `meta-ads-metrics`);
 *  - `META_CAMPAIGN_PROOF_OR` como filtro canônico de prova Meta;
 *  - `resolveAnchorCampaignId` para saber quem é a âncora.
 */
import { META_CAMPAIGN_PROOF_OR } from "./meta-campaign-proof.ts";
import { resolveAnchorCampaignId } from "./ads-anchor.ts";
import {
  aggregateAttribution,
  type AttributableCustomer,
} from "./brain-attribution.ts";
import {
  type BrainDataQuality,
  evaluateBrainDataQuality,
} from "./brain-data-quality.ts";
import {
  aggregateMetaMetrics,
  buildCampaignSnapshot,
  buildWalletState,
  type CampaignBrainSnapshot,
  type MetricDailyRow,
} from "./brain-snapshot.ts";
import {
  type BrainDecisionPolicy,
  resolveBrainDecisionPolicy,
  resolveTargetCplCents,
} from "./brain-policy.ts";

type MinimalClient = { from: (table: string) => any };

export type MeasureInput = {
  consultantId: string;
  /** Fim da janela (exclusivo no lado dos leads). Default: agora. */
  nowMs?: number;
  /** Tamanho da janela em dias. Default 2 (mesma janela do motor atual). */
  windowDays?: number;
  /** Restringe a medição a estas campanhas. */
  campaignIds?: readonly string[];
  /** Também mede campanhas fora do ar (para backtest/diagnóstico). */
  includeInactive?: boolean;
};

export type MeasureResult = {
  consultantId: string;
  brainConfig: unknown;
  policy: BrainDecisionPolicy;
  dataQuality: BrainDataQuality;
  snapshots: CampaignBrainSnapshot[];
  /** Segunda janela (3× maior) por campanha, para medir estabilidade. */
  secondWindowByCampaign: Map<string, { cplCents: number | null }>;
  windowStart: string;
  windowEnd: string;
};

const ACTIVE_STATUSES = ["active", "pending_review"];

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function sum(rows: MetricDailyRow[], key: keyof MetricDailyRow): number {
  return rows.reduce((s, r) => s + Number(r[key] ?? 0), 0);
}

export async function measureConsultantCampaigns(
  admin: MinimalClient,
  input: MeasureInput,
): Promise<MeasureResult> {
  const nowMs = input.nowMs ?? Date.now();
  const windowDays = Math.max(1, Math.min(90, input.windowDays ?? 2));
  const windowStartMs = nowMs - windowDays * 86_400_000;
  const windowStart = isoDate(windowStartMs);
  const windowEnd = isoDate(nowMs);
  // Janela longa só para estabilidade — nunca substitui a janela de decisão.
  const longWindowStart = isoDate(nowMs - windowDays * 3 * 86_400_000);

  const [settingsRes, campaignsRes, walletRes] = await Promise.all([
    admin.from("consultant_ad_settings")
      .select("brain_config")
      .eq("consultant_id", input.consultantId)
      .maybeSingle(),
    admin.from("facebook_campaigns")
      .select(
        "id, name, consultant_id, status, fb_campaign_id, daily_budget_cents, rejection_reason, started_at, created_at, updated_at, brain_scale_enabled, brain_scale_last_at, brain_scale_target_cpl_cents",
      )
      .eq("consultant_id", input.consultantId),
    admin.from("consultant_wallet")
      .select("balance_cents, debt_cents")
      .eq("consultant_id", input.consultantId)
      .maybeSingle(),
  ]);

  const brainConfig = settingsRes?.data?.brain_config ?? null;
  const policy = resolveBrainDecisionPolicy(brainConfig);
  const anchorId = resolveAnchorCampaignId(
    input.consultantId,
    brainConfig && typeof brainConfig === "object"
      ? brainConfig as { anchor_campaign_id?: string | null }
      : null,
  );

  const allCampaigns = ((campaignsRes?.data ?? []) as Array<
    Record<string, unknown>
  >)
    .filter((c) =>
      input.campaignIds ? input.campaignIds.includes(String(c.id)) : true
    )
    .filter((c) =>
      input.includeInactive ? true : ACTIVE_STATUSES.includes(String(c.status))
    );

  const campaignIds = allCampaigns.map((c) => String(c.id));
  const fallbackId = "00000000-0000-0000-0000-000000000000";

  const [metricsRes, longMetricsRes, leadsRes] = await Promise.all([
    // Janela fechada nos dois lados: sem o `lte` uma medição com o relógio no
    // passado (backtest, desfecho de 24h) enxergaria dias que ainda não tinham
    // acontecido na hora da decisão.
    admin.from("facebook_metrics_daily")
      .select(
        "campaign_id, date, spend_cents, messaging_conversations_started, clicks, impressions, ctr_bps, cpm_cents, frequency_x100, updated_at",
      )
      .in("campaign_id", campaignIds.length ? campaignIds : [fallbackId])
      .gte("date", windowStart)
      .lte("date", windowEnd),
    admin.from("facebook_metrics_daily")
      .select("campaign_id, spend_cents, messaging_conversations_started")
      .in("campaign_id", campaignIds.length ? campaignIds : [fallbackId])
      .gte("date", longWindowStart)
      .lte("date", windowEnd),
    // Só leads com prova Meta entram; o filtro é o mesmo de meta-ads-metrics.
    admin.from("customers")
      .select(
        "id, source_campaign_id, source_ad_id, ctwa_clid, source_ctwa_clid, lead_source, status, portal_submitted_at, created_at",
      )
      .eq("consultant_id", input.consultantId)
      .in("source_campaign_id", campaignIds.length ? campaignIds : [fallbackId])
      .or(META_CAMPAIGN_PROOF_OR)
      .gte("created_at", new Date(windowStartMs).toISOString())
      .lt("created_at", new Date(nowMs).toISOString()),
  ]);

  const metricRows = (metricsRes?.data ?? []) as Array<
    MetricDailyRow & { campaign_id: string; updated_at?: string | null }
  >;
  const byCampaign = new Map<string, typeof metricRows>();
  let lastSyncMs = 0;
  for (const row of metricRows) {
    const list = byCampaign.get(row.campaign_id) ?? [];
    list.push(row);
    byCampaign.set(row.campaign_id, list);
    const t = row.updated_at ? Date.parse(row.updated_at) : NaN;
    if (Number.isFinite(t) && t > lastSyncMs) lastSyncMs = t;
  }

  const longByCampaign = new Map<string, MetricDailyRow[]>();
  for (
    const row of ((longMetricsRes?.data ?? []) as Array<
      MetricDailyRow & { campaign_id: string }
    >)
  ) {
    const list = longByCampaign.get(row.campaign_id) ?? [];
    list.push(row);
    longByCampaign.set(row.campaign_id, list);
  }

  const leads = (leadsRes?.data ?? []) as AttributableCustomer[];
  const attribution = aggregateAttribution(leads);

  // `facebook-sync-metrics` toca `facebook_campaigns.updated_at` (leads_count)
  // depois de ler os insights com sucesso, mesmo quando a Meta não devolve
  // nenhuma linha. É a única prova de que o sync passou por uma campanha que
  // não entregou.
  const campaignSyncMs = (c: Record<string, unknown>): number => {
    const t = c.updated_at ? Date.parse(String(c.updated_at)) : NaN;
    return Number.isFinite(t) ? t : 0;
  };
  const syncConfirmedMs = allCampaigns.reduce(
    (max, c) => Math.max(max, campaignSyncMs(c)),
    0,
  );

  // Lacuna real = o sync não conseguiu ler esta campanha. Campanha ativa que
  // simplesmente não gastou não é lacuna.
  const syncCutoffMs = nowMs - policy.maxMetricsAgeHours * 3_600_000;
  const activeWithoutMetrics = allCampaigns.filter((c) =>
    ACTIVE_STATUSES.includes(String(c.status)) &&
    Number(c.daily_budget_cents ?? 0) > 0 &&
    !(byCampaign.get(String(c.id))?.length) &&
    campaignSyncMs(c) < syncCutoffMs
  ).length;

  const dataQuality = evaluateBrainDataQuality({
    nowMs,
    lastMetaSyncAtIso: lastSyncMs > 0 ? new Date(lastSyncMs).toISOString() : null,
    syncConfirmedAtIso: syncConfirmedMs > 0
      ? new Date(syncConfirmedMs).toISOString()
      : null,
    windowStart,
    windowEnd,
    campaignsFound: allCampaigns.length,
    metricRowsFound: metricRows.length,
    expectedMetricRows: allCampaigns.length * windowDays,
    hasCommercialData: attribution.totalConsidered > 0,
    duplicatesIgnored: attribution.duplicatesIgnored,
    activeCampaignsWithoutMetrics: activeWithoutMetrics,
    maxMetricsAgeHours: policy.maxMetricsAgeHours,
  });

  const liquidCents = Math.max(
    0,
    Number(walletRes?.data?.balance_cents ?? 0) -
      Number(walletRes?.data?.debt_cents ?? 0),
  );
  const activeDailyBudget = allCampaigns
    .filter((c) => ACTIVE_STATUSES.includes(String(c.status)))
    .reduce((s, c) => s + Number(c.daily_budget_cents ?? 0), 0);
  const wallet = buildWalletState({
    liquidCents,
    activeDailyBudgetCents: activeDailyBudget,
  });

  const secondWindowByCampaign = new Map<string, { cplCents: number | null }>();
  const snapshots: CampaignBrainSnapshot[] = [];

  for (const c of allCampaigns) {
    const id = String(c.id);
    const rows = byCampaign.get(id) ?? [];
    const meta = aggregateMetaMetrics(rows);

    const longRows = longByCampaign.get(id) ?? [];
    const longSpend = sum(longRows, "spend_cents");
    const longConv = sum(longRows, "messaging_conversations_started");
    secondWindowByCampaign.set(id, {
      cplCents: longConv > 0 ? Math.round(longSpend / longConv) : null,
    });

    const startedAt = String(c.started_at ?? c.created_at ?? "");
    const startedMs = Date.parse(startedAt);
    const ageHours = Number.isFinite(startedMs)
      ? Math.max(0, (nowMs - startedMs) / 3_600_000)
      : 0;

    // A campanha pode ter alvo próprio (Cérebro por campanha); o resolver
    // descarta o legado R$ 2 vindo do DEFAULT antigo da coluna.
    const targetCplCents = c.brain_scale_enabled === true
      ? resolveTargetCplCents(c.brain_scale_target_cpl_cents, "campaign_column")
      : policy.targetCplCents;

    snapshots.push(
      await buildCampaignSnapshot({
        measuredAtIso: new Date(nowMs).toISOString(),
        campaign: {
          id,
          consultantId: input.consultantId,
          name: String(c.name ?? ""),
          status: String(c.status ?? "unknown"),
          fbCampaignId: c.fb_campaign_id ? String(c.fb_campaign_id) : null,
          dailyBudgetCents: Number(c.daily_budget_cents ?? 0),
          isAnchor: Boolean(anchorId) && id === anchorId,
          ageHours,
          rejectionReason: c.rejection_reason ? String(c.rejection_reason) : null,
          brainScaleEnabled: c.brain_scale_enabled === true,
          lastExecutionAtIso: c.brain_scale_last_at
            ? String(c.brain_scale_last_at)
            : null,
        },
        meta,
        attribution,
        wallet,
        dataQuality,
        targetCplCents,
      }),
    );
  }

  return {
    consultantId: input.consultantId,
    brainConfig,
    policy,
    dataQuality,
    snapshots,
    secondWindowByCampaign,
    windowStart,
    windowEnd,
  };
}
