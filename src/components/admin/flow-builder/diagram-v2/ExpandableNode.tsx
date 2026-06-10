// Nó do Diagrama v2 — estilo "blueprint técnico" (n8n/Retool).
// PR5: header colorido sólido por tipo, corpo neutro, handles laterais
// grandes, badge "INÍCIO" e tipografia mais técnica.

import { memo, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Sparkles,
  Plus,
  Pencil,
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
  const width = showCompact ? 240 : expanded ? 380 : 320;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={cn(
        "group relative overflow-hidden rounded-lg border bg-card shadow-sm transition-all",
        selected
          ? "border-primary shadow-lg ring-2 ring-primary/40"
          : highlighted
          ? "border-primary/50 shadow-md"
          : "border-border",
        dimmed && "opacity-40",
        !step.is_active && "opacity-60",
      )}
      style={{ width }}
    >
      {/* HEADER colorido sólido (estilo n8n) */}
      <div
        className={cn(
          "flex items-center gap-2 px-2.5 py-1.5",
          color.accentBg,
          "border-b border-border/50",
        )}
      >
        <button
          type="button"
          className={cn(
            "rounded p-0.5 hover:bg-background/30",
            color.accentText,
          )}
          onClick={(e) => {
            e.stopPropagation();
            d.onToggleExpand(step.id);
          }}
          aria-label={expanded ? "Recolher" : "Expandir"}
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
        <span className={cn("font-mono text-[10px] font-bold", color.accentText)}>
          #{step.position}
        </span>
        <span className={cn("flex-1 truncate text-[13px] font-semibold", color.accentText)}>
          {step.title || "Sem título"}
        </span>
        {isStart && (
          <span className="rounded-sm bg-primary px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-primary-foreground">
            início
          </span>
        )}
        {hasWarning && (
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" aria-label="alerta" />
        )}
        <button
          type="button"
          className={cn(
            "rounded p-0.5 opacity-0 transition-opacity hover:bg-background/30 group-hover:opacity-100",
            color.accentText,
          )}
          onClick={(e) => {
            e.stopPropagation();
            d.onOpenInspector(step.id);
          }}
          aria-label="Editar"
        >
          <Pencil className="h-3 w-3" />
        </button>
      </div>

      {/* Tipo + badges em linha sutil */}
      {!expanded && (
        <div className="flex items-center gap-1.5 px-2.5 py-1.5">
          <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
            {color.shortLabel}
          </span>
          <div className="ml-auto flex gap-1">
            {buttons.length > 0 && (
              <Badge variant="outline" className="h-4 px-1 font-mono text-[9px]">
                {buttons.length}b
              </Badge>
            )}
            {rules.length > 0 && (
              <Badge variant="outline" className="h-4 px-1 font-mono text-[9px]">
                {rules.length}r
              </Badge>
            )}
          </div>
        </div>
      )}

      {/* Hover preview no modo compacto */}
      {showHoverPreview && (
        <div className="border-t border-border/50 bg-muted/40 px-2.5 py-1.5">
          <div className="line-clamp-2 text-[11px] leading-snug text-foreground/70">
            {preview.slice(0, 120)}{preview.length > 120 ? "…" : ""}
          </div>
        </div>
      )}

      {/* Conteúdo expandido */}
      {expanded && (
        <div className="space-y-2 px-2.5 py-2">
          {preview && (
            <div className="rounded border border-border/50 bg-muted/30 px-2 py-1.5 text-xs leading-snug text-foreground/85">
              {preview.length > 160 ? preview.slice(0, 160) + "…" : preview}
            </div>
          )}

          {buttons.length > 0 && (
            <div>
              <div className="mb-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
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
              <div className="mb-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
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

      {/* Handles laterais — fluxo esquerda → direita (estilo n8n) */}
      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-2 !border-background !bg-foreground/70"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-2 !border-background !bg-foreground/70"
      />
    </div>
  );
}

export const ExpandableNode = memo(ExpandableNodeImpl);
