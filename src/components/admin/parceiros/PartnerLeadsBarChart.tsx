import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3 } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PartnerAnalytics } from "./hooks/usePartnerAnalytics";

interface Props {
  analytics: PartnerAnalytics[];
}

export function PartnerLeadsBarChart({ analytics }: Props) {
  const data = [...analytics]
    .sort((a, b) => b.leads_total - a.leads_total)
    .slice(0, 8)
    .map((p) => ({
      nome: p.partner_nome,
      Total: p.leads_total,
      "Últ. 30d": p.leads_30d,
    }));

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-primary" />
          Clientes interessados por parceiro
        </CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="text-sm text-muted-foreground py-12 text-center">
            Aguardando primeiros clientes interessados
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart
              data={data}
              layout="vertical"
              margin={{ left: 12, right: 12 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="hsl(var(--border))"
                horizontal={false}
              />
              <XAxis
                type="number"
                stroke="hsl(var(--muted-foreground))"
                fontSize={11}
              />
              <YAxis
                type="category"
                dataKey="nome"
                stroke="hsl(var(--muted-foreground))"
                fontSize={11}
                width={100}
              />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Bar
                dataKey="Total"
                fill="hsl(var(--primary))"
                radius={[0, 4, 4, 0]}
              />
              <Bar
                dataKey="Últ. 30d"
                fill="hsl(var(--accent))"
                radius={[0, 4, 4, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
