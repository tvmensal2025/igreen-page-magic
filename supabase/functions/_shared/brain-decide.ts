/**
 * Camada de DECISÃO do Cérebro de Campanhas.
 *
 * Recebe um snapshot imutável e devolve diagnóstico + recomendação + bloqueios.
 * NÃO chama a Meta, NÃO altera campanha, NÃO altera orçamento — quem faz isso é
 * a camada de execução, que revalida tudo antes de escrever.
 *
 * Nenhum LLM participa desta decisão. Modelo de linguagem só pode explicar uma
 * decisão já calculada aqui; se ele falhar, o número continua de pé.
 *
 * Puro e determinístico: mesmo snapshot + mesma política = mesma decisão.
 */
import type { CampaignBrainSnapshot } from "./brain-snapshot.ts";
import {
  type BrainActionKind,
  type BrainDecisionPolicy,
  resolveBrainActionAuthorization,
  resolveWasteGuardMode,
  type WasteGuardMode,
} from "./brain-policy.ts";
import {
  type BrainHealth,
  evaluateBrainHealth,
  healthLabel,
} from "./brain-health.ts";
import {
  confidenceLabel,
  type DecisionConfidence,
  evaluateSampleQuality,
  maxStepPctForConfidence,
  type SampleAssessment,
  sampleQualityLabel,
} from "./brain-sample.ts";
import { describeDataQuality } from "./brain-data-quality.ts";
import { evaluateAdaptiveCampaignWaste } from "./campaign-waste-guard.ts";
import {
  capConfidenceForSupport,
  type CampaignSupportVerdict,
  supportForSnapshot,
  supportLabel,
} from "./brain-campaign-support.ts";

export type BrainDecisionAction =
  | "hold"
  | "increase_budget"
  | "reduce_budget"
  | "pause_waste"
  | "recommend_creative_review";

export type DecisionBlocker = {
  code: string;
  message: string;
};

export type BrainDecision = {
  campaignId: string;
  consultantId: string;
  /** Versão do snapshot que originou a decisão. */
  snapshotVersion: string;
  decidedAtIso: string;
  action: BrainDecisionAction;
  /** Ação correspondente na tabela de autorização. `null` para `hold`. */
  actionKind: BrainActionKind | null;
  currentBudgetCents: number;
  /** Orçamento proposto. `null` quando a ação não mexe em orçamento. */
  proposedBudgetCents: number | null;
  stepPct: number;
  confidence: DecisionConfidence;
  sample: SampleAssessment;
  health: BrainHealth;
  /** Capacidade de atribuição da campanha — teto do que pode ser decidido. */
  support: CampaignSupportVerdict;
  wasteGuardMode: WasteGuardMode;
  /** Motivo em pt-BR, pronto para o painel. */
  reason: string;
  blockers: DecisionBlocker[];
  /** O que precisa acontecer para reavaliar. */
  nextEvaluation: string;
  /** A decisão pode virar recomendação registrada? */
  canRecommend: boolean;
  /** A decisão pode virar escrita na Meta? */
  canExecute: boolean;
  /** Métricas congeladas no momento da decisão, para o histórico. */
  measured: {
    spendCents: number;
    conversations: number;
    cplCents: number | null;
    leadsTrusted: number;
    registrationsTrusted: number;
    approvedTrusted: number;
    runwayDays: number;
    windowStart: string;
    windowEnd: string;
    dataQualityState: string;
  };
};

export type DecideCampaignInput = {
  snapshot: CampaignBrainSnapshot;
  policy: BrainDecisionPolicy;
  /** `brain_config` cru do consultor, para resolver autorizações. */
  brainConfig: unknown;
  nowMs: number;
  /** Segunda janela opcional para medir estabilidade. */
  secondWindow?: { cplCents: number | null };
  /**
   * Versões de snapshot que já geraram decisão para esta campanha.
   * É o que impede a mesma amostra autorizar dois aumentos.
   */
  usedSnapshotVersions?: readonly string[];
};

const ACTIVE_STATUSES = new Set(["active", "pending_review"]);

function hoursSince(iso: string | null, nowMs: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return (nowMs - t) / 3_600_000;
}

/** Saldo necessário = queima diária projetada × runway + reserva operacional. */
export function requiredBalanceCents(input: {
  projectedDailyBurnWithFeeCents: number;
  minRunwayDays: number;
  reserveCents?: number;
}): number {
  const reserve = Math.max(0, Math.round(input.reserveCents ?? 0));
  return Math.round(
    input.projectedDailyBurnWithFeeCents * input.minRunwayDays,
  ) + reserve;
}

export type WalletVerdict = {
  ok: boolean;
  availableCents: number;
  requiredCents: number;
  currentRunwayDays: number;
  projectedRunwayDays: number;
};

/** Carteira aguenta o aumento sem furar o runway mínimo? */
export function evaluateWalletForIncrease(input: {
  liquidCents: number;
  currentDailyBurnWithFeeCents: number;
  budgetDeltaCents: number;
  minRunwayDays: number;
  reserveCents?: number;
  feeMultiplier?: number;
}): WalletVerdict {
  const fee = input.feeMultiplier ?? 1.2;
  const projectedBurn = Math.round(
    input.currentDailyBurnWithFeeCents + input.budgetDeltaCents * fee,
  );
  const required = requiredBalanceCents({
    projectedDailyBurnWithFeeCents: projectedBurn,
    minRunwayDays: input.minRunwayDays,
    reserveCents: input.reserveCents,
  });
  const currentRunway = input.currentDailyBurnWithFeeCents > 0
    ? Number((input.liquidCents / input.currentDailyBurnWithFeeCents).toFixed(1))
    : 999;
  const projectedRunway = projectedBurn > 0
    ? Number((input.liquidCents / projectedBurn).toFixed(1))
    : 999;
  return {
    ok: input.liquidCents >= required && projectedRunway >= input.minRunwayDays,
    availableCents: input.liquidCents,
    requiredCents: required,
    currentRunwayDays: currentRunway,
    projectedRunwayDays: projectedRunway,
  };
}

function brl(cents: number): string {
  return `R$ ${(cents / 100).toFixed(2)}`;
}

export function decideCampaign(input: DecideCampaignInput): BrainDecision {
  const { snapshot, policy, brainConfig, nowMs } = input;
  const health = evaluateBrainHealth(snapshot, policy);
  const rawSample = evaluateSampleQuality(snapshot, policy, input.secondWindow);
  const support = supportForSnapshot(snapshot);
  // A capacidade de atribuição é um teto, nunca uma promoção: campanha que não
  // liga gasto a cliente não vira confiável só porque teve muitas conversas.
  const sample: SampleAssessment = {
    ...rawSample,
    confidence: capConfidenceForSupport(rawSample.confidence, support.support),
  };
  const wasteGuardMode = resolveWasteGuardMode(brainConfig);
  const blockers: DecisionBlocker[] = [];

  const currentBudget = snapshot.campaign.dailyBudgetCents;
  const used = new Set(input.usedSnapshotVersions ?? []);
  const hoursSinceExecution = hoursSince(
    snapshot.campaign.lastExecutionAtIso,
    nowMs,
  );

  const base = {
    campaignId: snapshot.campaign.id,
    consultantId: snapshot.campaign.consultantId,
    snapshotVersion: snapshot.version,
    decidedAtIso: new Date(nowMs).toISOString(),
    currentBudgetCents: currentBudget,
    confidence: sample.confidence,
    sample,
    health,
    support,
    wasteGuardMode,
    measured: {
      spendCents: snapshot.meta.spendCents,
      conversations: snapshot.meta.conversations,
      cplCents: snapshot.meta.cplCents,
      leadsTrusted: snapshot.commercial.leadsTrusted,
      registrationsTrusted: snapshot.commercial.registrationsTrusted,
      approvedTrusted: snapshot.commercial.approvedTrusted,
      runwayDays: snapshot.wallet.runwayDays,
      windowStart: snapshot.dataQuality.windowStart,
      windowEnd: snapshot.dataQuality.windowEnd,
      dataQualityState: snapshot.dataQuality.state,
    },
  };

  const finish = (
    action: BrainDecisionAction,
    actionKind: BrainActionKind | null,
    proposedBudgetCents: number | null,
    stepPct: number,
    reason: string,
    nextEvaluation: string,
  ): BrainDecision => {
    const auth = actionKind
      ? resolveBrainActionAuthorization(brainConfig, actionKind)
      : null;
    // Bloqueio de dados/amostra derruba execução mesmo com autorização.
    const hasBlockers = blockers.length > 0;
    return {
      ...base,
      action,
      actionKind,
      proposedBudgetCents,
      stepPct,
      reason,
      blockers,
      nextEvaluation,
      canRecommend: auth ? auth.canRecommend : true,
      canExecute: Boolean(auth?.canExecute) && !hasBlockers && action !== "hold",
    };
  };

  // ── 1. Dados antes de tudo ────────────────────────────────────────────
  if (!snapshot.dataQuality.allowsFinancialAction) {
    blockers.push({
      code: `dados_${snapshot.dataQuality.state}`,
      message: describeDataQuality(snapshot.dataQuality),
    });
    return finish(
      "hold",
      null,
      null,
      0,
      `manter — ${describeDataQuality(snapshot.dataQuality)}`,
      "após nova sincronização completa das métricas",
    );
  }

  // ── 1b. Campanha que o Cérebro não sabe ler ───────────────────────────
  // Sem espelho na Meta (ou recusada por ela) não há métrica para julgar nem
  // objeto para ajustar. Nem proteger faz sentido: não há o que pausar.
  if (support.support === "unsupported") {
    blockers.push({
      code: "campanha_nao_suportada",
      message: support.reason,
    });
    return finish(
      "hold",
      null,
      null,
      0,
      `manter — ${support.reason}`,
      "após a campanha existir e ser aceita na Meta",
    );
  }

  // ── 2. Desperdício (protetivo — não depende de amostra grande) ─────────
  const waste = evaluateAdaptiveCampaignWaste({
    spendCents: snapshot.meta.spendCents,
    conversations: snapshot.meta.conversations,
    clicks: snapshot.meta.clicks,
    campaignAgeHours: snapshot.campaign.ageHours,
    targetCplCents: snapshot.targetCplCents,
    hasCommercialResult: snapshot.commercial.leadsTrusted > 0 ||
      snapshot.commercial.approvedTrusted > 0,
    policy,
  });

  if (waste.action === "recommend_pause") {
    if (wasteGuardMode === "off") {
      blockers.push({
        code: "waste_guard_off",
        message: "guarda de desperdício desligada na configuração",
      });
      return finish(
        "hold",
        null,
        null,
        0,
        `manter — ${waste.reason}, mas a guarda de desperdício está desligada`,
        "após religar a guarda de desperdício",
      );
    }
    if (wasteGuardMode === "recommend") {
      blockers.push({
        code: "waste_guard_recommend",
        message: "guarda de desperdício em modo recomendação",
      });
    }
    return finish(
      "pause_waste",
      "pause_waste",
      null,
      0,
      `pausar — ${waste.reason}`,
      "após revisão humana ou novo criativo",
    );
  }

  // ── 3. CPL acima do conforto → reduzir (protetivo) ─────────────────────
  const cpl = snapshot.meta.cplCents;
  const target = snapshot.targetCplCents;
  const REDUCE_THRESHOLD = 1.35;
  if (
    cpl != null && cpl > target * REDUCE_THRESHOLD &&
    snapshot.meta.conversations >= 1
  ) {
    if (hoursSinceExecution != null && hoursSinceExecution < policy.minHoursBetweenExecutions) {
      blockers.push({
        code: "intervalo_minimo",
        message: `última execução há ${hoursSinceExecution.toFixed(1)}h de ${policy.minHoursBetweenExecutions}h`,
      });
    }
    // Reduzir usa o degrau padrão: proteger não depende de confiança alta.
    const stepPct = policy.defaultStepPct;
    const proposed = Math.max(517, Math.round(currentBudget * (1 - stepPct / 100)));
    if (proposed >= currentBudget) {
      return finish(
        "hold",
        null,
        null,
        0,
        `manter — custo por conversa ${brl(cpl)} acima do alvo, mas o orçamento já está no piso da Meta`,
        "após revisão de criativo ou público",
      );
    }
    return finish(
      "reduce_budget",
      "reduce_budget",
      proposed,
      stepPct,
      `reduzir ${stepPct}% — custo por conversa ${brl(cpl)} contra alvo ${brl(target)}`,
      `após ${policy.minHoursBetweenExecutions}h ou nova amostra`,
    );
  }

  // ── 4. Aumento: caminho mais restrito de todos ─────────────────────────
  const wantsIncrease = cpl != null && cpl <= target;

  if (!wantsIncrease) {
    // CTR morto com CPL na faixa de observação é problema de criativo.
    if (health.meta.notes.some((n) => n.startsWith("CTR baixo"))) {
      return finish(
        "recommend_creative_review",
        "recommend_creative_review",
        null,
        0,
        "revisar criativo — entrega com CTR baixo e custo por conversa sem folga",
        "após troca de criativo e nova janela",
      );
    }
    return finish(
      "hold",
      null,
      null,
      0,
      cpl == null
        ? "manter — ainda sem custo por conversa medido na janela"
        : `manter — custo por conversa ${brl(cpl)} na faixa de observação (alvo ${brl(target)})`,
      "após nova amostra confiável",
    );
  }

  if (!ACTIVE_STATUSES.has(snapshot.campaign.status)) {
    blockers.push({
      code: "campanha_nao_ativa",
      message: `campanha está ${snapshot.campaign.status}`,
    });
  }
  if (used.has(snapshot.version)) {
    blockers.push({
      code: "snapshot_ja_utilizado",
      message: "esta mesma amostra já gerou uma decisão",
    });
  }
  if (
    hoursSinceExecution != null &&
    hoursSinceExecution < policy.minHoursBetweenExecutions
  ) {
    blockers.push({
      code: "intervalo_minimo",
      message: `última execução há ${hoursSinceExecution.toFixed(1)}h de ${policy.minHoursBetweenExecutions}h`,
    });
  }
  if (sample.quality === "insufficient" || sample.quality === "early") {
    blockers.push({
      code: "amostra_insuficiente",
      message: `amostra ${sampleQualityLabel(sample.quality)}: falta ${
        sample.missing.join(", ") || "volume"
      }`,
    });
  }
  if (!health.commercial.hasEnoughData) {
    blockers.push({
      code: "sem_dado_comercial",
      message: `${health.commercial.leadsTrusted} lead(s) identificado(s) — mínimo ${policy.minLeadsSample}`,
    });
  }
  // Custo por conversa barato não é vitória comercial quando ninguém consegue
  // dizer se aquela conversa virou cliente.
  if (!support.allowsExpansive) {
    blockers.push({
      code: "sem_atribuicao_comercial",
      message: `${supportLabel(support.support)} — ${support.reason}`,
    });
  }

  const stepPct = maxStepPctForConfidence(sample.confidence, policy);
  if (stepPct <= 0) {
    blockers.push({
      code: "confianca_baixa",
      message: `confiança ${confidenceLabel(sample.confidence)} não autoriza alteração`,
    });
  }

  const proposed = Math.round(currentBudget * (1 + stepPct / 100));
  const delta = Math.max(0, proposed - currentBudget);

  const walletVerdict = evaluateWalletForIncrease({
    liquidCents: snapshot.wallet.liquidCents,
    currentDailyBurnWithFeeCents: snapshot.wallet.dailyBurnWithFeeCents,
    budgetDeltaCents: delta,
    minRunwayDays: policy.minRunwayDays,
  });
  if (!walletVerdict.ok) {
    blockers.push({
      code: "carteira_insuficiente",
      message: `saldo ${brl(walletVerdict.availableCents)} para ${
        brl(walletVerdict.requiredCents)
      } necessários — runway projetado ${walletVerdict.projectedRunwayDays}d`,
    });
  }

  if (blockers.length > 0) {
    const first = blockers[0];
    return finish(
      "hold",
      null,
      null,
      0,
      `manter — ${first.message}`,
      blockers.some((b) => b.code === "sem_dado_comercial")
        ? "após nova amostra comercial confiável"
        : `após ${policy.minHoursBetweenExecutions}h ou nova amostra confiável`,
    );
  }

  return finish(
    "increase_budget",
    "increase_budget",
    proposed,
    stepPct,
    `aumentar ${stepPct}% — custo por conversa ${brl(cpl!)} dentro do alvo ${
      brl(target)
    }, ${health.commercial.approvedTrusted} cliente(s) aprovado(s), saúde comercial ${
      healthLabel(health.commercial.level)
    }`,
    `após ${policy.minHoursBetweenExecutions}h ou nova amostra confiável`,
  );
}
