// =============================================================================
// Módulo Multiproduto iGreen — Container
// =============================================================================
// Reúne as sub-telas do módulo (Acompanhamento, Pipeline/CRM de vendas,
// Orçamentos e Catálogo) em abas internas. Entra como UMA única aba no
// AppSidebar; o CRM de vendas vive DENTRO daqui, não como item separado.
// =============================================================================

import { useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LayoutDashboard, KanbanSquare, PackageSearch, FileText } from "lucide-react";
import { AcompanhamentoPanel } from "./acompanhamento";
import { SalesPipelineBoard } from "./crm";
import { ProductCatalogTable } from "./catalogo/ProductCatalogTable";
import { ProposalsPanel } from "./orcamento/ProposalsPanel";

export type ProdutosTabId = "acompanhamento" | "pipeline" | "orcamentos" | "catalogo";

interface ProdutosModuleProps {
  consultantId: string;
  initialTab?: ProdutosTabId;
  instanceName?: string | null;
  isWhapi?: boolean;
  onTabChange?: (tab: ProdutosTabId) => void;
}

export function ProdutosModule({
  consultantId,
  initialTab = "acompanhamento",
  instanceName,
  isWhapi,
  onTabChange,
}: ProdutosModuleProps) {
  const [tab, setTab] = useState<ProdutosTabId>(initialTab);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  const handleTabChange = (value: string) => {
    const next = value as ProdutosTabId;
    setTab(next);
    onTabChange?.(next);
  };

  return (
    <Tabs value={tab} onValueChange={handleTabChange} className="flex flex-col h-full min-h-0">
      <TabsList className="self-start">
        <TabsTrigger value="acompanhamento" className="gap-1.5">
          <LayoutDashboard className="h-3.5 w-3.5" />
          Acompanhamento
        </TabsTrigger>
        <TabsTrigger value="orcamentos" className="gap-1.5">
          <FileText className="h-3.5 w-3.5" />
          Orçamentos
        </TabsTrigger>
        <TabsTrigger value="pipeline" className="gap-1.5">
          <KanbanSquare className="h-3.5 w-3.5" />
          Pipeline de vendas
        </TabsTrigger>
        <TabsTrigger value="catalogo" className="gap-1.5">
          <PackageSearch className="h-3.5 w-3.5" />
          Catálogo
        </TabsTrigger>
      </TabsList>

      <TabsContent value="acompanhamento" className="flex-1 min-h-0 overflow-y-auto">
        <AcompanhamentoPanel consultantId={consultantId} />
      </TabsContent>

      <TabsContent value="orcamentos" className="flex-1 min-h-0 overflow-y-auto">
        <ProposalsPanel
          consultantId={consultantId}
          instanceName={instanceName}
          isWhapi={isWhapi}
        />
      </TabsContent>

      <TabsContent value="pipeline" className="flex-1 min-h-0 overflow-hidden">
        <SalesPipelineBoard consultantId={consultantId} />
      </TabsContent>

      <TabsContent value="catalogo" className="flex-1 min-h-0 overflow-y-auto">
        <ProductCatalogTable />
      </TabsContent>
    </Tabs>
  );
}
