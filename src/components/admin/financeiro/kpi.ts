import type { BoletoAdminRow } from "./hooks";

export interface FinanceiroKpis {
  venceHojeCount: number;
  venceHojeTotal: number;
  vencidosCount: number;
  vencidosTotal: number;
  vence7dCount: number;
  vence7dTotal: number;
  pagosMesCount: number;
  pagosMesTotal: number;
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/**
 * Calcula KPIs de vencimento e pagamento para o topo da aba Financeiro.
 * Usa `vencimento` (YYYY-MM-DD) e `pagamento` para determinar o estado real,
 * evitando confiar apenas em `status` (que a iGreen popula de forma variável).
 */
export function computeFinanceiroKpis(rows: BoletoAdminRow[]): FinanceiroKpis {
  const now = new Date();
  const today = startOfDay(now);
  const in7 = new Date(today);
  in7.setDate(in7.getDate() + 7);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const k: FinanceiroKpis = {
    venceHojeCount: 0,
    venceHojeTotal: 0,
    vencidosCount: 0,
    vencidosTotal: 0,
    vence7dCount: 0,
    vence7dTotal: 0,
    pagosMesCount: 0,
    pagosMesTotal: 0,
  };

  for (const r of rows) {
    const total = Number(r.total || 0);
    const pago = !!r.pagamento || String(r.status || "").toLowerCase().includes("pago");
    if (pago && r.pagamento) {
      const p = new Date(r.pagamento);
      if (p >= monthStart) {
        k.pagosMesCount++;
        k.pagosMesTotal += total;
      }
      continue;
    }
    if (!r.vencimento) continue;
    const v = startOfDay(new Date(r.vencimento));
    if (v.getTime() === today.getTime()) {
      k.venceHojeCount++;
      k.venceHojeTotal += total;
    }
    if (v < today) {
      k.vencidosCount++;
      k.vencidosTotal += total;
    } else if (v <= in7) {
      k.vence7dCount++;
      k.vence7dTotal += total;
    }
  }
  return k;
}
