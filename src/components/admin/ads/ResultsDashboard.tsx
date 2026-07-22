import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, DollarSign, Users, FileCheck2, Target, BarChart3, Eye, Hand, MousePointerClick, MessageCircle } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { MetricTooltip } from "./MetricTooltip";
import { HealthSummaryCard } from "./HealthSummaryCard";
import { InsightCards } from "./InsightCards";
import { CostExplainerCard } from "./CostExplainerCard";
import { FunnelWithCosts } from "./FunnelWithCosts";
import { CampaignExperimentCard } from "./CampaignExperimentCard";
import { META_CAMPAIGN_PROOF_OR } from "@/lib/metaCampaignProof";

type Range = 7 | 30 | 90;

interface Campaign {
  id: string;
  name: string;
  status: string;
  cities: any[];
  distribuidora: string | null;
  daily_budget_cents: number;
  created_at: string;
}

interface DailyMetric {
  campaign_id: string;
  date: string;
  spend_cents: number;
  impressions: number;
  clicks: number;
  meta_lead_actions: number;
  messaging_conversations_started: number;
  complete_registrations: number;
}

export function ResultsDashboard({
  consultantId,
  onCreateClick,
  externalRange,
  hidePeriodSelector,
}: {
  consultantId: string;
  onCreateClick?: () => void;
  externalRange?: Range;
  hidePeriodSelector?: boolean;
}) {
  const [internalRange, setInternalRange] = useState<Range>(30);
  const range = externalRange ?? internalRange;
  const setRange = (r: Range) => setInternalRange(r);
  const [distribFilter, setDistribFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [metrics, setMetrics] = useState<DailyMetric[]>([]);
  const [contactsByCampaign, setContactsByCampaign] = useState<Record<string, number>>({});
  const [approvedByCampaign, setApprovedByCampaign] = useState<Record<string, number>>({});

  useEffect(() => {
    (async () => {
      setLoading(true);
      const since = new Date(Date.now() - range * 86400_000).toISOString();
      const sinceDate = since.slice(0, 10);

      const { data: camps } = await supabase
        .from("facebook_campaigns")
        .select("id,name,status,cities,distribuidora,daily_budget_cents,created_at")
        .eq("consultant_id", consultantId)
        .order("created_at", { ascending: false });
      const list = (camps || []) as Campaign[];
      setCampaigns(list);

      if (list.length > 0) {
        const { data: ms, error: metricsError } = await supabase
          .from("facebook_metrics_daily")
          .select("campaign_id,date,spend_cents,impressions,clicks,meta_lead_actions,messaging_conversations_started,complete_registrations")
          .in("campaign_id", list.map(c => c.id))
          .gte("date", sinceDate)
          .order("date", { ascending: true });
        if (metricsError) console.error("[ResultsDashboard] Falha ao carregar métricas:", metricsError.message);
        setMetrics((ms || []) as DailyMetric[]);
      } else {
        setMetrics([]);
      }

      // Contatos atribuídos por campanha, exigindo prova Meta (AD ID ou ctwa_clid).
      if (list.length > 0) {
        const { data: contactRows } = await (supabase as any)
          .from("customers")
          .select("id, source_campaign_id")
          .eq("consultant_id", consultantId)
          .in("source_campaign_id", list.map((c) => c.id))
          .or(META_CAMPAIGN_PROOF_OR)
          .gte("created_at", since)
          .limit(10000);
        const contactCounts: Record<string, number> = {};
        (contactRows || []).forEach((row: any) => {
          if (row.source_campaign_id) contactCounts[row.source_campaign_id] = (contactCounts[row.source_campaign_id] || 0) + 1;
        });
        setContactsByCampaign(contactCounts);

        const { data: approvedRows } = await (supabase as any)
          .from("crm_deals")
          .select("id, customers!inner(source_campaign_id, source_ad_id, ctwa_clid, source_ctwa_clid)")
          .eq("consultant_id", consultantId)
          .eq("stage", "aprovado")
          .in("customers.source_campaign_id", list.map((c) => c.id))
          .gte("created_at", since)
          .limit(10000);
        const approvedCounts: Record<string, number> = {};
        (approvedRows || []).forEach((deal: any) => {
          const customer = deal.customers;
          const hasProof = !!(customer?.source_ad_id || customer?.ctwa_clid || customer?.source_ctwa_clid);
          if (hasProof && customer?.source_campaign_id) {
            approvedCounts[customer.source_campaign_id] = (approvedCounts[customer.source_campaign_id] || 0) + 1;
          }
        });
        setApprovedByCampaign(approvedCounts);
      } else {
        setContactsByCampaign({});
        setApprovedByCampaign({});
      }

      setLoading(false);
    })();
  }, [consultantId, range]);



  const distribuidoras = useMemo(() => {
    const set = new Set<string>();
    campaigns.forEach(c => { if (c.distribuidora) set.add(c.distribuidora); });
    return Array.from(set).sort();
  }, [campaigns]);

  const filteredCampaignIds = useMemo(() => {
    if (distribFilter === "all") return new Set(campaigns.map(c => c.id));
    return new Set(campaigns.filter(c => c.distribuidora === distribFilter).map(c => c.id));
  }, [campaigns, distribFilter]);

  const filteredMetrics = useMemo(
    () => metrics.filter(m => filteredCampaignIds.has(m.campaign_id)),
    [metrics, filteredCampaignIds],
  );

  const filteredContactCount = useMemo(
    () => Array.from(filteredCampaignIds).reduce((sum, id) => sum + (contactsByCampaign[id] || 0), 0),
    [filteredCampaignIds, contactsByCampaign],
  );
  const filteredApprovedCount = useMemo(
    () => Array.from(filteredCampaignIds).reduce((sum, id) => sum + (approvedByCampaign[id] || 0), 0),
    [filteredCampaignIds, approvedByCampaign],
  );

  const totals = useMemo(() => {
    const t = { spend: 0, impressions: 0, clicks: 0, metaLeads: 0, conversations: 0, registrations: 0 };
    filteredMetrics.forEach(m => {
      t.spend += m.spend_cents;
      t.impressions += m.impressions;
      t.clicks += m.clicks;
      t.metaLeads += m.meta_lead_actions;
      t.conversations += m.messaging_conversations_started;
      t.registrations += m.complete_registrations;
    });
    return t;
  }, [filteredMetrics]);

  // CPL/CPA usam contatos e clientes realmente atribuídos no CRM.
  const cpl = filteredContactCount > 0 ? totals.spend / filteredContactCount / 100 : 0;
  const cpa = filteredApprovedCount > 0 ? totals.spend / filteredApprovedCount / 100 : 0;
  const convRate = filteredContactCount > 0 ? (filteredApprovedCount / filteredContactCount) * 100 : 0;
  // Métricas de eficiência criativa/funil de topo
  const ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
  const clickToLead = totals.clicks > 0 ? (filteredContactCount / totals.clicks) * 100 : 0;
  const cpc = totals.clicks > 0 ? totals.spend / totals.clicks / 100 : 0;

  const chartData = useMemo(() => {
    const map = new Map<string, { date: string; gasto: number; conversas: number; leadsMeta: number }>();
    filteredMetrics.forEach(m => {
      const cur = map.get(m.date) || { date: m.date, gasto: 0, conversas: 0, leadsMeta: 0 };
      cur.gasto += m.spend_cents / 100;
      cur.conversas += m.messaging_conversations_started;
      cur.leadsMeta += m.meta_lead_actions;
      map.set(m.date, cur);
    });
    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date)).map(d => ({
      ...d,
      gasto: Math.round(d.gasto * 100) / 100,
      label: d.date.slice(5),
    }));
  }, [filteredMetrics]);

  const perCampaign = useMemo(() => {
    return campaigns
      .filter(c => filteredCampaignIds.has(c.id))
      .map(c => {
        const ms = metrics.filter(m => m.campaign_id === c.id);
        const spend = ms.reduce((s, m) => s + m.spend_cents, 0);
        const conversations = ms.reduce((s, m) => s + m.messaging_conversations_started, 0);
        const metaLeads = ms.reduce((s, m) => s + m.meta_lead_actions, 0);
        const contacts = contactsByCampaign[c.id] || 0;
        const approved = approvedByCampaign[c.id] || 0;
        return {
          ...c,
          spend_cents: spend,
          conversations,
          meta_leads: metaLeads,
          contacts,
          approved,
          cost_per_conversation_cents: conversations > 0 ? Math.round(spend / conversations) : 0,
          cost_per_contact_cents: contacts > 0 ? Math.round(spend / contacts) : 0,
        };
      })
      .sort((a, b) => b.spend_cents - a.spend_cents);
  }, [campaigns, metrics, filteredCampaignIds, contactsByCampaign, approvedByCampaign]);

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;

  if (campaigns.length === 0) {
    return (
      <Card className="p-10 text-center bg-gradient-to-br from-primary/10 to-primary/5 border-primary/20">
        <div className="mx-auto w-14 h-14 rounded-full bg-primary/15 flex items-center justify-center mb-4">
          <BarChart3 className="w-7 h-7 text-primary" />
        </div>
        <h3 className="text-lg font-bold text-foreground">Você ainda não tem campanhas</h3>
        <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
          Escolha um modelo pronto na <strong className="text-foreground">Galeria</strong> e publique em 1 clique — em seu nome, com seu WhatsApp já conectado.
        </p>
        {onCreateClick && (
          <Button size="lg" className="mt-5 gap-2" onClick={onCreateClick}>
            <Target className="w-4 h-4" /> Ver modelos prontos
          </Button>
        )}
      </Card>
    );
  }

  return (
    <div className="space-y-5 min-w-0 max-w-full">
      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3">
        {!hidePeriodSelector && (
          <div className="flex items-center gap-1 rounded-lg bg-secondary p-1">
            {[7, 30, 90].map(r => (
              <Button key={r} size="sm" variant={range === r ? "default" : "ghost"} onClick={() => setRange(r as Range)} className="h-7 text-xs">
                {r === 90 ? "90 dias" : `${r} dias`}
              </Button>
            ))}
          </div>
        )}
        {distribuidoras.length > 0 && (
          <select
            value={distribFilter}
            onChange={e => setDistribFilter(e.target.value)}
            className="h-8 text-xs rounded-lg bg-secondary border border-border px-2 text-foreground"
          >
            <option value="all">Todas distribuidoras</option>
            {distribuidoras.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        )}
      </div>

      {/* Aviso quando há cliques mas nenhum lead foi atribuído ao anúncio */}
      {totals.clicks > 0 && filteredContactCount === 0 && (
        <Card className="p-4 bg-warning/10 border-warning/40">
          <div className="flex items-start gap-3">
            <div className="text-warning text-lg">⚠️</div>
            <div className="text-xs sm:text-sm">
              <p className="font-semibold text-foreground mb-1">Atribuição de anúncio pendente</p>
              <p className="text-muted-foreground">
                Você teve <strong className="text-foreground">{totals.clicks} cliques</strong> no anúncio, mas nenhum contato no CRM possui prova de atribuição por ID do anúncio ou identificador CTWA ainda.
                Isso pode acontecer quando a origem do anúncio não chega junto com a conversa ou quando o contato entrou antes da atribuição automática.
                Os números abaixo mostram <strong className="text-foreground">apenas clientes interessados/clientes confirmados de anúncio</strong>.
              </p>
            </div>
          </div>
        </Card>
      )}

      <CampaignExperimentCard consultantId={consultantId} />

      {/* Explicação clara: Click → conversa Meta → cliente aprovado */}
      <CostExplainerCard
        spendCents={totals.spend}
        clicks={totals.clicks}
        leads={totals.conversations}
        approved={filteredApprovedCount}
      />


      {/* Funil de conversão com custo por etapa */}
      <FunnelWithCosts
        consultantId={consultantId}
        spendCents={totals.spend}
        periodDays={range}
      />

      {/* Saúde geral + insights da IA */}
      <HealthSummaryCard
        spend_cents={totals.spend}
        leads={totals.conversations}
        impressions={totals.impressions}
        registrations={filteredApprovedCount}
      />
      <InsightCards consultantId={consultantId} />

      {/* Cards em linguagem do dia a dia */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard icon={<DollarSign className="w-4 h-4" />} label="Quanto gastou" metric="spend" value={`R$ ${(totals.spend / 100).toFixed(2)}`} accent />
        <StatCard icon={<Eye className="w-4 h-4" />} label="Pessoas que viram" metric="impressions" value={totals.impressions.toLocaleString("pt-BR")} />
        <StatCard icon={<Hand className="w-4 h-4" />} label="Tocaram no anúncio" metric="clicks" value={totals.clicks.toString()} sub={cpc > 0 ? `R$ ${cpc.toFixed(2)} por clique` : "—"} />
        <StatCard icon={<MessageCircle className="w-4 h-4" />} label="Conversas iniciadas (Meta)" value={totals.conversations.toString()} sub="Dado informado pela Meta" />
        <StatCard icon={<Users className="w-4 h-4" />} label="Contatos identificados no CRM" metric="leads" value={filteredContactCount.toString()} sub={cpl > 0 ? `R$ ${cpl.toFixed(2)} cada` : "—"} />
        <StatCard icon={<FileCheck2 className="w-4 h-4" />} label="Viraram cliente" metric="registrations" value={filteredApprovedCount.toString()} sub={filteredContactCount > 0 ? `${convRate.toFixed(1)}% dos contatos` : "—"} />
      </div>

      {/* Eficiência do funil: topo (anúncio) e meio (clique → conversa) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <MousePointerClick className="w-4 h-4 text-primary" />
            <span>CTR — Taxa de clique no anúncio</span>
          </div>
          <div className="flex items-end justify-between mt-2">
            <div className="text-2xl font-bold text-foreground">
              {totals.impressions > 0 ? `${ctr.toFixed(2)}%` : "—"}
            </div>
            <div className="text-[11px] text-muted-foreground text-right">
              {totals.clicks.toLocaleString("pt-BR")} cliques<br/>de {totals.impressions.toLocaleString("pt-BR")} visualizações
            </div>
          </div>
          <div className="text-[11px] text-muted-foreground mt-2">
            {ctr === 0
              ? "Sem dados ainda."
              : "Compare esta taxa com o histórico das suas próprias campanhas e considere o volume de impressões antes de concluir."}
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <MessageCircle className="w-4 h-4 text-primary" />
            <span>Clique → Cliente interessado no WhatsApp</span>
          </div>
          <div className="flex items-end justify-between mt-2">
            <div className="text-2xl font-bold text-foreground">
              {totals.clicks > 0 ? `${clickToLead.toFixed(1)}%` : "—"}
            </div>
            <div className="text-[11px] text-muted-foreground text-right">
              {filteredContactCount} contatos atribuídos<br/>de {totals.clicks.toLocaleString("pt-BR")} cliques
            </div>
          </div>
          <div className="text-[11px] text-muted-foreground mt-2">
            {clickToLead === 0 && totals.clicks > 0 && <span className="text-warning">⚠ Ninguém que clicou virou cliente interessado. Verifique o link/WhatsApp.</span>}
            {clickToLead > 0 && clickToLead < 30 && "Muitos cliques se perdem antes de abrir conversa."}
            {clickToLead >= 30 && clickToLead < 60 && "Boa conversão de clique pra conversa."}
            {clickToLead >= 60 && <span className="text-primary">✅ Excelente — quase todo clique vira cliente interessado.</span>}
          </div>
        </Card>
      </div>

      {/* Card-resumo de fechamento real */}
      <Card className="p-4 bg-gradient-to-br from-primary/10 to-primary/5 border-primary/30">
        <div className="flex items-center gap-3">
          <Target className="w-5 h-5 text-primary" />
          <div className="flex-1">
            <div className="text-xs text-muted-foreground">Custo real pra ganhar 1 cliente novo</div>
            <div className="text-2xl font-bold text-foreground">
              {filteredApprovedCount > 0 ? `R$ ${((totals.spend / 100) / filteredApprovedCount).toFixed(2)}` : "—"}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              R$ {(totals.spend / 100).toFixed(2)} gastos → {filteredApprovedCount} cliente{filteredApprovedCount === 1 ? "" : "s"} aprovado{filteredApprovedCount === 1 ? "" : "s"}.
              Compare o custo com sua margem real e seu histórico; nenhuma meta fixa foi presumida.
            </div>
          </div>
        </div>
      </Card>

      {/* Gráfico */}
      <Card className="p-4">
        <h4 className="font-bold text-sm mb-3 flex items-center gap-2"><BarChart3 className="w-4 h-4 text-primary" /> Performance diária</h4>
        {chartData.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-8">Sem dados nesse período. Crie uma campanha pra começar.</div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="gasto" name="Gasto (R$)" stroke="hsl(var(--destructive))" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="conversas" name="Conversas Meta" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="leadsMeta" name="Leads Meta" stroke="hsl(var(--accent-foreground))" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* Tabela por campanha */}
      <Card className="p-4 overflow-x-auto">
        <h4 className="font-bold text-sm mb-3">Por campanha</h4>
        {perCampaign.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-6">Nenhuma campanha no filtro atual.</div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border">
                <th className="py-2">Campanha</th>
                <th>Distribuidora</th>
                <th className="text-right">Gasto</th>
                <th className="text-right">Conversas Meta</th>
                <th className="text-right">Leads Meta</th>
                <th className="text-right">Contatos CRM</th>
                <th className="text-right">Aprovados</th>
                <th className="text-right">Custo/conversa</th>
                <th className="text-right">Custo/contato</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {perCampaign.map(c => (
                <tr key={c.id} className="border-b border-border/50 hover:bg-secondary/30">
                  <td className="py-2 max-w-[200px] truncate font-medium text-foreground">{c.name}</td>
                  <td className="text-muted-foreground">{c.distribuidora || "—"}</td>
                  <td className="text-right font-mono">R$ {(c.spend_cents / 100).toFixed(2)}</td>
                  <td className="text-right font-mono">{c.conversations}</td>
                  <td className="text-right font-mono">{c.meta_leads}</td>
                  <td className="text-right font-mono">{c.contacts}</td>
                  <td className="text-right font-mono">{c.approved}</td>
                  <td className="text-right font-mono">{c.cost_per_conversation_cents > 0 ? `R$ ${(c.cost_per_conversation_cents / 100).toFixed(2)}` : "—"}</td>
                  <td className="text-right font-mono">{c.cost_per_contact_cents > 0 ? `R$ ${(c.cost_per_contact_cents / 100).toFixed(2)}` : "—"}</td>
                  <td>
                    <Badge variant="outline" className="text-[10px]">
                      {{
                        active: "Ativa",
                        paused: "Pausada",
                        pending_review: "Em revisão",
                        rejected: "Rejeitada",
                        completed: "Concluída",
                        draft: "Rascunho",
                      }[c.status] || c.status}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <p className="text-[10px] text-muted-foreground text-center">
        Métricas Meta (conversas e leads) são exibidas separadas dos contatos e aprovados confirmados no CRM.
        Não há projeção de lucro sem margem ou comissão real cadastrada.
      </p>
    </div>
  );
}

function StatCard({ icon, label, value, sub, accent, metric }: { icon: React.ReactNode; label: string; value: string; sub?: string; accent?: boolean; metric?: import("@/lib/adGlossary").AdMetricKey }) {
  return (
    <Card className={`p-3 ${accent ? "bg-primary/10 border-primary/30" : ""}`}>
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {icon}
        <span>{label}</span>
        {metric && <MetricTooltip metric={metric} />}
      </div>
      <div className={`text-lg font-bold mt-1 ${accent ? "text-primary" : "text-foreground"}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </Card>
  );
}
