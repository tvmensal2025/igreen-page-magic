import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from "recharts";
import { computeBoletosTrend } from "./kpi";
import type { BoletoAdminRow } from "./hooks";

const BRL = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

/** Gráfico de barras dos últimos 6 meses: emitidos, pagos e vencidos. */
export function BoletosTrendChart({ rows }: { rows: BoletoAdminRow[] }) {
  const data = useMemo(() => computeBoletosTrend(rows, 6), [rows]);
  const hasData = data.some((d) => d.emitidos > 0);
  if (!hasData) return null;

  return (
    <section className="rounded-xl border border-border/60 bg-card p-4">
      <header className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold">Tendência (últimos 6 meses)</h3>
        <span className="text-[11px] text-muted-foreground">por vencimento</span>
      </header>
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
            <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
            <Tooltip
              contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
              formatter={(v: number, name: string) => [BRL(v), name === "pagos" ? "Pagos" : name === "vencidos" ? "Vencidos" : "Emitidos"]}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="pagos" name="Pagos" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
            <Bar dataKey="vencidos" name="Vencidos" fill="hsl(0 84% 60%)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
