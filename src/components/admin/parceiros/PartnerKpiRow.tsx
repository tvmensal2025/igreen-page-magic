import { Users, TrendingUp, CheckCircle2, Crown } from "lucide-react";
import { StatCard } from "@/components/admin/StatCard";
import type { PartnerAnalytics } from "./hooks/usePartnerAnalytics";

interface Props {
  analytics: PartnerAnalytics[];
  activeCount: number;
}

export function PartnerKpiRow({ analytics, activeCount }: Props) {
  const leads30d = analytics.reduce((s, p) => s + p.leads_30d, 0);
  const totalLeads = analytics.reduce((s, p) => s + p.leads_total, 0);
  const totalAprov = analytics.reduce((s, p) => s + p.aprovados, 0);
  const convRate =
    totalLeads > 0 ? Math.round((totalAprov / totalLeads) * 100) : 0;
  const top = [...analytics].sort((a, b) => b.leads_30d - a.leads_30d)[0];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <StatCard
        icon={<Users />}
        label="Parceiros ativos"
        value={activeCount}
        color="primary"
      />
      <StatCard
        icon={<TrendingUp />}
        label="Clientes interessados (30 dias)"
        value={leads30d}
        color="accent"
        subtitle={`${totalLeads} no total`}
      />
      <StatCard
        icon={<CheckCircle2 />}
        label="Conversão média"
        value={`${convRate}%`}
        color="primary"
        subtitle={`${totalAprov} aprovados`}
      />
      <StatCard
        icon={<Crown />}
        label="Top parceiro 30d"
        value={top?.partner_nome ?? "—"}
        color="accent"
        subtitle={top ? `${top.leads_30d} leads` : "Aguardando dados"}
      />
    </div>
  );
}
