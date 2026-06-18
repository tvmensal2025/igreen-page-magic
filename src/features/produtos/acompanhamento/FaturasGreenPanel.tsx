// =============================================================================
// Acompanhamento — Painel de faturas Green (valor de conta de luz)
// =============================================================================
// Lista clientes sync sem fatura informada e os que usam estimativa por consumo.
// Não é cobrança/NF — é visibilidade para o cálculo de ganhos Conexão Green.

import { AlertTriangle, FileText, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { GreenFaturaClient } from "./greenData";

const BRL = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

interface FaturasGreenPanelProps {
  clients: GreenFaturaClient[];
  onOpenPosVenda?: (customerId: string) => void;
}

export function FaturasGreenPanel({ clients, onOpenPosVenda }: FaturasGreenPanelProps) {
  const semFatura = clients.filter((c) => c.kind === "sem_fatura");
  const estimadas = clients.filter((c) => c.kind === "estimada");
  const comFatura = clients.filter((c) => c.kind === "real");

  if (clients.length === 0) {
    return (
      <p className="text-xs text-muted-foreground text-center py-4">
        Nenhum cliente sincronizado do portal iGreen na sua carteira.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-3">
        <StatChip label="Fatura informada" value={comFatura.length} tone="success" />
        <StatChip label="Fatura estimada" value={estimadas.length} tone="warning" />
        <StatChip label="Sem fatura" value={semFatura.length} tone="danger" highlight />
      </div>

      {semFatura.length > 0 && (
        <section className="rounded-lg border border-warning/40 bg-warning/5 p-3 space-y-2">
          <h4 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 text-warning" />
            Clientes sem valor de fatura ({semFatura.length})
          </h4>
          <p className="text-[10px] text-muted-foreground">
            Informe o valor no Pós-Venda para entrar no cálculo de ganhos recorrentes.
          </p>
          <ul className="divide-y divide-border/40 max-h-48 overflow-y-auto">
            {semFatura.slice(0, 20).map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium truncate">{c.name || "Cliente"}</p>
                  {c.distribuidora && (
                    <p className="text-[10px] text-muted-foreground truncate">{c.distribuidora}</p>
                  )}
                </div>
                {onOpenPosVenda && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-[10px] shrink-0"
                    onClick={() => onOpenPosVenda(c.id)}
                  >
                    Informar fatura
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {semFatura.length > 20 && (
            <p className="text-[10px] text-muted-foreground">
              +{semFatura.length - 20} cliente(s) na mesma situação.
            </p>
          )}
        </section>
      )}

      {estimadas.length > 0 && (
        <section className="rounded-lg border border-border/60 p-3 space-y-2">
          <h4 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
            <TrendingUp className="h-3.5 w-3.5 text-primary" />
            Fatura estimada por consumo ({estimadas.length})
          </h4>
          <ul className="divide-y divide-border/40 max-h-36 overflow-y-auto">
            {estimadas.slice(0, 10).map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 py-1.5 text-xs">
                <span className="truncate">{c.name || "Cliente"}</span>
                <Badge variant="secondary" className="text-[9px] shrink-0">
                  ~{BRL(c.faturaValor ?? 0)}
                </Badge>
              </li>
            ))}
          </ul>
        </section>
      )}

      {comFatura.length > 0 && (
        <section className="rounded-lg border border-border/60 p-3 space-y-2">
          <h4 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5 text-emerald-600" />
            Fatura informada ({comFatura.length})
          </h4>
          <p className="text-[10px] text-muted-foreground">
            Valores reais cadastrados no Pós-Venda — entram no recorrente com precisão.
          </p>
        </section>
      )}
    </div>
  );
}

function StatChip({
  label,
  value,
  tone,
  highlight,
}: {
  label: string;
  value: number;
  tone: "success" | "warning" | "danger";
  highlight?: boolean;
}) {
  const colors =
    tone === "success"
      ? "border-emerald-500/30 bg-emerald-500/5"
      : tone === "warning"
        ? "border-amber-500/30 bg-amber-500/5"
        : "border-red-500/30 bg-red-500/5";
  return (
    <div className={`rounded-lg border px-3 py-2 text-center ${colors} ${highlight ? "ring-1 ring-warning/40" : ""}`}>
      <p className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-lg font-bold text-foreground">{value}</p>
    </div>
  );
}
