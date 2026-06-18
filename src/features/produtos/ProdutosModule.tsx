// =============================================================================
// Módulo Multiproduto iGreen — Container (Magazine 7+5 redesign)
// =============================================================================
// Wrapper editorial Sage & Cream com nav inline + CTA "Novo orçamento". Cada
// sub-aba renderiza seu próprio hero magazine + conteúdo (kanban/tabela/lista).
// =============================================================================

import { useEffect, useState } from "react";
import { LayoutDashboard, KanbanSquare, PackageSearch, FileText } from "lucide-react";
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

const TABS: { id: ProdutosTabId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "acompanhamento", label: "Acompanhamento", icon: LayoutDashboard },
  { id: "orcamentos", label: "Orçamentos", icon: FileText },
  { id: "pipeline", label: "Pipeline", icon: KanbanSquare },
  { id: "catalogo", label: "Catálogo", icon: PackageSearch },
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
    <div className={`pv-scope min-h-full w-full bg-pv-bg text-pv-ink ${pvBody}`}>
      <div className="max-w-[1440px] mx-auto px-4 sm:px-8 py-6 space-y-8">
        {/* Topbar editorial */}
        <div className="flex flex-col md:flex-row md:items-end justify-between border-b border-pv-mid/30 pb-4 gap-4">
          <nav className="flex gap-6 sm:gap-8 text-sm font-medium text-pv-ink/60 overflow-x-auto">
            {TABS.map(({ id, label, icon: Icon }) => {
              const active = tab === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => change(id)}
                  className={`pb-2 flex items-center gap-1.5 whitespace-nowrap transition-colors duration-200 ${
                    active
                      ? "text-pv-ink border-b-2 border-pv-accent"
                      : "hover:text-pv-ink"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              );
            })}
          </nav>
          <OrcamentoButton
            consultantId={consultantId}
            instanceName={instanceName}
            isWhapi={isWhapi}
          />
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
          {tab === "catalogo" && <ProductCatalogTable />}
        </div>
      </div>
    </div>
  );
}
