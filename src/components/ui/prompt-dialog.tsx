import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from "react";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Pencil } from "lucide-react";

interface PromptOptions {
  title: string;
  description?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmText?: string;
  cancelText?: string;
  multiline?: boolean;
}

interface InternalState extends PromptOptions {
  open: boolean;
  value: string;
  resolve?: (v: string | null) => void;
}

const PromptCtx = createContext<((o: PromptOptions) => Promise<string | null>) | null>(null);

export function PromptDialogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<InternalState>({ open: false, title: "", value: "" });

  const prompt = useCallback((opts: PromptOptions) => {
    return new Promise<string | null>((resolve) => {
      setState({ ...opts, open: true, value: opts.defaultValue ?? "", resolve });
    });
  }, []);

  const close = (result: string | null) => {
    state.resolve?.(result);
    setState((s) => ({ ...s, open: false }));
  };

  // Reset value when dialog opens
  useEffect(() => {
    if (state.open) {
      // value already set in prompt()
    }
  }, [state.open]);

  return (
    <PromptCtx.Provider value={prompt}>
      {children}
      <AlertDialog open={state.open} onOpenChange={(o) => !o && close(null)}>
        <AlertDialogContent className="border-border/60 bg-card/95 backdrop-blur-xl shadow-2xl">
          <AlertDialogHeader>
            <div className="flex items-start gap-3">
              <div className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center bg-primary/10">
                <Pencil className="w-5 h-5 text-primary" />
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
          <div className="mt-2">
            {state.multiline ? (
              <Textarea
                autoFocus
                value={state.value}
                placeholder={state.placeholder}
                onChange={(e) => setState((s) => ({ ...s, value: e.target.value }))}
                rows={4}
              />
            ) : (
              <Input
                autoFocus
                value={state.value}
                placeholder={state.placeholder}
                onChange={(e) => setState((s) => ({ ...s, value: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    close(state.value);
                  }
                }}
              />
            )}
          </div>
          <AlertDialogFooter className="mt-3">
            <AlertDialogCancel onClick={() => close(null)} className="rounded-lg">
              {state.cancelText ?? "Cancelar"}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => close(state.value)}
              className="rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {state.confirmText ?? "OK"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PromptCtx.Provider>
  );
}

export function usePrompt() {
  const ctx = useContext(PromptCtx);
  if (!ctx) throw new Error("usePrompt must be used inside <PromptDialogProvider>");
  return ctx;
}
