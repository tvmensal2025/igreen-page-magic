import { Flame } from "lucide-react";

interface Customer {
  id: string;
  name?: string | null;
  media_consumo?: number | null;
  electricity_bill_value?: number | null;
  status?: string | null;
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  approved: { label: "Aprovado", cls: "bg-primary/15 text-primary" },
  active: { label: "Ativo", cls: "bg-primary/15 text-primary" },
  pending: { label: "Pendente", cls: "bg-warning/15 text-warning" },
  rejected: { label: "Reprovado", cls: "bg-destructive/15 text-destructive" },
  devolutiva: { label: "Devolutiva", cls: "bg-warning/15 text-warning" },
};

function brl(v?: number | null) {
  if (!v || Number.isNaN(Number(v))) return "—";
  return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

export function TopConsumersCard({ customers }: { customers: Customer[] | undefined }) {
  const top = (customers ?? [])
    .filter((c) => Number(c.media_consumo) > 0)
    .sort((a, b) => Number(b.media_consumo) - Number(a.media_consumo))
    .slice(0, 10);

  return (
    <section className="rounded-2xl border border-border/60 bg-card/60 backdrop-blur overflow-hidden">
      <header className="flex items-center gap-3 px-5 py-4 border-b border-border/40">
        <Flame className="w-4 h-4 text-primary" />
        <div>
          <h3 className="font-heading font-black text-sm tracking-tight text-foreground">TOP 10 CLIENTES POR CONSUMO</h3>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Quem mais consome — onde está sua maior comissão</p>
        </div>
      </header>

      {top.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted-foreground">Nenhum cliente com consumo registrado.</p>
      ) : (
        <ol className="divide-y divide-border/40">
          {top.map((c, i) => {
            const badge = STATUS_BADGE[c.status || "pending"] ?? { label: c.status || "—", cls: "bg-muted text-muted-foreground" };
            return (
              <li key={c.id} className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-3 px-5 py-3 hover:bg-muted/30">
                <span className="font-heading font-black text-base tabular-nums text-muted-foreground/60 w-6">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">{c.name || "Sem nome"}</p>
                  <span className={`inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded ${badge.cls}`}>{badge.label}</span>
                </div>
                <div className="text-right">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Consumo</p>
                  <p className="text-sm font-bold tabular-nums text-foreground">{Number(c.media_consumo).toLocaleString("pt-BR")} kW</p>
                </div>
                <div className="text-right min-w-[80px]">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Conta</p>
                  <p className="text-sm font-bold tabular-nums text-primary">{brl(c.electricity_bill_value)}</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
