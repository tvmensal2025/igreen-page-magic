import { TrendingUp, Users, DollarSign, Wallet, Percent, Target, AlertTriangle, Activity } from "lucide-react";

interface Props { kpis: any | null }

function brl(cents?: number | null) {
  if (cents == null) return "—";
  return `R$ ${(cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function KpisRow({ kpis }: Props) {
  const cards = [
    { icon: DollarSign, label: "Gasto Ads (30d)", value: brl(kpis?.spend_cents), color: "text-amber-400", ring: "border-amber-500/20" },
    { icon: Users, label: "Leads Gerados", value: (kpis?.leads ?? 0).toLocaleString("pt-BR"), color: "text-blue-400", ring: "border-blue-500/20" },
    { icon: Target, label: "CPL Real", value: brl(kpis?.cpl_cents), color: "text-violet-400", ring: "border-violet-500/20" },
    { icon: Wallet, label: "Carteira (Aberta)", value: brl(kpis?.wallet_open_cents), color: "text-primary", ring: "border-primary/20" },
    { icon: TrendingUp, label: "Carteira Fechada", value: brl(kpis?.wallet_won_cents), color: "text-emerald-400", ring: "border-emerald-500/20" },
    { icon: Percent, label: "LP → Lead", value: `${kpis?.conversion_lp_lead_pct ?? 0}%`, color: "text-cyan-400", ring: "border-cyan-500/20" },
    { icon: Percent, label: "Lead → Aprovado", value: `${kpis?.conversion_lead_approved_pct ?? 0}%`, color: "text-pink-400", ring: "border-pink-500/20" },
    { icon: AlertTriangle, label: "Handoffs (30d)", value: (kpis?.handoff_count_30d ?? 0).toLocaleString("pt-BR"), color: "text-red-400", ring: "border-red-500/20" },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {cards.map((c) => (
        <div key={c.label} className={`rounded-xl border ${c.ring} bg-card/50 backdrop-blur p-4 hover:scale-[1.02] transition`}>
          <div className="flex items-center justify-between mb-2">
            <c.icon className={`w-4 h-4 ${c.color}`} />
            <Activity className="w-3 h-3 text-muted-foreground/30" />
          </div>
          <p className="text-xl font-bold text-foreground tabular-nums tracking-tight">{c.value}</p>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1 font-semibold">{c.label}</p>
        </div>
      ))}
    </div>
  );
}
