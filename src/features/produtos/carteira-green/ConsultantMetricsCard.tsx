// Card com métricas do consultor iGreen: clientes, rede, cadastros, cashback.
// Lê da tabela `igreen_consultant_metrics` (mês corrente).
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Users, Award, ClipboardList, Coins } from "lucide-react";

const BRL = (n: number | null | undefined) =>
  Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const N = (n: number | null | undefined) => Number(n || 0).toLocaleString("pt-BR");

export function ConsultantMetricsCard({ consultantId }: { consultantId: string }) {
  const mes = new Date().toISOString().slice(0, 7);
  const { data: m } = useQuery({
    queryKey: ["igreen-consultant-metrics", consultantId, mes],
    enabled: !!consultantId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("igreen_consultant_metrics" as never)
        .select("*")
        .eq("consultant_id", consultantId)
        .eq("mes_ref", mes)
        .maybeSingle();
      if (error) throw error;
      return data as Record<string, unknown> | null;
    },
  });

  if (!m) return null;
  const g = (k: string) => (m as Record<string, unknown>)[k] as number | null;

  const blocks = [
    {
      title: "Clientes",
      icon: Users,
      items: [
        { label: "Total", value: N(g("clientes_total")) },
        { label: "Green", value: N(g("clientes_green")) },
        { label: "Telecom", value: N(g("clientes_telecom")) },
        { label: "Seguros", value: N(g("clientes_seguros")) },
      ],
    },
    {
      title: "Rede",
      icon: Award,
      items: [
        { label: "Licenciados ativos", value: N(g("licenciados_ativos")) },
        { label: "Diretos ativos", value: `${N(g("diretos_ativos"))}/${N(g("diretos"))}` },
        { label: "GP mês", value: BRL(g("gp_mes")) },
        { label: "GI mês", value: BRL(g("gi_mes")) },
        { label: "Rede total", value: N(g("rede_tamanho")) },
      ],
    },
    {
      title: "Cadastros do mês",
      icon: ClipboardList,
      items: [
        { label: "Validados", value: N(g("validados_n")) },
        { label: "Aguardando", value: N(g("aguardando_n")) },
        { label: "Devolutivas", value: N(g("devolutivas_n")) },
        { label: "Reprovados", value: N(g("reprovados_n")) },
        { label: "Cancelados", value: N(g("cancelados_n")) },
        { label: "Ag. assinatura", value: N(g("ag_assinatura_n")) },
        { label: "kWh validados", value: N(g("kwh_validados")) },
      ],
    },
    {
      title: "Cashback",
      icon: Coins,
      items: [
        { label: "Green", value: BRL(g("cashback_green_saldo")) },
        { label: "Telecom", value: BRL(g("cashback_telecom_saldo")) },
        { label: "Seguros", value: BRL(g("cashback_seguros_saldo")) },
      ],
    },
  ];

  return (
    <section className="rounded-xl border border-border/60 bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold">Métricas do consultor · {mes}</h3>
      </div>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        {blocks.map((b) => {
          const Icon = b.icon;
          return (
            <div key={b.title} className="rounded-lg border border-border/60 bg-background/40 p-3">
              <div className="flex items-center gap-2 mb-2">
                <Icon className="h-4 w-4 text-primary" />
                <p className="text-xs font-semibold">{b.title}</p>
              </div>
              <dl className="space-y-1">
                {b.items.map((it) => (
                  <div key={it.label} className="flex items-baseline justify-between gap-2">
                    <dt className="text-[11px] text-muted-foreground">{it.label}</dt>
                    <dd className="text-xs font-semibold tabular-nums">{it.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          );
        })}
      </div>
    </section>
  );
}
