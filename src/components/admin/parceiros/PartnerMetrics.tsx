import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users } from "lucide-react";
import type { PartnerMetric } from "./hooks/useReferralPartners";

interface PartnerMetricsProps {
  metrics: PartnerMetric[];
}

export function PartnerMetrics({ metrics }: PartnerMetricsProps) {
  if (metrics.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4" />
            Clientes interessados por Parceiro
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Nenhum cliente interessado atribuído a parceiros ainda.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="h-4 w-4" />
          Clientes interessados por Parceiro
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {metrics.map((m) => (
            <div
              key={m.partner_id}
              className="flex items-center justify-between py-1.5 border-b last:border-0"
            >
              <span className="text-sm font-medium">{m.partner_nome}</span>
              <span className="text-sm text-muted-foreground font-mono">
                {m.lead_count} lead{m.lead_count !== 1 ? "s" : ""}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
