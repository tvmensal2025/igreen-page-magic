// Converte `Step[]` em `nodes/edges` do React Flow.
// Responsabilidade única: mapping puro de dados → grafo. Não toca em layout
// (delegado para `useAutoLayout`) nem em interações (drag, connect, etc.).

import { useMemo } from "react";
import type { Edge, Node } from "@xyflow/react";
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
};

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
      // Edge implícito: passo → próximo por position (sempre desenhado em
      // cinza claro pra mostrar a ordem default da lista).
      const sorted = steps
        .filter((s) => s.is_active && s.position > step.position)
        .sort((a, b) => a.position - b.position);
      const next = sorted[0];
      if (next) {
        edges.push({
          id: `${step.id}->order->${next.id}`,
          source: step.id,
          target: next.id,
          type: "smoothstep",
          animated: false,
          style: { stroke: "hsl(var(--muted-foreground) / 0.3)", strokeDasharray: "4 4" },
          label: "ordem",
          labelStyle: { fontSize: 10, fill: "hsl(var(--muted-foreground))" },
          labelBgStyle: { fill: "hsl(var(--background))" },
        });
      }

      // Edges explícitos a partir de transitions
      step.transitions.forEach((t, idx) => {
        if (t.goto_special && t.goto_special !== "repeat") {
          // Terminal node virtual — desenhamos com label, sem target real.
          return;
        }
        if (!t.goto_step_id) return;
        const resolved = resolveGotoLabel(steps, t);
        const buttons = getButtons(step);
        const isButton =
          t.trigger_phrases?.some((p) => buttons.some((b) => b.id === p || b.title === p)) ?? false;
        edges.push({
          id: `${step.id}->t${idx}->${t.goto_step_id}`,
          source: step.id,
          target: t.goto_step_id,
          type: "smoothstep",
          animated: !resolved.missing,
          style: {
            stroke: resolved.missing
              ? "hsl(var(--destructive))"
              : isButton
              ? "hsl(var(--primary))"
              : "hsl(var(--foreground) / 0.5)",
            strokeWidth: 2,
          },
          label: t.trigger_intent === "default" ? "padrão" : t.trigger_intent || "regra",
          labelStyle: { fontSize: 11, fontWeight: 500 },
          labelBgStyle: { fill: "hsl(var(--background))" },
          labelBgPadding: [4, 2] as [number, number],
          data: {
            label: resolved.label,
            intent: t.trigger_intent,
            missing: resolved.missing,
            transitionIdx: idx,
          } satisfies V2EdgeData,
        });
      });
    });

    return { nodes, edges };
  }, [steps, expandedIds, warningStepIds, handlers]);
}
