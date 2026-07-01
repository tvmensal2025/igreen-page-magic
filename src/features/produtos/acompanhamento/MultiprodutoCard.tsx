import { useMemo } from "react";
import { Smartphone, ShieldCheck, Loader2 } from "lucide-react";
import { useTelecomCustomers, useSegurosCustomers } from "./multiprodutoHooks";

/**
 * Cartão da carteira multiproduto (Telecom + Seguros), populada pelo sync do
 * escritório iGreen. Mostra contagem por status e receita mensal recorrente.
 */
export function MultiprodutoCard({ consultantId }: { consultantId?: string }) {
  const { data: telecom = [], isLoading: loadingTel } = useTelecomCustomers(consultantId);
  const { data: seguros = [], isLoading: loadingSeg } = useSegurosCustomers(consultantId);

  const telResumo = useMemo(() => {
    const ativos = telecom.filter((t) => t.status === "ativado").length;
    const mrr = telecom.reduce((s, t) => s + (t.fatura_valor || 0), 0);
    return { total: telecom.length, ativos, mrr };
  }, [telecom]);

  const segResumo = useMemo(() => {
    const vigentes = seguros.filter((s) => s.status === "vigente").length;
    const mrr = seguros.reduce((s, x) => s + (x.mensal || 0), 0);
    return { total: seguros.length, vigentes, mrr };
  }, [seguros]);

  const loading = loadingTel || loadingSeg;
  const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  // Não mostra o card se o consultor não tem nenhum produto extra.
  if (!loading && telecom.length === 0 && seguros.length === 0) return null;

  return (
    <div className="rounded-2xl border bg-card p-4 space-y-3">
      <h3 className="font-semibold text-sm">Outros produtos (carteira iGreen)</h3>
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border bg-muted/30 p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Smartphone className="h-4 w-4 text-primary" /> Telecom
            </div>
            <div className="mt-2 text-2xl font-bold">{telResumo.total}</div>
            <div className="text-xs text-muted-foreground">
              {telResumo.ativos} ativos • {brl(telResumo.mrr)}/mês
            </div>
          </div>
          <div className="rounded-xl border bg-muted/30 p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <ShieldCheck className="h-4 w-4 text-primary" /> Seguros
            </div>
            <div className="mt-2 text-2xl font-bold">{segResumo.total}</div>
            <div className="text-xs text-muted-foreground">
              {segResumo.vigentes} vigentes • {brl(segResumo.mrr)}/mês
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
