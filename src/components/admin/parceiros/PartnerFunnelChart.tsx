import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Filter } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PartnerAnalytics } from "./hooks/usePartnerAnalytics";

interface Props {
  analytics: PartnerAnalytics[];
}

export function PartnerFunnelChart({ analytics }: Props) {
  const data = [...analytics]
    .sort((a, b) => b.leads_total - a.leads_total)
    .slice(0, 6)
    .map((p) => ({
      nome: p.partner_nome,
      Interessados: p.funnel.lead,
      Conta: p.funnel.conta,
      Aprovado: p.funnel.aprovado,
    }));

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Filter className="h-4 w-4 text-primary" />
          Funil por parceiro
        </CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="text-sm text-muted-foreground py-12 text-center">
            Sem dados ainda
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={data} margin={{ left: 0, right: 12 }}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="hsl(var(--border))"
              />
              <XAxis
                dataKey="nome"
                stroke="hsl(var(--muted-foreground))"
                fontSize={10}
                interval={0}
                angle={-15}
                textAnchor="end"
                height={50}
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
              <Bar
                dataKey="Interessados"
                name="Clientes interessados"
                fill="hsl(var(--muted-foreground) / 0.5)"
                radius={[4, 4, 0, 0]}
              />
              <Bar
                dataKey="Conta"
                fill="hsl(var(--accent))"
                radius={[4, 4, 0, 0]}
              />
              <Bar
                dataKey="Aprovado"
                fill="hsl(var(--primary))"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
