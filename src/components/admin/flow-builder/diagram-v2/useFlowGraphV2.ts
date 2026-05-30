// Converte `Step[]` em `nodes/edges` do React Flow.
// PR5: edges monocromáticos (foreground) com peso/opacidade variando por
// importância da conexão. Único caso colorido: edge "missing" (destructive).

import { useMemo } from "react";
import { MarkerType, type Edge, type Node } from "@xyflow/react";
import type { Step } from "../flowTypes";
import { getButtons, resolveGotoLabel } from "../flowTypes";

export type V2NodeData = {
  step: Step;
  expanded: boolean;
  hasWarning: boolean;
  compact?: boolean;
  dimmed?: boolean;
  highlighted?: boolean;
  isStart?: boolean;
  onToggleExpand: (id: string) => void;
  onOpenInspector: (id: string) => void;
  onAddRule: (id: string) => void;
  onAiSuggest: (id: string) => void;
};

export type V2EdgeData = {
  label: string;
  intent: string;
  missing: boolean;
  transitionIdx: number;
  kind: "order" | "default" | "rule" | "button" | "missing";
};

const FG = "hsl(var(--foreground))";
const DESTRUCTIVE = "hsl(var(--destructive))";

function edgeStyle(kind: V2EdgeData["kind"]) {
  switch (kind) {
    case "order":
      return { stroke: FG, strokeWidth: 1, opacity: 0.22, strokeDasharray: "4 4" };
    case "default":
      return { stroke: FG, strokeWidth: 1.5, opacity: 0.5 };
    case "rule":
      return { stroke: FG, strokeWidth: 2, opacity: 0.75 };
    case "button":
      return { stroke: FG, strokeWidth: 2.5, opacity: 1 };
    case "missing":
      return { stroke: DESTRUCTIVE, strokeWidth: 2, opacity: 1, strokeDasharray: "6 4" };
  }
}

export function useFlowGraphV2(
  steps: Step[],
  expandedIds: Set<string>,
  warningStepIds: Set<string>,
  handlers: Pick<
    V2NodeData,
    "onToggleExpand" | "onOpenInspector" | "onAddRule" | "onAiSuggest"
  >,
): { nodes: Node[]; edges: Edge[] } {
  return useMemo(() => {
    const nodes: Node[] = steps.map((step) => ({
      id: step.id,
      type: "expandable",
      position: step.layout ?? { x: 0, y: 0 },
      data: {
        step,
        expanded: expandedIds.has(step.id),
        hasWarning: warningStepIds.has(step.id),
        ...handlers,
      } satisfies V2NodeData,
    }));

    const edges: Edge[] = [];
    steps.forEach((step) => {
      // Edge implícito de ordem (fluxo natural por position)
      const sorted = steps
        .filter((s) => s.is_active && s.position > step.position)
        .sort((a, b) => a.position - b.position);
      const next = sorted[0];
      if (next) {
        const kind: V2EdgeData["kind"] = "order";
        edges.push({
          id: `${step.id}->order->${next.id}`,
          source: step.id,
          target: next.id,
          type: "smoothstep",
          style: edgeStyle(kind),
          markerEnd: { type: MarkerType.ArrowClosed, color: FG, width: 14, height: 14 },
          data: { label: "ordem", intent: "order", missing: false, transitionIdx: -1, kind } satisfies V2EdgeData,
        });
      }

      // Edges explícitos a partir de transitions
      step.transitions.forEach((t, idx) => {
        if (t.goto_special && t.goto_special !== "repeat") return;
        if (!t.goto_step_id) return;
        const resolved = resolveGotoLabel(steps, t);
        const buttons = getButtons(step);
        const isButton =
          t.trigger_phrases?.some((p) => buttons.some((b) => b.id === p || b.title === p)) ?? false;
        const isDefault = t.trigger_intent === "default";
        const kind: V2EdgeData["kind"] = resolved.missing
          ? "missing"
          : isButton
          ? "button"
          : isDefault
          ? "default"
          : "rule";
        const st = edgeStyle(kind);
        edges.push({
          id: `${step.id}->t${idx}->${t.goto_step_id}`,
          source: step.id,
          target: t.goto_step_id,
          type: "smoothstep",
          style: st,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: kind === "missing" ? DESTRUCTIVE : FG,
            width: 16,
            height: 16,
          },
          label: isDefault ? undefined : t.trigger_intent || "regra",
          labelStyle: { fontSize: 10, fontWeight: 500, fill: "hsl(var(--foreground))" },
          labelBgStyle: { fill: "hsl(var(--background))", stroke: "hsl(var(--border))", strokeWidth: 1 },
          labelBgPadding: [6, 3] as [number, number],
          labelBgBorderRadius: 4,
          data: {
            label: resolved.label,
            intent: t.trigger_intent,
            missing: resolved.missing,
            transitionIdx: idx,
            kind,
          } satisfies V2EdgeData,
        });
      });
    });

    return { nodes, edges };
  }, [steps, expandedIds, warningStepIds, handlers]);
}
