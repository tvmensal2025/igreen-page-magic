/**
 * CommissionPanel — Painel de Comissões por Campanha
 *
 * Mostra para cada campanha:
 *  - Quantos leads foram convertidos
 *  - Soma dos valores de fatura (electricity_bill_value)
 *  - Comissão de 1ª venda (% configurado na campanha)
 *  - Recorrente mensal (4% sobre a soma das faturas)
 *  - Total projetado
 *
 * O consultor pode:
 *  - Definir o % padrão de comissão por campanha
 *  - Ver o resumo financeiro consolidado
 */

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, TrendingUp, DollarSign, Users, RefreshCw, Sparkles, Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const COMMISSION_RATES = [10, 20, 40, 50, 60, 70, 80, 100] as const;
type CommissionRate = typeof COMMISSION_RATES[number];

const RECURRING_RATE = 0.04; // 4% ao mês recorrente

interface CampaignCommission {
  id: string;
  name: string;
  status: string;
  commission_rate: CommissionRate | null;
  converted_count: number;
  total_bill_value: number;       // soma das faturas dos convertidos
  first_sale_commission: number;  // % × total_bill_value
  monthly_recurring: number;      // 4% × total_bill_value
}

interface Props {
  consultantId: string;
}

function fmt(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function CommissionPanel({ consultantId }: Props) {
  const [rows, setRows] = useState<CampaignCommission[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // 1) Campanhas do consultor
      const { data: camps } = await supabase
        .from("facebook_campaigns")
        .select("id, name, status, commission_rate")
        .eq("consultant_id", consultantId)
        .order("created_at", { ascending: false });

      if (!camps || camps.length === 0) { setRows([]); return; }

      // 2) Leads convertidos com valor de fatura, agrupados por campanha
      const { data: converted } = await (supabase as any)
        .from("customers")
        .select("source_campaign_id, electricity_bill_value, commission_rate")
        .eq("consultant_id", consultantId)
        .eq("is_converted", true)
        .not("source_campaign_id", "is", null);

      // 3) Leads convertidos SEM campanha (para o total geral)
      const { data: convertedNoCamp } = await (supabase as any)
        .from("customers")
        .select("electricity_bill_value, commission_rate")
        .eq("consultant_id", consultantId)
        .eq("is_converted", true)
        .is("source_campaign_id", null);

      // Agrupa por campanha
      const bycamp: Record<string, { count: number; billSum: number }> = {};
      (converted || []).forEach((c: any) => {
        const cid = c.source_campaign_id;
        if (!bycamp[cid]) bycamp[cid] = { count: 0, billSum: 0 };
        bycamp[cid].count++;
        bycamp[cid].billSum += Number(c.electricity_bill_value || 0);
      });

      const result: CampaignCommission[] = (camps as any[]).map((camp) => {
        const agg = bycamp[camp.id] || { count: 0, billSum: 0 };
        const rate = (camp.commission_rate as CommissionRate | null);
        const pct = (rate ?? 0) / 100;
        const firstSale = agg.billSum * pct;
        const recurring = agg.billSum * RECURRING_RATE;
        return {
          id: camp.id,
          name: camp.name,
          status: camp.status,
          commission_rate: rate,
          converted_count: agg.count,
          total_bill_value: agg.billSum,
          first_sale_commission: firstSale,
          monthly_recurring: recurring,
        };
      });

      // Linha "Sem campanha" se houver convertidos sem source_campaign_id
      const noCampAgg = (convertedNoCamp || []).reduce(
        (acc: { count: number; billSum: number }, c: any) => {
          acc.count++;
          acc.billSum += Number(c.electricity_bill_value || 0);
          return acc;
        },
        { count: 0, billSum: 0 },
      );
      if (noCampAgg.count > 0) {
        result.push({
          id: "__no_campaign__",
          name: "Sem campanha identificada",
          status: "—",
          commission_rate: null,
          converted_count: noCampAgg.count,
          total_bill_value: noCampAgg.billSum,
          first_sale_commission: 0,
          monthly_recurring: noCampAgg.billSum * RECURRING_RATE,
        });
      }

      setRows(result);
    } finally {
      setLoading(false);
    }
  }, [consultantId]);

  useEffect(() => { load(); }, [load]);

  async function saveRate(campaignId: string, rate: CommissionRate | null) {
    if (campaignId === "__no_campaign__") return;
    setSaving(campaignId);
    const { error } = await supabase
      .from("facebook_campaigns")
      .update({ commission_rate: rate } as any)
      .eq("id", campaignId);
    if (error) {
      toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
    } else {
      setRows((prev) =>
        prev.map((r) => r.id === campaignId ? { ...r, commission_rate: rate, first_sale_commission: r.total_bill_value * ((rate ?? 0) / 100) } : r),
      );
      toast({ title: "Taxa salva", description: rate ? `${rate}% configurado para esta campanha` : "Taxa removida" });
    }
    setSaving(null);
  }

  // Totais consolidados
  const totalConverted = rows.reduce((s, r) => s + r.converted_count, 0);
  const totalBill = rows.reduce((s, r) => s + r.total_bill_value, 0);
  const totalFirstSale = rows.reduce((s, r) => s + r.first_sale_commission, 0);
  const totalRecurring = rows.reduce((s, r) => s + r.monthly_recurring, 0);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Resumo consolidado */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryCard
          icon={<Users className="w-4 h-4 text-primary" />}
          label="Convertidos"
          value={String(totalConverted)}
          sub="clientes interessados marcados"
          color="emerald"
        />
        <SummaryCard
          icon={<DollarSign className="w-4 h-4 text-info" />}
          label="Soma das faturas"
          value={fmt(totalBill)}
          sub="base de cálculo"
          color="sky"
        />
        <SummaryCard
          icon={<TrendingUp className="w-4 h-4 text-primary" />}
          label="Comissão 1ª venda"
          value={fmt(totalFirstSale)}
          sub="% configurado × fatura"
          color="violet"
        />
        <SummaryCard
          icon={<Sparkles className="w-4 h-4 text-warning" />}
          label="Recorrente/mês"
          value={fmt(totalRecurring)}
          sub="4% × soma faturas"
          color="amber"
        />
      </div>

      {/* Nota explicativa */}
      <div className="flex items-start gap-2 rounded-xl border border-border/40 bg-muted/30 p-3 text-xs text-muted-foreground">
        <Info className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
        <span>
          <strong className="text-foreground">Como funciona:</strong> configure o % de comissão de cada campanha.
          Quando você marcar um cliente interessado como convertido (na aba Clientes interessados), o sistema soma o valor da fatura dele e calcula:
          <strong className="text-foreground"> comissão de 1ª venda</strong> (% × fatura) +
          <strong className="text-foreground"> recorrente mensal</strong> (4% × fatura, todo mês enquanto o cliente estiver ativo).
          Exemplo: fatura R$ 200, campanha 50% → R$ 100 na 1ª venda + R$ 8/mês recorrente.
        </span>
      </div>

      {/* Tabela por campanha */}
      {rows.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground text-sm">
          Nenhuma campanha ainda. Crie uma campanha e marque clientes interessados como convertidos para ver as comissões.
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <Card key={row.id} className="p-4">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                {/* Nome + status */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="font-semibold text-foreground truncate">{row.name}</span>
                    {row.status !== "—" && (
                      <Badge variant="outline" className="text-[10px] h-5 px-2">
                        {row.status === "active" ? "Ativa" : row.status === "paused" ? "Pausada" : row.status}
                      </Badge>
                    )}
                    {row.converted_count > 0 && (
                      <Badge className="text-[10px] h-5 px-2 bg-primary/15 text-primary border-primary/20">
                        ✓ {row.converted_count} convertido{row.converted_count !== 1 ? "s" : ""}
                      </Badge>
                    )}
                  </div>

                  {/* Métricas financeiras */}
                  {row.converted_count > 0 ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2 text-xs">
                      <div className="rounded-lg bg-secondary/40 px-2.5 py-2">
                        <p className="text-muted-foreground">Soma faturas</p>
                        <p className="font-bold text-foreground">{fmt(row.total_bill_value)}</p>
                      </div>
                      <div className="rounded-lg bg-primary/10 border border-primary/20 px-2.5 py-2">
                        <p className="text-muted-foreground">1ª venda ({row.commission_rate ?? "—"}%)</p>
                        <p className="font-bold text-primary">
                          {row.commission_rate ? fmt(row.first_sale_commission) : "Configure o %"}
                        </p>
                      </div>
                      <div className="rounded-lg bg-warning/10 border border-warning/20 px-2.5 py-2">
                        <p className="text-muted-foreground">Recorrente/mês (4%)</p>
                        <p className="font-bold text-warning">{fmt(row.monthly_recurring)}</p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-1">
                      Nenhum cliente interessado convertido ainda nesta campanha.
                    </p>
                  )}
                </div>

                {/* Seletor de % */}
                {row.id !== "__no_campaign__" && (
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-muted-foreground whitespace-nowrap">% comissão:</span>
                    <Select
                      value={row.commission_rate ? String(row.commission_rate) : "none"}
                      onValueChange={(v) => saveRate(row.id, v === "none" ? null : Number(v) as CommissionRate)}
                      disabled={saving === row.id}
                    >
                      <SelectTrigger className="w-24 h-8 text-xs">
                        {saving === row.id
                          ? <Loader2 className="w-3 h-3 animate-spin" />
                          : <SelectValue placeholder="Definir" />}
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Não definido</SelectItem>
                        {COMMISSION_RATES.map((r) => (
                          <SelectItem key={r} value={String(r)}>{r}%</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={load} className="gap-1.5 text-xs">
          <RefreshCw className="w-3.5 h-3.5" /> Atualizar
        </Button>
      </div>
    </div>
  );
}

function SummaryCard({
  icon, label, value, sub, color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  color: "emerald" | "sky" | "violet" | "amber";
}) {
  const bg: Record<string, string> = {
    emerald: "from-primary/10 to-primary/5",
    sky: "from-info/10 to-info/5",
    violet: "from-primary/10 to-primary/5",
    amber: "from-warning/10 to-warning/5",
  };
  return (
    <div className="premium-card !p-4">
      <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${bg[color]} flex items-center justify-center mb-3`}>
        {icon}
      </div>
      <p className="text-xl font-bold text-foreground tracking-tight">{value}</p>
      <p className="text-xs font-semibold text-foreground mt-0.5">{label}</p>
      <p className="text-[10px] text-muted-foreground">{sub}</p>
    </div>
  );
}
