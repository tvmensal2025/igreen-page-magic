import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, TrendingDown, TrendingUp, AlertTriangle, Wallet, Users, Megaphone, Target } from "lucide-react";

interface Row {
  consultant_id: string;
  name: string;
  license: string;
  balance_cents: number;
  spend_7d_cents: number;
  leads_7d: number;
  cpl_cents: number;
  active_campaigns: number;
  status: "ok" | "no_campaign" | "low_balance" | "burning" | "no_leads";
}

/**
 * Saúde da Rede: 1 linha por consultor, ordenada por risco.
 * Permite intervir antes do consultor desistir.
 */
export function NetworkHealthPanel() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const since = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);

      const [{ data: consultants }, { data: wallets }, { data: camps }, { data: metrics }] = await Promise.all([
        supabase.from("consultants").select("id,name,license").eq("approved", true),
        supabase.from("consultant_wallet").select("consultant_id,balance_cents"),
        supabase.from("facebook_campaigns").select("id,consultant_id,status"),
        supabase.from("facebook_metrics_daily").select("campaign_id,spend_cents,leads").gte("date", since),
      ]);

      const walletMap = new Map((wallets || []).map((w: any) => [w.consultant_id, Number(w.balance_cents || 0)]));
      const campaignsByConsultant = new Map<string, { id: string; status: string }[]>();
      (camps || []).forEach((c: any) => {
        const arr = campaignsByConsultant.get(c.consultant_id) || [];
        arr.push({ id: c.id, status: c.status });
        campaignsByConsultant.set(c.consultant_id, arr);
      });
      const metricsByCampaign = new Map<string, { spend: number; leads: number }>();
      (metrics || []).forEach((m: any) => {
        const cur = metricsByCampaign.get(m.campaign_id) || { spend: 0, leads: 0 };
        cur.spend += Number(m.spend_cents || 0);
        cur.leads += Number(m.leads || 0);
        metricsByCampaign.set(m.campaign_id, cur);
      });

      const out: Row[] = (consultants || []).map((c: any) => {
        const userCamps = campaignsByConsultant.get(c.id) || [];
        const active = userCamps.filter((x) => x.status === "active").length;
        let spend = 0, leads = 0;
        userCamps.forEach((uc) => {
          const m = metricsByCampaign.get(uc.id);
          if (m) { spend += m.spend; leads += m.leads; }
        });
        const cpl = leads > 0 ? Math.round(spend / leads) : 0;
        const balance = walletMap.get(c.id) || 0;

        let status: Row["status"] = "ok";
        if (userCamps.length === 0) status = "no_campaign";
        else if (balance < 5000) status = "low_balance";
        else if (spend > 20000 && leads === 0) status = "burning";
        else if (active > 0 && spend > 5000 && leads < 2) status = "no_leads";

        return {
          consultant_id: c.id,
          name: c.name,
          license: c.license,
          balance_cents: balance,
          spend_7d_cents: spend,
          leads_7d: leads,
          cpl_cents: cpl,
          active_campaigns: active,
          status,
        };
      });

      // Ordena por risco: burning > no_leads > low_balance > no_campaign > ok
      const order = { burning: 0, no_leads: 1, low_balance: 2, no_campaign: 3, ok: 4 };
      out.sort((a, b) => order[a.status] - order[b.status] || b.spend_7d_cents - a.spend_7d_cents);
      setRows(out);
      setLoading(false);
    })();
  }, []);

  const summary = useMemo(() => {
    const s = { total: rows.length, publishing: 0, burning: 0, lowBalance: 0, totalSpend: 0, totalLeads: 0 };
    rows.forEach((r) => {
      if (r.active_campaigns > 0) s.publishing++;
      if (r.status === "burning") s.burning++;
      if (r.status === "low_balance") s.lowBalance++;
      s.totalSpend += r.spend_7d_cents;
      s.totalLeads += r.leads_7d;
    });
    return s;
  }, [rows]);

  if (loading) {
    return <Card className="p-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" /></Card>;
  }

  const fmtBRL = (c: number) => `R$ ${(c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
  const cplGlobal = summary.totalLeads > 0 ? Math.round(summary.totalSpend / summary.totalLeads) : 0;

  return (
    <div className="space-y-4">
      {/* Resumo */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className="p-4"><div className="flex items-center gap-2 text-muted-foreground text-xs"><Users className="w-3.5 h-3.5" />Consultores</div><div className="text-2xl font-semibold mt-1">{summary.total}</div></Card>
        <Card className="p-4"><div className="flex items-center gap-2 text-muted-foreground text-xs"><Megaphone className="w-3.5 h-3.5" />Publicando agora</div><div className="text-2xl font-semibold mt-1 text-primary">{summary.publishing}</div></Card>
        <Card className="p-4"><div className="flex items-center gap-2 text-muted-foreground text-xs"><Target className="w-3.5 h-3.5" />Clientes interessados 7d</div><div className="text-2xl font-semibold mt-1">{summary.totalLeads}</div></Card>
        <Card className="p-4"><div className="flex items-center gap-2 text-muted-foreground text-xs"><TrendingDown className="w-3.5 h-3.5" />CPL médio</div><div className="text-2xl font-semibold mt-1">{cplGlobal > 0 ? fmtBRL(cplGlobal) : "—"}</div></Card>
        <Card className="p-4"><div className="flex items-center gap-2 text-muted-foreground text-xs"><AlertTriangle className="w-3.5 h-3.5" />Em risco</div><div className="text-2xl font-semibold mt-1 text-warning">{summary.burning + summary.lowBalance}</div></Card>
      </div>

      {/* Tabela */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr className="text-left text-xs text-muted-foreground">
                <th className="px-4 py-3 font-medium">Consultor</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Saldo</th>
                <th className="px-4 py-3 font-medium text-right">Gasto 7d</th>
                <th className="px-4 py-3 font-medium text-right">Clientes interessados</th>
                <th className="px-4 py-3 font-medium text-right">CPL</th>
                <th className="px-4 py-3 font-medium text-right">Camp. ativas</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.consultant_id} className="border-t border-border/50 hover:bg-muted/20">
                  <td className="px-4 py-3"><div className="font-medium">{r.name}</div><div className="text-xs text-muted-foreground">Lic. {r.license}</div></td>
                  <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                  <td className={`px-4 py-3 text-right font-mono ${r.balance_cents < 5000 ? "text-warning" : ""}`}>{fmtBRL(r.balance_cents)}</td>
                  <td className="px-4 py-3 text-right font-mono">{fmtBRL(r.spend_7d_cents)}</td>
                  <td className="px-4 py-3 text-right font-mono">{r.leads_7d}</td>
                  <td className="px-4 py-3 text-right font-mono">{r.cpl_cents > 0 ? fmtBRL(r.cpl_cents) : "—"}</td>
                  <td className="px-4 py-3 text-right">{r.active_campaigns > 0 ? <Badge variant="secondary" className="bg-primary/10 text-primary">{r.active_campaigns}</Badge> : <span className="text-muted-foreground">0</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function StatusBadge({ status }: { status: Row["status"] }) {
  const map = {
    ok: { label: "OK", cls: "bg-primary/10 text-primary", icon: <TrendingUp className="w-3 h-3" /> },
    no_campaign: { label: "Sem campanha", cls: "bg-muted text-muted-foreground", icon: <Megaphone className="w-3 h-3" /> },
    low_balance: { label: "Saldo baixo", cls: "bg-warning/10 text-warning", icon: <Wallet className="w-3 h-3" /> },
    burning: { label: "Queimando verba", cls: "bg-destructive/15 text-destructive", icon: <AlertTriangle className="w-3 h-3" /> },
    no_leads: { label: "Sem clientes interessados", cls: "bg-warning/10 text-warning", icon: <TrendingDown className="w-3 h-3" /> },
  } as const;
  const it = map[status];
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${it.cls}`}>{it.icon}{it.label}</span>;
}