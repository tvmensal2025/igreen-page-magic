// Toolbar do Diagrama v2: layout, expandir, navegação, compactar, busca.

import { Button } from "@/components/ui/button";
import {
  Maximize2, Minimize2, Wand2, Plus, AlertTriangle,
  Maximize, Home, ZoomIn, Search, LayoutGrid, Layers,
} from "lucide-react";

type Props = {
  onAutoLayout: () => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onAddStep: () => void;
  warningCount: number;
  onAutoFix?: () => void;
  onFit: () => void;
  onZoom100: () => void;
  onGoHome: () => void;
  onOpenSearch: () => void;
  compact: boolean;
  onToggleCompact: () => void;
};

export function CanvasToolbar({
  onAutoLayout,
  onExpandAll,
  onCollapseAll,
  onAddStep,
  warningCount,
  onAutoFix,
  onFit, onZoom100, onGoHome, onOpenSearch,
  compact, onToggleCompact,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-lg border bg-background/95 p-1 shadow-md backdrop-blur">
      <Button size="sm" variant="ghost" onClick={onAutoLayout} title="Reorganizar layout">
        <Wand2 className="mr-1 h-3.5 w-3.5" />
        Organizar
      </Button>
      <Button size="sm" variant="ghost" onClick={onToggleCompact} title={compact ? "Modo detalhado" : "Modo compacto"}>
        {compact ? <Layers className="h-3.5 w-3.5" /> : <LayoutGrid className="h-3.5 w-3.5" />}
      </Button>
      <Button size="sm" variant="ghost" onClick={onExpandAll} title="Expandir todos">
        <Maximize2 className="h-3.5 w-3.5" />
      </Button>
      <Button size="sm" variant="ghost" onClick={onCollapseAll} title="Recolher todos">
        <Minimize2 className="h-3.5 w-3.5" />
      </Button>
      <div className="mx-1 h-5 w-px bg-border" />
      <Button size="sm" variant="ghost" onClick={onFit} title="Encaixar (F)">
        <Maximize className="h-3.5 w-3.5" />
      </Button>
      <Button size="sm" variant="ghost" onClick={onZoom100} title="Zoom 100% (0)">
        <ZoomIn className="h-3.5 w-3.5" />
      </Button>
      <Button size="sm" variant="ghost" onClick={onGoHome} title="Ir ao início (H)">
        <Home className="h-3.5 w-3.5" />
      </Button>
      <Button size="sm" variant="ghost" onClick={onOpenSearch} title="Buscar passo (/)">
        <Search className="h-3.5 w-3.5" />
      </Button>
      <div className="mx-1 h-5 w-px bg-border" />
      <Button size="sm" variant="default" onClick={onAddStep}>
        <Plus className="mr-1 h-3.5 w-3.5" />
        Passo
      </Button>
      {warningCount > 0 && (
        <Button
          size="sm"
          variant="ghost"
          className="text-amber-600"
          onClick={onAutoFix}
          title="Corrigir alertas"
        >
          <AlertTriangle className="mr-1 h-3.5 w-3.5" />
          {warningCount}
        </Button>
      )}
    </div>
  );
}
