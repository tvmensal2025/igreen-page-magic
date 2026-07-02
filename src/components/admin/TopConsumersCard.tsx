import { Flame, AlertTriangle } from "lucide-react";
import { getStatusPresentation } from "./lib/customerStatusLabels";
import { useLastIgreenSync } from "@/hooks/useLastIgreenSync";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface Customer {
  id: string;
  name?: string | null;
  media_consumo?: number | null;
  electricity_bill_value?: number | null;
  status?: string | null;
  is_sandbox?: boolean | null;
  is_test_lead?: boolean | null;
}

// Portal iGreen não devolve valor da conta — estimamos a partir do kWh × tarifa média
const TARIFA_MEDIA = 0.95;

function estimateBill(c: Customer): { value: number; estimated: boolean } {
  const real = Number(c.electricity_bill_value) || 0;
  if (real > 0) return { value: real, estimated: false };
  const kwh = Number(c.media_consumo) || 0;
  return { value: kwh * TARIFA_MEDIA, estimated: kwh > 0 };
}

function brl(v: number) {
  if (!v || Number.isNaN(v)) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

const TEST_NAME_RE = /\b(teste|test|empresa\s*teste|bateria\s*ltda)\b/i;

function isTestCustomer(c: Customer) {
  if (c.is_sandbox || c.is_test_lead) return true;
  if (c.name && TEST_NAME_RE.test(c.name)) return true;
  return false;
}

function timeAgo(date: Date | null): { label: string; stale: boolean } {
  if (!date) return { label: "Sem sincronização", stale: true };
  const diffMs = Date.now() - date.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return { label: "Atualizado agora", stale: false };
  if (mins < 60) return { label: `Atualizado há ${mins} min`, stale: false };
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return { label: `Atualizado há ${hrs}h`, stale: hrs > 12 };
  const days = Math.floor(hrs / 24);
  return { label: `Atualizado há ${days}d`, stale: true };
}

export function TopConsumersCard({
  customers,
  consultantId,
}: {
  customers: Customer[] | undefined;
  consultantId?: string | null;
}) {
  const { data: lastSync } = useLastIgreenSync(consultantId);
  const freshness = timeAgo(lastSync ?? null);

  const top = (customers ?? [])
    .filter((c) => !isTestCustomer(c))
    .filter((c) => Number(c.media_consumo) > 0)
    .sort((a, b) => Number(b.media_consumo) - Number(a.media_consumo))
    .slice(0, 10);

  return (
    <TooltipProvider delayDuration={200}>
      <section className="rounded-2xl border border-border/60 bg-card/60 backdrop-blur overflow-hidden">
        <header className="flex items-center gap-3 px-5 py-4 border-b border-border/40">
          <Flame className="w-4 h-4 text-primary" />
          <div className="min-w-0 flex-1">
            <h3 className="font-heading font-black text-sm tracking-tight text-foreground">TOP 10 CLIENTES POR CONSUMO</h3>
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Quem mais consome — onde está sua maior comissão</p>
          </div>
          <span
            className={`shrink-0 inline-flex items-center gap-1 text-[10px] uppercase tracking-wider px-2 py-1 rounded ${
              freshness.stale ? "bg-warning/15 text-warning" : "bg-muted text-muted-foreground"
            }`}
            title={lastSync ? lastSync.toLocaleString("pt-BR") : "Nenhum sync concluído"}
          >
            {freshness.stale && <AlertTriangle className="w-3 h-3" />}
            {freshness.label}
          </span>
        </header>

        {top.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">Nenhum cliente com consumo registrado.</p>
        ) : (
          <ol className="divide-y divide-border/40">
            {top.map((c, i) => {
              const badge = getStatusPresentation(c.status);
              const bill = estimateBill(c);
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
                    <p className="text-sm font-bold tabular-nums text-foreground">
                      {Number(c.media_consumo).toLocaleString("pt-BR")} kWh
                    </p>
                  </div>
                  <div className="text-right min-w-[80px]">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Conta</p>
                    {bill.estimated ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <p className="text-sm font-bold tabular-nums text-primary/80 cursor-help">
                            ~{brl(bill.value)}
                          </p>
                        </TooltipTrigger>
                        <TooltipContent side="left" className="max-w-[220px] text-xs">
                          Estimado — portal iGreen não devolve o valor da conta. Cálculo: kWh × R$ {TARIFA_MEDIA.toFixed(2)}.
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <p className="text-sm font-bold tabular-nums text-primary">{brl(bill.value)}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </TooltipProvider>
  );
}
