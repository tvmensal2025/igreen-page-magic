import { TrendingUp } from "lucide-react";
import { ReheatCyclePizza } from "@/components/admin/ReheatCyclePizza";

interface CustomerMetrics {
  totalCustomers: number;
  totalKw: number;
  avgKw: number;
  customersByStatus: { status: string; count: number; label: string }[];
  weeklyNewCustomers: { week: string; count: number }[];
}

interface LicenciadoData {
  name: string;
  deals: number;
}

interface CustomerChartsProps {
  filteredMetrics: CustomerMetrics | null;
  topLicenciados?: LicenciadoData[];
  consultantId?: string;
}

export function CustomerCharts({ filteredMetrics: _filteredMetrics, topLicenciados, consultantId }: CustomerChartsProps) {
  const licenciadosData = topLicenciados ?? [];

  const maxDeals = licenciadosData.reduce((m, l) => Math.max(m, l.deals), 0) || 1;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Ranking de Licenciados */}
        <div className="premium-card lg:col-span-2">
          <h3 className="font-heading font-bold text-foreground mb-1 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary" /> Ranking de licenciados
          </h3>
          <p className="text-xs text-muted-foreground mb-4">Top licenciados por contas cadastradas</p>
          {licenciadosData && licenciadosData.length > 0 ? (
            <ol className="space-y-2.5">
              {licenciadosData.slice(0, 10).map((b, idx) => {
                const pct = (b.deals / maxDeals) * 100;
                return (
                  <li key={`${b.name}-${idx}`} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="truncate max-w-[220px] sensitive-name" title={b.name}>
                        <span className="text-muted-foreground mr-1.5">{idx + 1}.</span>
                        {b.name}
                      </span>
                      <span className="font-semibold tabular-nums text-foreground">{b.deals}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-primary/80" style={{ width: `${pct}%` }} />
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">Nenhum licenciado vinculado ainda</p>
          )}
        </div>

        {/* Ciclo diário — no lugar do Status (2 pizzas grandes: Novo | Frio) */}
        <div className="lg:col-span-3 min-w-0">
          <ReheatCyclePizza consultantId={consultantId} />
        </div>
      </div>
    </div>
  );
}
