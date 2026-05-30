/**
 * `FlowDiagramV2` — canvas reescrito para o painel de fluxos.
 * PR4: modo compacto, highlight de caminho on-hover, navegação (fit/100/home),
 * busca de nó (Cmd/Ctrl+/), destaque do passo inicial, atalhos de teclado.
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
  useReactFlow,
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
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

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
  /** PR5 — controla a visibilidade do painel direito (preview WhatsApp). */
  panelHidden?: boolean;
  /** PR5 — alterna painel direito a partir do toolbar do canvas. */
  onTogglePanel?: () => void;
}

const nodeTypes: NodeTypes = {
  expandable: ExpandableNode,
};

function readCompact(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const v = window.localStorage.getItem("flow-diagram-compact");
    return v === null ? true : v === "1";
  } catch { return true; }
}

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

  const rf = useReactFlow();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [localPositions, setLocalPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [compact, setCompactState] = useState<boolean>(readCompact);
  const setCompact = useCallback((next: boolean) => {
    setCompactState(next);
    try { window.localStorage.setItem("flow-diagram-compact", next ? "1" : "0"); } catch { /* noop */ }
  }, []);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);

  // Step inicial = menor `position` entre os ativos
  const startStepId = useMemo(() => {
    const active = steps.filter((s) => s.is_active);
    if (!active.length) return null;
    return active.reduce((a, b) => (a.position <= b.position ? a : b)).id;
  }, [steps]);

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

  const { nodes: baseNodes, edges: baseEdges } = useFlowGraphV2(steps, expandedIds, warningStepIds, handlers);

  // Calcula nós conectados ao nó com hover (in/out) para destacar caminho
  const { highlightedNodes, highlightedEdges } = useMemo(() => {
    const hn = new Set<string>();
    const he = new Set<string>();
    const focus = hoveredId ?? selectedId;
    if (focus) {
      hn.add(focus);
      baseEdges.forEach((e) => {
        if (e.source === focus || e.target === focus) {
          he.add(e.id);
          hn.add(e.source);
          hn.add(e.target);
        }
      });
    }
    return { highlightedNodes: hn, highlightedEdges: he };
  }, [hoveredId, selectedId, baseEdges]);

  // Aplica posições locais (drag) + auto-layout pra quem não tem layout salvo
  const positionedNodes = useMemo(() => {
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
    return autoLayout(withLocal, baseEdges);
  }, [baseNodes, baseEdges, localPositions]);

  // Marca seleção + injeta compact/highlight/start em data
  const decoratedNodes = useMemo(
    () => positionedNodes.map((n) => {
      const focus = hoveredId ?? selectedId;
      const isHighlighted = focus ? highlightedNodes.has(n.id) : false;
      const isDimmed = focus ? !isHighlighted : false;
      return {
        ...n,
        selected: n.id === selectedId,
        data: {
          ...(n.data as any),
          compact,
          isStart: n.id === startStepId,
          highlighted: isHighlighted && n.id !== focus,
          dimmed: isDimmed,
        },
      };
    }),
    [positionedNodes, selectedId, hoveredId, highlightedNodes, compact, startStepId],
  );

  // Decora edges com highlight/dim
  const decoratedEdges = useMemo<Edge[]>(() => {
    const focus = hoveredId ?? selectedId;
    if (!focus) return baseEdges;
    return baseEdges.map((e) => ({
      ...e,
      animated: highlightedEdges.has(e.id),
      style: {
        ...(e.style as any),
        opacity: highlightedEdges.has(e.id) ? 1 : 0.2,
        strokeWidth: highlightedEdges.has(e.id) ? 2.5 : (e.style as any)?.strokeWidth ?? 1.5,
      },
    }));
  }, [baseEdges, highlightedEdges, hoveredId, selectedId]);

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const next = applyNodeChanges(changes, decoratedNodes);
      const positions: Record<string, { x: number; y: number }> = { ...localPositions };
      next.forEach((n) => {
        positions[n.id] = n.position;
      });
      setLocalPositions(positions);

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

  const handleNodeMouseEnter: NodeMouseHandler = useCallback(
    (_, node) => setHoveredId(node.id),
    [],
  );
  const handleNodeMouseLeave: NodeMouseHandler = useCallback(() => setHoveredId(null), []);

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
    const laid = autoLayout(decoratedNodes, baseEdges);
    const positions: Record<string, { x: number; y: number }> = {};
    laid.forEach((n) => {
      positions[n.id] = n.position;
    });
    setLocalPositions(positions);
    await Promise.all(
      laid.map((n) => onPatchStep(n.id, { layout: n.position } as any)),
    );
    toast.success("Layout reorganizado");
    setTimeout(() => rf.fitView({ padding: 0.2, duration: 400 }), 50);
  }, [decoratedNodes, baseEdges, onPatchStep, rf]);

  const expandAll = useCallback(() => {
    setExpandedIds(new Set(steps.map((s) => s.id)));
  }, [steps]);
  const collapseAll = useCallback(() => setExpandedIds(new Set()), []);

  const handleAddStep = useCallback(async () => {
    const created = await onAddStep();
    if (created) onSelectStep(created.id);
  }, [onAddStep, onSelectStep]);

  // Navegação
  const fit = useCallback(() => rf.fitView({ padding: 0.2, duration: 400 }), [rf]);
  const zoom100 = useCallback(() => rf.zoomTo(1, { duration: 300 }), [rf]);
  const goHome = useCallback(() => {
    if (!startStepId) return;
    rf.fitView({ nodes: [{ id: startStepId }], padding: 0.5, duration: 400, maxZoom: 1.2 });
    onSelectStep(startStepId);
  }, [rf, startStepId, onSelectStep]);
  const focusOnStep = useCallback((id: string) => {
    rf.fitView({ nodes: [{ id }], padding: 0.5, duration: 400, maxZoom: 1.2 });
    onSelectStep(id);
    setSearchOpen(false);
  }, [rf, onSelectStep]);

  // Atalhos de teclado
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isTyping = tag === "input" || tag === "textarea" || target?.isContentEditable;
      if (isTyping) return;
      if (e.key === "/") { e.preventDefault(); setSearchOpen(true); }
      else if (e.key === "f" || e.key === "F") { e.preventDefault(); fit(); }
      else if (e.key === "0") { e.preventDefault(); zoom100(); }
      else if (e.key === "h" || e.key === "H") { e.preventDefault(); goHome(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fit, zoom100, goHome]);

  return (
    <>
      <ReactFlow
        nodes={decoratedNodes}
        edges={decoratedEdges}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onNodeMouseEnter={handleNodeMouseEnter}
        onNodeMouseLeave={handleNodeMouseLeave}
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
          nodeColor={(n) =>
            n.id === startStepId ? "hsl(var(--primary))"
              : n.id === selectedId ? "hsl(var(--primary) / 0.6)"
              : "hsl(var(--muted))"
          }
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
            onFit={fit}
            onZoom100={zoom100}
            onGoHome={goHome}
            onOpenSearch={() => setSearchOpen(true)}
            compact={compact}
            onToggleCompact={() => setCompact(!compact)}
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

      <CommandDialog open={searchOpen} onOpenChange={setSearchOpen}>
        <CommandInput placeholder="Buscar passo por título, mensagem…" />
        <CommandList>
          <CommandEmpty>Nenhum passo encontrado.</CommandEmpty>
          <CommandGroup heading="Passos do fluxo">
            {steps.map((s) => (
              <CommandItem
                key={s.id}
                value={`${s.position} ${s.title} ${s.message_text ?? ""}`}
                onSelect={() => focusOnStep(s.id)}
              >
                <span className="mr-2 font-mono text-xs text-muted-foreground">#{s.position}</span>
                <span className="truncate">{s.title || "Sem título"}</span>
                {s.id === startStepId && (
                  <span className="ml-auto rounded bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">início</span>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}

export default function FlowDiagramV2(props: FlowDiagramV2Props) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} className="h-full w-full">
      <ReactFlowProvider>
        <Inner {...props} />
      </ReactFlowProvider>
    </div>
  );
}
