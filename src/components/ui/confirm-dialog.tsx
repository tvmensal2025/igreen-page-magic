import { createContext, useCallback, useContext, useState, ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AlertTriangle, HelpCircle, Trash2, Sparkles } from "lucide-react";

type Tone = "default" | "danger" | "success" | "info";

interface ConfirmOptions {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  tone?: Tone;
}

interface InternalState extends ConfirmOptions {
  open: boolean;
  resolve?: (v: boolean) => void;
}

const ConfirmCtx = createContext<((o: ConfirmOptions) => Promise<boolean>) | null>(null);

const toneIcon: Record<Tone, { Icon: typeof AlertTriangle; bg: string; fg: string }> = {
  default: { Icon: HelpCircle, bg: "bg-primary/10", fg: "text-primary" },
  danger: { Icon: Trash2, bg: "bg-destructive/10", fg: "text-destructive" },
  success: { Icon: Sparkles, bg: "bg-primary/10", fg: "text-primary" },
  info: { Icon: AlertTriangle, bg: "bg-warning/10", fg: "text-warning" },
};

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<InternalState>({ open: false, title: "" });

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setState({ ...opts, open: true, resolve });
    });
  }, []);

  const close = (result: boolean) => {
    state.resolve?.(result);
    setState((s) => ({ ...s, open: false }));
  };

  const tone = state.tone ?? "default";
  const { Icon, bg, fg } = toneIcon[tone];

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <AlertDialog open={state.open} onOpenChange={(o) => !o && close(false)}>
        <AlertDialogContent className="border-border/60 bg-card/95 backdrop-blur-xl shadow-2xl">
          <AlertDialogHeader>
            <div className="flex items-start gap-3">
              <div className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ${bg}`}>
                <Icon className={`w-5 h-5 ${fg}`} />
              </div>
              <div className="flex-1 min-w-0">
                <AlertDialogTitle className="text-base font-semibold text-foreground">
                  {state.title}
                </AlertDialogTitle>
                {state.description && (
                  <AlertDialogDescription className="text-sm text-muted-foreground mt-1 leading-relaxed whitespace-pre-line">
                    {state.description}
                  </AlertDialogDescription>
                )}
              </div>
            </div>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-2">
            <AlertDialogCancel onClick={() => close(false)} className="rounded-lg">
              {state.cancelText ?? "Cancelar"}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => close(true)}
              className={`rounded-lg ${
                tone === "danger"
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : "bg-primary text-primary-foreground hover:bg-primary/90"
              }`}
            >
              {state.confirmText ?? "Confirmar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmCtx.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmCtx);
  if (!ctx) throw new Error("useConfirm must be used inside <ConfirmDialogProvider>");
  return ctx;
}
