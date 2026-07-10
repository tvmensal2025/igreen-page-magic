import { useCallback, useEffect, useRef, useState } from "react";
import { GripVertical, GripHorizontal } from "lucide-react";
import { useLayoutLock } from "@/hooks/useLayoutLock";
import { cn } from "@/lib/utils";

type Props = {
  /** Unique key per resizer — persists size in localStorage. */
  storageKey: string;
  /** CSS variable name (without --) updated on the nearest ancestor with `data-resize-scope`. */
  cssVar: string;
  /** Initial pixel size (also fallback). */
  defaultPx: number;
  /** Min/max pixel sizes. */
  minPx?: number;
  maxPx?: number;
  /** "x" = horizontal handle that resizes width (left/right column). "y" = vertical handle that resizes height. */
  axis?: "x" | "y";
  /** When true, drag grows the value; when false, drag shrinks (use false for right-side columns where dragging left grows the column). */
  invert?: boolean;
  className?: string;
};

const STORAGE = "igreen:dragsize:";

/**
 * Tiny drag handle that resizes a CSS variable on the nearest `[data-resize-scope]` ancestor.
 * Globally disabled when the layout lock is ON.
 *
 * Usage:
 *  <div data-resize-scope style={{ "--sidebar-w": "16rem" }}>
 *    <aside className="w-[var(--sidebar-w)]">…</aside>
 *    <DragResizer storageKey="whatsapp-sidebar" cssVar="sidebar-w" defaultPx={256} minPx={200} maxPx={520} />
 *    <main>…</main>
 *  </div>
 */
export function DragResizer({
  storageKey,
  cssVar,
  defaultPx,
  minPx = 160,
  maxPx = 720,
  axis = "x",
  invert = false,
  className,
}: Props) {
  const { locked } = useLayoutLock();
  const ref = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const startRef = useRef<{ pos: number; size: number } | null>(null);

  // Apply persisted size on mount + when key changes.
  useEffect(() => {
    let px = defaultPx;
    try {
      const raw = localStorage.getItem(STORAGE + storageKey);
      if (raw) {
        const n = parseFloat(raw);
        if (Number.isFinite(n)) px = Math.max(minPx, Math.min(maxPx, n));
      }
    } catch {}
    const scope = ref.current?.closest("[data-resize-scope]") as HTMLElement | null;
    if (scope) scope.style.setProperty(`--${cssVar}`, `${px}px`);
  }, [storageKey, cssVar, defaultPx, minPx, maxPx]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (locked) return;
      e.preventDefault();
      const scope = ref.current?.closest("[data-resize-scope]") as HTMLElement | null;
      if (!scope) return;
      const cur = parseFloat(getComputedStyle(scope).getPropertyValue(`--${cssVar}`)) || defaultPx;
      startRef.current = { pos: axis === "x" ? e.clientX : e.clientY, size: cur };
      setDragging(true);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [locked, cssVar, defaultPx, axis],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging || !startRef.current) return;
      const scope = ref.current?.closest("[data-resize-scope]") as HTMLElement | null;
      if (!scope) return;
      const delta = (axis === "x" ? e.clientX : e.clientY) - startRef.current.pos;
      const signed = invert ? -delta : delta;
      const next = Math.max(minPx, Math.min(maxPx, startRef.current.size + signed));
      scope.style.setProperty(`--${cssVar}`, `${next}px`);
    },
    [dragging, axis, invert, minPx, maxPx, cssVar],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging) return;
      setDragging(false);
      startRef.current = null;
      try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
      const scope = ref.current?.closest("[data-resize-scope]") as HTMLElement | null;
      if (scope) {
        const cur = parseFloat(getComputedStyle(scope).getPropertyValue(`--${cssVar}`));
        if (Number.isFinite(cur)) {
          try { localStorage.setItem(STORAGE + storageKey, String(cur)); } catch {}
        }
      }
    },
    [dragging, cssVar, storageKey],
  );

  const onDoubleClick = useCallback(() => {
    if (locked) return;
    const scope = ref.current?.closest("[data-resize-scope]") as HTMLElement | null;
    if (!scope) return;
    scope.style.setProperty(`--${cssVar}`, `${defaultPx}px`);
    try { localStorage.removeItem(STORAGE + storageKey); } catch {}
  }, [locked, cssVar, defaultPx, storageKey]);

  const isX = axis === "x";
  const Grip = isX ? GripVertical : GripHorizontal;

  return (
    <div
      ref={ref}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      data-dragging={dragging || undefined}
      className={cn(
        "group relative hidden md:flex items-center justify-center transition-all shrink-0 z-20 touch-none select-none",
        isX ? "w-1.5 self-stretch" : "h-1.5 self-stretch w-full",
        locked
          ? "pointer-events-none opacity-0"
          : isX
            ? "cursor-col-resize bg-primary/25 hover:bg-primary/70"
            : "cursor-row-resize bg-primary/25 hover:bg-primary/70",
        dragging && "bg-primary/80",
        className,
      )}
      title="Arraste para redimensionar"
      aria-label="Redimensionar coluna"
      role="separator"
      aria-orientation={isX ? "vertical" : "horizontal"}
    >
      {!locked && (
        <div
          className={cn(
            "z-10 flex items-center justify-center rounded-md border border-primary/40 bg-card text-primary shadow-md opacity-0 group-hover:opacity-100 transition-opacity",
            isX ? "h-8 w-3" : "h-3 w-8",
            dragging && "opacity-100",
          )}
        >
          <Grip className="h-3 w-3" />
        </div>
      )}
    </div>
  );
}
