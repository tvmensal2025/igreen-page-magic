import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { loadCadenceGaps, type CadenceGap } from "@/lib/cadenceReadiness";

type Props = {
  className?: string;
  /** Recarrega a cada N ms (padrão 60s). */
  refreshMs?: number;
};

function goFix(gap: CadenceGap) {
  try {
    sessionStorage.setItem("igreen-voz-subtab", "textos");
    if (gap.cadenceKey) {
      sessionStorage.setItem("igreen-multichannel-focus-key", gap.cadenceKey);
    }
  } catch { /* noop */ }
  window.dispatchEvent(new CustomEvent("igreen-admin-nav", { detail: { tab: "voz" } }));
  window.dispatchEvent(new CustomEvent("igreen-voz-subtab", { detail: { sub: "textos" } }));
  if (gap.cadenceKey) {
    window.dispatchEvent(
      new CustomEvent("igreen-multichannel-focus", { detail: { key: gap.cadenceKey } }),
    );
  }
}

/**
 * Aviso piscante na frente: aparece só se faltar áudio de ligação,
 * texto de SMS ou estágio OFF com toggle ON.
 */
export function CadenceMissingAlert({ className, refreshMs = 60_000 }: Props) {
  const [gaps, setGaps] = useState<CadenceGap[]>([]);
  const [open, setOpen] = useState(true);
  const [dismissed, setDismissed] = useState(false);

  const reload = useCallback(async () => {
    try {
      const next = await loadCadenceGaps();
      setGaps(next);
      if (next.length > 0) setDismissed(false);
    } catch {
      /* noop */
    }
  }, []);

  useEffect(() => {
    void reload();
    const t = setInterval(() => void reload(), refreshMs);
    return () => clearInterval(t);
  }, [reload, refreshMs]);

  if (dismissed || gaps.length === 0) return null;

  const high = gaps.filter((g) => g.severity === "high").length;
  const headline =
    high > 0
      ? `${high} item(ns) crítico(s) faltando`
      : `${gaps.length} ajuste(s) pendente(s)`;

  return (
    <div
      role="alert"
      className={cn(
        "cadence-missing-blink rounded-lg border-2 border-amber-500/80 bg-amber-500/15 px-3 py-2.5 shadow-sm",
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 animate-pulse" />
        <div className="min-w-0 flex-1">
          <button
            type="button"
            className="flex w-full items-center gap-1.5 text-left"
            onClick={() => setOpen((v) => !v)}
          >
            <span className="text-sm font-bold text-amber-900 dark:text-amber-100">
              Atenção — {headline}
            </span>
            {open ? (
              <ChevronUp className="h-3.5 w-3.5 text-amber-700/80" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 text-amber-700/80" />
            )}
          </button>
          <p className="mt-0.5 text-[11px] text-amber-900/80 dark:text-amber-100/80">
            Sem isso, ligação ou SMS podem não sair. Clique no item para abrir o toque certo e corrigir.
          </p>
          {open && (
            <ul className="mt-2 space-y-1.5">
              {gaps.map((g) => (
                <li key={g.id}>
                  <button
                    type="button"
                    className={cn(
                      "w-full rounded-md border px-2 py-1.5 text-left text-[11px] transition-colors",
                      g.severity === "high"
                        ? "border-destructive/40 bg-destructive/10 hover:bg-destructive/15"
                        : "border-amber-500/40 bg-background/60 hover:bg-background/90",
                    )}
                    onClick={() => goFix(g)}
                  >
                    <span className="font-semibold text-foreground">{g.title}</span>
                    <span className="mt-0.5 block text-muted-foreground">{g.detail}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7 shrink-0 text-amber-800/70 hover:text-amber-900"
          title="Dispensar até o próximo reload"
          onClick={() => setDismissed(true)}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
