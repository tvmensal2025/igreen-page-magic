import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PieChart as PieIcon } from "lucide-react";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts";
import type { PartnerAnalytics } from "./hooks/usePartnerAnalytics";

interface Props {
  analytics: PartnerAnalytics[];
}

export function PartnerOriginDonut({ analytics }: Props) {
  const qr = analytics.reduce((s, p) => s + p.qr_count, 0);
  const kw = analytics.reduce((s, p) => s + p.keyword_count, 0);
  const data = [
    { name: "QR Code", value: qr, fill: "hsl(var(--primary))" },
    { name: "Palavra-chave", value: kw, fill: "hsl(var(--accent))" },
  ].filter((d) => d.value > 0);

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <PieIcon className="h-4 w-4 text-accent" />
          Origem dos clientes interessados
        </CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="text-sm text-muted-foreground py-12 text-center">
            Sem dados de origem
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={100}
                paddingAngle={4}
                dataKey="value"
              >
                {data.map((entry, i) => (
                  <Cell key={i} fill={entry.fill} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
