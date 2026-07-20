import { DollarSign, Users, Target, Eye, MousePointerClick, TrendingUp } from "lucide-react";
import { useAdMetrics } from "@/hooks/useAdMetrics";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const fmtBRL = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const fmtNum = (n: number) => n.toLocaleString("pt-BR");

interface Props {
  consultantId: string;
  periodDays: number;
}

export function AdMetricsCards({ consultantId, periodDays }: Props) {
  const { data, isLoading } = useAdMetrics(consultantId, periodDays);

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
    );
  }

  const cards = [
    { icon: DollarSign, label: "Gasto Ads", value: fmtBRL(data?.spendCents ?? 0), tone: "text-primary" },
    { icon: Users, label: "Leads / Conversas Meta", value: fmtNum(data?.leads ?? 0), tone: "text-primary" },
    { icon: Target, label: "Custo por lead", value: data?.cplCents != null ? fmtBRL(data.cplCents) : "—", tone: "text-warning" },
    { icon: Eye, label: "Impressões", value: fmtNum(data?.impressions ?? 0), tone: "text-info" },
    { icon: MousePointerClick, label: "Cliques", value: fmtNum(data?.clicks ?? 0), tone: "text-primary" },
    { icon: TrendingUp, label: "CTR", value: data?.ctr != null ? `${(data.ctr * 100).toFixed(2)}%` : "—", tone: "text-primary" },
  ];

  const noData = (data?.spendCents ?? 0) === 0 && (data?.impressions ?? 0) === 0;

  return (
    <div className="space-y-2">
      {!data?.hasConnection && noData && (
        <div className="text-[11px] text-muted-foreground/70 px-1">
          Sem conexão Meta Ads — conecte sua conta para popular gasto, impressões e leads Meta.
        </div>
      )}
      {data?.hasConnection && !data?.hasCampaigns && (
        <div className="text-[11px] text-muted-foreground/70 px-1">
          Conta Meta conectada, mas ainda sem campanhas. Publique um modelo na Galeria para começar a ver números.
        </div>
      )}
      {data?.hasCampaigns && noData && (
        <div className="text-[11px] text-muted-foreground/70 px-1">
          Aguardando o primeiro sync de métricas do Meta (roda a cada 30 min).
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {cards.map((c) => (
          <Card
            key={c.label}
            className="p-3 bg-card/60 border-border/40 backdrop-blur hover:bg-card/80 transition-colors"
          >
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <c.icon className={`w-3.5 h-3.5 ${c.tone}`} />
              <span className="truncate">{c.label}</span>
            </div>
            <div className="mt-1.5 font-bold text-lg text-foreground tabular-nums">
              {c.value}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
