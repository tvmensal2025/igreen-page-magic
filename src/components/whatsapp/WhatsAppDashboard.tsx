import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { MessageSquare, Clock, Send, TrendingUp, Calendar, Users, Sparkles, CalendarClock } from "lucide-react";
import { AttendanceRatingsCard } from "@/components/whatsapp/AttendanceRatingsCard";
import { AreaChart, Area, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { format, subDays, differenceInMinutes, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { isIgreenWalletOrigin } from "@/lib/customerOrigin";
import { buildUpcomingPosVendaMessages, groupSentStageKeys } from "@/lib/posVendaSchedule";
import { dispatchAgendamentosNav } from "@/lib/agendamentosHub";
import type { PosVendaStage } from "@/lib/posVenda/format";
import { AutomacoesAtivasBadge } from "@/features/produtos/acompanhamento/AutomacoesAtivasBadge";

interface WhatsAppDashboardProps {
  consultantId: string;
}

function KpiCard({ icon, label, value, subtitle, accentClass = "text-primary" }: {
  icon: React.ReactNode; label: string; value: string | number; subtitle?: string; accentClass?: string;
}) {
  return (
    <div className="bg-card rounded-xl border border-border p-3 flex items-start gap-2.5 min-w-0">
      <div className={`w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 ${accentClass}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xl font-bold font-heading text-foreground leading-tight truncate">{value}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{label}</p>
        {subtitle && <p className="text-[10px] text-muted-foreground/70 mt-0.5 truncate">{subtitle}</p>}
      </div>
    </div>
  );
}

export function WhatsAppDashboard({ consultantId }: WhatsAppDashboardProps) {
  // Fetch all conversations for this consultant's customers
  const { data: conversations, isLoading: loadingConvos } = useQuery({
    queryKey: ["waDashConvos", consultantId],
    queryFn: async () => {
      const { data: customerIds } = await supabase
        .from("customers")
        .select("id")
        .eq("consultant_id", consultantId);
      if (!customerIds?.length) return [];
      const ids = customerIds.map((c) => c.id);
      const all: any[] = [];
      // Fetch in batches of 50 customer IDs
      for (let i = 0; i < ids.length; i += 50) {
        const batch = ids.slice(i, i + 50);
        const { data } = await supabase
          .from("conversations")
          .select("customer_id, message_direction, created_at")
          .in("customer_id", batch)
          .gte("created_at", subDays(new Date(), 30).toISOString())
          .order("created_at", { ascending: true });
        if (data) all.push(...data);
      }
      return all;
    },
  });

  const { data: customers, isLoading: loadingCustomers } = useQuery({
    queryKey: ["waDashCustomerNames", consultantId],
    queryFn: async () => {
      const { data } = await supabase
        .from("customers")
        .select("id, name, phone_whatsapp")
        .eq("consultant_id", consultantId);
      return data || [];
    },
  });

  const { data: deals } = useQuery({
    queryKey: ["waDashDeals", consultantId],
    queryFn: async () => {
      const { data } = await supabase.from("crm_deals").select("stage").eq("consultant_id", consultantId);
      return data || [];
    },
  });

  const { data: kanbanStages } = useQuery({
    queryKey: ["waDashStages", consultantId],
    queryFn: async () => {
      const { data } = await supabase.from("kanban_stages").select("stage_key, label, color").eq("consultant_id", consultantId).order("position");
      return data || [];
    },
  });

  const { data: scheduledMsgs } = useQuery({
    queryKey: ["waDashScheduled", consultantId],
    queryFn: async () => {
      const { data } = await supabase
        .from("scheduled_messages")
        .select("id, status, scheduled_at, remote_jid, message_text")
        .eq("consultant_id", consultantId)
        .eq("status", "pending")
        .order("scheduled_at", { ascending: true })
        .limit(5);
      return data || [];
    },
  });

  const { data: posVendaUpcoming } = useQuery({
    queryKey: ["waDashPosVendaUpcoming", consultantId],
    queryFn: async () => {
      const [custRes, logRes, defRes] = await Promise.all([
        supabase
          .from("customers")
          .select("id, name, phone_whatsapp, pos_venda_stage, pos_venda_approved_at, customer_origin")
          .or(`consultant_id.eq.${consultantId},assigned_consultant_id.eq.${consultantId}`)
          .in("pos_venda_stage", ["aprovado", "reprovado", "retentativa", "d30", "d60", "d90", "d120", "d150", "d180", "d210"]),
        supabase.from("customer_auto_message_log").select("customer_id, stage_key").eq("consultant_id", consultantId),
        supabase.from("pos_venda_default_media").select("stage, message_text").eq("is_active", true),
      ]);
      const wallet = (custRes.data || []).filter((c) => isIgreenWalletOrigin(c.customer_origin));
      const previews: Partial<Record<PosVendaStage, string>> = {};
      for (const d of defRes.data || []) {
        if (d.message_text) previews[d.stage as PosVendaStage] = d.message_text;
      }
      return buildUpcomingPosVendaMessages(
        wallet.map((c) => ({
          id: c.id,
          name: c.name,
          phone_whatsapp: c.phone_whatsapp,
          pos_venda_stage: c.pos_venda_stage,
          pos_venda_approved_at: c.pos_venda_approved_at,
        })),
        groupSentStageKeys((logRes.data || []) as Array<{ customer_id: string; stage_key: string }>),
        previews,
      );
    },
  });

  const upcomingCombined = useMemo(() => {
    const manual = (scheduledMsgs || []).map((msg) => ({
      id: `m-${msg.id}`,
      kind: "manual" as const,
      name: customers?.find((c) => {
        const phone = msg.remote_jid?.replace("@s.whatsapp.net", "").replace(/\D/g, "") || "";
        return c.phone_whatsapp?.replace(/\D/g, "") === phone;
      })?.name,
      preview: msg.message_text,
      at: msg.scheduled_at,
      label: "Manual",
    }));
    const auto = (posVendaUpcoming || []).slice(0, 8).map((u) => ({
      id: u.id,
      kind: "auto" as const,
      name: u.customerName,
      preview: u.messagePreview || `Mensagem ${u.stageLabel}`,
      at: u.scheduledAt.toISOString(),
      label: u.stageLabel,
    }));
    return [...manual, ...auto]
      .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
      .slice(0, 6);
  }, [scheduledMsgs, posVendaUpcoming, customers]);

  // KPIs
  const kpis = useMemo(() => {
    if (!conversations) return null;
    const now = new Date();
    const sevenDaysAgo = subDays(now, 7);

    const recent = conversations.filter((c) => new Date(c.created_at) >= sevenDaysAgo);
    const activeChats = new Set(recent.map((c) => c.customer_id)).size;
    const sentMessages = conversations.filter((c) => c.message_direction === "outbound").length;
    const inbound = conversations.filter((c) => c.message_direction === "inbound");
    const outbound = conversations.filter((c) => c.message_direction === "outbound");

    // Response rate: % of unique customers who sent inbound that also got outbound
    const inboundCustomers = new Set(inbound.map((c) => c.customer_id));
    const outboundCustomers = new Set(outbound.map((c) => c.customer_id));
    const respondedCustomers = [...inboundCustomers].filter((id) => outboundCustomers.has(id));
    const responseRate = inboundCustomers.size > 0 ? Math.round((respondedCustomers.length / inboundCustomers.size) * 100) : 0;

    // Average response time
    const byCustomer = new Map<string, any[]>();
    for (const c of conversations) {
      if (!byCustomer.has(c.customer_id)) byCustomer.set(c.customer_id, []);
      byCustomer.get(c.customer_id)!.push(c);
    }
    const responseTimes: number[] = [];
    for (const msgs of byCustomer.values()) {
      for (let i = 0; i < msgs.length - 1; i++) {
        if (msgs[i].message_direction === "inbound" && msgs[i + 1].message_direction === "outbound") {
          const diff = differenceInMinutes(parseISO(msgs[i + 1].created_at), parseISO(msgs[i].created_at));
          if (diff >= 0 && diff < 1440) responseTimes.push(diff);
        }
      }
    }
    const avgResponse = responseTimes.length > 0 ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length) : 0;
    const avgResponseLabel = avgResponse >= 60 ? `${Math.floor(avgResponse / 60)}h ${avgResponse % 60}m` : `${avgResponse}m`;

    return { activeChats, sentMessages, responseRate, avgResponseLabel };
  }, [conversations]);

  // Daily messages chart (last 14 days)
  const dailyChart = useMemo(() => {
    if (!conversations) return [];
    const days: { date: string; enviadas: number; recebidas: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const day = subDays(new Date(), i);
      const dayStr = format(day, "yyyy-MM-dd");
      const label = format(day, "dd/MM", { locale: ptBR });
      const dayConvos = conversations.filter((c) => c.created_at.startsWith(dayStr));
      days.push({
        date: label,
        enviadas: dayConvos.filter((c) => c.message_direction === "outbound").length,
        recebidas: dayConvos.filter((c) => c.message_direction === "inbound").length,
      });
    }
    return days;
  }, [conversations]);

  // CRM Funnel
  const funnel = useMemo(() => {
    if (!deals || !kanbanStages?.length) return [];
    const stageMap = new Map<string, number>();
    for (const d of deals) stageMap.set(d.stage, (stageMap.get(d.stage) || 0) + 1);
    const total = deals.length || 1;
    return kanbanStages.map((s, i) => {
      const count = stageMap.get(s.stage_key) || 0;
      const pct = Math.round((count / total) * 100);
      return { label: s.label, count, pct, color: s.color };
    });
  }, [deals, kanbanStages]);

  // Top contacts
  const topContacts = useMemo(() => {
    if (!conversations || !customers) return [];
    const countMap = new Map<string, number>();
    for (const c of conversations) countMap.set(c.customer_id, (countMap.get(c.customer_id) || 0) + 1);
    const sorted = [...countMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const customerMap = new Map(customers.map((c) => [c.id, c]));
    return sorted.map(([id, count]) => {
      const cust = customerMap.get(id);
      return { name: cust?.name || cust?.phone_whatsapp || "Desconhecido", count };
    });
  }, [conversations, customers]);

  const isLoading = loadingConvos || loadingCustomers;

  if (isLoading) {
    return (
      <div className="flex-1 min-h-0 overflow-auto p-3 space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <Skeleton className="h-56 rounded-xl" />
          <Skeleton className="h-56 rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-auto p-3 space-y-3">
      <div className="flex justify-end">
        <AutomacoesAtivasBadge consultantId={consultantId} variant="chip" />
      </div>
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KpiCard icon={<MessageSquare className="w-4 h-4" />} label="Conversas Ativas" value={kpis?.activeChats ?? 0} subtitle="Últimos 7 dias" />
        <KpiCard icon={<Clock className="w-4 h-4" />} label="Tempo Médio Resposta" value={kpis?.avgResponseLabel ?? "—"} subtitle="Recebida → enviada" />
        <KpiCard icon={<Send className="w-4 h-4" />} label="Mensagens Enviadas" value={kpis?.sentMessages ?? 0} subtitle="Últimos 30 dias" />
        <KpiCard icon={<TrendingUp className="w-4 h-4" />} label="Taxa de Resposta" value={`${kpis?.responseRate ?? 0}%`} subtitle="Clientes respondidos" />
      </div>

      <AttendanceRatingsCard consultantId={consultantId} />

      {/* Row 2: Funnel + Area Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* CRM Funnel */}
        <div className="bg-card rounded-xl border border-border p-3 min-w-0">
          <h3 className="font-heading font-bold text-foreground mb-2.5 flex items-center gap-2 text-sm">
            <TrendingUp className="w-4 h-4 text-primary" /> Funil do CRM
          </h3>
          {funnel.length > 0 ? (
            <div className="space-y-1.5">
              {funnel.map((stage, i) => {
                const widthPct = Math.max(stage.pct, 8);
                const hue = 130 - (i * (80 / Math.max(funnel.length - 1, 1)));
                return (
                  <div key={i} className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between text-[11px] mb-0.5">
                        <span className="text-muted-foreground truncate">{stage.label}</span>
                        <span className="text-foreground font-medium shrink-0 ml-2">{stage.count} ({stage.pct}%)</span>
                      </div>
                      <div className="w-full bg-muted/30 rounded-full h-2.5 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${widthPct}%`,
                            background: `hsl(${hue}, 70%, 45%)`,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground text-center py-6">Nenhum deal no CRM</p>
          )}
        </div>

        {/* Messages per Day */}
        <div className="bg-card rounded-xl border border-border p-3 min-w-0">
          <h3 className="font-heading font-bold text-foreground mb-2.5 flex items-center gap-2 text-sm">
            <Send className="w-4 h-4 text-primary" /> Mensagens por Dia (14 dias)
          </h3>
          {dailyChart.some((d) => d.enviadas > 0 || d.recebidas > 0) ? (
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={dailyChart} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorEnv" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(130, 70%, 45%)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(130, 70%, 45%)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorRec" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(200, 80%, 55%)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(200, 80%, 55%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "12px",
                      fontSize: "12px",
                      color: "hsl(var(--foreground))",
                    }}
                  />
                  <Area type="monotone" dataKey="enviadas" name="Enviadas" stroke="hsl(130, 70%, 45%)" fill="url(#colorEnv)" strokeWidth={2} />
                  <Area type="monotone" dataKey="recebidas" name="Recebidas" stroke="hsl(200, 80%, 55%)" fill="url(#colorRec)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground text-center py-6">Sem mensagens no período</p>
          )}
        </div>
      </div>

      {/* Row 3: Scheduled + Top Contacts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Scheduled Messages */}
        <div className="bg-card rounded-xl border border-border p-3 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-2.5">
            <h3 className="font-heading font-bold text-foreground flex items-center gap-2 text-sm">
              <Calendar className="w-4 h-4 text-primary" /> Próximos envios
            </h3>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-[10px] gap-1 px-2 text-primary"
              onClick={() => dispatchAgendamentosNav({ tab: "agendamentos" })}
            >
              <CalendarClock className="w-3 h-3" />
              Ver tudo
            </Button>
          </div>
          {upcomingCombined.length > 0 ? (
            <div className="space-y-2">
              {upcomingCombined.map((item) => (
                <div key={item.id} className="flex items-start gap-2 p-1.5 rounded-lg bg-muted/20 min-w-0">
                  <div className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${item.kind === "auto" ? "bg-accent/10" : "bg-primary/10"}`}>
                    {item.kind === "auto" ? <Sparkles className="w-3.5 h-3.5 text-primary" /> : <Clock className="w-3.5 h-3.5 text-primary" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-foreground truncate">{item.name || "Cliente"}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{item.preview}</p>
                    <p className="text-[10px] text-primary mt-0.5">
                      {format(parseISO(item.at), "dd/MM 'às' HH:mm", { locale: ptBR })}
                      <span className="text-muted-foreground/50 mx-1">•</span>
                      <span className={item.kind === "auto" ? "text-primary" : "text-muted-foreground"}>{item.label}</span>
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground text-center py-6">Nenhum envio previsto</p>
          )}
        </div>

        {/* Top Contacts */}
        <div className="bg-card rounded-xl border border-border p-3 min-w-0">
          <h3 className="font-heading font-bold text-foreground mb-2.5 flex items-center gap-2 text-sm">
            <Users className="w-4 h-4 text-primary" /> Top Contatos (30 dias)
          </h3>
          {topContacts.length > 0 ? (
            <div className="space-y-1.5">
              {topContacts.map((contact, i) => (
                <div key={i} className="flex items-center gap-2 p-1.5 rounded-lg bg-muted/20 min-w-0">
                  <div className="w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center text-[11px] font-bold text-primary shrink-0">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{contact.name}</p>
                  </div>
                  <span className="text-[11px] font-bold text-primary shrink-0">{contact.count} msgs</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground text-center py-6">Sem interações recentes</p>
          )}
        </div>
      </div>
    </div>
  );
}
