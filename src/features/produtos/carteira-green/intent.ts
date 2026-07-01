// =============================================================================
// Score determinístico "vai pagar" para um boleto em aberto.
// Recebe o histórico do cliente (todos os boletos) e o boleto atual.
// =============================================================================

export type IntentLevel = "alta" | "media" | "baixa" | "perdido";

export interface BoletoLike {
  status: string | null;
  vencimento: string | null; // YYYY-MM-DD
  pagamento: string | null;
  dias_atraso: number | null;
}

/** Bucket determinístico: alta / media / baixa / perdido. */
export function scoreIntent(current: BoletoLike, history: BoletoLike[]): IntentLevel {
  const atraso = current.dias_atraso ?? 0;
  if (atraso > 60) return "perdido";

  const pagos = history.filter((b) => b.pagamento);
  const atrasos = pagos
    .map((b) => diffDays(b.pagamento, b.vencimento))
    .filter((n): n is number => n !== null);

  const ultimos2 = pagos.slice(0, 2);
  const doisEmDia =
    ultimos2.length === 2 &&
    ultimos2.every((b) => (diffDays(b.pagamento, b.vencimento) ?? 99) <= 0);

  if (doisEmDia && atraso <= 0) return "alta";

  const mediaAtraso = atrasos.length
    ? atrasos.reduce((s, n) => s + n, 0) / atrasos.length
    : 0;
  if (mediaAtraso >= 1 && mediaAtraso <= 10 && atraso <= 30) return "media";

  return "baixa";
}

function diffDays(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  if (Number.isNaN(da) || Number.isNaN(db)) return null;
  return Math.round((da - db) / 86_400_000);
}

export const INTENT_LABEL: Record<IntentLevel, string> = {
  alta: "Provável pagamento",
  media: "Pode atrasar",
  baixa: "Risco alto",
  perdido: "Perdido provável",
};

export const INTENT_STYLE: Record<IntentLevel, string> = {
  alta: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  media: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  baixa: "bg-orange-500/10 text-orange-600 border-orange-500/30",
  perdido: "bg-red-500/10 text-red-600 border-red-500/30",
};

export const INTENT_ACTION: Record<IntentLevel, string> = {
  alta: "Só reenviar o boleto 3 dias antes.",
  media: "Lembrete no vencimento + link do PDF.",
  baixa: "Ligação + oferta de 2ª via.",
  perdido: "Negociação / acionar retenção.",
};
