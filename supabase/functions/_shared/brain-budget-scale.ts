/**
 * Escala automática do budget da âncora (Uberlândia).
 * Sobe em degraus de ~15% enquanto CPL estiver ok — sem trava de 48h.
 * O lookback de métricas (ex.: 48h) só mede o CPL; não impede novo aumento.
 * Há um intervalo mínimo curto entre subidas (default 4h) só pra não
 * disparar a cada cron de 30 min.
 */

export type AnchorScaleInput = {
  currentBudgetCents: number;
  /** Teto (default R$ 500). */
  maxBudgetCents: number;
  /** CPL Meta alvo em centavos (ex.: 200 = R$ 2,00). */
  targetCplCents: number;
  /** CPL médio recente (centavos). null = sem dados. */
  recentCplCents: number | null;
  /** Conversas no período (precisa ter sinal). */
  recentConversations: number;
  /** Gasto no período (centavos). */
  recentSpendCents: number;
  /** % de aumento por degrau (default 15). */
  stepPct?: number;
  /** Mínimo de conversas no período pra considerar escala. */
  minConversations?: number;
  /** ISO da última escala (up/down). Evita spam do cron 30 min — NÃO é trava de 48h. */
  lastScaleAtIso?: string | null;
  /** Horas mínimas entre subidas (default 4). 0 = sobe em todo ciclo com CPL ok. */
  minHoursBetweenScaleUps?: number;
};

export type AnchorScaleResult =
  | { action: "hold"; budgetCents: number; reason: string }
  | { action: "scale_up"; budgetCents: number; reason: string }
  | { action: "scale_down"; budgetCents: number; reason: string };

const META_MIN = 517;

function hoursSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return (Date.now() - t) / 3_600_000;
}

export function decideAnchorBudgetScale(input: AnchorScaleInput): AnchorScaleResult {
  const maxBud = Math.max(META_MIN, Math.min(50000, Math.round(input.maxBudgetCents || 50000)));
  const cur = Math.max(META_MIN, Math.min(maxBud, Math.round(input.currentBudgetCents)));
  const targetCpl = Math.max(50, Math.round(input.targetCplCents || 200));
  const stepPct = Math.min(30, Math.max(8, input.stepPct ?? 15));
  const minConv = Math.max(3, input.minConversations ?? 5);
  const conv = Math.max(0, input.recentConversations | 0);
  const spend = Math.max(0, input.recentSpendCents | 0);
  const cpl = input.recentCplCents;
  const minGapH = Math.max(0, input.minHoursBetweenScaleUps ?? 4);
  const sinceLast = hoursSince(input.lastScaleAtIso);

  if (conv < minConv || spend < META_MIN) {
    return {
      action: "hold",
      budgetCents: cur,
      reason: `poucos dados (${conv} conversas / R$ ${(spend / 100).toFixed(2)}) — mantém`,
    };
  }

  if (cpl == null || !Number.isFinite(cpl)) {
    return { action: "hold", budgetCents: cur, reason: "CPL indisponível — mantém" };
  }

  // CPL ruim (> 1,35× alvo) → desce um degrau (sem trava de intervalo longo)
  if (cpl > targetCpl * 1.35) {
    const down = Math.max(META_MIN, Math.round(cur * (1 - stepPct / 100)));
    if (down >= cur) {
      return { action: "hold", budgetCents: cur, reason: `CPL alto (R$ ${(cpl / 100).toFixed(2)}) mas já no mínimo` };
    }
    return {
      action: "scale_down",
      budgetCents: down,
      reason: `CPL R$ ${(cpl / 100).toFixed(2)} > alvo R$ ${(targetCpl / 100).toFixed(2)} — reduz ${stepPct}%`,
    };
  }

  // CPL ok (≤ alvo) → sobe se ainda abaixo do teto (sem trava de 48h)
  if (cpl <= targetCpl && cur < maxBud) {
    if (minGapH > 0 && sinceLast != null && sinceLast < minGapH) {
      return {
        action: "hold",
        budgetCents: cur,
        reason: `CPL ok, mas última subida há ${sinceLast.toFixed(1)}h — próximo degrau em ~${(minGapH - sinceLast).toFixed(1)}h`,
      };
    }
    const up = Math.min(maxBud, Math.round(cur * (1 + stepPct / 100)));
    if (up <= cur) {
      return { action: "hold", budgetCents: cur, reason: "já no teto efetivo" };
    }
    return {
      action: "scale_up",
      budgetCents: up,
      reason: `CPL R$ ${(cpl / 100).toFixed(2)} ≤ alvo R$ ${(targetCpl / 100).toFixed(2)} — sobe ${stepPct}%`,
    };
  }

  // CPL entre alvo e 1,35× → segura
  return {
    action: "hold",
    budgetCents: cur,
    reason: `CPL R$ ${(cpl / 100).toFixed(2)} na faixa de observação — mantém R$ ${(cur / 100).toFixed(2)}`,
  };
}

function brl(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Mensagem WhatsApp (negrito *...*, emoji) ao subir budget da âncora. */
export function formatAnchorScaleUpWhatsApp(input: {
  fromCents: number;
  toCents: number;
  stepPct: number;
  walletLiquidCents: number;
  cplCents: number | null;
  conversations: number;
  spendCents: number;
  targetCplCents: number;
  reason: string;
  cityLabel?: string;
}): string {
  const city = input.cityLabel || "Uberlândia";
  const from = brl(input.fromCents);
  const to = brl(input.toCents);
  const wallet = brl(Math.max(0, input.walletLiquidCents));
  const cpl = input.cplCents != null ? brl(input.cplCents) : "—";
  const spend = brl(input.spendCents);
  const target = brl(input.targetCplCents);
  const when = new Date().toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  return [
    `🚀 *Cérebro · Budget subiu!*`,
    ``,
    `📍 *Campanha:* ${city}`,
    `📈 *Investimento:* ${from} → *${to}*  (+${input.stepPct}%)`,
    ``,
    `💰 *Carteira (saldo):* ${wallet}`,
    `🎯 *Custo por lead:* ${cpl}`,
    `💬 *Conversas (janela):* ${input.conversations}`,
    `📊 *Gasto (janela):* ${spend}`,
    `📌 *CPL alvo:* ${target}`,
    ``,
    `✅ *Por que subiu?*`,
    input.reason,
    ``,
    `_iGreen Autopilot · ${when}_`,
  ].join("\n");
}

/** Mensagem WhatsApp ao reduzir budget (CPL ruim). */
export function formatAnchorScaleDownWhatsApp(input: {
  fromCents: number;
  toCents: number;
  stepPct: number;
  walletLiquidCents: number;
  cplCents: number | null;
  conversations: number;
  targetCplCents: number;
  reason: string;
  cityLabel?: string;
}): string {
  const city = input.cityLabel || "Uberlândia";
  const when = new Date().toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  return [
    `📉 *Cérebro · Budget reduzido*`,
    ``,
    `📍 *Campanha:* ${city}`,
    `📈 *Investimento:* ${brl(input.fromCents)} → *${brl(input.toCents)}*  (−${input.stepPct}%)`,
    ``,
    `💰 *Carteira:* ${brl(Math.max(0, input.walletLiquidCents))}`,
    `🎯 *Custo por lead:* ${input.cplCents != null ? brl(input.cplCents) : "—"}`,
    `💬 *Conversas:* ${input.conversations}`,
    `📌 *CPL alvo:* ${brl(input.targetCplCents)}`,
    ``,
    `⚠️ *Por que baixou?*`,
    input.reason,
    ``,
    `_iGreen Autopilot · ${when}_`,
  ].join("\n");
}
