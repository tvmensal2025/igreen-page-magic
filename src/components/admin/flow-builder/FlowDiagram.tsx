/**
 * `FlowDiagram` — componente raiz do Modo_Diagrama.
 *
 * Esta versão cobre tasks 7.1, 7.2, 7.3 e 7.4:
 *
 *   - 7.1 — esqueleto com `<ReactFlow>` + tipos de nó/aresta registrados,
 *           `<Background>`, `<Controls>`, `<MiniMap>`, estado vazio (R2.10).
 *   - 7.2 — cablagem de `useDiagramData` + `useDiagramLayout` (R10.1, R10.3,
 *           R10.4, R10.9, R12.2). Posicionamento via `layoutNodes(nodes)`,
 *           persistência via `saveNodePosition` no `onNodeDragStop`, botão
 *           "Reorganizar automaticamente" conectado a `autoLayoutAll`, e
 *           toolbar montada em `<Panel position="top-left">`.
 *   - 7.3 — handlers de seleção (`onNodeClick` → R5.1), duplo-clique
 *           (`onNodeDoubleClick` → R5.2/R18.1, ignorando `terminal` nodes),
 *           menu de contexto (`onNodeContextMenu` → R5.3) com fechamento via
 *           `onPaneClick` (R6.5), e navegação por teclado (`Enter` → R14.2,
 *           `F2` → R14.3, setas → R14.4/R14.5 com cone de 90°).
 *   - 7.4 — criação/edição/remoção de aresta via `<TransitionPopover>`:
 *           `onConnectStart`/`onConnect`/`onConnectEnd` orquestram a abertura
 *           do popover em modo `create` quando o drop cai sobre um nó válido
 *           (mesma Variante — R6.2, R11.6, R11.7); drop em canvas vazio
 *           cancela sem persistir (R6.4); auto-laço é permitido (R6.7,
 *           R13.3); confirmação persiste a transition usando
 *           `onPatchStep(sourceId, { transitions: [...] })` com formato
 *           específico para handle de botão (R7.7), default ou terminal
 *           (R6.8). Em qualquer falha, reverte estado local + `toast.error`
 *           e mantém o popover aberto para retry (R6.9, R7.8). Clique em
 *           aresta existente abre o popover em modo `edit` (R6.5) com opções
 *           "Remover" e "Redirecionar".
 *
 * Tarefas subsequentes (7.5 → 7.7, 9.x) cabeiam progressivamente:
 *   - 7.5 — handler de "Adicionar passo" via canvas.
 *   - 7.6 — realce de ciclos no hover.
 *   - 7.7 — aviso de mais de 200 passos.
 *   - 9.x — integração de busca, métricas, export e viewport persistente.
 *
 * Por que `default export`?
 *   A task 10.2 carrega este componente via `React.lazy(() =>
 *   import("@/components/admin/flow-builder/FlowDiagram"))`, que exige que
 *   o módulo exponha o componente como default (R1).
 *
 * Por que `<ReactFlowProvider>` envolve o `<ReactFlow>`?
 *   Filhos do `<ReactFlow>` (incluindo `DiagramToolbar` em `<Panel>`) usam
 *   `useReactFlow()` para `fitView`, `setCenter`, etc. Sem o provider, esses
 *   hooks lançam em runtime.
 *
 * Mapeia para: R2.1, R2.6, R2.7, R2.9, R2.10, R10.1, R10.3, R10.4, R10.9, R12.2.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type DefaultEdgeOptions,
  type EdgeMouseHandler,
  type FinalConnectionState,
  type IsValidConnection,
  type Node,
  type NodeMouseHandler,
  type OnConnect,
  type OnConnectEnd,
  type OnConnectStart,
  type OnConnectStartParams,
  type OnNodeDrag,
} from "@xyflow/react";

// CSS oficial do React Flow — obrigatório para o canvas renderizar.
// Tailwind sozinho não cobre as classes internas da lib (handles, edges,
// minimap). Importar aqui evita que o consumidor precise lembrar.
import "@xyflow/react/dist/style.css";

import { AlertTriangle, Loader2, Plus, Sparkles, X } from "lucide-react";
import { toast } from "sonner";

import { DiagramToolbar } from "@/components/admin/flow-builder/diagram/DiagramToolbar";
import FlowDiagramEdge from "@/components/admin/flow-builder/diagram/FlowDiagramEdge";
import FlowDiagramNode from "@/components/admin/flow-builder/diagram/FlowDiagramNode";
import {
  NodeContextMenu,
  type NodeContextMenuState,
} from "@/components/admin/flow-builder/diagram/NodeContextMenu";
import TerminalNode from "@/components/admin/flow-builder/diagram/TerminalNode";
import {
  TransitionPopover,
  type TransitionPopoverState,
} from "@/components/admin/flow-builder/diagram/TransitionPopover";
import {
  getButtons,
  isDeterministicIntent,
  type Step,
  type Transition,
  type Variant,
  VALID_GOTO_SPECIAL,
} from "@/components/admin/flow-builder/flowTypes";
import type { FlowValidation } from "@/components/admin/flow-builder/useFlowValidation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useDiagramData, type TerminalKind } from "@/hooks/useDiagramData";
import { useDiagramExport } from "@/hooks/useDiagramExport";
import { useDiagramLayout } from "@/hooks/useDiagramLayout";
import { useDiagramMetrics } from "@/hooks/useDiagramMetrics";
import { useDiagramSearch } from "@/hooks/useDiagramSearch";
import { useViewportPersistence } from "@/hooks/useViewportPersistence";

// ---------------------------------------------------------------------------
// Constantes de módulo
// ---------------------------------------------------------------------------
//
// `nodeTypes`, `edgeTypes` e `defaultEdgeOptions` precisam ser referências
// estáveis entre renders. Defini-las dentro do componente faria o React Flow
// recriar todo o grafo a cada render (e logar warning em dev). Por isso ficam
// aqui no escopo do módulo.

const NODE_TYPES = {
  flow: FlowDiagramNode,
  terminal: TerminalNode,
} as const;

const EDGE_TYPES = {
  default: FlowDiagramEdge,
} as const;

// Categoria visual concreta da edge é decidida em `FlowDiagramEdge` via
// `data.category`. O `defaultEdgeOptions` apenas garante que toda nova edge
// criada/exibida pelo canvas use o tipo customizado e tenha animação
// desligada (perf — R12.2).
const DEFAULT_EDGE_OPTIONS: DefaultEdgeOptions = {
  type: "default",
  animated: false,
};

const FIT_VIEW_OPTIONS = { padding: 0.15 } as const;
const CENTER_FIT_VIEW_OPTIONS = { padding: 0.15, duration: 300 } as const;

/**
 * task 12.3 — `ariaLabelConfig` em pt-BR para os controles internos do
 * React Flow (zoom in/out, fit view, lock, minimap, descrições de nó/aresta
 * para leitores de tela). Passamos um objeto **parcial** para `<ReactFlow>`;
 * a lib aplica `mergeAriaLabelConfig` internamente, então qualquer chave não
 * fornecida cai nos defaults em inglês — ainda assim, preenchemos todas as
 * chaves visíveis ao usuário em pt-BR (R14.7, R14.9).
 */
const ARIA_LABEL_CONFIG_PTBR = {
  "node.a11yDescription.default":
    "Pressione Enter ou Espaço para selecionar um passo. Pressione F2 para abrir o editor e Esc para cancelar.",
  "node.a11yDescription.keyboardDisabled":
    "Pressione Enter ou Espaço para selecionar um passo. Use as setas para mover o foco.",
  "node.a11yDescription.ariaLiveMessage": ({
    direction,
    x,
    y,
  }: {
    direction: string;
    x: number;
    y: number;
  }) =>
    `Passo movido para ${direction}. Nova posição: x ${x}, y ${y}.`,
  "edge.a11yDescription.default":
    "Pressione Enter ou Espaço para selecionar uma aresta. Pressione Delete para remover ou Esc para cancelar.",
  "controls.ariaLabel": "Controles do diagrama",
  "controls.zoomIn.ariaLabel": "Aumentar zoom",
  "controls.zoomOut.ariaLabel": "Diminuir zoom",
  "controls.fitView.ariaLabel": "Enquadrar todos os passos",
  "controls.interactive.ariaLabel": "Alternar interatividade",
  "minimap.ariaLabel": "Mini-mapa do diagrama",
  "handle.ariaLabel": "Conector",
} as const;

/**
 * Prefixo dos IDs de nodes terminais sintéticos gerados em `useDiagramData`
 * (`terminal-cadastro`, `terminal-humano`, `terminal-repeat`).
 */
const TERMINAL_NODE_PREFIX = "terminal-";

/**
 * Extrai a `TerminalKind` do `id` de um node terminal sintético, ou `null`
 * quando o id pertence a um node `flow`.
 */
function decodeTerminalKind(nodeId: string): TerminalKind | null {
  if (!nodeId.startsWith(TERMINAL_NODE_PREFIX)) return null;
  const kind = nodeId.slice(TERMINAL_NODE_PREFIX.length);
  if ((VALID_GOTO_SPECIAL as readonly string[]).includes(kind)) {
    return kind as TerminalKind;
  }
  return null;
}

/**
 * Tenta extrair o índice da `transition` do `edge.id` quando este foi gerado
 * por `useDiagramData` para uma transition explícita
 * (`${stepId}-${targetId}-${transitionIdx}`). Edges de fallback, sequência ou
 * `ai-self-loop` retornam `null` — esses tipos não são editáveis pelo
 * popover (R6.5 fala apenas de Aresta_Solida e Aresta_IA).
 *
 * O regex captura um inteiro não-negativo no final do id; UUIDs em
 * `stepId`/`targetId` contêm hífens, mas todos os tokens com letras (UUID
 * hex, `__warning_*`, `fallback`, `sequence`, `ai-fallback`) falham nesta
 * captura, garantindo o filtro correto.
 */
function extractTransitionIdxFromEdgeId(edgeId: string): number | null {
  const m = edgeId.match(/-(\d+)$/);
  if (!m) return null;
  const idx = parseInt(m[1], 10);
  if (!Number.isFinite(idx) || idx < 0) return null;
  return idx;
}

/**
 * Escapa um valor para uso seguro dentro de um seletor CSS (`[data-step-id="..."]`).
 *
 * Preferimos `CSS.escape` quando disponível; em ambientes onde a API não
 * existe (test runners antigos, SSR), caímos em uma escapagem manual que
 * apenas troca aspas duplas e contrabarras pelos seus equivalentes
 * escapados. Para os IDs que `bot_flow_steps` produz (UUIDs), nenhum dos
 * dois caminhos altera o valor; o helper existe por defesa.
 */
function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/(["\\])/g, "\\$1");
}

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export interface FlowDiagramProps {
  /** Lista canônica de passos da Variante em edição (vinda do `FluxoBuilder`). */
  steps: Step[];

  /** Passo atualmente selecionado (espelha o `selectedId` do `FluxoBuilder`). */
  selectedId: string | null;

  /** Identificador do consultor dono do fluxo (`auth.users.id`). */
  consultantId: string;

  /** Nome legível do consultor — usado em previews que herdam do `FluxoBuilder`. */
  consultantName: string;

  /** Slug URL-safe (ver Glossário). Usado nos nomes de export PNG/SVG (task 9.3). */
  consultantSlug: string;

  /** ID do `bot_flows` em edição. Pode ser `null` antes do load inicial. */
  flowId: string | null;

  /** Variante A/B/C/D/E sendo editada. */
  editingVariant: Variant;

  /** Contagem de mídias por `slot_key` (mesmo formato consumido pela lista). */
  mediaCounts: Record<
    string,
    { audio: number; image: number; video: number }
  >;

  /** Resultado de `useFlowValidation(steps)` — fonte de verdade dos warnings. */
  validation: FlowValidation;

  /** Modo somente leitura (R15.2 — viewport <768px). */
  readOnly: boolean;

  // ---------------------------------------------------------------------
  // Callbacks (mesmas mutations usadas pelo Modo_Lista — sem fork, R4.1)
  // ---------------------------------------------------------------------

  onSelectStep: (id: string | null) => void;
  onOpenInspector: (id: string) => void;
  onPatchStep: (id: string, patch: Partial<Step>) => Promise<void>;
  onAddStep: (
    initialPosition?: { x: number; y: number },
  ) => Promise<Step | null>;
  onDuplicateStep: (id: string) => Promise<void>;
  onDeleteStep: (id: string) => Promise<void>;
  onAutoFixAll: () => Promise<void>;
  /**
   * R10.10 — disparado pelo canvas após `autoLayoutAll` concluir com
   * sucesso a limpeza de `bot_flow_steps.layout` no banco. O consumidor
   * (`FluxoBuilder`) deve usar este callback para recarregar `steps` do
   * Supabase, mantendo `step.layout` em sincronia com a coluna recém
   * limpada. Opcional para retro-compatibilidade.
   */
  onReloadAfterAutoLayout?: () => void | Promise<void>;
  /**
   * R11.5 — atalho do estado vazio. Quando o Consultor está em uma Variante
   * sem Passos, o `FlowDiagramEmptyState` exibe um botão extra
   * "Criar a partir de template" que dispara este callback (que abre o
   * `CreateFlowFromTemplateDialog` no `FluxoBuilder`, pré-selecionado para
   * a Variante atual). Opcional para manter compatibilidade.
   */
  onCreateFromTemplate?: () => void;
}

// ---------------------------------------------------------------------------
// Estado vazio (R2.10)
// ---------------------------------------------------------------------------
//
// Reusa o mesmo texto/atalho do estado vazio do Modo_Lista renderizado em
// `FluxoBuilder.tsx`. Manter o copy alinhado entre os dois modos é parte do
// requisito ("mesmo texto e ações usados pelo estado vazio do Modo_Lista").

function FlowDiagramEmptyState({
  onAddStep,
  readOnly,
  onCreateFromTemplate,
}: {
  onAddStep: (
    initialPosition?: { x: number; y: number },
  ) => Promise<Step | null>;
  readOnly: boolean;
  /** R11.5 — quando fornecido, exibe atalho "Criar a partir de template". */
  onCreateFromTemplate?: () => void;
}) {
  // R2.10 — mesma UX do estado vazio do Modo_Lista (texto + botão "Adicionar
  // passo"). Em modo somente leitura (R15.2), ocultamos o botão.
  // R11.5 — atalho extra para abrir o `CreateFlowFromTemplateDialog`
  // pré-selecionado para a Variante atual quando o consumidor cabou.
  return (
    <div className="flex h-full w-full items-center justify-center p-10">
      <div className="rounded-xl border border-dashed bg-muted/20 p-10 text-center">
        <p className="text-sm text-muted-foreground">
          Nenhum passo ainda. Adicione o primeiro abaixo.
        </p>
        {!readOnly && (
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void onAddStep();
              }}
              aria-label="Adicionar primeiro passo do fluxo"
            >
              <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
              Adicionar passo
            </Button>
            {onCreateFromTemplate && (
              <Button
                variant="default"
                size="sm"
                onClick={onCreateFromTemplate}
                aria-label="Criar fluxo a partir de template"
              >
                <Sparkles className="mr-1 h-4 w-4" aria-hidden="true" />
                Criar a partir de template
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inner — instancia `<ReactFlow>` (precisa estar dentro do Provider)
// ---------------------------------------------------------------------------

function FlowDiagramInner(props: FlowDiagramProps) {
  const {
    steps,
    selectedId,
    consultantId,
    consultantSlug,
    flowId,
    editingVariant,
    mediaCounts,
    validation,
    readOnly,
    onSelectStep,
    onOpenInspector,
    onPatchStep,
    onAddStep,
    onDuplicateStep,
    onDeleteStep,
    onCreateFromTemplate,
    onReloadAfterAutoLayout,
  } = props;

  // -------------------------------------------------------------------
  // Estado interno do canvas (R3.6, R9.1, R19.1)
  // -------------------------------------------------------------------
  //
  // Mantemos aqui apenas o estado que é "do canvas" (busca, toggle de
  // sequência, toggle de métricas). Os dados do fluxo continuam em `props`
  // para preservar a fonte única de verdade (R4.1).
  //
  // - `dottedEdgesVisible` (R3.6): default `true`.
  // - `metricsEnabled` (R9.1): default `false`.
  //
  // A busca (`searchQuery`) vive dentro do `useDiagramSearch` e é cabeada
  // ao canvas via `<FlowDiagramCanvas>`. O atalho global Ctrl+K também
  // mora lá (única fonte do listener — evita duplicação com a toolbar).
  const [dottedEdgesVisible, setDottedEdgesVisible] = useState(true);
  const [metricsEnabled, setMetricsEnabled] = useState(false);
  // task ad-hoc — modo Tela Cheia. Tornamos o wrapper do canvas `fixed
  // inset-0 z-50` para preencher a viewport sem depender de
  // `requestFullscreen()` (mais confiável em iframes/embeds e mantém o
  // header da app acessível via toggle "Sair da tela cheia").
  const [fullscreen, setFullscreen] = useState(false);

  // Estado vazio: nem o canvas é instanciado. Evita o `fitView` rodar com 0
  // nós (que faria o React Flow logar warning) e dá a mesma UX do Modo_Lista.
  if (steps.length === 0) {
    return (
      <FlowDiagramEmptyState
        onAddStep={onAddStep}
        readOnly={readOnly}
        onCreateFromTemplate={onCreateFromTemplate}
      />
    );
  }

  return (
    <div className="h-full w-full">
      <FlowDiagramCanvas
        steps={steps}
        selectedId={selectedId}
        consultantId={consultantId}
        consultantSlug={consultantSlug}
        flowId={flowId}
        editingVariant={editingVariant}
        mediaCounts={mediaCounts}
        validation={validation}
        readOnly={readOnly}
        dottedEdgesVisible={dottedEdgesVisible}
        onDottedEdgesToggle={setDottedEdgesVisible}
        metricsEnabled={metricsEnabled}
        onMetricsToggle={setMetricsEnabled}
        fullscreen={fullscreen}
        onFullscreenToggle={() => setFullscreen((v) => !v)}
        onSelectStep={onSelectStep}
        onOpenInspector={onOpenInspector}
        onPatchStep={onPatchStep}
        onAddStep={onAddStep}
        onDuplicateStep={onDuplicateStep}
        onDeleteStep={onDeleteStep}
        onReloadAfterAutoLayout={onReloadAfterAutoLayout}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Canvas — bloco que de fato instancia `<ReactFlow>` e usa `useReactFlow()`.
// Separado para que o `useReactFlow()` possa rodar dentro do
// `<ReactFlowProvider>` que envolve o componente raiz.
// ---------------------------------------------------------------------------

interface FlowDiagramCanvasProps {
  steps: Step[];
  selectedId: string | null;
  consultantId: string;
  consultantSlug: string;
  flowId: string | null;
  editingVariant: Variant;
  mediaCounts: Record<
    string,
    { audio: number; image: number; video: number }
  >;
  validation: FlowValidation;
  readOnly: boolean;
  dottedEdgesVisible: boolean;
  onDottedEdgesToggle: (v: boolean) => void;
  metricsEnabled: boolean;
  onMetricsToggle: (v: boolean) => void;
  fullscreen: boolean;
  onFullscreenToggle: () => void;

  // Callbacks de edição (forwardados do `FlowDiagramProps`).
  onSelectStep: (id: string | null) => void;
  onOpenInspector: (id: string) => void;
  onPatchStep: (id: string, patch: Partial<Step>) => Promise<void>;
  onAddStep: (
    initialPosition?: { x: number; y: number },
  ) => Promise<Step | null>;
  onDuplicateStep: (id: string) => Promise<void>;
  onDeleteStep: (id: string) => Promise<void>;
  /** R10.10 — recarrega `steps` após `autoLayoutAll` zerar `layout` no banco. */
  onReloadAfterAutoLayout?: () => void | Promise<void>;
}

function FlowDiagramCanvas({
  steps,
  selectedId,
  consultantId,
  consultantSlug,
  flowId,
  editingVariant,
  mediaCounts,
  validation,
  readOnly,
  dottedEdgesVisible,
  onDottedEdgesToggle,
  metricsEnabled,
  onMetricsToggle,
  fullscreen,
  onFullscreenToggle,
  onSelectStep,
  onOpenInspector,
  onPatchStep,
  onAddStep,
  onDuplicateStep,
  onDeleteStep,
  onReloadAfterAutoLayout,
}: FlowDiagramCanvasProps) {
  // -------------------------------------------------------------------
  // Instância do React Flow — usada por busca, export e viewport persist.
  // -------------------------------------------------------------------
  const reactFlow = useReactFlow();

  // -------------------------------------------------------------------
  // Hooks de UX (task 9.x) — agora cabeados ao canvas.
  // -------------------------------------------------------------------

  // 9.2 — métricas do funil (R9.2/R9.10). Habilitado apenas pelo toggle
  // da toolbar; em falha, mantém último cache válido.
  const metrics = useDiagramMetrics({
    enabled: metricsEnabled,
    consultantId,
    variant: editingVariant,
  });

  // 9.4 — persiste zoom/pan em localStorage por (consultantId, variant).
  // Restaura ao montar e a cada troca de variant; falha silenciosa (R1.7).
  useViewportPersistence({
    consultantId,
    variant: editingVariant,
    reactFlowInstance: reactFlow,
  });

  // -------------------------------------------------------------------
  // 1) Mapping puro `Step[]` → `{ nodes, edges, terminalsUsed }` (R2.1)
  // -------------------------------------------------------------------
  //
  // `useDiagramData` é puro e memoizado: o objeto retornado tem
  // identidade estável enquanto suas dependências (steps, validation,
  // mediaCounts, metricsData, searchQuery, selectedId, dottedEdgesVisible)
  // não mudarem.
  //
  // 9.1 — `useDiagramSearch` é a fonte única da query da busca, do cursor
  // de ciclagem e do listener global Ctrl+K (não duplicar com a toolbar).
  // O hook é chamado abaixo (depois de `positionedNodes`), mas só usamos
  // sua `query` (string) — para evitar referência forward na ordem de
  // declaração, o `useDiagramData` consome `searchQueryDraft` e o hook
  // `useDiagramSearch` mantém a query controlada via callback.
  //
  // Como `useState` é estável entre renders, a query escrita pelo input
  // (que chama `search.setQuery`) atualiza imediatamente o `searchQueryDraft`
  // graças ao callback `setSearchQueryDraft` passado ao hook (sem useEffect
  // — sem lag de 1 frame).
  const [searchQueryDraft, setSearchQueryDraft] = useState("");

  const { nodes: rawNodes, edges, terminalsUsed } = useDiagramData({
    steps,
    validation,
    mediaCounts,
    metricsData: metricsEnabled ? metrics.data : null,
    searchQuery: searchQueryDraft,
    selectedId,
    dottedEdgesVisible,
  });

  // -------------------------------------------------------------------
  // 2) Layout — aplica posições antes de passar a `<ReactFlow>` (R10.1, R10.4, R10.9)
  // -------------------------------------------------------------------
  const { layoutNodes, saveNodePosition, autoLayoutAll, saving: layoutSaving, saveError: layoutSaveError } = useDiagramLayout({
    flowId,
    steps,
    terminalsUsed,
    onAfterAutoLayout: onReloadAfterAutoLayout,
  });

  // `layoutNodes` é uma função pura que recebe `Node[]` e devolve `Node[]`
  // com `position` aplicada. Memoizamos sobre (rawNodes, layoutNodes) para
  // evitar recomputar a cada render.
  const positionedNodes = useMemo(
    () => layoutNodes(rawNodes),
    [layoutNodes, rawNodes],
  );

  // 9.1 — `useDiagramSearch` consome `positionedNodes` (precisa das posições
  // para `setCenter`). Conectamos `onQueryChange` para que cada keystroke
  // atualize `searchQueryDraft` sincronamente, sem useEffect e sem lag de
  // 1 frame no realce/dim dos nós.
  const search = useDiagramSearch({
    nodes: positionedNodes,
    reactFlowInstance: reactFlow,
    onQueryChange: setSearchQueryDraft,
  });
  const searchQuery = search.query;

  // -------------------------------------------------------------------
  // 3) Persistência da posição ao soltar o nó (R10.4, R12.2 — debounce 500ms)
  // -------------------------------------------------------------------
  //
  // Nós_Terminais (📝 Cadastro, 👤 Humano, 🔁 Repetir) são sintéticos e não
  // existem em `bot_flow_steps` — nunca persistir layout para eles (R10.2).
  // Ainda que o `TerminalNode` use `draggable: false`, defendemos aqui para
  // não depender de invariantes do componente.
  const handleNodeDragStop = useCallback<OnNodeDrag>(
    (_event, node) => {
      if (node.type === "terminal") return;
      saveNodePosition(node.id, { x: node.position.x, y: node.position.y });
    },
    [saveNodePosition],
  );

  // -------------------------------------------------------------------
  // 4) Toolbar — `onCenter` usa `fitView` da instância (R2.8)
  // -------------------------------------------------------------------
  const handleCenter = useCallback(() => {
    // `fitView` retorna Promise<boolean> em RF v12; podemos ignorar o resultado.
    void reactFlow.fitView(CENTER_FIT_VIEW_OPTIONS);
  }, [reactFlow]);

  // 9.3 — exportação PNG/SVG (cabeada ao botão "Exportar" da toolbar).
  const exportApi = useDiagramExport({
    consultantSlug,
    variant: editingVariant,
    reactFlowInstance: reactFlow,
  });
  const handleExport = useCallback(
    (format: "png" | "svg") => {
      if (format === "png") void exportApi.exportPng();
      else void exportApi.exportSvg();
    },
    [exportApi],
  );

  const handleMetricsRefresh = useCallback(() => {
    void metrics.refresh();
  }, [metrics]);

  // -------------------------------------------------------------------
  // 5) Handlers de seleção, duplo-clique e menu de contexto (task 7.3)
  // -------------------------------------------------------------------
  //
  // R5.1 — clique único atualiza `selectedId` e, por consequência, o
  // `WhatsAppPreview` no `FluxoBuilder` reflete em ≤200ms (a chamada é
  // síncrona; o repaint é responsabilidade do React).
  //
  // R5.2 / R18.1 — duplo-clique abre o Inspector, mas **somente** para nós
  // do tipo `flow`. Nós `terminal` (Cadastro/Humano/Repetir) são sintéticos
  // e não correspondem a registros editáveis.
  //
  // R5.3 — clique direito posiciona o `NodeContextMenu` no ponto exato do
  // clique (`clientX`/`clientY`) usando `position: fixed`. Apenas nós `flow`
  // recebem menu — não faria sentido remover/duplicar um terminal.
  //
  // R6.5 — `onPaneClick` fecha popovers e menus em aberto (no escopo desta
  // task, apenas o `contextMenu`; o `transitionPopover` virá na 7.4).
  const [contextMenu, setContextMenu] = useState<NodeContextMenuState | null>(
    null,
  );

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  // -------------------------------------------------------------------
  // 5b) Popover de criação/edição de transition (task 7.4)
  // -------------------------------------------------------------------
  //
  // Estados envolvidos:
  //
  // - `transitionPopover`: estado renderizável do `<TransitionPopover>` (modo
  //   `create` ou `edit`, com posição em coordenadas relativas ao wrapper do
  //   canvas). `null` significa popover fechado.
  //
  // - `pendingConnectionRef`: armazena os parâmetros do `onConnectStart`
  //   enquanto o usuário arrasta a aresta. Usamos `ref` (não `state`) porque
  //   a sequência `onConnectStart → onConnect → onConnectEnd` ocorre de
  //   forma síncrona dentro de uma sessão de drag e queremos os valores
  //   imediatamente, sem esperar re-render.
  //
  // - `connectMadeRef`: marcador booleano (também via `ref`) que sinaliza se
  //   o `onConnect` chegou a disparar antes do `onConnectEnd`. Necessário
  //   para implementar R6.4 (drop em canvas vazio cancela): se o
  //   `onConnectEnd` recebe `connectionState.toNode === null`, e o
  //   `onConnect` não foi chamado (=> `connectMadeRef.current === false`),
  //   significa que a aresta foi solta no canvas vazio e devemos descartar.
  const [transitionPopover, setTransitionPopover] =
    useState<TransitionPopoverState | null>(null);

  const pendingConnectionRef = useRef<OnConnectStartParams | null>(null);
  const connectMadeRef = useRef(false);
  // Guarda a posição do drop em coordenadas relativas ao wrapper, capturada
  // de forma "leve" via `onPointerUp` global porque o React Flow chama
  // `onConnect` *antes* de `onConnectEnd`, e queremos posicionar o popover
  // exatamente sob o ponteiro (R6.2 — "abrir popover próximo ao ponto de
  // soltura"). Mantemos a posição em ref, não em state, para evitar
  // re-render extra entre o pointer-up e a abertura do popover.
  const lastPointerPosRef = useRef<{ x: number; y: number } | null>(null);

  const closeTransitionPopover = useCallback(() => {
    setTransitionPopover(null);
    pendingConnectionRef.current = null;
    connectMadeRef.current = false;
    lastPointerPosRef.current = null;
  }, []);

  // -------------------------------------------------------------------

  const handleNodeClick = useCallback<NodeMouseHandler>(
    (_event, node) => {
      // Nós terminais não são selecionáveis no sentido do `selectedId` do
      // `FluxoBuilder` — eles não têm `step` correspondente. Ignoramos para
      // não quebrar o `WhatsAppPreview`.
      if (node.type === "terminal") return;
      onSelectStep(node.id);
    },
    [onSelectStep],
  );

  const handleNodeDoubleClick = useCallback<NodeMouseHandler>(
    (_event, node) => {
      // R5.2 / R18.1 — Inspector apenas para nós `flow`.
      if (node.type === "terminal") return;
      onOpenInspector(node.id);
    },
    [onOpenInspector],
  );

  const handleNodeContextMenu = useCallback<NodeMouseHandler>(
    (event, node) => {
      // Terminais não têm menu de contexto: deixamos o menu nativo do
      // navegador aparecer normalmente seria estranho aqui também, então
      // suprimimos sem abrir o `NodeContextMenu`.
      if (node.type === "terminal") {
        event.preventDefault();
        return;
      }
      // task 12.1 — em modo somente leitura (R15.2), suprimimos o menu de
      // contexto inteiramente: nenhuma das ações ("Editar", "Duplicar",
      // "Ativar/Desativar", "Remover") faz sentido fora do modo de edição.
      // Apenas prevenimos o menu nativo para manter a UX consistente — o
      // duplo-clique continua abrindo o Inspector (R15.3).
      if (readOnly) {
        event.preventDefault();
        return;
      }
      // R5.3 — preveni o menu nativo e abro o `NodeContextMenu` no ponto
      // exato do clique. `clientX`/`clientY` são coordenadas de viewport,
      // que combinam com o `position: fixed` do menu.
      event.preventDefault();
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        stepId: node.id,
      });
    },
    [readOnly],
  );

  const handlePaneClick = useCallback(() => {
    // R6.5 — clique no canvas vazio fecha popovers/menus.
    closeContextMenu();
    closeTransitionPopover();
  }, [closeContextMenu, closeTransitionPopover]);

  // Lookup do `Step` para passar ao `NodeContextMenu` (precisa do
  // `is_active` para escolher entre "Ativar" / "Desativar"). Memoizado para
  // não recriar o Map a cada render.
  const stepsById = useMemo(() => {
    const map = new Map<string, Step>();
    for (const s of steps) map.set(s.id, s);
    return map;
  }, [steps]);

  const contextMenuStep = contextMenu
    ? stepsById.get(contextMenu.stepId) ?? null
    : null;

  // Adapter: `NodeContextMenu` chama `onToggleActive(stepId, nextActive)`,
  // mas o `FluxoBuilder` expõe a alternância como um `patchStep` genérico.
  // Centralizamos a tradução aqui para manter o menu desacoplado.
  const handleToggleActive = useCallback(
    async (stepId: string, nextActive: boolean) => {
      await onPatchStep(stepId, { is_active: nextActive });
    },
    [onPatchStep],
  );

  // -------------------------------------------------------------------
  // 5c) Handlers de conexão e clique em aresta (task 7.4)
  // -------------------------------------------------------------------
  //
  // Fluxo de criação:
  //
  //   1. `onConnectStart`: o usuário começa a arrastar a partir de um
  //      handle (default ou `btn:<id>`). Guardamos os parâmetros em
  //      `pendingConnectionRef` e zeramos `connectMadeRef`.
  //
  //   2. `onConnect`: o React Flow só dispara este callback quando o drop
  //      cai sobre um Handle target válido (nó com `type="target"`),
  //      passando pelo `isValidConnection`. Marcamos `connectMadeRef =
  //      true` e abrimos o `<TransitionPopover>` em modo `create`.
  //
  //   3. `onConnectEnd`: dispara em todo final de drag, com ou sem `target`.
  //      Se `connectMadeRef.current === false`, o drop foi sobre canvas
  //      vazio (R6.4) e descartamos a conexão silenciosamente.
  //
  // Persistência: a confirmação no popover monta o `Transition` segundo o
  // tipo do drop:
  //
  //   - Handle de botão (`sourceHandle = "btn:<id>"`): R7.7 obriga
  //     `trigger_phrases = [btn.title, btn.id]` e `trigger_intent =
  //     "palavra_chave"` para que o runtime reconheça como
  //     Trigger_Determinístico (paridade com `StepInspector`).
  //   - Handle default → `Step`: usa `trigger_phrase`/`trigger_intent` do
  //     popover; se o intent estiver vazio, default para `"palavra_chave"`.
  //   - Drop em `TerminalNode`: persiste `goto_step_id = null`,
  //     `goto_special = <kind>` (R6.8). Trigger de `trigger_intent` vazio
  //     também default para `"palavra_chave"` (mesmo padrão do default
  //     handle).
  //
  // Em qualquer falha de `onPatchStep`: revertemos o estado local (graças
  // ao `setSteps` otimista do `FluxoBuilder.patchStep` — em caso de erro
  // ele exibe `toast.error` mas a UI já foi atualizada; aqui propagamos o
  // erro para o popover continuar aberto e o usuário poder tentar de novo
  // — R6.9, R7.8). Como `FluxoBuilder.patchStep` não rejeita a Promise,
  // detectamos erro pelo padrão de "transition não persistiu": deixamos o
  // popover orquestrar via `throw` apenas quando obtemos um caminho de
  // erro detectável (ver `handleConfirmTransitionCreate`).

  /**
   * Validação de conexão (R11.6, R11.7). Como `useDiagramData` constrói o
   * grafo a partir de uma única Variante (a do `FluxoBuilder.editingVariant`)
   * e os `TerminalNode`s pertencem implicitamente a essa Variante,
   * **qualquer** node com handle target válido aqui pertence à mesma Variante
   * e mesmo `flow_id`. Não há nodes de outras Variantes no canvas.
   *
   * Mantemos esta função explícita por dois motivos:
   *   1. Documenta o requisito (auditoria por requirements links).
   *   2. Garante que `source !== "" && target !== ""` mesmo se algum
   *      callback do React Flow escapar com strings vazias por algum motivo.
   */
  const isValidConnection = useCallback<IsValidConnection>((conn) => {
    if (!conn.source || !conn.target) return false;
    // R6.7 / R13.3 — auto-laço (origem === destino) é permitido.
    return true;
  }, []);

  /**
   * Converte coordenadas de tela (clientX/clientY) para coordenadas
   * relativas ao wrapper do canvas, usadas pelo `<TransitionPopover>` cuja
   * raiz é `position: absolute` filho do wrapper.
   */
  const wrapperRelativePos = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } => {
      const rect = wrapperRef.current?.getBoundingClientRect();
      if (!rect) return { x: clientX, y: clientY };
      return { x: clientX - rect.left, y: clientY - rect.top };
    },
    [],
  );

  const handleConnectStart = useCallback<OnConnectStart>(
    (event, params) => {
      // Memoriza o início. Limpa qualquer popover anterior para garantir o
      // requisito R6.5 (apenas um popover aberto por vez).
      pendingConnectionRef.current = params;
      connectMadeRef.current = false;
      lastPointerPosRef.current = null;
      setTransitionPopover(null);

      // Captura a posição do ponteiro durante o drag para que `onConnect` /
      // `onConnectEnd` possam posicionar o popover sob o ponto de soltura
      // (R6.2). React Flow não passa o evento original para `onConnect`,
      // mas o pointer up sempre é capturado pelo listener temporário.
      const isPointer = (e: Event): e is PointerEvent =>
        typeof PointerEvent !== "undefined" && e instanceof PointerEvent;
      const isMouse = (e: Event): e is MouseEvent =>
        typeof MouseEvent !== "undefined" && e instanceof MouseEvent;
      const onPointerMove = (e: Event) => {
        if (isPointer(e) || isMouse(e)) {
          const rect = wrapperRef.current?.getBoundingClientRect();
          if (rect) {
            lastPointerPosRef.current = {
              x: e.clientX - rect.left,
              y: e.clientY - rect.top,
            };
          }
        } else if (
          typeof TouchEvent !== "undefined" &&
          e instanceof TouchEvent &&
          e.touches.length > 0
        ) {
          const t = e.touches[0];
          const rect = wrapperRef.current?.getBoundingClientRect();
          if (rect) {
            lastPointerPosRef.current = {
              x: t.clientX - rect.left,
              y: t.clientY - rect.top,
            };
          }
        }
      };
      const cleanup = () => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("mousemove", onPointerMove);
        window.removeEventListener("touchmove", onPointerMove);
        window.removeEventListener("pointerup", cleanup);
        window.removeEventListener("mouseup", cleanup);
        window.removeEventListener("touchend", cleanup);
      };
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("mousemove", onPointerMove);
      window.addEventListener("touchmove", onPointerMove, { passive: true });
      window.addEventListener("pointerup", cleanup);
      window.addEventListener("mouseup", cleanup);
      window.addEventListener("touchend", cleanup);

      // Posição inicial do drag a partir do `event` recebido (mouse/pointer).
      if (event && "clientX" in event && typeof event.clientX === "number") {
        const rect = wrapperRef.current?.getBoundingClientRect();
        if (rect) {
          lastPointerPosRef.current = {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
          };
        }
      }
    },
    [],
  );

  const handleConnect = useCallback<OnConnect>(
    (connection: Connection) => {
      // O React Flow só chega aqui quando target é um handle válido (e o
      // `isValidConnection` retornou true).
      connectMadeRef.current = true;

      const { source, target, sourceHandle } = connection;
      if (!source || !target) return;

      // R6.2 — popover deve abrir próximo ao ponto de soltura. Preferimos
      // a última posição do ponteiro capturada durante o drag; se por algum
      // motivo ela não estiver disponível (hot-reload, teste), caímos no
      // centro do nó destino e por fim no centro do wrapper.
      let popoverX = 0;
      let popoverY = 0;
      const pointer = lastPointerPosRef.current;
      if (pointer) {
        popoverX = pointer.x;
        popoverY = pointer.y;
      } else {
        const targetNode = positionedNodes.find((n) => n.id === target);
        if (targetNode) {
          const screen = reactFlow.flowToScreenPosition({
            x: targetNode.position.x,
            y: targetNode.position.y,
          });
          const rel = wrapperRelativePos(screen.x, screen.y);
          popoverX = rel.x;
          popoverY = rel.y;
        } else {
          const rect = wrapperRef.current?.getBoundingClientRect();
          popoverX = rect ? rect.width / 2 : 200;
          popoverY = rect ? rect.height / 2 : 200;
        }
      }

      setTransitionPopover({
        kind: "create",
        sourceId: source,
        sourceHandle: sourceHandle ?? undefined,
        targetId: target,
        x: popoverX,
        y: popoverY,
      });
    },
    [positionedNodes, reactFlow, wrapperRelativePos],
  );

  const handleConnectEnd = useCallback<OnConnectEnd>(
    (_event, _connectionState: FinalConnectionState) => {
      // R6.4 — se `onConnect` não disparou, o drop foi em canvas vazio
      // (ou em handle inválido). Descartamos sem persistir e sem popover.
      if (!connectMadeRef.current) {
        pendingConnectionRef.current = null;
      }
      // Caso `onConnect` tenha disparado, o popover já está aberto; aqui
      // não fazemos nada — a confirmação ou o cancelamento é responsabilidade
      // do `<TransitionPopover>`.
    },
    [],
  );

  /**
   * Handler de clique em aresta (R6.5).
   *
   * Apenas arestas geradas a partir de transitions explícitas suportam
   * edição via popover (Aresta_Solida e Aresta_IA). Edges sintéticas
   * (`fallback`, `sequence`, `ai-fallback`, `__warning_*`) não são editáveis
   * por aqui — o usuário deve usar o `StepInspector` para ajustar fallback,
   * e arestas de sequência refletem `position`, não dados editáveis.
   */
  const handleEdgeClick = useCallback<EdgeMouseHandler>(
    (event, edge) => {
      // Bloqueia edição em modo somente leitura (R15.2).
      if (readOnly) return;

      const transitionIdx = extractTransitionIdxFromEdgeId(edge.id);
      if (transitionIdx === null) return;

      const sourceId = edge.source;
      const sourceStep = stepsById.get(sourceId);
      if (!sourceStep) return;
      const transition = sourceStep.transitions[transitionIdx];
      if (!transition) return;

      // Rejeita edges com `target` sintético (`__warning_*`); o popover
      // assume um destino real ou um terminal válido.
      const targetId = edge.target;
      const isWarningTarget = targetId.startsWith("__warning_");
      if (isWarningTarget) return;

      // `currentTargetId` para o select "Redirecionar" é o `goto_step_id`
      // atual (ou `null` quando o destino é um terminal).
      const currentTargetId =
        decodeTerminalKind(targetId) === null ? targetId : null;

      // Para o popover, exibimos o primeiro `trigger_phrase` não vazio (ou
      // string vazia) e o `trigger_intent` atual (string vazia ⇒ "nenhum").
      const initialPhrase =
        transition.trigger_phrases.find((p) => p && p.trim() !== "") ?? "";
      const initialIntent = transition.trigger_intent ?? "";

      const { x, y } = wrapperRelativePos(event.clientX, event.clientY);
      setTransitionPopover({
        kind: "edit",
        edgeId: edge.id,
        x,
        y,
        initialTriggerPhrase: initialPhrase,
        initialTriggerIntent: initialIntent,
        currentTargetId,
      });
    },
    [readOnly, stepsById, wrapperRelativePos],
  );

  // -------------------------------------------------------------------
  // 5d) Persistência das ações do `<TransitionPopover>` (task 7.4)
  // -------------------------------------------------------------------
  //
  // Helper que monta o `Transition` correto a partir do contexto da
  // criação. Centraliza a lógica de "handle de botão" vs "default" vs
  // "drop em terminal" para facilitar leitura e teste manual.

  /**
   * Constrói uma nova `Transition` a partir do contexto do popover de
   * criação e dos valores digitados pelo usuário.
   *
   * - Para `sourceHandle = "btn:<id>"` (R7.7), o formato é fixo:
   *   `trigger_phrases = [btn.title, btn.id]`, `trigger_intent =
   *   "palavra_chave"`. Os valores digitados pelo usuário são ignorados
   *   intencionalmente — o gatilho do botão é o próprio botão.
   *
   * - Para `sourceHandle = "default"`, usa `triggerPhrase`/`triggerIntent`
   *   do popover. Quando `triggerIntent` é string vazia, default para
   *   `"palavra_chave"` (Trigger_Determinístico no runtime).
   *
   * - `targetId` pode ser um id de Step (real) ou um id de TerminalNode
   *   sintético (R6.8). No caso de terminal, persiste `goto_step_id =
   *   null`, `goto_special = <kind>`.
   */
  const buildNewTransition = useCallback(
    (params: {
      sourceStep: Step;
      sourceHandle: string | undefined;
      targetId: string;
      triggerPhrase: string;
      triggerIntent: string;
    }): Transition | null => {
      const { sourceStep, sourceHandle, targetId, triggerPhrase, triggerIntent } =
        params;
      const terminalKind = decodeTerminalKind(targetId);

      // Caso 1 — handle de botão (R7.7). O formato é fixo, ignora os
      // campos do popover.
      if (sourceHandle && sourceHandle.startsWith("btn:")) {
        const btnId = sourceHandle.slice("btn:".length);
        const btn = getButtons(sourceStep).find((b) => b.id === btnId);
        if (!btn) return null;

        return {
          trigger_phrases: [btn.title, btn.id],
          trigger_intent: "palavra_chave",
          goto_step_id: terminalKind ? null : targetId,
          goto_special: terminalKind ?? null,
        };
      }

      // Caso 2 — handle default (Step ou Terminal).
      const intent = triggerIntent.trim() || "palavra_chave";
      const phrases = triggerPhrase.trim() ? [triggerPhrase.trim()] : [];

      return {
        trigger_phrases: phrases,
        trigger_intent: intent,
        goto_step_id: terminalKind ? null : targetId,
        goto_special: terminalKind ?? null,
      };
    },
    [],
  );

  /** Confirma a criação de uma nova transition. Lança em caso de erro
   *  (mantendo o popover aberto para retry, conforme R6.9 / R7.8). */
  const handleConfirmTransitionCreate = useCallback(
    async (input: { triggerPhrase: string; triggerIntent: string }) => {
      const popover = transitionPopover;
      if (!popover || popover.kind !== "create") return;

      const sourceStep = stepsById.get(popover.sourceId);
      if (!sourceStep) {
        toast.error("Passo de origem não encontrado.");
        throw new Error("source step missing");
      }

      const newTransition = buildNewTransition({
        sourceStep,
        sourceHandle: popover.sourceHandle,
        targetId: popover.targetId,
        triggerPhrase: input.triggerPhrase,
        triggerIntent: input.triggerIntent,
      });
      if (!newTransition) {
        toast.error("Não foi possível identificar o botão de origem.");
        throw new Error("invalid source handle");
      }

      const nextTransitions: Transition[] = [
        ...sourceStep.transitions,
        newTransition,
      ];

      try {
        await onPatchStep(sourceStep.id, { transitions: nextTransitions });
      } catch (err) {
        // R6.9 / R7.8 — em caso de exceção propagada, mostramos um toast e
        // mantemos o popover aberto. (FluxoBuilder.patchStep atual exibe seu
        // próprio toast; este catch cobre o caso de implementações futuras
        // que rejeitem a Promise.)
        toast.error("Não foi possível salvar a regra. Tente novamente.");
        throw err;
      }

      closeTransitionPopover();
    },
    [
      buildNewTransition,
      closeTransitionPopover,
      onPatchStep,
      stepsById,
      transitionPopover,
    ],
  );

  /** Confirma edição (apenas trigger phrase/intent) de uma transition existente. */
  const handleConfirmTransitionEdit = useCallback(
    async (input: { triggerPhrase: string; triggerIntent: string }) => {
      const popover = transitionPopover;
      if (!popover || popover.kind !== "edit") return;

      const transitionIdx = extractTransitionIdxFromEdgeId(popover.edgeId);
      if (transitionIdx === null) {
        toast.error("Aresta não pode ser editada por aqui.");
        throw new Error("non-editable edge");
      }
      // O `edge.id` começa com `${stepId}-` (UUIDs com hífens estão dentro
      // de `stepId`). Em vez de re-parsear, recuperamos via `edges`.
      const edge = edges.find((e) => e.id === popover.edgeId);
      if (!edge) {
        toast.error("Aresta não encontrada.");
        throw new Error("edge missing");
      }
      const sourceStep = stepsById.get(edge.source);
      if (!sourceStep) {
        toast.error("Passo de origem não encontrado.");
        throw new Error("source step missing");
      }
      const current = sourceStep.transitions[transitionIdx];
      if (!current) {
        toast.error("Regra não encontrada (foi removida?).");
        throw new Error("transition missing");
      }

      const intent = input.triggerIntent.trim();
      const phrase = input.triggerPhrase.trim();
      const updated: Transition = {
        ...current,
        trigger_intent: intent || "palavra_chave",
        trigger_phrases: phrase ? [phrase] : current.trigger_phrases,
      };

      const nextTransitions = sourceStep.transitions.map((t, i) =>
        i === transitionIdx ? updated : t,
      );

      try {
        await onPatchStep(sourceStep.id, { transitions: nextTransitions });
      } catch (err) {
        toast.error("Não foi possível salvar a regra. Tente novamente.");
        throw err;
      }
      closeTransitionPopover();
    },
    [
      closeTransitionPopover,
      edges,
      onPatchStep,
      stepsById,
      transitionPopover,
    ],
  );

  /** Remove a transition da edge atualmente em edição (R6.6). */
  const handleRemoveTransition = useCallback(async () => {
    const popover = transitionPopover;
    if (!popover || popover.kind !== "edit") return;

    const transitionIdx = extractTransitionIdxFromEdgeId(popover.edgeId);
    if (transitionIdx === null) {
      toast.error("Aresta não pode ser removida por aqui.");
      throw new Error("non-removable edge");
    }
    const edge = edges.find((e) => e.id === popover.edgeId);
    if (!edge) {
      toast.error("Aresta não encontrada.");
      throw new Error("edge missing");
    }
    const sourceStep = stepsById.get(edge.source);
    if (!sourceStep) {
      toast.error("Passo de origem não encontrado.");
      throw new Error("source step missing");
    }

    const nextTransitions = sourceStep.transitions.filter(
      (_t, i) => i !== transitionIdx,
    );

    try {
      await onPatchStep(sourceStep.id, { transitions: nextTransitions });
    } catch (err) {
      toast.error("Não foi possível remover. Tente novamente.");
      throw err;
    }
    closeTransitionPopover();
  }, [closeTransitionPopover, edges, onPatchStep, stepsById, transitionPopover]);

  /** Redireciona o destino da transition para outro Step (R6.5). */
  const handleRedirectTransition = useCallback(
    async (newTargetId: string) => {
      const popover = transitionPopover;
      if (!popover || popover.kind !== "edit") return;

      const transitionIdx = extractTransitionIdxFromEdgeId(popover.edgeId);
      if (transitionIdx === null) {
        toast.error("Aresta não pode ser redirecionada por aqui.");
        throw new Error("non-redirectable edge");
      }
      const edge = edges.find((e) => e.id === popover.edgeId);
      if (!edge) {
        toast.error("Aresta não encontrada.");
        throw new Error("edge missing");
      }
      const sourceStep = stepsById.get(edge.source);
      if (!sourceStep) {
        toast.error("Passo de origem não encontrado.");
        throw new Error("source step missing");
      }
      const current = sourceStep.transitions[transitionIdx];
      if (!current) {
        toast.error("Regra não encontrada (foi removida?).");
        throw new Error("transition missing");
      }

      const terminalKind = decodeTerminalKind(newTargetId);
      const updated: Transition = {
        ...current,
        goto_step_id: terminalKind ? null : newTargetId,
        goto_special: terminalKind ?? null,
      };
      const nextTransitions = sourceStep.transitions.map((t, i) =>
        i === transitionIdx ? updated : t,
      );

      try {
        await onPatchStep(sourceStep.id, { transitions: nextTransitions });
      } catch (err) {
        toast.error("Não foi possível redirecionar. Tente novamente.");
        throw err;
      }
      // Mantém o popover aberto após redirect (consistente com a UX do
      // selector inline em `TransitionPopover`).
    },
    [edges, onPatchStep, stepsById, transitionPopover],
  );

  // -------------------------------------------------------------------

  // -------------------------------------------------------------------
  // 6) Navegação por teclado dentro do canvas (R14.2, R14.3, R14.4, R14.5)
  // -------------------------------------------------------------------
  //
  // O React Flow não expõe um sistema de "foco lógico de nó" pronto, então
  // implementamos o handler no wrapper do canvas (`tabIndex={0}`):
  //   - `Enter` no nó focado → `onSelectStep` (R14.2).
  //   - `F2` no nó focado → `onOpenInspector` (R14.3).
  //   - Setas → mover foco para o vizinho mais próximo no cone de 90° na
  //     direção da seta (R14.4); cone vazio mantém o foco (R14.5).
  //
  // O "nó focado" é determinado por `document.activeElement` carregando
  // `data-step-id` (ver `FlowDiagramNode.tsx`). Isso evita acoplar o
  // teclado a `selectedId` (seleção e foco são conceitos independentes —
  // por exemplo, o Consultor pode estar com um nó focado mas outro
  // selecionado pelo `WhatsAppPreview`).
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  /**
   * Resolve o `stepId` do nó atualmente focado (via DOM). Retorna `null`
   * quando o foco não está sobre nenhum `FlowDiagramNode`.
   */
  const getFocusedStepId = useCallback((): string | null => {
    const active = typeof document !== "undefined" ? document.activeElement : null;
    if (!active) return null;
    // `closest` cobre tanto o caso de o `activeElement` ser o próprio
    // wrapper do nó quanto algum filho focado dentro dele.
    const nodeEl = (active as HTMLElement).closest?.(
      "[data-step-id]",
    ) as HTMLElement | null;
    return nodeEl?.dataset.stepId ?? null;
  }, []);

  /**
   * Encontra o nó vizinho mais próximo a partir do nó `fromId` na direção
   * `direction`, considerando apenas nós cujo centro geométrico cai dentro
   * do cone de 90° centrado naquela direção (R14.4).
   *
   * Retorna `null` quando o cone está vazio (R14.5 — foco permanece).
   */
  const findNearestInDirection = useCallback(
    (
      fromId: string,
      direction: "up" | "down" | "left" | "right",
    ): string | null => {
      // Apenas nós `flow` participam da navegação por teclado; terminais
      // são alvos de aresta, não de foco.
      const all = positionedNodes.filter((n) => n.type === "flow");
      const origin = all.find((n) => n.id === fromId);
      if (!origin) return null;

      // Tamanho aproximado do nó (ver `FlowDiagramNode`: 280px de largura;
      // altura varia conforme conteúdo, mas para o cálculo de centro o
      // valor exato não importa muito — usamos uma constante razoável).
      // O React Flow expõe `node.measured` em v12 quando disponível.
      const widthOf = (n: Node) => n.measured?.width ?? n.width ?? 280;
      const heightOf = (n: Node) => n.measured?.height ?? n.height ?? 120;

      const ox = origin.position.x + widthOf(origin) / 2;
      const oy = origin.position.y + heightOf(origin) / 2;

      let best: { id: string; dist: number } | null = null;

      for (const n of all) {
        if (n.id === fromId) continue;
        const cx = n.position.x + widthOf(n) / 2;
        const cy = n.position.y + heightOf(n) / 2;
        const dx = cx - ox;
        const dy = cy - oy;

        // Cone de 90° (±45° em torno da direção). Em coordenadas de canvas,
        // y cresce para baixo. Equivalente ao critério de "distância
        // dominante na direção alvo": para "right", precisamos `dx > 0` e
        // `|dx| >= |dy|` (ângulo dentro de ±45°). Análogo para os demais.
        let inCone = false;
        switch (direction) {
          case "right":
            inCone = dx > 0 && Math.abs(dx) >= Math.abs(dy);
            break;
          case "left":
            inCone = dx < 0 && Math.abs(dx) >= Math.abs(dy);
            break;
          case "down":
            inCone = dy > 0 && Math.abs(dy) >= Math.abs(dx);
            break;
          case "up":
            inCone = dy < 0 && Math.abs(dy) >= Math.abs(dx);
            break;
        }
        if (!inCone) continue;

        // Distância euclidiana entre os centros (R14.4 explicita
        // "menor distância euclidiana ao centro do nó atual").
        const dist = Math.hypot(dx, dy);
        if (!best || dist < best.dist) {
          best = { id: n.id, dist };
        }
      }

      return best ? best.id : null;
    },
    [positionedNodes],
  );

  /** Foca o nó com `data-step-id={stepId}` dentro do wrapper do canvas. */
  const focusStepNode = useCallback((stepId: string) => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const el = wrapper.querySelector<HTMLElement>(
      `[data-step-id="${CSS.escape(stepId)}"]`,
    );
    el?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const focusedId = getFocusedStepId();

      // Mapas de tecla → direção (R14.4).
      const arrowMap: Record<string, "up" | "down" | "left" | "right" | undefined> = {
        ArrowUp: "up",
        ArrowDown: "down",
        ArrowLeft: "left",
        ArrowRight: "right",
      };
      const direction = arrowMap[event.key];

      if (direction) {
        if (!focusedId) return;
        // Setas dentro do canvas de fluxo competem com o pan padrão do
        // React Flow; quando há um nó focado, queremos navegação entre nós.
        event.preventDefault();
        event.stopPropagation();
        const nextId = findNearestInDirection(focusedId, direction);
        if (nextId) {
          focusStepNode(nextId);
        }
        // R14.5 — cone vazio: foco permanece (no-op intencional).
        return;
      }

      if (event.key === "Enter") {
        if (!focusedId) return;
        event.preventDefault();
        event.stopPropagation();
        // R14.2 — equivalente ao clique único.
        onSelectStep(focusedId);
        return;
      }

      if (event.key === "F2") {
        if (!focusedId) return;
        event.preventDefault();
        event.stopPropagation();
        // R14.3 — equivalente a duplo-clique / "Editar".
        onOpenInspector(focusedId);
        return;
      }

      if (event.key === "Escape") {
        // task 12.2 — fechar popovers/menus em aberto a partir do canvas.
        // O `<TransitionPopover>` e o `<NodeContextMenu>` também têm
        // listeners próprios de Esc, mas centralizar aqui garante o
        // fechamento mesmo quando o foco está sobre um nó (não dentro do
        // popover/menu) — paridade com a UX descrita em R14 e R6.5.
        let handled = false;
        if (transitionPopover) {
          closeTransitionPopover();
          handled = true;
        }
        if (contextMenu) {
          closeContextMenu();
          handled = true;
        }
        // Se nada de UI flutuante estava aberto e estamos em tela cheia,
        // Esc sai da tela cheia (paridade com a API nativa do navegador).
        if (!handled && fullscreen) {
          onFullscreenToggle();
          handled = true;
        }
        if (handled) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }

      // Atalho `F` (sem Ctrl/Meta/Alt) alterna a Tela Cheia. Ignorado quando
      // o foco está em um campo editável para não interferir com digitação.
      if (
        (event.key === "f" || event.key === "F") &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey
      ) {
        const target = event.target as HTMLElement | null;
        const isEditable =
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          (target?.isContentEditable ?? false);
        if (isEditable) return;
        event.preventDefault();
        event.stopPropagation();
        onFullscreenToggle();
        return;
      }
    },
    [
      closeContextMenu,
      closeTransitionPopover,
      contextMenu,
      findNearestInDirection,
      focusStepNode,
      fullscreen,
      getFocusedStepId,
      onFullscreenToggle,
      onOpenInspector,
      onSelectStep,
      transitionPopover,
    ],
  );

  // Garante que pelo menos um listener global de Esc fecha o menu mesmo
  // quando o foco saiu do canvas (paridade com `NodeContextMenu` interno,
  // que já cobre o caso do menu focado).
  useEffect(() => {
    if (!contextMenu) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeContextMenu();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [contextMenu, closeContextMenu]);

  // Quantidade de Nós_Diagrama "reais" (excluindo terminais) — usada para
  // habilitar/desabilitar o botão Exportar na toolbar (R16.2).
  const flowNodeCount = useMemo(
    () => positionedNodes.filter((n: Node) => n.type === "flow").length,
    [positionedNodes],
  );

  // -------------------------------------------------------------------
  // 7) "Adicionar passo" via canvas (task 7.5 — R5.5, R5.6, R10.11)
  // -------------------------------------------------------------------
  //
  // Estratégia:
  //
  //   1. Calcula um candidato no centro da viewport visível (em coordenadas
  //      do canvas, pré-zoom) via `screenToFlowPosition`.
  //
  //   2. Itera enquanto houver colisão com algum nó existente — entendido
  //      como "centro do candidato a menos de 40px do centro de qualquer
  //      nó posicionado". Em cada colisão desloca o candidato em (40, 40)
  //      e tenta de novo, até no máximo 10 vezes.
  //
  //   3. Se as 10 tentativas falharem, mantém o último candidato (centro
  //      da viewport ou próximo dele) — R5.5 explicita "mesmo que isso
  //      resulte em sobreposição visual".
  //
  // R5.6 / Error Scenario 7: enquanto `addingStep` for `true`, o botão
  // fica desabilitado para evitar duplo-clique acidental que crie dois
  // passos vazios. Em falha, reabilitamos o botão e exibimos toast.error.
  //
  // R10.11 — `onAddStep` recebe a coordenada calculada; o consumidor
  // (`FluxoBuilder.addStep`) é responsável por inicializar `layout =
  // initialPosition` no insert.
  const [addingStep, setAddingStep] = useState(false);

  const findFreeCanvasPosition = useCallback((): { x: number; y: number } => {
    // Centro da viewport visível em coordenadas de tela.
    const rect = wrapperRef.current?.getBoundingClientRect();
    const screenCenterX = rect ? rect.left + rect.width / 2 : 0;
    const screenCenterY = rect ? rect.top + rect.height / 2 : 0;
    // Converte para coordenadas do canvas (pré-zoom).
    const flowCenter = reactFlow.screenToFlowPosition({
      x: screenCenterX,
      y: screenCenterY,
    });

    // Centros dos nós existentes (apenas nós `flow`; terminais ficam fora
    // da área editável e não disputam posição com novos passos).
    const widthOf = (n: Node) => n.measured?.width ?? n.width ?? 280;
    const heightOf = (n: Node) => n.measured?.height ?? n.height ?? 120;
    const flowNodes = positionedNodes.filter((n) => n.type === "flow");
    const nodeCenters = flowNodes.map((n) => ({
      x: n.position.x + widthOf(n) / 2,
      y: n.position.y + heightOf(n) / 2,
    }));

    const MIN_OFFSET = 40;
    let candidate = { x: flowCenter.x, y: flowCenter.y };

    // Até 10 tentativas. Cada colisão desloca em (40, 40) — diagonal
    // descendente para a direita, padrão consistente com inserções
    // sucessivas no mesmo lote.
    for (let attempt = 0; attempt < 10; attempt++) {
      const collides = nodeCenters.some((c) => {
        const dx = candidate.x - c.x;
        const dy = candidate.y - c.y;
        return Math.hypot(dx, dy) < MIN_OFFSET;
      });
      if (!collides) break;
      candidate = {
        x: candidate.x + MIN_OFFSET,
        y: candidate.y + MIN_OFFSET,
      };
    }

    return candidate;
  }, [positionedNodes, reactFlow]);

  const handleAddStepClick = useCallback(async () => {
    if (addingStep) return;
    setAddingStep(true);
    try {
      const initialPosition = findFreeCanvasPosition();
      // Repassa a coordenada — `FluxoBuilder.addStep` inicializa
      // `layout = initialPosition` no insert (R10.11). Quando a operação
      // falha silenciosamente (e.g. o consumidor já mostrou seu próprio
      // toast), `null` chega aqui e tratamos como erro para reabilitar o
      // botão sem nó-fantasma (R5.6).
      const created = await onAddStep(initialPosition);
      if (!created) {
        toast.error("Não foi possível adicionar o passo. Tente novamente.");
      }
    } catch (err) {
      // R5.6 — manter estado anterior, exibir erro, reabilitar botão.
      console.error("[FlowDiagram] onAddStep failed", err);
      toast.error("Não foi possível adicionar o passo. Tente novamente.");
    } finally {
      setAddingStep(false);
    }
  }, [addingStep, findFreeCanvasPosition, onAddStep]);

  // -------------------------------------------------------------------
  // 8) Realce de ciclos no hover (task 7.6 — R13.2, R13.5)
  // -------------------------------------------------------------------
  //
  // Estratégia:
  //
  //   - Pré-computa, **uma única vez por mudança em `steps`**, todos os
  //     ciclos simples (caminhos `origem → ... → origem` distintos) usando
  //     apenas Arestas_Solidas (transitions com `goto_step_id` válido
  //     apontando para outro Step ativo). DFS clássica com pilha.
  //
  //   - Limita o conjunto detectado aos primeiros 50 ciclos por ordem de
  //     descoberta (R13.5). Ciclos com mais de 50 passos também são
  //     descartados, conforme R13.2 ("até 50 Passos no ciclo").
  //
  //   - Para cada Step, mantém o conjunto de IDs de outros Steps que
  //     pertencem ao mesmo ciclo dele. Ao `onNodeMouseEnter` em um Step
  //     que pertence a algum ciclo, união todos os ciclos dele e expõe o
  //     conjunto resultante via `cycleHighlightStepIds` — usado por uma
  //     `<style>` injetada para aplicar `outline` (≤ 200ms via CSS
  //     transition).
  //
  //   - Quando o número total de ciclos detectados excede 50, exibimos um
  //     pequeno indicador informativo no canto superior direito do canvas
  //     (R13.5 — "exibir indicador informativo de que ciclos adicionais
  //     existem mas não estão visualmente destacados").

  const MAX_CYCLES = 50;
  const MAX_CYCLE_LENGTH = 50;

  const { cyclesByStepId, totalCyclesDetected, hasMoreCycles } = useMemo(() => {
    const stepIds = new Set(steps.map((s) => s.id));
    const activeStepIds = new Set(
      steps.filter((s) => s.is_active !== false).map((s) => s.id),
    );

    // Adjacência apenas com Arestas_Solidas: transitions com `goto_step_id`
    // existente, ativo, e cujo `trigger_intent` é Trigger_Determinístico.
    const adj = new Map<string, string[]>();
    for (const s of steps) {
      const out: string[] = [];
      for (const t of s.transitions) {
        const targetId = t.goto_step_id;
        if (!targetId) continue;
        if (!stepIds.has(targetId)) continue;
        if (!activeStepIds.has(targetId)) continue;
        if (!isDeterministicIntent(t.trigger_intent)) continue;
        out.push(targetId);
      }
      adj.set(s.id, out);
    }

    // Detecta todos os ciclos simples (algoritmo simples DFS; não usamos
    // Johnson para manter a implementação simples e o limite é baixo —
    // 50 ciclos / 50 passos por ciclo).
    const cycles: string[][] = [];
    let total = 0;

    const blocked = new Set<string>();
    const path: string[] = [];

    function dfs(start: string, current: string): void {
      if (cycles.length >= MAX_CYCLES) return;
      if (path.length > MAX_CYCLE_LENGTH) return;

      blocked.add(current);
      path.push(current);

      const neighbors = adj.get(current) ?? [];
      for (const next of neighbors) {
        if (cycles.length >= MAX_CYCLES) break;
        // Só consideramos ciclos cujo nó de menor `id` no ciclo seja o
        // `start` — isso evita reportar o mesmo ciclo várias vezes (uma
        // por ponto de entrada distinto). Como filtramos por `start`
        // no caller, basta ignorar `next < start`.
        if (next < start) continue;
        if (next === start) {
          // Fechou o ciclo — registra cópia do path.
          total++;
          if (cycles.length < MAX_CYCLES) {
            cycles.push([...path]);
          }
        } else if (!blocked.has(next)) {
          dfs(start, next);
        }
      }

      path.pop();
      blocked.delete(current);
    }

    // Ordena os IDs para garantir a invariante "menor id primeiro".
    const orderedIds = [...stepIds].sort();
    for (const start of orderedIds) {
      if (cycles.length >= MAX_CYCLES) break;
      blocked.clear();
      path.length = 0;
      dfs(start, start);
    }

    // Mapeia cada step para o conjunto de step ids no(s) ciclo(s) ao(s)
    // qual(is) ele pertence.
    const byStep = new Map<string, Set<string>>();
    for (const cyc of cycles) {
      for (const id of cyc) {
        let set = byStep.get(id);
        if (!set) {
          set = new Set<string>();
          byStep.set(id, set);
        }
        for (const other of cyc) set.add(other);
      }
    }

    return {
      cyclesByStepId: byStep,
      totalCyclesDetected: total,
      hasMoreCycles: total > MAX_CYCLES,
    };
  }, [steps]);

  const [cycleHighlightStepIds, setCycleHighlightStepIds] = useState<
    Set<string>
  >(() => new Set());

  const handleNodeMouseEnter = useCallback<NodeMouseHandler>(
    (_event, node) => {
      if (node.type !== "flow") return;
      const set = cyclesByStepId.get(node.id);
      if (set && set.size > 0) {
        setCycleHighlightStepIds(set);
      }
    },
    [cyclesByStepId],
  );

  const handleNodeMouseLeave = useCallback<NodeMouseHandler>(() => {
    setCycleHighlightStepIds((prev) => (prev.size === 0 ? prev : new Set()));
  }, []);

  // CSS dinâmico — uma única regra por id em destaque. `:not(.flow-node-...)`
  // não é necessário; a outline é aditiva e não sobrescreve a borda do nó.
  // O selector `[data-step-id="..."]` casa o wrapper exposto por
  // `FlowDiagramNode` (ver task 5.1).
  const cycleHighlightCSS = useMemo(() => {
    if (cycleHighlightStepIds.size === 0) return "";
    const selectors = Array.from(cycleHighlightStepIds)
      .map((id) => `[data-step-id="${cssEscape(id)}"]`)
      .join(", ");
    // Outline em vez de box-shadow para não conflitar com o ring de seleção
    // / busca. Cor primária do tema (HSL var) para herdar o modo
    // claro/escuro automaticamente.
    return `${selectors} { outline: 2px solid hsl(var(--primary)); outline-offset: 3px; transition: outline 200ms ease-out; }`;
  }, [cycleHighlightStepIds]);

  // -------------------------------------------------------------------
  // 9) Aviso de mais de 200 passos (task 7.7 — R12.5, R12.6)
  // -------------------------------------------------------------------
  //
  // Estratégia:
  //
  //   - Quando `steps.length > 200`, mostramos um banner dispensável no
  //     topo do canvas. Nada do que o canvas faz é bloqueado por ele
  //     (R12.6) — ele apenas vive em um `<Panel position="top-center">`.
  //
  //   - Persistência: a dispensa fica em `sessionStorage` na chave
  //     `flow-diagram-200plus-banner-dismissed`. R12.5 não exige uma chave
  //     por consultor/variant — a recomendação é genérica ("recomenda
  //     segmentar"). Manter em sessão evita que o aviso ressurja a cada
  //     navegação interna; recarregar a aba o restaura.
  //
  //   - Acesso a `sessionStorage` é defensivo (try/catch) para sobreviver
  //     a navegadores em modo privado / quotas (R1.7 trata de
  //     `localStorage` mas a lógica é a mesma — fallback silencioso).

  const SESSION_KEY = "flow-diagram-200plus-banner-dismissed";

  const [bannerDismissed, setBannerDismissed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.sessionStorage.getItem(SESSION_KEY) === "1";
    } catch {
      return false;
    }
  });

  const dismissBanner = useCallback(() => {
    setBannerDismissed(true);
    try {
      window.sessionStorage.setItem(SESSION_KEY, "1");
    } catch {
      // Fallback silencioso (paridade com Persistencia_Layout / R1.7).
    }
  }, []);

  const showLargeFlowBanner = steps.length > 200 && !bannerDismissed;

  // -------------------------------------------------------------------
  // 10) Banner "Edição via canvas indisponível em telas estreitas"
  //     (task 12.1 — R15.3)
  // -------------------------------------------------------------------
  //
  // Quando `readOnly === true` (viewport <768px), exibimos uma mensagem
  // persistente e dispensável instruindo o Consultor a alternar para o
  // Modo_Lista para editar. A dispensa fica em `sessionStorage` (não
  // `localStorage`) para que o aviso reapareça em uma nova sessão — a
  // restrição é imposta pela viewport, não por uma escolha permanente do
  // usuário, então faz sentido relembrar.
  //
  // Resetamos `narrowDismissed` quando o canvas sai do modo somente leitura
  // (viewport cresce ≥768px) para que, se a viewport encolher de novo, o
  // aviso volte a aparecer no mesmo session — comportamento esperado em
  // dispositivos como tablets que mudam de orientação (R15.4).

  const NARROW_SESSION_KEY = "flow-diagram-narrow-banner-dismissed";

  const [narrowDismissed, setNarrowDismissed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.sessionStorage.getItem(NARROW_SESSION_KEY) === "1";
    } catch {
      return false;
    }
  });

  // Quando o canvas volta a ser editável (readOnly=false), zeramos o flag
  // tanto em estado quanto em sessionStorage. Isso garante R15.4 (transição
  // automática) e permite que o aviso apareça de novo se a viewport
  // encolher novamente.
  useEffect(() => {
    if (!readOnly && narrowDismissed) {
      setNarrowDismissed(false);
      try {
        window.sessionStorage.removeItem(NARROW_SESSION_KEY);
      } catch {
        // Fallback silencioso (R1.7).
      }
    }
  }, [readOnly, narrowDismissed]);

  const dismissNarrowBanner = useCallback(() => {
    setNarrowDismissed(true);
    try {
      window.sessionStorage.setItem(NARROW_SESSION_KEY, "1");
    } catch {
      // Fallback silencioso.
    }
  }, []);

  const showNarrowBanner = readOnly && !narrowDismissed;

  return (
    <div
      ref={wrapperRef}
      className={cn(
        "relative h-full w-full",
        // Tela cheia: cobre toda a viewport, sobrepondo header/sidebar.
        // `bg-background` evita transparência sobre o app por trás.
        fullscreen &&
          "fixed inset-0 z-50 h-screen w-screen bg-background",
      )}
      data-fullscreen={fullscreen ? "true" : "false"}
      // R14.4 — wrapper focalizável para receber eventos de teclado quando
      // nenhum nó individual está com foco (evita perdermos a primeira
      // pressão de seta após clicar no canvas vazio).
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <ReactFlow
        nodes={positionedNodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onNodeContextMenu={handleNodeContextMenu}
        onNodeMouseEnter={handleNodeMouseEnter}
        onNodeMouseLeave={handleNodeMouseLeave}
        onPaneClick={handlePaneClick}
        onNodeDragStop={handleNodeDragStop}
        onConnect={handleConnect}
        onConnectStart={handleConnectStart}
        onConnectEnd={handleConnectEnd}
        isValidConnection={isValidConnection}
        onEdgeClick={handleEdgeClick}
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        edgesReconnectable={!readOnly}
        minZoom={0.25}
        maxZoom={2}
        fitView
        fitViewOptions={FIT_VIEW_OPTIONS}
        proOptions={{ hideAttribution: true }}
        // task 12.3 — labels acessíveis em pt-BR para controles e descrições
        // internas do React Flow (R14.7, R14.9).
        ariaLabelConfig={ARIA_LABEL_CONFIG_PTBR}
        // Detecta tema dark via classe HTML para aplicar estilos coerentes
        // ao Background/Controls/MiniMap (R14.8 — paridade visual entre temas).
        colorMode="system"
      >
        <Background
          gap={20}
          size={1}
          color="hsl(var(--border))"
          bgColor="hsl(var(--background))"
        />
        <Controls
          showInteractive={false}
          className="!border-border !bg-background/95 !shadow-md [&>button]:!border-border [&>button]:!bg-background [&>button]:!text-foreground hover:[&>button]:!bg-accent hover:[&>button]:!text-accent-foreground"
        />
        <MiniMap
          pannable
          zoomable
          nodeStrokeWidth={3}
          className="!border-border !bg-background/95 !shadow-md"
          maskColor="hsl(var(--muted) / 0.6)"
          nodeColor={(n) =>
            n.type === "terminal"
              ? "hsl(var(--muted-foreground))"
              : "hsl(var(--primary))"
          }
        />

        {/*
          Toolbar do canvas — R2.8, R3.6, R9.1, R9.10, R10.9, R16.1, R19.1.
          Renderizada via `<Panel>` para flutuar sobre o canvas sem precisar
          sair do React Flow Provider.
        */}
        <Panel position="top-left">
          <DiagramToolbar
            searchQuery={searchQuery}
            onSearchChange={search.setQuery}
            onSearchEnter={search.next}
            searchInputRef={search.inputRef}
            searchMatches={search.matches}
            dottedEdgesVisible={dottedEdgesVisible}
            onDottedEdgesToggle={onDottedEdgesToggle}
            metricsEnabled={metricsEnabled}
            onMetricsToggle={onMetricsToggle}
            onMetricsRefresh={handleMetricsRefresh}
            onCenter={handleCenter}
            onAutoLayout={autoLayoutAll}
            onExport={handleExport}
            nodeCount={flowNodeCount}
            canExport={true}
            exporting={exportApi.exporting}
            readOnly={readOnly}
            fullscreen={fullscreen}
            onFullscreenToggle={onFullscreenToggle}
          />
        </Panel>

        {/*
          Botão "Adicionar passo" — task 7.5 (R5.5, R5.6, R10.11).
          Renderizado em `<Panel position="top-right">` para não competir
          com a toolbar à esquerda nem com a banner de mais de 200 passos
          ao centro. Desabilitado em modo somente leitura (R15.2) e
          enquanto há um insert em andamento (R5.6 / Error Scenario 7).
        */}
        {!readOnly && (
          <Panel position="top-right">
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={handleAddStepClick}
              disabled={addingStep}
              aria-label="Adicionar passo no diagrama"
              className="shadow-md"
            >
              {addingStep ? (
                <Loader2
                  className="h-4 w-4 animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <Plus className="h-4 w-4" aria-hidden="true" />
              )}
              <span className="hidden md:inline">Adicionar passo</span>
            </Button>
          </Panel>
        )}

        {/*
          Banner "Edição via canvas indisponível" — task 12.1 (R15.3).
          Aparece quando `readOnly === true` (viewport <768px). É
          persistente até o Consultor dispensar; a dispensa é por sessão
          (sessionStorage). Pan/zoom continuam habilitados e o duplo-clique
          ainda abre o Inspector — o canvas vira "leitura interativa".
          Renderizado em `top-center` para ficar visível imediatamente após
          o toggle para "Diagrama"; quando o banner de mais de 200 passos
          também estiver visível, eles empilham naturalmente porque ambos
          ocupam a mesma região superior.
        */}
        {showNarrowBanner && (
          <Panel position="top-center">
            <div
              role="status"
              aria-live="polite"
              className="flex max-w-2xl items-start gap-3 rounded-lg border border-border bg-background/95 p-3 shadow-md backdrop-blur"
            >
              <AlertTriangle
                className="mt-0.5 h-5 w-5 shrink-0 text-foreground"
                aria-hidden="true"
              />
              <div className="flex-1 text-sm text-foreground">
                <p className="font-medium">Modo somente leitura</p>
                <p className="mt-0.5 text-muted-foreground">
                  Edição via canvas indisponível em telas estreitas — use a
                  Lista para editar.
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={dismissNarrowBanner}
                aria-label="Dispensar aviso de modo somente leitura"
                className="h-7 w-7 shrink-0"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </Panel>
        )}

        {/*
          Banner de mais de 200 passos — task 7.7 (R12.5, R12.6).
          Posicionado em `top-center` para ficar visível mas não bloquear
          a toolbar nem o botão de adicionar. `R12.6` exige que todas as
          interações continuem disponíveis enquanto o aviso estiver
          visível — por isso ele vive **dentro** do `<ReactFlow>` (mesmo
          stacking context) mas em um `<Panel>` que não captura eventos
          do canvas.
        */}
        {showLargeFlowBanner && (
          <Panel position="top-center">
            <div
              role="status"
              aria-live="polite"
              className="flex max-w-2xl items-start gap-3 rounded-lg border border-warning/50 bg-warning/95 p-3 shadow-md backdrop-blur dark:border-warning/40 dark:bg-warning/80"
            >
              <AlertTriangle
                className="mt-0.5 h-5 w-5 shrink-0 text-warning dark:text-warning"
                aria-hidden="true"
              />
              <div className="flex-1 text-sm text-warning dark:text-warning">
                <p className="font-medium">
                  Fluxo grande: {steps.length} passos
                </p>
                <p className="mt-0.5 text-warning/90 dark:text-warning/90">
                  Considere segmentar este fluxo em variantes ou subfluxos
                  para facilitar a manutenção. Todas as interações continuam
                  disponíveis.
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={dismissBanner}
                aria-label="Dispensar aviso de fluxo grande"
                className="h-7 w-7 shrink-0 text-warning hover:bg-warning/10 dark:text-warning dark:hover:bg-warning/50"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </Panel>
        )}

        {/*
          Indicador "mais ciclos detectados" — task 7.6 (R13.5).
          Quando o número total de ciclos detectados excede o limite
          (`MAX_CYCLES = 50`), exibimos um pequeno selo informativo no
          rodapé central (longe da toolbar à esquerda, dos Controls em
          bottom-left e do MiniMap em bottom-right) avisando que ciclos
          adicionais existem mas não estão visualmente destacados.
        */}
        {hasMoreCycles && (
          <Panel position="bottom-center">
            <div
              role="status"
              className="rounded-md border border-border bg-background/95 px-2 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur"
            >
              Mais de {MAX_CYCLES} ciclos detectados ({totalCyclesDetected}).
              Apenas os primeiros são realçados.
            </div>
          </Panel>
        )}

        {/*
          Indicador persistente de salvamento de layout (R10.13).
          - "Salvando…" quando há save em voo.
          - "Erro ao salvar — tentando novamente" quando há erro pendente.
          Permanece visível até o próximo save bem-sucedido.
        */}
        {(layoutSaving || layoutSaveError) && (
          <Panel position="bottom-right">
            <div
              role="status"
              aria-live="polite"
              className={cn(
                "flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] shadow-sm backdrop-blur",
                layoutSaveError
                  ? "border-destructive/40 bg-destructive/10 text-destructive"
                  : "border-border bg-background/95 text-muted-foreground",
              )}
            >
              {layoutSaveError ? (
                <>
                  <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                  <span>Erro ao salvar — tentando novamente</span>
                </>
              ) : (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                  <span>Salvando…</span>
                </>
              )}
            </div>
          </Panel>
        )}
      </ReactFlow>

      {/*
        CSS dinâmico do realce de ciclos — task 7.6 (R13.2). Renderizado
        fora do `<ReactFlow>` para evitar que a serialização do React Flow
        toque na tag. As regras aplicam `outline` a `[data-step-id="..."]`
        (selector exposto por `FlowDiagramNode`). Quando não há nó em
        destaque, `cycleHighlightCSS` é uma string vazia e a tag é
        renderizada vazia (custo desprezível).
      */}
      <style>{cycleHighlightCSS}</style>

      {/*
        TransitionPopover — task 7.4. Renderizado **fora** do `<ReactFlow>`
        em coordenadas relativas ao wrapper do canvas (que é `position:
        relative`). Mantemos o popover fora do pane transformado do React
        Flow para que o zoom/pan não distorça suas dimensões nem afete
        o cálculo de `clientX/clientY → wrapper-relative` feito em
        `wrapperRelativePos`. Modo `create` é aberto pelo `onConnect`;
        modo `edit`, pelo `onEdgeClick`.
      */}
      {transitionPopover && (
        <TransitionPopover
          state={transitionPopover}
          steps={steps}
          onConfirm={
            transitionPopover.kind === "create"
              ? handleConfirmTransitionCreate
              : handleConfirmTransitionEdit
          }
          onRemove={
            transitionPopover.kind === "edit"
              ? handleRemoveTransition
              : undefined
          }
          onRedirect={
            transitionPopover.kind === "edit"
              ? handleRedirectTransition
              : undefined
          }
          onCancel={closeTransitionPopover}
        />
      )}

      {/*
        `NodeContextMenu` é renderizado **fora** do `<ReactFlow>` porque usa
        `position: fixed` em coordenadas de viewport — não deveria participar
        do pan/zoom do canvas. Mantê-lo como sibling preserva o
        posicionamento e simplifica o stacking context.
      */}
      {contextMenu && contextMenuStep && (
        <NodeContextMenu
          state={contextMenu}
          step={contextMenuStep}
          onClose={closeContextMenu}
          onEdit={onOpenInspector}
          onDuplicate={onDuplicateStep}
          onToggleActive={handleToggleActive}
          onDelete={onDeleteStep}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Outer — wrap em `<ReactFlowProvider>` para habilitar `useReactFlow()` em
// hooks/sub-componentes (DiagramToolbar via `onCenter`, useDiagramSearch,
// useDiagramExport, useViewportPersistence) sem precisar de um Provider
// externo.
// ---------------------------------------------------------------------------

function FlowDiagram(props: FlowDiagramProps) {
  return (
    <ReactFlowProvider>
      <FlowDiagramInner {...props} />
    </ReactFlowProvider>
  );
}

const FlowDiagramMemo = memo(FlowDiagram);
FlowDiagramMemo.displayName = "FlowDiagram";

export default FlowDiagramMemo;
