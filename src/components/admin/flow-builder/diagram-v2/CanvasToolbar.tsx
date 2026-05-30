// Toolbar do Diagrama v2: organizar layout, expandir/recolher todos, novo passo.

import { Button } from "@/components/ui/button";
import { Maximize2, Minimize2, Wand2, Plus, AlertTriangle } from "lucide-react";

type Props = {
  onAutoLayout: () => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onAddStep: () => void;
  warningCount: number;
  onAutoFix?: () => void;
};

export function CanvasToolbar({
  onAutoLayout,
  onExpandAll,
  onCollapseAll,
  onAddStep,
  warningCount,
  onAutoFix,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-lg border bg-background/95 p-1 shadow-md backdrop-blur">
      <Button size="sm" variant="ghost" onClick={onAutoLayout} title="Reorganizar layout">
        <Wand2 className="mr-1 h-3.5 w-3.5" />
        Organizar
      </Button>
      <Button size="sm" variant="ghost" onClick={onExpandAll} title="Expandir todos">
        <Maximize2 className="h-3.5 w-3.5" />
      </Button>
      <Button size="sm" variant="ghost" onClick={onCollapseAll} title="Recolher todos">
        <Minimize2 className="h-3.5 w-3.5" />
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
