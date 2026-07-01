// Card com métricas do consultor iGreen: colapsável para reduzir poluição visual.
// Fechado por padrão — mostra ribbon de 4 KPIs; abre grid completa ao clicar.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Users, Award, ClipboardList, Coins, ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

const BRL = (n: number | null | undefined) =>
  Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const N = (n: number | null | undefined) => Number(n || 0).toLocaleString("pt-BR");

export function ConsultantMetricsCard({
  consultantId,
  defaultOpen = false,
}: {
  consultantId: string;
  defaultOpen?: boolean;
}) {
  const mes = new Date().toISOString().slice(0, 7);
  const [open, setOpen] = useState(defaultOpen);
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

  const ribbon = [
    { icon: Users, label: "Clientes", value: N(g("clientes_total")) },
    { icon: Award, label: "Rede ativa", value: N(g("licenciados_ativos")) },
    { icon: ClipboardList, label: "Validados no mês", value: N(g("validados_n")) },
    { icon: Coins, label: "Cashback Green", value: BRL(g("cashback_green_saldo")) },
  ];

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
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="w-full group text-left">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
              Métricas · {mes}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {ribbon.map(({ icon: Icon, label, value }) => (
                <span
                  key={label}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border/60 bg-background/60 text-[11px]"
                >
                  <Icon className="h-3 w-3 text-muted-foreground" />
                  <span className="text-muted-foreground">{label}</span>
                  <strong className="text-foreground font-semibold tabular-nums">{value}</strong>
                </span>
              ))}
            </div>
          </div>
          <ChevronDown
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
          />
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-3">
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
      </CollapsibleContent>
    </Collapsible>
  );
}
