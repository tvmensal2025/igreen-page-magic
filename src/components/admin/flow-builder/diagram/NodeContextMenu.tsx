/**
 * `NodeContextMenu` — Menu de contexto disparado por clique direito sobre um
 * `FlowDiagramNode` no Modo_Diagrama (R5.3).
 *
 * Itens (ordem fixa):
 * 1. **Editar** — abre o `StepInspector` para o passo (mesma rotina do `onEdit`
 *    do Modo_Lista).
 * 2. **Duplicar** — chama `onDuplicate` (mesma rotina do Modo_Lista).
 * 3. **Ativar/Desativar** — alterna `step.is_active` via `onToggleActive`.
 * 4. **Remover** — exibe o **mesmo** `useConfirm` usado pelo Modo_Lista em
 *    `FluxoBuilder.deleteStep` (mesmo título, descrição, texto de botão e
 *    tom — R5.4) e, em caso de confirmação, chama `onDelete`.
 *
 * Comportamento de fechamento:
 * - `Esc` global enquanto o menu estiver aberto.
 * - Click fora (qualquer `mousedown` em elemento que não esteja contido no
 *   container do menu).
 * - O `FlowDiagram` é responsável por chamar `onClose` em `onPaneClick`
 *   conforme R6.5.
 *
 * Acessibilidade:
 * - `role="menu"` no container e `role="menuitem"` em cada item.
 * - `aria-label` em pt-BR no container.
 * - Foco automático no primeiro item ao abrir.
 * - Setas (`ArrowDown`/`ArrowUp`) navegam entre itens; `Tab`/`Shift+Tab` e
 *   `Enter` ativam o item focado (R14.7).
 *
 * Mapeia para: R5.3, R5.4.
 */

import {
  forwardRef,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { Copy, Pencil, Power, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { useConfirm } from "@/components/ui/confirm-dialog";
import type { Step } from "@/components/admin/flow-builder/flowTypes";

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

/**
 * Estado de posicionamento e contexto do menu. Quando `null`, o menu não é
 * renderizado. O `FlowDiagram` mantém esse estado e o atualiza no
 * `onNodeContextMenu`.
 */
export type NodeContextMenuState = {
  /** Coordenada X em pixels relativa à viewport (clientX). */
  x: number;
  /** Coordenada Y em pixels relativa à viewport (clientY). */
  y: number;
  /** Id do passo (`bot_flow_steps.id`) sob o cursor no momento do clique. */
  stepId: string;
};

export interface NodeContextMenuProps {
  /** Posição e step atual; renderização é controlada por presence do estado. */
  state: NodeContextMenuState;
  /** Passo correspondente ao `state.stepId`, usado para o rótulo "Ativar/Desativar". */
  step: Step;
  /** Fecha o menu (clique fora, Esc, após executar item). */
  onClose: () => void;
  /** Abre o Inspector para edição (paridade com `StepCard.onEdit`). */
  onEdit: (stepId: string) => void;
  /** Duplica o passo (paridade com `StepCard.onDuplicate`). */
  onDuplicate: (stepId: string) => void | Promise<void>;
  /** Alterna o `is_active` do passo. Recebe o novo valor desejado. */
  onToggleActive: (stepId: string, nextActive: boolean) => void | Promise<void>;
  /** Remove o passo (mesma rotina do Modo_Lista após confirmação). */
  onDelete: (stepId: string) => void | Promise<void>;
}

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/**
 * Strings do confirm de remoção. Devem permanecer **idênticas** às usadas em
 * `FluxoBuilder.deleteStep` para satisfazer R5.4 (mesmo título, descrição,
 * confirmText e tom).
 */
const DELETE_CONFIRM = {
  title: "Remover este passo?",
  description: "As regras que apontavam para ele serão limpas.",
  confirmText: "Remover",
  tone: "danger" as const,
};

/** Largura mínima do menu — comporta os 4 itens sem quebra. */
const MENU_MIN_WIDTH = 200;

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function NodeContextMenu({
  state,
  step,
  onClose,
  onEdit,
  onDuplicate,
  onToggleActive,
  onDelete,
}: NodeContextMenuProps) {
  const confirm = useConfirm();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Cada render zera o slice antes de o callback registerItemRef preencher os
  // 4 slots — garante consistência mesmo se a ordem dos itens mudar.
  itemRefs.current = [];
  const registerItemRef = useCallback(
    (idx: number) => (el: HTMLButtonElement | null) => {
      itemRefs.current[idx] = el;
    },
    [],
  );

  // ---------------------------------------------------------------------
  // Efeitos: foco inicial, listener de Esc e click-outside
  // ---------------------------------------------------------------------

  useEffect(() => {
    // R14.7 — abre com o primeiro item focado para suporte imediato a teclado.
    const first = itemRefs.current[0];
    if (first) {
      first.focus();
    }
  }, [state.stepId]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }

    function handleMouseDown(e: MouseEvent) {
      const target = e.target as Node | null;
      if (!target) return;
      const container = containerRef.current;
      if (container && !container.contains(target)) {
        onClose();
      }
    }

    // `keydown` em window cobre Esc mesmo quando o foco saiu do menu.
    window.addEventListener("keydown", handleKeyDown);
    // `mousedown` (não `click`) garante fechamento antes de ações em outros
    // elementos da página, evitando duplo-handling.
    document.addEventListener("mousedown", handleMouseDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleMouseDown);
    };
  }, [onClose]);

  // ---------------------------------------------------------------------
  // Posicionamento — clamp na viewport para evitar overflow
  // ---------------------------------------------------------------------

  const positionStyle = useMemo<React.CSSProperties>(() => {
    if (typeof window === "undefined") {
      return { left: state.x, top: state.y };
    }
    const padding = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Estimativa conservadora de 4 itens × ~36px + paddings.
    const estimatedHeight = 168;
    const left = Math.min(state.x, Math.max(padding, vw - MENU_MIN_WIDTH - padding));
    const top = Math.min(state.y, Math.max(padding, vh - estimatedHeight - padding));
    return { left, top };
  }, [state.x, state.y]);

  // ---------------------------------------------------------------------
  // Navegação por teclado entre itens (Setas)
  // ---------------------------------------------------------------------

  const moveFocus = useCallback((delta: 1 | -1) => {
    const items = itemRefs.current.filter(
      (el): el is HTMLButtonElement => el !== null && !el.disabled,
    );
    if (items.length === 0) return;
    const active = document.activeElement;
    const currentIdx = items.findIndex((el) => el === active);
    const nextIdx = (currentIdx + delta + items.length) % items.length;
    items[nextIdx]?.focus();
  }, []);

  const handleContainerKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        moveFocus(1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        moveFocus(-1);
      }
    },
    [moveFocus],
  );

  // ---------------------------------------------------------------------
  // Handlers dos itens
  // ---------------------------------------------------------------------

  const stopPropagation = useCallback(
    (e: ReactMouseEvent<HTMLButtonElement>) => {
      // Evita que o `onPaneClick` do React Flow / o listener de mousedown
      // global re-fechem o menu antes de o clique ser processado.
      e.stopPropagation();
    },
    [],
  );

  const handleEdit = useCallback(() => {
    onEdit(state.stepId);
    onClose();
  }, [onClose, onEdit, state.stepId]);

  const handleDuplicate = useCallback(() => {
    void onDuplicate(state.stepId);
    onClose();
  }, [onClose, onDuplicate, state.stepId]);

  const handleToggleActive = useCallback(() => {
    void onToggleActive(state.stepId, !step.is_active);
    onClose();
  }, [onClose, onToggleActive, state.stepId, step.is_active]);

  const handleDelete = useCallback(async () => {
    // R5.4 — mesmo confirm do Modo_Lista (FluxoBuilder.deleteStep).
    const ok = await confirm(DELETE_CONFIRM);
    if (!ok) {
      onClose();
      return;
    }
    await onDelete(state.stepId);
    onClose();
  }, [confirm, onClose, onDelete, state.stepId]);

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------

  const toggleActiveLabel = step.is_active ? "Desativar" : "Ativar";

  return (
    <div
      ref={containerRef}
      role="menu"
      aria-label="Ações do passo"
      onKeyDown={handleContainerKeyDown}
      // `position: fixed` para coordenadas em viewport (clientX/clientY);
      // o menu vive fora do fluxo do canvas e ignora seu zoom/pan.
      style={{ position: "fixed", ...positionStyle, minWidth: MENU_MIN_WIDTH }}
      className={cn(
        "z-[200] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md",
        "animate-in fade-in-0 zoom-in-95",
      )}
    >
      <MenuItem
        ref={registerItemRef(0)}
        icon={<Pencil className="h-3.5 w-3.5" aria-hidden="true" />}
        label="Editar"
        ariaLabel="Editar passo"
        onClick={handleEdit}
        onMouseDown={stopPropagation}
      />
      <MenuItem
        ref={registerItemRef(1)}
        icon={<Copy className="h-3.5 w-3.5" aria-hidden="true" />}
        label="Duplicar"
        ariaLabel="Duplicar passo"
        onClick={handleDuplicate}
        onMouseDown={stopPropagation}
      />
      <MenuItem
        ref={registerItemRef(2)}
        icon={<Power className="h-3.5 w-3.5" aria-hidden="true" />}
        label={toggleActiveLabel}
        ariaLabel={`${toggleActiveLabel} passo`}
        onClick={handleToggleActive}
        onMouseDown={stopPropagation}
      />
      <MenuItem
        ref={registerItemRef(3)}
        icon={<Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
        label="Remover"
        ariaLabel="Remover passo"
        destructive
        onClick={handleDelete}
        onMouseDown={stopPropagation}
      />
    </div>
  );
}

export default NodeContextMenu;

// ---------------------------------------------------------------------------
// Subcomponente: item do menu
// ---------------------------------------------------------------------------

type MenuItemProps = {
  icon: React.ReactNode;
  label: string;
  ariaLabel: string;
  destructive?: boolean;
  onClick: () => void;
  onMouseDown?: (e: ReactMouseEvent<HTMLButtonElement>) => void;
};

const MenuItem = forwardRef<HTMLButtonElement, MenuItemProps>(function MenuItem(
  { icon, label, ariaLabel, destructive, onClick, onMouseDown },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      role="menuitem"
      aria-label={ariaLabel}
      onClick={onClick}
      onMouseDown={onMouseDown}
      className={cn(
        "flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm",
        "outline-none transition-colors",
        "hover:bg-accent hover:text-accent-foreground",
        "focus-visible:bg-accent focus-visible:text-accent-foreground",
        destructive && "text-destructive hover:bg-destructive/10 focus-visible:bg-destructive/10",
      )}
    >
      <span className="shrink-0">{icon}</span>
      <span className="flex-1 text-left">{label}</span>
    </button>
  );
});
