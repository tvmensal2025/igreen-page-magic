import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Crown, Users, Loader2 } from "lucide-react";

interface Props {
  teamIds: string[];
  leaderId: string;
}

interface ConsultantRow {
  id: string;
  name: string;
  totalCustomers: number;
  approved: number;
  avgKw: number;
  avgBill: number;
  conversionPct: number;
  leads30d: number;
}

function brl(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

export function TeamRankingTab({ teamIds, leaderId }: Props) {
  const { data: rows, isLoading } = useQuery({
    queryKey: ["team-ranking", leaderId, teamIds.sort().join(",")],
    enabled: teamIds.length > 1,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ConsultantRow[]> => {
      const since30 = new Date();
      since30.setDate(since30.getDate() - 30);
      const sinceISO = since30.toISOString();

      const [consRes, custRes] = await Promise.all([
        supabase
          .from("consultants")
          .select("id, name")
          .in("id", teamIds),
        // Fetch all customers (paginated)
        (async () => {
          const all: any[] = [];
          let page = 0;
          const size = 1000;
          while (true) {
            const { data, error } = await supabase
              .from("customers")
              .select("consultant_id, status, media_consumo, electricity_bill_value, created_at")
              .in("consultant_id", teamIds)
              .range(page * size, (page + 1) * size - 1);
            if (error) throw error;
            if (data) all.push(...data);
            if (!data || data.length < size) break;
            page++;
          }
          return all;
        })(),
      ]);

      if (consRes.error) throw consRes.error;
      const consultants = consRes.data || [];
      const customers = custRes;

      return consultants.map((c: any) => {
        const mine = customers.filter((x: any) => x.consultant_id === c.id);
        const totalCustomers = mine.length;
        const approved = mine.filter(
          (x: any) => x.status === "approved" || x.status === "active",
        ).length;
        const withKw = mine.filter((x: any) => Number(x.media_consumo) > 0);
        const avgKw = withKw.length
          ? withKw.reduce((s: number, x: any) => s + Number(x.media_consumo), 0) / withKw.length
          : 0;
        const withBill = mine.filter((x: any) => Number(x.electricity_bill_value) > 0);
        const avgBill = withBill.length
          ? withBill.reduce((s: number, x: any) => s + Number(x.electricity_bill_value), 0) /
            withBill.length
          : 0;
        const leads30d = mine.filter((x: any) => new Date(x.created_at) >= since30).length;
        const conversionPct = totalCustomers ? (approved / totalCustomers) * 100 : 0;

        return {
          id: c.id,
          name: c.name || c.id.slice(0, 6),
          totalCustomers,
          approved,
          avgKw,
          avgBill,
          conversionPct,
          leads30d,
        };
      }).sort((a, b) => b.totalCustomers - a.totalCustomers);
    },
  });

  if (teamIds.length <= 1) {
    return (
      <div className="rounded-2xl border border-border/60 bg-card/40 p-8 text-center">
        <Users className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
        <h3 className="font-heading font-black text-lg">Sem equipe vinculada</h3>
        <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
          Quando outros consultores forem indicados por você (campo
          <code className="px-1 mx-1 rounded bg-muted text-xs">referred_by</code> no cadastro deles),
          esta aba mostrará o ranking completo da sua rede.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  const list = rows ?? [];

  return (
    <section className="rounded-2xl border border-border/60 bg-card/60 backdrop-blur overflow-hidden">
      <header className="flex items-center gap-3 px-5 py-4 border-b border-border/40">
        <Crown className="w-4 h-4 text-primary" />
        <div>
          <h3 className="font-heading font-black text-sm tracking-tight">RANKING DA EQUIPE</h3>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            {list.length} consultores na sua rede
          </p>
        </div>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-2 w-8">#</th>
              <th className="text-left px-4 py-2">Consultor</th>
              <th className="text-right px-4 py-2">Clientes</th>
              <th className="text-right px-4 py-2">Aprovados</th>
              <th className="text-right px-4 py-2">kW médio</th>
              <th className="text-right px-4 py-2">Conta média</th>
              <th className="text-right px-4 py-2">Conv%</th>
              <th className="text-right px-4 py-2">Clientes interessados 30d</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {list.map((r, i) => (
              <tr key={r.id} className="hover:bg-muted/30">
                <td className="px-4 py-2 font-heading font-black text-muted-foreground/60 tabular-nums">
                  {String(i + 1).padStart(2, "0")}
                </td>
                <td className="px-4 py-2 font-semibold text-foreground">
                  {r.name}
                  {r.id === leaderId && (
                    <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary">você</span>
                  )}
                </td>
                <td className="text-right px-4 py-2 tabular-nums">{r.totalCustomers}</td>
                <td className="text-right px-4 py-2 tabular-nums text-primary font-bold">{r.approved}</td>
                <td className="text-right px-4 py-2 tabular-nums">
                  {r.avgKw.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}
                </td>
                <td className="text-right px-4 py-2 tabular-nums">{brl(r.avgBill)}</td>
                <td className={`text-right px-4 py-2 tabular-nums font-bold ${r.conversionPct >= 20 ? "text-primary" : "text-muted-foreground"}`}>
                  {r.conversionPct.toFixed(1)}%
                </td>
                <td className="text-right px-4 py-2 tabular-nums">{r.leads30d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
