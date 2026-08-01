import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Gift, Loader2, AlertCircle, FlaskConical } from "lucide-react";
import { toast as sonnerToast } from "@/components/ui/sonner";
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

interface Props {
  consultantId: string;
  customerId: string;
  missing: string[];
  isComplete: boolean;
  /** Se true, envia dryRun:false (cadastro real). Default false = dry-run seguro. */
  allowLive?: boolean;
}

export function ClubSubmitButton({
  customerId,
  missing,
  isComplete,
  allowLive = false,
}: Props) {
  const [sending, setSending] = useState(false);
  const [askLive, setAskLive] = useState(false);

  const runSubmit = async (dryRun: boolean) => {
    if (sending) return;
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("finalize-club", {
        body: { customerId, dryRun },
      });
      if (error) throw new Error(error.message || "Falha ao cadastrar no Club");
      const res = (data as Record<string, unknown>) || {};
      if (res.error) {
        const msg =
          res.error === "incomplete"
            ? `Faltam dados: ${((res.missing as string[]) || []).join(", ")}`
            : String(res.error);
        throw new Error(msg);
      }
      if (res.already) {
        sonnerToast.info("Cliente já cadastrado no iGreen Club.");
        return;
      }
      if (dryRun) {
        sonnerToast.success("Dry-run Club OK — nenhum cadastro real foi feito.");
      } else {
        const idcliente =
          (res.result as { result?: { response?: { idcliente?: number } } } | undefined)
            ?.result?.response?.idcliente ??
          (res.result as { response?: { idcliente?: number } } | undefined)?.response?.idcliente;
        sonnerToast.success(
          idcliente
            ? `Cadastrado no iGreen Club! idcliente ${idcliente}`
            : "Cadastro enviado ao iGreen Club!",
        );
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Falha ao cadastrar no Club";
      sonnerToast.error(msg);
    } finally {
      setSending(false);
    }
  };

  const handleClick = () => {
    if (sending) return;
    if (allowLive) {
      setAskLive(true);
      return;
    }
    void runSubmit(true);
  };

  return (
    <div
      className="sticky bottom-0 left-0 right-0 border-t border-border/60 bg-card/80 backdrop-blur-md px-3 py-1.5 z-10"
      style={{ paddingBottom: "calc(0.375rem + env(safe-area-inset-bottom, 0px))" }}
    >
      {!isComplete && missing.length > 0 && (
        <div className="flex items-start gap-1.5 text-[10px] text-warning mb-1.5">
          <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
          <p className="leading-tight truncate">
            <span className="font-bold">Falta: </span>
            {missing.slice(0, 3).join(", ")}
            {missing.length > 3 ? ` +${missing.length - 3}` : ""}
          </p>
        </div>
      )}
      <div className="flex gap-1.5">
        <Button
          onClick={handleClick}
          disabled={sending}
          className="flex-1 h-9 font-semibold gap-2"
          variant={isComplete ? "default" : "secondary"}
        >
          {sending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <>
              {allowLive ? <Gift className="w-4 h-4" /> : <FlaskConical className="w-4 h-4" />}
              {allowLive
                ? isComplete
                  ? "Cadastrar no Club"
                  : "Enviar mesmo assim"
                : "Simular Club (dry-run)"}
            </>
          )}
        </Button>
      </div>
      {!allowLive && (
        <p className="mt-1 text-[9px] text-muted-foreground leading-tight">
          Cadastro real desligado na UI — use dry-run até liberar live.
        </p>
      )}

      <AlertDialog open={askLive} onOpenChange={setAskLive}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cadastrar de verdade no iGreen Club?</AlertDialogTitle>
            <AlertDialogDescription>
              Isso envia o cliente para a API oficial do Club (não é Portal 2 / energia).
              Você pode só simular (dry-run) sem gravar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setAskLive(false);
                void runSubmit(true);
              }}
              className="bg-secondary text-secondary-foreground hover:bg-secondary/80"
            >
              Só simular
            </AlertDialogAction>
            <AlertDialogAction
              onClick={() => {
                setAskLive(false);
                void runSubmit(false);
              }}
            >
              Cadastrar de verdade
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
