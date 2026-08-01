// =============================================================================
// Módulo Multiproduto iGreen — Container (Magazine 7+5 redesign)
// =============================================================================
// Wrapper editorial Sage & Cream com nav inline + CTA "Novo orçamento". Cada
// sub-aba renderiza seu próprio hero magazine + conteúdo (kanban/tabela/lista).
// =============================================================================

import { useEffect, useState } from "react";
import { LayoutDashboard, KanbanSquare, PackageSearch, FileText, Sun } from "lucide-react";
import { Link } from "react-router-dom";
import { AcompanhamentoPanel } from "./acompanhamento";
import { SalesPipelineBoard } from "./crm";
import { ProductCatalogTable } from "./catalogo/ProductCatalogTable";
import { ProposalsPanel } from "./orcamento/ProposalsPanel";
import { OrcamentoButton } from "./orcamento/OrcamentoButton";
import { usePvFonts, pvBody } from "./theme";

export type ProdutosTabId = "acompanhamento" | "pipeline" | "orcamentos" | "catalogo";

interface ProdutosModuleProps {
  consultantId: string;
  initialTab?: ProdutosTabId;
  instanceName?: string | null;
  isWhapi?: boolean;
  onTabChange?: (tab: ProdutosTabId) => void;
  onOpenPosVenda?: (customerId: string) => void;
  onOpenSettings?: () => void;
}

const TABS: { id: ProdutosTabId; label: string; shortLabel: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "acompanhamento", label: "Acompanhamento", shortLabel: "Acomp.", icon: LayoutDashboard },
  { id: "orcamentos", label: "Orçamentos", shortLabel: "Orçam.", icon: FileText },
  { id: "pipeline", label: "Vendas em andamento", shortLabel: "Vendas", icon: KanbanSquare },
  { id: "catalogo", label: "Catálogo", shortLabel: "Cat.", icon: PackageSearch },
];

export function ProdutosModule({
  consultantId,
  initialTab = "acompanhamento",
  instanceName,
  isWhapi,
  onTabChange,
  onOpenPosVenda,
  onOpenSettings,
}: ProdutosModuleProps) {
  usePvFonts();
  const [tab, setTab] = useState<ProdutosTabId>(initialTab);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  // Após gerar+enviar uma proposta, troca pra aba de Acompanhamento para o
  // consultor ver imediatamente o status do envio.
  useEffect(() => {
    const handler = () => {
      setTab("acompanhamento");
      onTabChange?.("acompanhamento");
    };
    window.addEventListener("produtos:proposta-enviada", handler);
    return () => window.removeEventListener("produtos:proposta-enviada", handler);
  }, [onTabChange]);


  const change = (next: ProdutosTabId) => {
    setTab(next);
    onTabChange?.(next);
  };

  return (
    <div className={`pv-scope min-h-full w-full bg-pv-bg text-pv-ink ${pvBody} pb-24 md:pb-0`}>
      <div className="max-w-[1440px] mx-auto px-4 sm:px-8 py-6 space-y-8">
        {/* Topbar editorial */}
        <div className="flex flex-col md:flex-row md:items-end justify-between border-b border-pv-mid/30 pb-4 gap-4">
          <nav className="flex gap-4 sm:gap-8 text-sm font-medium text-pv-ink/60 overflow-x-auto scrollbar-thin -mx-1 px-1" data-tour="prod-tabs">
            {TABS.map(({ id, label, shortLabel, icon: Icon }) => {
              const active = tab === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => change(id)}
                  aria-label={label}
                  aria-current={active ? "page" : undefined}
                  data-tour={`prod-tab-${id}`}
                  className={`pb-2 flex items-center gap-1.5 whitespace-nowrap transition-colors duration-200 min-h-[44px] ${
                    active
                      ? "text-pv-ink border-b-2 border-pv-accent"
                      : "hover:text-pv-ink"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="sm:hidden">{shortLabel}</span>
                  <span className="hidden sm:inline">{label}</span>
                </button>
              );
            })}
          </nav>
          <div className="hidden md:flex items-center gap-2" data-tour="prod-acoes">
          <OrcamentoButton
            consultantId={consultantId}
            instanceName={instanceName}
            isWhapi={isWhapi}
          />
          <Link
            to="/admin/solar-design"
            data-tour="prod-solar"
            className="inline-flex items-center gap-2 rounded-full border border-pv-mid/40 bg-white px-4 py-2 text-sm font-medium text-pv-ink shadow-sm hover:bg-pv-bg transition-colors"
          >
            <Sun className="h-4 w-4 text-amber-600" />
            Análise telhado
          </Link>
          </div>
        </div>

        {/* Conteúdo */}
        <div className="animate-in fade-in duration-200">
          {tab === "acompanhamento" && (
            <AcompanhamentoPanel
              consultantId={consultantId}
              onOpenPosVenda={onOpenPosVenda}
              onOpenSettings={onOpenSettings}
            />
          )}
          {tab === "orcamentos" && (
            <ProposalsPanel
              consultantId={consultantId}
              instanceName={instanceName}
              isWhapi={isWhapi}
            />
          )}
          {tab === "pipeline" && <SalesPipelineBoard consultantId={consultantId} />}
          {tab === "catalogo" && <ProductCatalogTable consultantId={consultantId} />}
        </div>
      </div>

      {/* CTA fixo no rodapé — mobile */}
      <div className="md:hidden fixed bottom-0 inset-x-0 z-[85] p-3 bg-pv-bg/95 border-t border-pv-mid/30 backdrop-blur-sm pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <OrcamentoButton
          consultantId={consultantId}
          instanceName={instanceName}
          isWhapi={isWhapi}
          className="w-full"
        />
      </div>
    </div>
  );
}
