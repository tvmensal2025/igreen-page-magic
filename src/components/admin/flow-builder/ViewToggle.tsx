import * as React from "react";
import { LayoutGrid, List, Table2 } from "lucide-react";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type ViewMode = "lista" | "diagrama" | "planilha";

export interface ViewToggleProps {
  value: ViewMode;
  onChange: (next: ViewMode) => void;
  diagramHint?: boolean;
  className?: string;
}

const ITEM_BASE_CLASSES =
  "h-8 gap-1.5 px-3 text-xs font-medium data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm";

export function ViewToggle({
  value,
  onChange,
  diagramHint = false,
  className,
}: ViewToggleProps) {
  const handleValueChange = React.useCallback(
    (next: string) => {
      if (next !== "lista" && next !== "diagrama" && next !== "planilha") return;
      if (next === value) return;
      onChange(next);
    },
    [onChange, value],
  );

  const diagramaItem = (
    <ToggleGroupItem
      value="diagrama"
      aria-label="Visualizar fluxo em diagrama"
      className={ITEM_BASE_CLASSES}
    >
      <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" />
      <span>Diagrama</span>
    </ToggleGroupItem>
  );

  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={handleValueChange}
      aria-label="Modo de visualização do fluxo"
      className={cn(
        "inline-flex rounded-lg border border-border/50 bg-muted/40 p-0.5",
        className,
      )}
    >
      <ToggleGroupItem
        value="lista"
        aria-label="Visualizar fluxo em lista"
        className={ITEM_BASE_CLASSES}
      >
        <List className="h-3.5 w-3.5" aria-hidden="true" />
        <span>Lista</span>
      </ToggleGroupItem>

      {diagramHint ? (
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>{diagramaItem}</TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              Melhor visualização em desktop
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        diagramaItem
      )}

      <ToggleGroupItem
        value="planilha"
        aria-label="Visualizar fluxo em planilha"
        className={ITEM_BASE_CLASSES}
      >
        <Table2 className="h-3.5 w-3.5" aria-hidden="true" />
        <span>Planilha</span>
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

export default ViewToggle;
