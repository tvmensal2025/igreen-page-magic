import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Preference = "unificado" | "separado" | null;

interface Props {
  value: Preference;
  saving?: boolean;
  onChange: (next: "unificado" | "separado") => void | Promise<void>;
}

const OPTIONS = [
  {
    id: "unificado" as const,
    title: "Boleto único",
    detail: "Já recebe UM boleto bancário — anexar o comprovante",
  },
  {
    id: "separado" as const,
    title: "Boletos separados",
    detail: "Fatura da distribuidora + iGreen em cobranças distintas",
  },
];

/**
 * Preferência de fatura na ficha (espelha ask_contaunica do bot).
 * Unificado ⇔ contaunica + transferir_titularidade; separado ⇔ ambos false.
 */
export function CaptureBoletoPreference({ value, saving, onChange }: Props) {
  const answered = value !== null;

  return (
    <div
      className={cn(
        "rounded-md border px-2.5 py-2 transition-colors",
        answered
          ? "border-primary/25 bg-primary/[0.04]"
          : "border-border/60 bg-background/40",
      )}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground/80">
            Boleto
          </p>
          <p className="text-[10px] leading-snug text-muted-foreground/70">
            Como o cliente quer receber a cobrança
          </p>
        </div>
        {saving ? (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />
        ) : answered ? (
          <span className="inline-flex shrink-0 items-center gap-0.5 text-[10px] font-medium text-primary">
            <Check className="h-3 w-3" />
            definido
          </span>
        ) : (
          <span className="shrink-0 text-[10px] italic text-muted-foreground/50">obrigatório</span>
        )}
      </div>

      <div
        role="radiogroup"
        aria-label="Preferência de boleto"
        className="grid grid-cols-2 gap-1.5"
      >
        {OPTIONS.map((opt) => {
          const selected = value === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={saving}
              onClick={() => {
                if (!selected) void onChange(opt.id);
              }}
              className={cn(
                "relative rounded-md border px-2 py-2 text-left transition-all",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                "disabled:pointer-events-none disabled:opacity-60",
                selected
                  ? "border-primary/50 bg-primary/10 shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.15)]"
                  : "border-border/50 bg-background/60 hover:border-primary/30 hover:bg-background",
              )}
            >
              <div className="flex items-start justify-between gap-1">
                <span
                  className={cn(
                    "text-[11px] font-semibold leading-tight",
                    selected ? "text-foreground" : "text-foreground/80",
                  )}
                >
                  {opt.title}
                </span>
                <span
                  className={cn(
                    "mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border transition-colors",
                    selected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-muted-foreground/35 bg-transparent",
                  )}
                  aria-hidden
                >
                  {selected && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                </span>
              </div>
              <p
                className={cn(
                  "mt-1 text-[10px] leading-snug",
                  selected ? "text-muted-foreground" : "text-muted-foreground/70",
                )}
              >
                {opt.detail}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Deriva o valor do seletor a partir dos campos do bot/portal. */
export function resolveBoletoPreference(c: {
  contaunica_answered?: boolean | null;
  contaunica?: boolean | null;
} | null | undefined): Preference {
  if (!c || c.contaunica_answered !== true) return null;
  return c.contaunica ? "unificado" : "separado";
}
