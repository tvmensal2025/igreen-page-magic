import { FileText, CheckCircle2, Clock, XCircle, Leaf, Zap, TrendingDown } from "lucide-react";
import type { CarteiraStats } from "./hooks";

export function StatusCards({ stats }: { stats: CarteiraStats }) {
  return (
    <div className="space-y-4">
      <section>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
          Status da carteira
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card
            icon={<FileText className="h-4 w-4" />}
            tone="neutral"
            big={stats.totalComBoleto}
            title="Com boleto gerado"
            hint="carteira faturada"
          />
          <Card
            icon={<CheckCircle2 className="h-4 w-4" />}
            tone="success"
            big={stats.pagos}
            title="Boletos pagos"
            hint={`${stats.adimplenciaPct}% adimplência`}
          />
          <Card
            icon={<Clock className="h-4 w-4" />}
            tone="info"
            big={stats.disponiveis}
            title="Disponível (a vencer)"
            hint="boleto gerado, em aberto"
          />
          <Card
            icon={<XCircle className="h-4 w-4" />}
            tone="danger"
            big={stats.vencidos}
            title="Vencidos"
            hint={`${stats.inadimplenciaPct}% inadimplência`}
          />
        </div>
      </section>

      <section>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
          Injeção de energia
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Card
            icon={<Leaf className="h-4 w-4" />}
            tone="success"
            big={stats.comInjecao}
            title="Com injeção"
            hint="já recebem crédito"
          />
          <Card
            icon={<TrendingDown className="h-4 w-4" />}
            tone="warning"
            big={stats.semInjecao}
            title="Sem injeção ainda"
            hint="aguardando geração"
          />
          <Card
            icon={<Zap className="h-4 w-4" />}
            tone="info"
            big={stats.kwhCompensados}
            title="kWh compensados"
            hint="soma da carteira"
          />
        </div>
      </section>
    </div>
  );
}

function Card({
  icon,
  tone,
  big,
  title,
  hint,
}: {
  icon: React.ReactNode;
  tone: "neutral" | "success" | "info" | "danger" | "warning";
  big: number;
  title: string;
  hint: string;
}) {
  const toneCls = {
    neutral: "bg-muted/40 text-foreground",
    success: "bg-emerald-500/10 text-emerald-600",
    info: "bg-blue-500/10 text-blue-600",
    danger: "bg-red-500/10 text-red-600",
    warning: "bg-amber-500/10 text-amber-600",
  }[tone];
  return (
    <div className="rounded-xl border border-border/60 bg-card p-3 flex items-start gap-3">
      <span className={`h-9 w-9 rounded-lg grid place-items-center shrink-0 ${toneCls}`}>{icon}</span>
      <div className="min-w-0">
        <p className="text-2xl font-bold leading-none">{big.toLocaleString("pt-BR")}</p>
        <p className="text-xs font-medium mt-1">{title}</p>
        <p className="text-[10px] text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}
