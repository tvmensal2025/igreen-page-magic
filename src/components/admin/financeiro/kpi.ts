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
  /** Boletos com vencimento no mês corrente (pagos + em aberto). */
  emitidosMesCount: number;
  emitidosMesTotal: number;
  /** Vencidos com vencimento no mês corrente (mais correto p/ inadimplência do mês). */
  vencidosMesCount: number;
  vencidosMesTotal: number;
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
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  const k: FinanceiroKpis = {
    venceHojeCount: 0,
    venceHojeTotal: 0,
    vencidosCount: 0,
    vencidosTotal: 0,
    vence7dCount: 0,
    vence7dTotal: 0,
    pagosMesCount: 0,
    pagosMesTotal: 0,
    emitidosMesCount: 0,
    emitidosMesTotal: 0,
    vencidosMesCount: 0,
    vencidosMesTotal: 0,
  };

  for (const r of rows) {
    const total = Number(r.total || 0);
    const pago = !!r.pagamento || String(r.status || "").toLowerCase().includes("pago");
    const venc = r.vencimento ? startOfDay(new Date(r.vencimento)) : null;

    // Emitidos no mês (por vencimento)
    if (venc && venc >= monthStart && venc <= monthEnd) {
      k.emitidosMesCount++;
      k.emitidosMesTotal += total;
      if (!pago && venc < today) {
        k.vencidosMesCount++;
        k.vencidosMesTotal += total;
      }
    }

    if (pago && r.pagamento) {
      const p = new Date(r.pagamento);
      if (p >= monthStart) {
        k.pagosMesCount++;
        k.pagosMesTotal += total;
      }
      continue;
    }
    if (!venc) continue;
    if (venc.getTime() === today.getTime()) {
      k.venceHojeCount++;
      k.venceHojeTotal += total;
    }
    if (venc < today) {
      k.vencidosCount++;
      k.vencidosTotal += total;
    } else if (venc <= in7) {
      k.vence7dCount++;
      k.vence7dTotal += total;
    }
  }
  return k;
}

export interface TrendPoint {
  mes: string; // YYYY-MM
  label: string; // "Jan/26"
  pagos: number;
  vencidos: number;
  emitidos: number;
}

/**
 * Série mensal (últimos N meses) de emitidos × pagos × vencidos por
 * `vencimento`. Usado no gráfico de tendência do painel de boletos.
 */
export function computeBoletosTrend(rows: BoletoAdminRow[], months = 6): TrendPoint[] {
  const now = new Date();
  const points: TrendPoint[] = [];
  const map = new Map<string, TrendPoint>();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }).replace(".", "");
    const p: TrendPoint = { mes: key, label, pagos: 0, vencidos: 0, emitidos: 0 };
    map.set(key, p);
    points.push(p);
  }
  const today = startOfDay(now);
  for (const r of rows) {
    if (!r.vencimento) continue;
    const v = new Date(r.vencimento);
    const key = `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}`;
    const p = map.get(key);
    if (!p) continue;
    const total = Number(r.total || 0);
    const pago = !!r.pagamento || String(r.status || "").toLowerCase().includes("pago");
    p.emitidos += total;
    if (pago) p.pagos += total;
    else if (startOfDay(v) < today) p.vencidos += total;
  }
  return points;
}
