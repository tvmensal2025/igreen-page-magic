// =============================================================================
// Catálogo de Produtos — Tabela (Magazine 7+5 redesign)
// =============================================================================
// Hero editorial + KPIs + donut SVG por família, busca, chips de filtro, e
// produtos agrupados por família em seções com cabeçalho serif.
// =============================================================================

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Search } from "lucide-react";
import { useProducts, useUpdateProductActive } from "./hooks";
import {
  PRODUCT_FAMILY_LABEL,
  type CommissionRule,
  type ProductFamily,
  type ScoringRule,
} from "./types";
import { isQuotableProduct } from "../orcamento/catalog";
import { useUserRole } from "@/hooks/useUserRole";
import { useToast } from "@/hooks/use-toast";
import { pvSerif } from "../theme";

const FAMILY_COLOR: Record<ProductFamily, string> = {
  energia: "#7d9b76",
  placas: "#c9a84c",
  telecom: "#5b8aa6",
  seguros: "#9b6f4f",
  club: "#1a2e1f",
  expansao: "#a8c0a0",
};

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
      return `R$${rule.own} próprio${rule.chip_activation ? ` · R$${rule.chip_activation}/ativação` : ""}`;
    case "per_policy":
      return "Por apólice";
    case "recruitment":
      return `R$${rule.direct_bonus} por licenciado direto`;
    case "none":
    default:
      return "Sem comissão direta";
  }
}

function maxCommissionPct(rule: CommissionRule): number {
  if (rule.type === "recurring_percent" || rule.type === "royalties_percent")
    return rule.max_percent;
  return 0;
}

export function ProductCatalogTable({ consultantId }: { consultantId?: string }) {
  const { data: products = [], isLoading } = useProducts({ includeInactive: true });
  const [search, setSearch] = useState("");
  const [familyFilter, setFamilyFilter] = useState<ProductFamily | "all">("all");
  const { isAdmin, isSuperAdmin } = useUserRole(consultantId ?? null);
  const canManage = isAdmin || isSuperAdmin;
  const updateActive = useUpdateProductActive();
  const { toast } = useToast();

  const filtered = useMemo(() => {
    return products.filter((p) => {
      if (familyFilter !== "all" && p.family !== familyFilter) return false;
      if (!search) return true;
      const q = search.toLowerCase();
      return p.name.toLowerCase().includes(q) || p.brandName.toLowerCase().includes(q);
    });
  }, [products, search, familyFilter]);

  const byFamily = useMemo(() => {
    const map = new Map<ProductFamily, typeof products>();
    for (const p of filtered) {
      const list = map.get(p.family) ?? [];
      list.push(p);
      map.set(p.family, list);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const familyCounts = useMemo(() => {
    const counts = new Map<ProductFamily, number>();
    for (const p of products) {
      counts.set(p.family, (counts.get(p.family) ?? 0) + 1);
    }
    return counts;
  }, [products]);

  const kpis = useMemo(() => {
    const ativos = products.filter((p) => p.isActive).length;
    const familias = familyCounts.size;
    const maxPct = products.reduce((acc, p) => Math.max(acc, maxCommissionPct(p.commissionRule)), 0);
    const validPcts = products
      .map((p) => maxCommissionPct(p.commissionRule))
      .filter((v) => v > 0);
    const avgPct = validPcts.length
      ? Math.round(validPcts.reduce((a, b) => a + b, 0) / validPcts.length)
      : 0;
    return { ativos, familias, maxPct, avgPct };
  }, [products, familyCounts]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin h-8 w-8 border-4 border-pv-accent border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {/* Hero magazine 7+5 */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start">
        <div className="lg:col-span-7">
          <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-pv-accent mb-3 block">
            Catálogo iGreen
          </span>
          <h1 className={`text-5xl md:text-7xl text-pv-ink leading-[1.05] ${pvSerif}`}>
            Produtos &<br />Famílias
          </h1>
          <p className="mt-5 text-base text-pv-ink/70 max-w-md leading-relaxed">
            {products.length} produto(s) no catálogo distribuídos em {kpis.familias} família(s).
            Pontuação e comissão lado a lado para o consultor saber como cada item rende.
          </p>
        </div>

        <div className="lg:col-span-5 grid grid-cols-2 gap-3">
          <KpiBlock kicker="Produtos Ativos" value={String(kpis.ativos)} accent="accent" />
          <KpiBlock kicker="Famílias" value={String(kpis.familias)} accent="ink" />
          <KpiBlock kicker="Maior Comissão" value={kpis.maxPct ? `${kpis.maxPct}%` : "—"} accent="gold" />
          <KpiBlock kicker="Média Recorrente" value={kpis.avgPct ? `${kpis.avgPct}%` : "—"} accent="accent" />
        </div>
      </section>

      {/* Donut por família */}
      <FamilyDonut counts={familyCounts} total={products.length} />

      {/* Busca + chips */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-pv-ink/40" />
          <Input
            placeholder="Buscar produto ou marca..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 pl-9 text-xs rounded-none bg-white border-pv-mid/40 focus-visible:ring-pv-accent"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <FilterChip
            label={`Todos (${products.length})`}
            active={familyFilter === "all"}
            onClick={() => setFamilyFilter("all")}
          />
          {Array.from(familyCounts.entries()).map(([fam, count]) => (
            <FilterChip
              key={fam}
              label={`${PRODUCT_FAMILY_LABEL[fam]} (${count})`}
              active={familyFilter === fam}
              onClick={() => setFamilyFilter(fam)}
              color={FAMILY_COLOR[fam]}
            />
          ))}
        </div>
      </div>

      {/* Grupos por família */}
      {byFamily.length === 0 ? (
        <p className="text-xs text-pv-ink/50 text-center py-8 italic">
          Nenhum produto encontrado.
        </p>
      ) : (
        <div className="space-y-10">
          {byFamily.map(([family, items]) => (
            <section key={family} className="space-y-4">
              <div className="flex items-end justify-between border-b border-pv-mid/40 pb-2">
                <h2 className={`text-3xl text-pv-ink ${pvSerif}`}>
                  {PRODUCT_FAMILY_LABEL[family]}
                </h2>
                <span className="text-[10px] uppercase tracking-widest text-pv-ink/50 font-semibold">
                  {items.length} produto(s)
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {items.map((p) => (
                  <div
                    key={p.id}
                    className="bg-white p-5 border border-pv-surface hover:border-pv-accent transition-colors group"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className={`text-lg text-pv-ink leading-tight ${pvSerif}`}>
                          {p.name}
                        </p>
                        <p className="text-[10px] text-pv-ink/50 uppercase tracking-wider mt-0.5">
                          {p.brandName}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        {isQuotableProduct(p.slug) ? (
                          <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 bg-pv-accent/15 text-pv-accent border border-pv-accent/30">
                            orçável
                          </span>
                        ) : (
                          <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 bg-pv-bg border border-pv-surface text-pv-ink/50">
                            manual
                          </span>
                        )}
                        {!p.isActive && (
                          <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 bg-pv-bg border border-pv-surface text-pv-ink/50">
                            inativo
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3 pt-3 border-t border-pv-bg">
                      <div>
                        <p className="text-[9px] uppercase tracking-widest text-pv-ink/50 font-semibold">
                          Pontuação
                        </p>
                        <p className="text-xs text-pv-ink mt-1">{describeScoring(p.scoringRule)}</p>
                      </div>
                      <div>
                        <p className="text-[9px] uppercase tracking-widest text-pv-ink/50 font-semibold">
                          Comissão
                        </p>
                        <p className="text-xs text-pv-ink mt-1">{describeCommission(p.commissionRule)}</p>
                      </div>
                    </div>
                    {canManage && (
                      <div className="mt-3 pt-3 border-t border-pv-bg flex items-center justify-between gap-2">
                        <span className="text-[10px] text-pv-ink/60">Visível no catálogo</span>
                        <Switch
                          checked={p.isActive}
                          disabled={updateActive.isPending}
                          onCheckedChange={(v) => {
                            updateActive.mutate(
                              { productId: p.id, isActive: v },
                              {
                                onSuccess: () =>
                                  toast({
                                    title: v ? "Produto ativado" : "Produto desativado",
                                  }),
                                onError: (e) =>
                                  toast({
                                    title: "Não foi possível alterar",
                                    description: e instanceof Error ? e.message : "",
                                    variant: "destructive",
                                  }),
                              },
                            );
                          }}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function KpiBlock({
  kicker,
  value,
  accent,
}: {
  kicker: string;
  value: string;
  accent: "gold" | "accent" | "ink";
}) {
  const borderColor =
    accent === "gold" ? "border-pv-gold" : accent === "ink" ? "border-pv-ink" : "border-pv-accent";
  const bg = accent === "gold" ? "bg-pv-surface" : "bg-white/60";
  return (
    <div className={`${bg} p-5 border-l-4 ${borderColor} min-h-[110px] flex flex-col justify-between`}>
      <span className="text-[10px] uppercase tracking-[0.18em] text-pv-ink/60 font-semibold">
        {kicker}
      </span>
      <div className={`text-3xl font-light text-pv-ink mt-1 ${pvSerif}`}>{value}</div>
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
  color,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  color?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[10px] uppercase tracking-widest font-semibold px-3 py-1.5 border transition-colors ${
        active
          ? "bg-pv-ink text-white border-pv-ink"
          : "bg-white text-pv-ink/70 border-pv-surface hover:border-pv-accent"
      }`}
      style={active && color ? { backgroundColor: color, borderColor: color } : undefined}
    >
      {label}
    </button>
  );
}

function FamilyDonut({
  counts,
  total,
}: {
  counts: Map<ProductFamily, number>;
  total: number;
}) {
  if (total === 0) return null;
  const entries = Array.from(counts.entries());
  const radius = 60;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <div className="bg-white border border-pv-surface p-6 flex flex-col md:flex-row items-center gap-8">
      <svg viewBox="0 0 160 160" className="w-32 h-32 -rotate-90">
        <circle cx="80" cy="80" r={radius} fill="none" stroke="hsl(var(--pv-bg))" strokeWidth="22" />
        {entries.map(([fam, count]) => {
          const pct = count / total;
          const length = circumference * pct;
          const dash = `${length} ${circumference - length}`;
          const el = (
            <circle
              key={fam}
              cx="80"
              cy="80"
              r={radius}
              fill="none"
              stroke={FAMILY_COLOR[fam]}
              strokeWidth="22"
              strokeDasharray={dash}
              strokeDashoffset={-offset}
            />
          );
          offset += length;
          return el;
        })}
      </svg>
      <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 gap-3">
        {entries.map(([fam, count]) => (
          <div key={fam} className="flex items-center gap-2">
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: FAMILY_COLOR[fam] }}
            />
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-pv-ink/60 font-semibold truncate">
                {PRODUCT_FAMILY_LABEL[fam]}
              </p>
              <p className="text-xs text-pv-ink font-medium">{count} produto(s)</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
