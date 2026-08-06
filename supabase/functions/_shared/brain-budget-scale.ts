/**
 * Escala automática do budget da âncora (Uberlândia) e do Cérebro por campanha.
 * Sobe/desce em degraus (~15%) conforme CPL — sem trava de 48h entre mudanças.
 * O lookback de métricas (ex.: 48h) só mede o CPL; não impede novo degrau.
 * Intervalo mínimo curto entre escalas (default 4h) evita spam do cron ~30 min.
 *
 * CPL-alvo: sempre via `resolveTargetCplCents` (`brain-policy.ts`). O fallback
 * `|| 200` (R$ 2) que existia aqui travava a escala no piso da Meta.
 */
import { resolveTargetCplCents } from "./brain-policy.ts";

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
  /** Horas mínimas entre degraus up/down (default 4). 0 = pode mudar a cada ciclo. */
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
  const targetCpl = resolveTargetCplCents(input.targetCplCents);
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

  // Intervalo anti-spam do cron (~30 min): vale para sobe e desce.
  if (minGapH > 0 && sinceLast != null && sinceLast < minGapH) {
    return {
      action: "hold",
      budgetCents: cur,
      reason: `última escala há ${sinceLast.toFixed(1)}h — próximo degrau em ~${(minGapH - sinceLast).toFixed(1)}h`,
    };
  }

  // CPL ruim (> 1,35× alvo) → desce um degrau
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

function nowBrLabel(): string {
  return new Date().toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Leitura rápida CPL vs alvo (texto amigável pro Zap). */
function cplHealthLine(cplCents: number | null, targetCplCents: number): string {
  if (cplCents == null || !Number.isFinite(cplCents)) {
    return `📡 Ainda sem CPL suficiente na janela — seguimos de olho.`;
  }
  const target = resolveTargetCplCents(targetCplCents);
  if (cplCents <= target) {
    return `🟢 CPL *abaixo do alvo* — performance boa, dá pra acelerar.`;
  }
  if (cplCents <= target * 1.35) {
    return `🟡 CPL na *faixa de observação* — sem pressa de mexer forte.`;
  }
  return `🔴 CPL *acima do conforto* — melhor proteger a carteira.`;
}

type ScaleMsgInput = {
  fromCents: number;
  toCents: number;
  stepPct: number;
  walletLiquidCents: number;
  cplCents: number | null;
  conversations: number;
  spendCents?: number;
  targetCplCents: number;
  reason: string;
  cityLabel?: string;
};

/** Mensagem WhatsApp (negrito *...*, emoji) ao subir budget da âncora. */
export function formatAnchorScaleUpWhatsApp(input: ScaleMsgInput): string {
  const city = input.cityLabel || "Uberlândia";
  const from = brl(input.fromCents);
  const to = brl(input.toCents);
  const delta = brl(Math.max(0, input.toCents - input.fromCents));
  const wallet = brl(Math.max(0, input.walletLiquidCents));
  const cpl = input.cplCents != null ? brl(input.cplCents) : "—";
  const spend = input.spendCents != null ? brl(input.spendCents) : null;
  const target = brl(input.targetCplCents);
  const when = nowBrLabel();

  return [
    `🧠✨ *Cérebro iGreen · Autopilot*`,
    `━━━━━━━━━━━━━━━━`,
    `🚀 *Budget subiu!* 📈🔥`,
    ``,
    `📍 *Campanha âncora*`,
    `🏙️ ${city}`,
    `🕐 ${when}`,
    ``,
    `💵 *Investimento diário*`,
    `📤 Antes: ${from}`,
    `📥 Agora: *${to}*`,
    `⬆️ Degrau: *+${input.stepPct}%*  (+${delta})`,
    ``,
    `📊 *Janela recente (48h)*`,
    `🎯 Custo por conversa: *${cpl}*`,
    `📌 CPL alvo: *${target}*`,
    `💬 Conversas: *${input.conversations}*`,
    ...(spend ? [`💸 Gasto na janela: *${spend}*`] : []),
    ``,
    `💼 *Carteira*`,
    `💰 Saldo líquido: *${wallet}*`,
    ``,
    `💡 *Leitura rápida*`,
    cplHealthLine(input.cplCents, input.targetCplCents),
    `✅ ${input.reason}`,
    ``,
    `💪 Seguimos no piloto automático.`,
    `✨ _iGreen Ads · Cérebro_`,
  ].join("\n");
}

/** Mensagem WhatsApp ao reduzir budget (CPL ruim). */
export function formatAnchorScaleDownWhatsApp(input: ScaleMsgInput): string {
  const city = input.cityLabel || "Uberlândia";
  const from = brl(input.fromCents);
  const to = brl(input.toCents);
  const delta = brl(Math.max(0, input.fromCents - input.toCents));
  const wallet = brl(Math.max(0, input.walletLiquidCents));
  const cpl = input.cplCents != null ? brl(input.cplCents) : "—";
  const spend = input.spendCents != null ? brl(input.spendCents) : null;
  const target = brl(input.targetCplCents);
  const when = nowBrLabel();

  return [
    `🧠✨ *Cérebro iGreen · Autopilot*`,
    `━━━━━━━━━━━━━━━━`,
    `📉 *Budget reduzido* 🛡️⚠️`,
    ``,
    `📍 *Campanha âncora*`,
    `🏙️ ${city}`,
    `🕐 ${when}`,
    ``,
    `💵 *Investimento diário*`,
    `📤 Antes: ${from}`,
    `📥 Agora: *${to}*`,
    `⬇️ Degrau: *−${input.stepPct}%*  (−${delta})`,
    ``,
    `📊 *Janela recente (48h)*`,
    `🎯 Custo por conversa: *${cpl}*`,
    `📌 CPL alvo: *${target}*`,
    `💬 Conversas: *${input.conversations}*`,
    ...(spend ? [`💸 Gasto na janela: *${spend}*`] : []),
    ``,
    `💼 *Carteira*`,
    `💰 Saldo líquido: *${wallet}*`,
    ``,
    `💡 *Leitura rápida*`,
    cplHealthLine(input.cplCents, input.targetCplCents),
    `⚠️ ${input.reason}`,
    ``,
    `🛡️ Protegendo o saldo — quando o CPL melhorar, subimos de novo.`,
    `✨ _iGreen Ads · Cérebro_`,
  ].join("\n");
}
