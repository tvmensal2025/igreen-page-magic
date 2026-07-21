import { DollarSign, Users, Target, Eye, MousePointerClick, TrendingUp, MessageCircle } from "lucide-react";
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
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8 min-w-0">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
    );
  }

  const cards = [
    { icon: DollarSign, label: "Gasto Ads (Meta)", value: fmtBRL(data?.spendCents ?? 0), tone: "text-primary", hint: "Insights Meta sync" },
    {
      icon: MessageCircle,
      label: "Conversas Meta",
      value: fmtNum(data?.conversations ?? 0),
      tone: "text-primary",
      hint: "CTWA · messaging started",
    },
    {
      icon: Users,
      label: "Leads CRM (Meta)",
      value: fmtNum(data?.crmLeads ?? 0),
      tone: "text-info",
      hint: "União real: campanha + match_log + meta_ads + CTWA/ad (sem duplicar)",
    },
    {
      icon: Target,
      label: "Custo / conversa",
      value: data?.costPerConversationCents != null ? fmtBRL(data.costPerConversationCents) : "—",
      tone: "text-warning",
      hint: "Gasto ÷ conversas Meta",
    },
    {
      icon: Target,
      label: "Custo / lead CRM",
      value: data?.cplCrmCents != null ? fmtBRL(data.cplCrmCents) : "—",
      tone: "text-warning",
      hint: "Gasto ÷ leads CRM reais (união Meta)",
    },
    { icon: Eye, label: "Impressões", value: fmtNum(data?.impressions ?? 0), tone: "text-info", hint: "Meta" },
    { icon: MousePointerClick, label: "Cliques", value: fmtNum(data?.clicks ?? 0), tone: "text-primary", hint: "Meta" },
    {
      icon: TrendingUp,
      label: "CTR",
      value: data?.ctr != null ? `${(data.ctr * 100).toFixed(2)}%` : "—",
      tone: "text-primary",
      hint: "Cliques ÷ impressões",
    },
  ];

  const noData = (data?.spendCents ?? 0) === 0 && (data?.impressions ?? 0) === 0;

  return (
    <div className="space-y-2">
      {!data?.hasConnection && noData && (
        <div className="text-[11px] text-muted-foreground/70 px-1">
          Sem conexão Meta Ads — conecte sua conta para popular gasto, impressões e conversas Meta.
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
      {data?.hasCampaigns && !noData && (
        <div className="text-[11px] text-muted-foreground/70 px-1">
          Fonte: Insights Meta (gasto/impr./cliques/conversas) + CRM com prova Meta
          (campanha ∪ meta_ads ∪ CTWA/ad — sem fallback de rodízio). Período {data.periodSince} →{" "}
          {data.periodUntil}
          {typeof data.crmLeadsStrict === "number" && data.crmLeadsStrict !== data.crmLeads
            ? ` · só source_campaign: ${data.crmLeadsStrict}`
            : ""}
          {(data.metaLeadActions ?? 0) > 0 ? ` · Lead forms Meta: ${data.metaLeadActions}` : ""}.
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8 min-w-0">
        {cards.map((c) => (
          <Card
            key={c.label}
            className="p-3 bg-card/60 border-border/40 backdrop-blur hover:bg-card/80 transition-colors min-w-0"
            title={c.hint}
          >
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground min-w-0">
              <c.icon className={`w-3.5 h-3.5 shrink-0 ${c.tone}`} />
              <span className="line-clamp-2 leading-tight">{c.label}</span>
            </div>
            <div className="mt-1.5 font-bold text-lg text-foreground tabular-nums break-words">
              {c.value}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
