import { Receipt, TrendingUp, Wallet, ScrollText } from "lucide-react";

export type FinanceiroSubTab = "boletos" | "recebiveis" | "carteira" | "extrato";

const TABS: { id: FinanceiroSubTab; label: string; icon: React.ComponentType<{ className?: string }>; adminOnly?: boolean }[] = [
  { id: "boletos", label: "Boletos", icon: Receipt },
  { id: "recebiveis", label: "Recebíveis", icon: TrendingUp },
  { id: "carteira", label: "Carteira Green", icon: Wallet },
  { id: "extrato", label: "Extrato", icon: ScrollText, adminOnly: true },
];

interface Props {
  active: FinanceiroSubTab;
  onChange: (sub: FinanceiroSubTab) => void;
  isAdmin: boolean;
}

/** Navegação interna da aba Financeiro. Sincroniza com ?sub= via callback. */
export function FinanceiroTabs({ active, onChange, isAdmin }: Props) {
  const items = TABS.filter((t) => !t.adminOnly || isAdmin);
  return (
    <nav
      className="flex gap-1 border-b border-border/60 overflow-x-auto -mx-1 px-1"
      role="tablist"
      aria-label="Seções do painel financeiro"
    >
      {items.map(({ id, label, icon: Icon }) => {
        const isActive = active === id;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={isActive}
            data-tour={`fin-tab-${id}`}
            onClick={() => onChange(id)}
            className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
              isActive
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        );
      })}
    </nav>
  );
}
