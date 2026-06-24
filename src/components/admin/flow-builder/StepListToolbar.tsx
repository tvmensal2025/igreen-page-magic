// Barra de busca + filtros por tipo para a lista de steps.
// PR4 — UX da lista de steps.

import { useEffect, useRef } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { STEP_TYPE_OPTIONS } from "./flowTypes";

type Props = {
  query: string;
  onQueryChange: (v: string) => void;
  typeFilter: Set<string>;
  onToggleType: (t: string) => void;
  onClear: () => void;
  total: number;
  visible: number;
};

export default function StepListToolbar({
  query, onQueryChange, typeFilter, onToggleType, onClear, total, visible,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isTyping = tag === "input" || tag === "textarea" || target?.isContentEditable;
      if (e.key === "/" && !isTyping) {
        e.preventDefault();
        inputRef.current?.focus();
      } else if (e.key === "Escape" && document.activeElement === inputRef.current) {
        onQueryChange("");
        inputRef.current?.blur();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onQueryChange]);

  const hasFilter = query.trim().length > 0 || typeFilter.size > 0;

  return (
    <div className="sticky top-[60px] z-[5] -mx-1 space-y-2 rounded-lg border bg-background/95 px-3 py-2 backdrop-blur">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Buscar passo, mensagem ou botão  ( / )"
            className="h-8 pl-7 text-xs"
          />
        </div>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {visible} de {total}
        </span>
        {hasFilter && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px]"
            onClick={onClear}
          >
            <X className="mr-1 h-3 w-3" />
            Limpar
          </Button>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        {STEP_TYPE_OPTIONS.map((t) => {
          const active = typeFilter.has(t.value);
          return (
            <button
              key={t.value}
              type="button"
              onClick={() => onToggleType(t.value)}
              className={cn(
                "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] transition-colors",
                active
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-muted/40 text-muted-foreground hover:border-primary/40 hover:text-foreground",
              )}
              title={t.hint}
            >
              <span>{t.emoji}</span>
              <span className="hidden lg:inline">{t.label.replace(/^Cap(?:tar|turar) /, "")}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
