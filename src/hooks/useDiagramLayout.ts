// useDiagramLayout — hook responsável por aplicar coordenadas aos Nós_Diagrama
// (priorizando `step.layout` salvo, caindo para dagre quando ausente/inválido),
// posicionar os Nós_Terminais em coluna fixa à direita, persistir o resultado
// do drag final com debounce coalescente de 500 ms por nó e oferecer
// "Reorganizar automaticamente" transacional.
//
// Mapeia para os requisitos R10.1, R10.2, R10.4, R10.7, R10.9, R10.10 e R10.13
// do spec `flow-diagram-view`. O hook é puramente cosmético — nunca atualiza a
// `position` dos passos, garantindo R10.8 (mudança de `position` não invalida
// `layout`).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Node } from "@xyflow/react";
import dagre from "dagre";
import { toast } from "@/components/ui/sonner";

import { supabase } from "@/integrations/supabase/client";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  Step,
  StepLayout,
  GotoSpecial,
  VALID_GOTO_SPECIAL,
} from "@/components/admin/flow-builder/flowTypes";

// Constantes do auto-layout. Ver design `useDiagramLayout`:
// dagre com `rankdir = "LR"`, `nodesep = 80`, `ranksep = 60`.
const DEBOUNCE_MS = 500;
const DEFAULT_NODE_WIDTH = 280;
const DEFAULT_NODE_HEIGHT = 120;
const DAGRE_NODESEP = 80;
const DAGRE_RANKSEP = 60;
// Posicionamento dos Nós_Terminais (R10.2):
//   x = max(x_passo) + 240
//   y distribuído com 100 px entre eles começando em min(y_passo).
const TERMINAL_X_OFFSET = 240;
const TERMINAL_Y_SPACING = 100;
// Range válido para coordenadas persistidas (R10.7).
const LAYOUT_BOUND = 100_000;

type StepLayoutOrNull = StepLayout | null;

export interface UseDiagramLayoutArgs {
  /** `bot_flows.id` da Variante em edição. Usado por `autoLayoutAll`. */
  flowId: string | null;
  /** Passos da Variante atual; lemos `step.layout` quando válido. */
  steps: Step[];
  /** Conjunto de Nós_Terminais visíveis (derivado de `useDiagramData`). */
  terminalsUsed: Set<GotoSpecial>;
  /**
   * Callback opcional disparado **após** um `autoLayoutAll` bem-sucedido
   * persistir `layout = null` para todos os passos da Variante.
   *
   * O consumidor (`FluxoBuilder`) deve recarregar o array `steps` a partir
   * do banco para manter o `step.layout` em sincronia com a coluna recém
   * limpada. Sem esse reload, o estado em React conviveria com `step.layout`
   * antigos enquanto o override local em `localLayouts` os sobrepõe — não
   * causa bug visual, mas deixa a fonte única de verdade desalinhada e
   * pode confundir property tests / unit tests que comparam estado.
   *
   * Em falha do reload, o consumidor é responsável por exibir seu próprio
   * `toast.error` e revertir overrides locais se quiser.
   */
  onAfterAutoLayout?: () => void | Promise<void>;
}

export interface UseDiagramLayoutResult {
  /** Aplica posições aos nodes recebidos (mistura de `flow` e `terminal`). */
  layoutNodes: (nodes: Node[]) => Node[];
  /** Salva posição manual de um nó (debounced; coalesce). */
  saveNodePosition: (stepId: string, position: StepLayout) => void;
  /** Reorganiza tudo (R10.9): confirma, limpa `layout` em transação única. */
  autoLayoutAll: () => Promise<void>;
  /** `true` quando há ao menos uma persistência em voo. */
  saving: boolean;
  /**
   * Quando não-nulo, indica que pelo menos uma operação de salvamento de
   * `layout` falhou e ainda não foi resolvida — o consumidor deve exibir
   * indicador persistente (R10.13). Limpado automaticamente assim que
   * uma persistência subsequente for bem-sucedida.
   */
  saveError: string | null;
}

/** Valida se `value` é um {x, y} numérico finito dentro do range aceito (R10.7). */
function isValidLayout(value: unknown): value is StepLayout {
  if (!value || typeof value !== "object") return false;
  const v = value as { x?: unknown; y?: unknown };
  if (typeof v.x !== "number" || !Number.isFinite(v.x)) return false;
  if (typeof v.y !== "number" || !Number.isFinite(v.y)) return false;
  if (Math.abs(v.x) > LAYOUT_BOUND || Math.abs(v.y) > LAYOUT_BOUND) return false;
  return true;
}

export function useDiagramLayout({
  flowId,
  steps,
  terminalsUsed,
  onAfterAutoLayout,
}: UseDiagramLayoutArgs): UseDiagramLayoutResult {
  const confirm = useConfirm();

  // Override local por `stepId`:
  //   - StepLayout válido    → usa esta posição (sobrepõe `step.layout` das props).
  //   - null                 → "limpar"; força dagre mesmo se `step.layout` houver.
  //   - chave ausente        → cai para `step.layout` das props.
  // Isto permite atualização otimista durante drag e durante `autoLayoutAll`
  // sem precisar mexer no array `steps` da página pai.
  const [localLayouts, setLocalLayouts] = useState<Map<string, StepLayoutOrNull>>(
    () => new Map(),
  );

  const [saving, setSaving] = useState(false);
  // R10.13 — persiste mensagem de erro até o próximo save bem-sucedido.
  const [saveError, setSaveError] = useState<string | null>(null);

  // Timers e posições pendentes para o debounce de 500 ms por `stepId` (R10.4).
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const pendingPositionsRef = useRef<Map<string, StepLayout>>(new Map());
  const unmountedRef = useRef(false);
  const inFlightCountRef = useRef(0);

  // R10.13: o retry continua "respeitando o debounce até a página ser deixada".
  // Em unmount paramos qualquer timer pendente.
  useEffect(() => {
    return () => {
      unmountedRef.current = true;
      for (const t of timersRef.current.values()) clearTimeout(t);
      timersRef.current.clear();
      pendingPositionsRef.current.clear();
    };
  }, []);

  // Ao trocar de Variante, descarta overrides locais e timers pendentes para
  // evitar persistir posições da Variante anterior em passos da nova.
  useEffect(() => {
    setLocalLayouts(new Map());
    for (const t of timersRef.current.values()) clearTimeout(t);
    timersRef.current.clear();
    pendingPositionsRef.current.clear();
  }, [flowId]);

  /**
   * Resolve o layout efetivo de um passo considerando, nessa ordem:
   *   1. override local (StepLayout válido)
   *   2. override local explicitamente `null` → força dagre
   *   3. `step.layout` das props quando válido (R10.7)
   *   4. ausência → null (cai em dagre)
   */
  const resolveLayout = useCallback(
    (step: Step, overrides: Map<string, StepLayoutOrNull>): StepLayout | null => {
      if (overrides.has(step.id)) {
        const v = overrides.get(step.id);
        return v && isValidLayout(v) ? v : null;
      }
      return isValidLayout(step.layout) ? step.layout : null;
    },
    [],
  );

  const layoutNodes = useCallback(
    (nodes: Node[]): Node[] => {
      const stepsById = new Map(steps.map((s) => [s.id, s]));

      // Separa nós em "flow" (representam passos) e "terminal" (Cadastro/Humano/Repetir).
      const flowNodes: Node[] = [];
      const terminalNodes: Node[] = [];
      for (const node of nodes) {
        if (node.type === "terminal") terminalNodes.push(node);
        else flowNodes.push(node);
      }

      // Primeiro passe: separar nós com layout válido dos que precisam de dagre.
      const positioned = new Map<string, StepLayout>();
      const needsLayout: Node[] = [];
      for (const node of flowNodes) {
        const step = stepsById.get(node.id);
        const layout = step ? resolveLayout(step, localLayouts) : null;
        if (layout) positioned.set(node.id, layout);
        else needsLayout.push(node);
      }

      // R10.7: dagre roda apenas no subgrafo dos nós SEM layout válido,
      // preservando exatamente as posições dos demais.
      if (needsLayout.length > 0) {
        const g = new dagre.graphlib.Graph({ multigraph: false, compound: false });
        g.setGraph({ rankdir: "LR", nodesep: DAGRE_NODESEP, ranksep: DAGRE_RANKSEP });
        g.setDefaultEdgeLabel(() => ({}));

        for (const node of needsLayout) {
          const w = (node.width as number | undefined) ?? DEFAULT_NODE_WIDTH;
          const h = (node.height as number | undefined) ?? DEFAULT_NODE_HEIGHT;
          g.setNode(node.id, { width: w, height: h });
        }

        // Adiciona arestas apenas quando ambos os extremos estão no subgrafo
        // de nós sem layout, para que o dagre produza um arranjo coerente.
        const unpositionedSet = new Set(needsLayout.map((n) => n.id));
        for (const step of steps) {
          if (!unpositionedSet.has(step.id)) continue;
          for (const t of step.transitions) {
            if (t.goto_step_id && unpositionedSet.has(t.goto_step_id)) {
              g.setEdge(step.id, t.goto_step_id);
            }
          }
          const fb = step.fallback;
          if (
            fb?.mode === "goto" &&
            fb.goto_step_id &&
            unpositionedSet.has(fb.goto_step_id)
          ) {
            g.setEdge(step.id, fb.goto_step_id);
          }
        }

        dagre.layout(g);

        for (const node of needsLayout) {
          const dnode = g.node(node.id);
          if (!dnode) continue;
          const w = (node.width as number | undefined) ?? DEFAULT_NODE_WIDTH;
          const h = (node.height as number | undefined) ?? DEFAULT_NODE_HEIGHT;
          // dagre devolve coordenadas do CENTRO; React Flow usa canto superior esquerdo.
          positioned.set(node.id, { x: dnode.x - w / 2, y: dnode.y - h / 2 });
        }
      }

      // R10.2: posicionamento dos Nós_Terminais em coluna fixa à direita.
      const terminalPositions = new Map<string, StepLayout>();
      if (terminalNodes.length > 0) {
        let maxX = -Infinity;
        let minY = Infinity;
        for (const layout of positioned.values()) {
          if (layout.x > maxX) maxX = layout.x;
          if (layout.y < minY) minY = layout.y;
        }
        if (!Number.isFinite(maxX)) maxX = 0;
        if (!Number.isFinite(minY)) minY = 0;

        // Ordem estável dos terminais conforme a ordem canônica do glossário
        // (R3.2): cadastro → humano → repeat. Filtramos por `terminalsUsed`
        // E pelo conjunto realmente recebido em `nodes` para tolerar
        // dessincronizações momentâneas com `useDiagramData`.
        const terminalIds = new Set(terminalNodes.map((n) => n.id));
        const ordered = VALID_GOTO_SPECIAL.filter(
          (kind) => terminalsUsed.has(kind) && terminalIds.has(`terminal-${kind}`),
        );
        // Fallback para qualquer terminal id presente nos `nodes` mas ausente do
        // conjunto `terminalsUsed` (ex.: nodes injetados em testes).
        const orderedFinal: GotoSpecial[] = [
          ...ordered,
          ...VALID_GOTO_SPECIAL.filter(
            (kind) => terminalIds.has(`terminal-${kind}`) && !ordered.includes(kind),
          ),
        ];
        orderedFinal.forEach((kind, idx) => {
          terminalPositions.set(`terminal-${kind}`, {
            x: maxX + TERMINAL_X_OFFSET,
            y: minY + idx * TERMINAL_Y_SPACING,
          });
        });
      }

      // Aplica as posições nos nodes originais preservando todos os outros campos.
      return nodes.map((node) => {
        if (node.type === "terminal") {
          const pos = terminalPositions.get(node.id);
          return pos ? { ...node, position: pos } : node;
        }
        const pos = positioned.get(node.id);
        return pos ? { ...node, position: pos } : node;
      });
    },
    [steps, localLayouts, resolveLayout, terminalsUsed],
  );

  /**
   * Persiste a posição de um único passo. Em falha (R10.13), preserva o estado
   * local, exibe `toast.error` e agenda nova tentativa respeitando o debounce.
   */
  const persistOne = useCallback(
    async (stepId: string, position: StepLayout): Promise<void> => {
      if (unmountedRef.current) return;
      inFlightCountRef.current += 1;
      setSaving(true);
      try {
        const { error } = await supabase
          .from("bot_flow_steps")
          // `layout` é coluna jsonb adicionada via migration desta feature; o
          // tipo gerado em `supabase/types.ts` ainda não a expõe, então usamos
          // cast localizado.
          .update({ layout: position } as never)
          .eq("id", stepId);
        if (error) throw error;
        // Sucesso — limpa indicador de erro persistente (R10.13).
        if (!unmountedRef.current) setSaveError(null);
      } catch (err) {
        if (unmountedRef.current) return;
        // R10.13: estado local permanece inalterado; agenda retry só se não
        // existir um timer mais novo (ou seja, nenhum drag posterior está
        // pendente para este passo). Mantém indicador de erro persistente
        // até a próxima persistência bem-sucedida.
        const msg =
          err instanceof Error
            ? err.message
            : "Não foi possível salvar a posição";
        setSaveError(msg);
        toast.error("Não foi possível salvar a posição. Tentando novamente…");
        if (!timersRef.current.has(stepId)) {
          pendingPositionsRef.current.set(stepId, position);
          const t = setTimeout(() => {
            timersRef.current.delete(stepId);
            const pending = pendingPositionsRef.current.get(stepId);
            if (!pending) return;
            pendingPositionsRef.current.delete(stepId);
            void persistOne(stepId, pending);
          }, DEBOUNCE_MS);
          timersRef.current.set(stepId, t);
        }
      } finally {
        inFlightCountRef.current = Math.max(0, inFlightCountRef.current - 1);
        if (inFlightCountRef.current === 0) setSaving(false);
      }
    },
    [],
  );

  const saveNodePosition = useCallback(
    (stepId: string, position: StepLayout): void => {
      if (!isValidLayout(position)) return;

      // Atualização otimista: a UI continua mostrando a posição arrastada.
      setLocalLayouts((prev) => {
        const next = new Map(prev);
        next.set(stepId, position);
        return next;
      });

      // Coalesce por `stepId`: cancela timer pendente, atualiza pending, reagenda.
      const existing = timersRef.current.get(stepId);
      if (existing) clearTimeout(existing);
      pendingPositionsRef.current.set(stepId, position);
      const t = setTimeout(() => {
        timersRef.current.delete(stepId);
        const pending = pendingPositionsRef.current.get(stepId);
        if (!pending) return;
        pendingPositionsRef.current.delete(stepId);
        void persistOne(stepId, pending);
      }, DEBOUNCE_MS);
      timersRef.current.set(stepId, t);
    },
    [persistOne],
  );

  const autoLayoutAll = useCallback(async (): Promise<void> => {
    if (!flowId) return;

    const ok = await confirm({
      title: "Reorganizar diagrama automaticamente?",
      description:
        "As posições manuais dos passos desta variante serão descartadas e o canvas será reorganizado pelo algoritmo automático.",
      confirmText: "Reorganizar",
      cancelText: "Cancelar",
      tone: "info",
    });
    if (!ok) return;

    // Snapshot do estado anterior para rollback em caso de falha (R10.10).
    const overridesSnapshot = new Map(localLayouts);

    // Limpeza otimista: força dagre para todos os passos da Variante atual
    // através do override local, sem depender de reload das props.
    setLocalLayouts(() => {
      const next = new Map<string, StepLayoutOrNull>();
      for (const s of steps) next.set(s.id, null);
      return next;
    });

    inFlightCountRef.current += 1;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("bot_flow_steps")
        // Transação única: limpa `layout` para todos os passos do flow.
        .update({ layout: null } as never)
        .eq("flow_id", flowId);
      if (error) throw error;
      // Em sucesso, mantemos os overrides em `null` enquanto o consumidor
      // recarrega `steps` do banco. Após o reload, `step.layout` virá
      // como `null` e o `resolveLayout` cairá em dagre naturalmente; nessa
      // hora limpamos os overrides para evitar que persistam após reloads
      // futuros que possam trazer layouts vindos de outros consultores em
      // sessões paralelas (R10.10).
      try {
        await onAfterAutoLayout?.();
      } catch (reloadErr) {
        // Reload falhou — não é crítico; o canvas continua funcional via
        // overrides locais. O consumidor já exibiu seu próprio toast em
        // `reload()` se necessário.
        if (typeof console !== "undefined") {
          console.warn("[useDiagramLayout] onAfterAutoLayout failed", reloadErr);
        }
      }
      // Limpa overrides após o reload (ou após a tentativa de reload).
      // Se o consumidor não fornecer `onAfterAutoLayout`, mantemos os
      // overrides em `null` para forçar dagre — comportamento prévio.
      if (onAfterAutoLayout && !unmountedRef.current) {
        setLocalLayouts(new Map());
      }
    } catch (err) {
      // R10.10: restaura snapshot + toast.error.
      setLocalLayouts(overridesSnapshot);
      toast.error("Não foi possível reorganizar o diagrama. Tente novamente.");
    } finally {
      inFlightCountRef.current = Math.max(0, inFlightCountRef.current - 1);
      if (inFlightCountRef.current === 0) setSaving(false);
    }
  }, [confirm, flowId, localLayouts, steps, onAfterAutoLayout]);

  return useMemo(
    () => ({ layoutNodes, saveNodePosition, autoLayoutAll, saving, saveError }),
    [layoutNodes, saveNodePosition, autoLayoutAll, saving, saveError],
  );
}
