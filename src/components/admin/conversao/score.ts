/**
 * Score de priorização da fila de Conversão.
 *
 * Combina temperatura (classificada pela IA), chance de conversão, valor da
 * conta de luz, urgência (tempo parado) e engajamento (mensagens trocadas).
 * É uma função PURA — fácil de testar e sem efeito colateral.
 *
 * Quanto maior o score, mais perto do topo da fila o lead aparece.
 */

export type Temp = "hot" | "warm" | "cold" | "dead" | "objection" | "rescue";

/** Peso por temperatura. Quente e resgate valem mais; morto quase nada. */
const TEMP_WEIGHT: Record<Temp, number> = {
  hot: 1.0,
  rescue: 0.95,
  objection: 0.7,
  warm: 0.5,
  cold: 0.25,
  dead: 0.05,
};

export interface ScoreInput {
  temperature: Temp | null;
  /** 0–100, vindo de lead_insights.conversion_chance. */
  conversionChance: number | null;
  /** Valor da conta de luz em R$ (eletricity_bill_value). */
  billValue: number | null;
  /** Horas desde a última interação. */
  hoursStuck: number | null;
  /** Quantas mensagens o cliente já mandou (engajamento). */
  inboundCount: number | null;
}

/** Fator de valor da conta: conta alta = lead mais valioso. */
function billBoost(bill: number | null): number {
  if (bill == null) return 1.0;
  if (bill >= 200) return 1.3;
  return 1.1;
}

/** Urgência: o valor decai com o tempo parado, mas nunca zera. */
function urgencyFactor(hours: number | null): number {
  if (hours == null) return 0.9;
  if (hours < 48) return 1.0;
  if (hours < 168) return 0.85; // < 7 dias
  if (hours < 336) return 0.7; // < 14 dias
  return 0.55;
}

/** Engajamento: quem trocou várias mensagens estava mais perto de fechar. */
function engagementFactor(inbound: number | null): number {
  return (inbound ?? 0) >= 5 ? 1.15 : 1.0;
}

/**
 * Calcula o score de prioridade (0–100+, normalmente 0–130 por causa dos boosts).
 * Leads sem classificação recebem score baixo, mas não zero, para não sumirem.
 */
export function priorityScore(input: ScoreInput): number {
  const temp = input.temperature;
  const tempW = temp ? TEMP_WEIGHT[temp] : 0.3; // não classificado = peso neutro baixo
  const chance = (input.conversionChance ?? 30) / 100; // sem chance conhecida ~ 30%
  const base = chance * tempW;
  const score =
    100 *
    base *
    billBoost(input.billValue) *
    urgencyFactor(input.hoursStuck) *
    engagementFactor(input.inboundCount);
  return Math.round(score * 10) / 10;
}

/** Faixa de prioridade legível para badge na UI. */
export type PriorityTier = "urgente" | "alta" | "media" | "baixa";

export function priorityTier(score: number): PriorityTier {
  if (score >= 70) return "urgente";
  if (score >= 45) return "alta";
  if (score >= 25) return "media";
  return "baixa";
}

export const TIER_META: Record<
  PriorityTier,
  { label: string; cls: string; dot: string }
> = {
  urgente: {
    label: "Urgente",
    cls: "bg-destructive/15 text-destructive border-destructive/30",
    dot: "bg-destructive",
  },
  alta: {
    label: "Alta",
    cls: "bg-warning/15 text-warning border-warning/30",
    dot: "bg-warning",
  },
  media: {
    label: "Média",
    cls: "bg-info/15 text-info border-info/30",
    dot: "bg-info",
  },
  baixa: {
    label: "Baixa",
    cls: "bg-muted text-muted-foreground border-border",
    dot: "bg-muted-foreground",
  },
};

/** Horas → "3d 5h" / "12h" / "agora". */
export function formatStuck(hours: number | null): string {
  if (hours == null) return "—";
  if (hours < 1) return "agora";
  if (hours < 24) return `${Math.round(hours)}h`;
  const days = Math.floor(hours / 24);
  const rem = Math.round(hours % 24);
  return rem > 0 ? `${days}d ${rem}h` : `${days}d`;
}
