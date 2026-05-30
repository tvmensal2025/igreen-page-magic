/**
 * `FlowDiagramV2` — canvas reescrito para o painel de fluxos.
 *
 * Foco: simplicidade, fluidez, nós expansíveis, auto-layout dagre,
 * drag-to-connect cria transition default. Mantém o mesmo contrato de
 * props do FlowDiagram legado pra ser plug-and-play no FluxoBuilder via
 * feature flag.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type NodeMouseHandler,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { toast } from "sonner";
import { ExpandableNode } from "./ExpandableNode";
import { CanvasToolbar } from "./CanvasToolbar";
import { useFlowGraphV2 } from "./useFlowGraphV2";
import { autoLayout } from "./useAutoLayout";
import type { Step, Variant } from "../flowTypes";
import type { FlowValidation } from "../useFlowValidation";

export interface FlowDiagramV2Props {
  steps: Step[];
  selectedId: string | null;
  consultantId: string;
  consultantName: string;
  consultantSlug: string;
  flowId: string | null;
  editingVariant: Variant;
  mediaCounts: Record<string, { audio: number; image: number; video: number }>;
  validation: FlowValidation;
  readOnly: boolean;
  onSelectStep: (id: string | null) => void;
  onOpenInspector: (id: string) => void;
  onPatchStep: (id: string, patch: Partial<Step>) => Promise<void>;
  onAddStep: (initialPosition?: { x: number; y: number }) => Promise<Step | null>;
  onDuplicateStep: (id: string) => Promise<void>;
  onDeleteStep: (id: string) => Promise<void>;
  onAutoFixAll: () => Promise<void>;
  onReloadAfterAutoLayout?: () => void | Promise<void>;
  onCreateFromTemplate?: () => void;
}

const nodeTypes: NodeTypes = {
  expandable: ExpandableNode,
};

function Inner(props: FlowDiagramV2Props) {
  const {
    steps,
    selectedId,
    validation,
    readOnly,
    onSelectStep,
    onOpenInspector,
    onPatchStep,
    onAddStep,
    onAutoFixAll,
  } = props;

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [localPositions, setLocalPositions] = useState<Record<string, { x: number; y: number }>>({});

  const warningStepIds = useMemo(() => {
    const s = new Set<string>();
    validation?.warnings?.forEach((w: any) => {
      if (w.stepId) s.add(w.stepId);
    });
    return s;
  }, [validation]);

  const handlers = useMemo(
    () => ({
      onToggleExpand: (id: string) =>
        setExpandedIds((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        }),
      onOpenInspector,
      onAddRule: (id: string) => {
        onSelectStep(id);
        onOpenInspector(id);
      },
      onAiSuggest: (id: string) => {
        onSelectStep(id);
        onOpenInspector(id);
        toast.info("Abra a aba IA no inspetor para sugestões");
      },
    }),
    [onOpenInspector, onSelectStep],
  );

  const { nodes: baseNodes, edges } = useFlowGraphV2(steps, expandedIds, warningStepIds, handlers);

  // Aplica posições locais (drag) + auto-layout pra quem não tem layout salvo
  const nodes = useMemo(() => {
    const withLocal = baseNodes.map((n) => {
      const local = localPositions[n.id];
      if (local) return { ...n, position: local };
      const step = (n.data as any).step as Step;
      if (step.layout) return { ...n, position: step.layout };
      return n;
    });
    const needsLayout = withLocal.some(
      (n) => !((n.data as any).step as Step).layout && !localPositions[n.id],
    );
    if (!needsLayout) return withLocal;
    return autoLayout(withLocal, edges);
  }, [baseNodes, edges, localPositions]);

  // Marca o nó selecionado
  const decoratedNodes = useMemo(
    () => nodes.map((n) => ({ ...n, selected: n.id === selectedId })),
    [nodes, selectedId],
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const next = applyNodeChanges(changes, decoratedNodes);
      const positions: Record<string, { x: number; y: number }> = { ...localPositions };
      next.forEach((n) => {
        positions[n.id] = n.position;
      });
      setLocalPositions(positions);

      // Persiste no fim do drag
      changes.forEach((c) => {
        if (c.type === "position" && c.position && c.dragging === false) {
          void onPatchStep(c.id, { layout: c.position } as any);
        }
      });
    },
    [decoratedNodes, localPositions, onPatchStep],
  );

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_, node) => onSelectStep(node.id),
    [onSelectStep],
  );

  const handleNodeDoubleClick: NodeMouseHandler = useCallback(
    (_, node) => onOpenInspector(node.id),
    [onOpenInspector],
  );

  const handleConnect = useCallback(
    async (c: Connection) => {
      if (!c.source || !c.target) return;
      const sourceStep = steps.find((s) => s.id === c.source);
      if (!sourceStep) return;
      const newTransition = {
        trigger_intent: "default" as const,
        trigger_phrases: [] as string[],
        goto_step_id: c.target,
        goto_special: null,
      };
      const exists = sourceStep.transitions.some(
        (t) => t.trigger_intent === "default" && t.goto_step_id === c.target,
      );
      if (exists) {
        toast.info("Já existe uma regra padrão entre esses passos");
        return;
      }
      await onPatchStep(sourceStep.id, {
        transitions: [...sourceStep.transitions, newTransition],
      });
      toast.success("Conexão criada");
    },
    [steps, onPatchStep],
  );

  const reorganize = useCallback(async () => {
    const laid = autoLayout(decoratedNodes, edges);
    const positions: Record<string, { x: number; y: number }> = {};
    laid.forEach((n) => {
      positions[n.id] = n.position;
    });
    setLocalPositions(positions);
    // Persiste em background
    await Promise.all(
      laid.map((n) => onPatchStep(n.id, { layout: n.position } as any)),
    );
    toast.success("Layout reorganizado");
  }, [decoratedNodes, edges, onPatchStep]);

  const expandAll = useCallback(() => {
    setExpandedIds(new Set(steps.map((s) => s.id)));
  }, [steps]);

  const collapseAll = useCallback(() => setExpandedIds(new Set()), []);

  const handleAddStep = useCallback(async () => {
    const created = await onAddStep();
    if (created) {
      onSelectStep(created.id);
    }
  }, [onAddStep, onSelectStep]);

  return (
    <ReactFlow
      nodes={decoratedNodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={handleNodesChange}
      onNodeClick={handleNodeClick}
      onNodeDoubleClick={handleNodeDoubleClick}
      onConnect={readOnly ? undefined : handleConnect}
      onPaneClick={() => onSelectStep(null)}
      nodesDraggable={!readOnly}
      nodesConnectable={!readOnly}
      elementsSelectable
      fitView
      fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
      minZoom={0.2}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
      onlyRenderVisibleElements
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
      <Controls showInteractive={false} />
      <MiniMap
        pannable
        zoomable
        nodeColor={(n) => (n.id === selectedId ? "hsl(var(--primary))" : "hsl(var(--muted))")}
        maskColor="hsl(var(--background) / 0.7)"
      />
      <Panel position="top-left">
        <CanvasToolbar
          onAutoLayout={reorganize}
          onExpandAll={expandAll}
          onCollapseAll={collapseAll}
          onAddStep={handleAddStep}
          warningCount={validation?.warnings?.length ?? 0}
          onAutoFix={onAutoFixAll}
        />
      </Panel>
      {steps.length === 0 && (
        <Panel position="top-center" className="mt-12">
          <div className="rounded-lg border bg-background p-6 text-center shadow-lg">
            <p className="mb-3 text-sm text-muted-foreground">Nenhum passo ainda neste fluxo.</p>
            <button
              type="button"
              onClick={handleAddStep}
              className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90"
            >
              Criar primeiro passo
            </button>
          </div>
        </Panel>
      )}
    </ReactFlow>
  );
}

export default function FlowDiagramV2(props: FlowDiagramV2Props) {
  // useRef pra estabilizar caso ReactFlowProvider seja remountado
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} className="h-full w-full">
      <ReactFlowProvider>
        <Inner {...props} />
      </ReactFlowProvider>
    </div>
  );
}
