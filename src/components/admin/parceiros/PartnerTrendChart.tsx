import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChart as LineIcon } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts";
import type { PartnerAnalytics } from "./hooks/usePartnerAnalytics";

interface Props {
  analytics: PartnerAnalytics[];
}

const COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--accent))",
  "hsl(200 80% 55%)",
  "hsl(280 70% 60%)",
  "hsl(40 90% 55%)",
];

export function PartnerTrendChart({ analytics }: Props) {
  const top = [...analytics]
    .sort((a, b) => b.leads_30d - a.leads_30d)
    .slice(0, 5);

  // Build merged series: array of {date, [partnerNome]: count}
  const dateMap = new Map<string, Record<string, number | string>>();
  top.forEach((p) => {
    (p.daily_series ?? []).forEach((d) => {
      const row = dateMap.get(d.date) ?? { date: d.date };
      row[p.partner_nome] = Number(d.count) || 0;
      dateMap.set(d.date, row);
    });
  });
  const data = Array.from(dateMap.values()).sort((a, b) =>
    String(a.date).localeCompare(String(b.date)),
  );

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <LineIcon className="h-4 w-4 text-primary" />
          Evolução (30 dias) — top 5
        </CardTitle>
      </CardHeader>
      <CardContent>
        {top.length === 0 ? (
          <p className="text-sm text-muted-foreground py-12 text-center">
            Sem dados nos últimos 30 dias
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={data} margin={{ left: 0, right: 12 }}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="hsl(var(--border))"
              />
              <XAxis
                dataKey="date"
                stroke="hsl(var(--muted-foreground))"
                fontSize={10}
                tickFormatter={(v) => {
                  const d = new Date(v);
                  return `${d.getDate()}/${d.getMonth() + 1}`;
                }}
              />
              <YAxis
                stroke="hsl(var(--muted-foreground))"
                fontSize={11}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {top.map((p, i) => (
                <Line
                  key={p.partner_id}
                  type="monotone"
                  dataKey={p.partner_nome}
                  stroke={COLORS[i % COLORS.length]}
                  strokeWidth={2}
                  dot={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
