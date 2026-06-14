// =============================================================================
// Catálogo de Produtos — Tabela (visão admin)
// =============================================================================
// Lista os produtos do catálogo (tabela `products`) com família, regra de
// pontuação e regra de comissão resumidas. Leitura: serve de referência para
// o consultor entender como cada produto pontua e remunera. A edição do
// catálogo é restrita ao admin (RLS) e fora do escopo desta tela.
// =============================================================================

import { Badge } from "@/components/ui/badge";
import { useProducts } from "./hooks";
import { PRODUCT_FAMILY_LABEL, type CommissionRule, type ScoringRule } from "./types";

function describeScoring(rule: ScoringRule): string {
  switch (rule.mode) {
    case "contracted_kwh":
      return `${rule.multiplier}x kWh contratado`;
    case "proposal_kwh":
      return `${rule.multiplier}x kWh da proposta${rule.validity_months ? ` · ${rule.validity_months} meses` : ""}`;
    case "fixed_per_unit":
      return `${rule.kwh_per_unit} kWh por unidade${rule.only_portability ? " (portabilidade)" : ""}`;
    case "none":
    default:
      return "Não pontua";
  }
}

function describeCommission(rule: CommissionRule): string {
  switch (rule.type) {
    case "recurring_percent":
      return `Até ${rule.max_percent}% recorrente`;
    case "royalties_percent":
      return `Royalties até ${rule.max_percent}%`;
    case "fixed":
      return `R$${rule.own} geração própria${rule.chip_activation ? ` · R$${rule.chip_activation}/ativação` : ""}`;
    case "per_policy":
      return "Por apólice";
    case "recruitment":
      return `R$${rule.direct_bonus} por licenciado direto`;
    case "none":
    default:
      return "Sem comissão direta";
  }
}

export function ProductCatalogTable() {
  const { data: products = [], isLoading } = useProducts({ includeInactive: true });

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <p className="text-xs text-muted-foreground text-center py-8">
        Catálogo vazio. Rode a migration de produtos para popular os produtos Conexão.
      </p>
    );
  }

  return (
    <div className="rounded-xl border border-border/60 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border/60 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Catálogo de produtos</h3>
        <Badge variant="secondary" className="text-[10px]">{products.length} produto(s)</Badge>
      </div>
      <div className="divide-y divide-border/40">
        {products.map((p) => (
          <div key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-xs font-medium text-foreground truncate">{p.name}</p>
                {!p.isActive && (
                  <Badge variant="outline" className="text-[9px] text-muted-foreground">inativo</Badge>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground">
                {p.brandName} · {PRODUCT_FAMILY_LABEL[p.family]}
              </p>
            </div>
            <div className="flex items-center gap-4 shrink-0 text-right">
              <div>
                <p className="text-[10px] text-muted-foreground">Pontuação</p>
                <p className="text-[11px] text-foreground">{describeScoring(p.scoringRule)}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">Comissão</p>
                <p className="text-[11px] text-foreground">{describeCommission(p.commissionRule)}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
