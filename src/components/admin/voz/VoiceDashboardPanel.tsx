import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, PhoneCall, PhoneOff, DollarSign, Percent } from "lucide-react";
import { VozCampaignShell, VozSection } from "./VozCampaignShell";

interface Metrics {
  total_calls: number;
  answered: number;
  no_answer: number;
  failed: number;
  avg_duration_sec: number;
  total_cost: number;
  by_day: { day: string; total: number; answered: number }[];
  by_hour: number[];
}

interface Props { consultantId: string; }

export function VoiceDashboardPanel({ consultantId }: Props) {
  const [m, setM] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data } = await supabase.functions.invoke("voice-dashboard-metrics", {
          body: { consultant_id: consultantId, days: 30 },
        });
        setM((data ?? null) as Metrics | null);
      } finally { setLoading(false); }
    })();
  }, [consultantId]);

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (!m) return <p className="text-sm text-muted-foreground text-center py-8">Sem dados nos últimos 30 dias.</p>;

  const rate = m.total_calls > 0 ? Math.round((m.answered / m.total_calls) * 100) : 0;

  const kpis = [
    { icon: PhoneCall, label: "Ligações", value: m.total_calls, color: "var(--pe-emerald)" },
    { icon: Percent, label: "Atendimento", value: `${rate}%`, color: "var(--pe-emerald)" },
    { icon: PhoneOff, label: "Não atendeu", value: m.no_answer, color: "#e5a800" },
    { icon: DollarSign, label: "Custo 30d", value: `R$ ${(m.total_cost || 0).toFixed(2)}`, color: "var(--pe-emerald)" },
  ];

  return (
    <VozCampaignShell title="Painel — últimos 30 dias" subtitle="Visão geral de ligações, atendimento e custo.">
      <VozSection title="Resumo">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {kpis.map((k) => {
            const Icon = k.icon;
            return (
              <div key={k.label} className="rounded-[var(--pe-radius)] border p-3" style={{ borderColor: "var(--pe-border)", background: "var(--pe-surface)" }}>
                <div className="flex items-center gap-2 text-xs" style={{ color: "var(--pe-text-muted)" }}>
                  <Icon className="h-4 w-4" style={{ color: k.color }} />
                  {k.label}
                </div>
                <div className="text-2xl font-bold mt-1" style={{ color: "var(--pe-text)" }}>{k.value}</div>
              </div>
            );
          })}
        </div>
      </VozSection>

      {m.by_hour?.length === 24 && (
        <VozSection title="Melhor horário para ligar">
          <div className="flex items-end gap-1 h-24">
            {m.by_hour.map((v, i) => {
              const max = Math.max(...m.by_hour, 1);
              const h = Math.round((v / max) * 100);
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full rounded-t" style={{ height: `${h}%`, background: "var(--pe-emerald)", opacity: v ? 0.85 : 0.15 }} />
                  <span className="text-[9px]" style={{ color: "var(--pe-text-muted)" }}>{i}h</span>
                </div>
              );
            })}
          </div>
        </VozSection>
      )}

      {m.by_day?.length > 0 && (
        <VozSection title="Últimos dias">
          <ul className="space-y-1 text-sm">
            {m.by_day.slice(0, 10).map((d) => (
              <li key={d.day} className="flex items-center justify-between">
                <span style={{ color: "var(--pe-text-muted)" }}>{d.day}</span>
                <span style={{ color: "var(--pe-text)" }}>{d.answered}/{d.total}</span>
              </li>
            ))}
          </ul>
        </VozSection>
      )}
    </VozCampaignShell>
  );
}
