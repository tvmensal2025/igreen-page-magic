import { useEffect, useState } from "react";
import { Lock, Unlock, RotateCcw } from "lucide-react";
import { useLayoutLock } from "@/hooks/useLayoutLock";
import { useResetLayoutSizes } from "@/hooks/useResetLayoutSizes";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/components/ui/confirm-dialog";

const HINT_KEY = "igreen:layout-lock-hint-seen";

export function LayoutLockToggle({ className }: { className?: string }) {
  const { locked, toggle } = useLayoutLock();
  const resetSizes = useResetLayoutSizes();
  const confirm = useConfirm();
  const [pulse, setPulse] = useState(false);

  // Pulso sutil na 1ª visita para sinalizar que o ajuste existe.
  useEffect(() => {
    try {
      if (!localStorage.getItem(HINT_KEY)) {
        setPulse(true);
        const t = setTimeout(() => {
          setPulse(false);
          try { localStorage.setItem(HINT_KEY, "1"); } catch {}
        }, 8000);
        return () => clearTimeout(t);
      }
    } catch {}
  }, []);

  // Atalho global Shift+L para alternar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.shiftKey && (e.key === "L" || e.key === "l") && !(e.target as HTMLElement)?.matches?.("input,textarea,[contenteditable='true']")) {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => { setPulse(false); try { localStorage.setItem(HINT_KEY, "1"); } catch {}; toggle(); }}
        title={locked ? "Layout travado — clique (Shift+L) para liberar o ajuste das colunas" : "Layout liberado — arraste as bordas para redimensionar (Shift+L trava)"}
        aria-label={locked ? "Destravar layout" : "Travar layout"}
        className={cn(
          "relative p-1.5 sm:p-2 rounded-xl transition-all duration-200",
          locked
            ? "text-muted-foreground hover:text-foreground hover:bg-secondary"
            : "text-primary bg-primary/10 hover:bg-primary/20 ring-1 ring-primary/40",
          pulse && locked && "ring-2 ring-primary/60 animate-pulse",
          className,
        )}
      >
        {locked ? <Lock className="h-4 w-4 sm:h-5 sm:w-5" /> : <Unlock className="h-4 w-4 sm:h-5 sm:w-5" />}
      </button>
      {!locked && (
        <button
          type="button"
          onClick={async () => {
            const ok = await confirm({ title: "Resetar tamanhos das colunas?", description: "Volta todas as colunas para o tamanho padrão.", confirmText: "Resetar" });
            if (ok) resetSizes();
          }}
          title="Resetar tamanhos das colunas"
          aria-label="Resetar tamanhos das colunas"
          className="p-1.5 sm:p-2 rounded-xl text-muted-foreground hover:text-primary hover:bg-secondary transition-all"
        >
          <RotateCcw className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

