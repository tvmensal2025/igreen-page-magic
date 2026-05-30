// Nó expansível do Diagrama v2.
// PR4: modo compacto (default), expand on-hover, destaque do passo inicial.

import { memo, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Sparkles,
  Plus,
  Pencil,
  Play,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  getButtons,
  renderVarsPreview,
  resolveGotoLabel,
  type Step,
} from "../flowTypes";
import { getStepTypeColor } from "../diagram/stepTypeColors";
import type { V2NodeData } from "./useFlowGraphV2";

function ExpandableNodeImpl({ data, selected }: NodeProps) {
  const d = data as unknown as V2NodeData;
  const { step, expanded, hasWarning, compact, dimmed, highlighted, isStart } = d as V2NodeData & {
    compact?: boolean; dimmed?: boolean; highlighted?: boolean; isStart?: boolean;
  };
  const [hovered, setHovered] = useState(false);
  const color = getStepTypeColor(step.step_type);
  const buttons = getButtons(step);
  const rules = step.transitions.filter((t) => t.trigger_intent !== "default");
  const preview = renderVarsPreview(step.message_text || "");

  const showCompact = compact && !expanded;
  const showHoverPreview = showCompact && hovered && preview;
  const width = showCompact ? 220 : expanded ? 360 : 320;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={cn(
        "group relative rounded-xl border-2 bg-background shadow-sm transition-all",
        selected ? "border-primary shadow-lg ring-2 ring-primary/30" : "border-border",
        highlighted && !selected && "border-primary/60 shadow-md",
        dimmed && "opacity-40",
        isStart && !selected && "border-primary/70 ring-2 ring-primary/20",
        !step.is_active && "opacity-60",
      )}
      style={{ width }}
    >
      {/* Stripe lateral por tipo */}
      <div className={cn("absolute left-0 top-0 h-full w-1 rounded-l-lg", color.stripe)} />

      {/* Header */}
      <div className="flex items-start gap-2 px-3 py-2">
        <button
          type="button"
          className="mt-0.5 rounded p-0.5 text-muted-foreground hover:bg-muted"
          onClick={(e) => {
            e.stopPropagation();
            d.onToggleExpand(step.id);
          }}
          aria-label={expanded ? "Recolher" : "Expandir"}
        >
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <div className={cn("rounded-md p-1.5", color.accentBg)}>
          <span className={cn("text-sm", color.accentText)}>#{step.position}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            {isStart && (
              <Play className="h-3 w-3 shrink-0 fill-primary text-primary" aria-label="Início" />
            )}
            <div className="truncate text-sm font-semibold">{step.title || "Sem título"}</div>
          </div>
          {!showCompact && (
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {color.shortLabel}
            </div>
          )}
        </div>
        {hasWarning && (
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" aria-label="alerta" />
        )}
        <button
          type="button"
          className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            d.onOpenInspector(step.id);
          }}
          aria-label="Editar"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Badges colapsadas (sempre mostra) */}
      {!expanded && (buttons.length > 0 || rules.length > 0) && (
        <div className="flex flex-wrap gap-1 px-3 pb-2">
          {buttons.length > 0 && (
            <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
              {buttons.length}b
            </Badge>
          )}
          {rules.length > 0 && (
            <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
              {rules.length}r
            </Badge>
          )}
        </div>
      )}

      {/* Hover preview no modo compacto */}
      {showHoverPreview && (
        <div className="border-t bg-muted/30 px-3 py-1.5">
          <div className="line-clamp-2 text-[11px] leading-snug text-foreground/70">
            {preview.slice(0, 120)}{preview.length > 120 ? "…" : ""}
          </div>
        </div>
      )}

      {/* Conteúdo expandido */}
      {expanded && (
        <div className="space-y-2 border-t bg-muted/30 px-3 py-2">
          {preview && (
            <div className="rounded-md bg-background px-2 py-1.5 text-xs leading-snug text-foreground/80">
              {preview.length > 140 ? preview.slice(0, 140) + "…" : preview}
            </div>
          )}

          {buttons.length > 0 && (
            <div>
              <div className="mb-1 text-[10px] font-medium uppercase text-muted-foreground">
                Botões
              </div>
              <div className="flex flex-wrap gap-1">
                {buttons.map((b) => (
                  <Badge key={b.id} variant="outline" className="h-5 px-1.5 text-[10px]">
                    {b.title}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {rules.length > 0 && (
            <div>
              <div className="mb-1 text-[10px] font-medium uppercase text-muted-foreground">
                Regras
              </div>
              <div className="space-y-0.5">
                {rules.slice(0, 4).map((t, i) => {
                  const r = resolveGotoLabel([], t);
                  return (
                    <div key={i} className="flex items-center justify-between text-[11px]">
                      <span className="truncate text-muted-foreground">
                        {t.trigger_intent || "(sem intent)"}
                      </span>
                      <span className={cn("ml-2 truncate", r.missing && "text-destructive")}>
                        → {r.label}
                      </span>
                    </div>
                  );
                })}
                {rules.length > 4 && (
                  <div className="text-[10px] text-muted-foreground">+{rules.length - 4} regras</div>
                )}
              </div>
            </div>
          )}

          <div className="flex gap-1 pt-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 flex-1 text-[11px]"
              onClick={(e) => {
                e.stopPropagation();
                d.onAddRule(step.id);
              }}
            >
              <Plus className="mr-1 h-3 w-3" />
              Regra
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 flex-1 text-[11px]"
              onClick={(e) => {
                e.stopPropagation();
                d.onAiSuggest(step.id);
              }}
            >
              <Sparkles className="mr-1 h-3 w-3" />
              IA
            </Button>
          </div>
        </div>
      )}

      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !bg-primary/60" />
      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !bg-primary/60" />
    </div>
  );
}

export const ExpandableNode = memo(ExpandableNodeImpl);
