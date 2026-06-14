import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Formatador único de moeda (R$) para todo o front.
 *
 * Centraliza o que hoje está espalhado em vários `BRL`/`formatBRL`/`_formatBRL`
 * locais. Use sempre este helper ao exibir valores monetários, para que o
 * formato fique consistente e os valores possam ser ocultados pelo modo
 * privacidade (ver componente <Sensitive kind="value">).
 *
 * @param value  valor em reais (ex.: 1234.5). Aceita null/undefined → "—".
 * @param opts.cents  quando true, trata `value` como centavos (ex.: 123450 → R$ 1.234,50).
 */
export function formatCurrencyBRL(
  value: number | null | undefined,
  opts?: { cents?: boolean },
): string {
  if (value == null || Number.isNaN(value)) return "—";
  const reais = opts?.cents ? value / 100 : value;
  return reais.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
