import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Trophy, Loader2, AlertCircle } from "lucide-react";
import { toast as sonnerToast } from "sonner";
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
  variant?: "A" | "B" | "C" | "D" | "E";
  missing: string[];
  isComplete: boolean;
  allStepsSent: boolean;
  pendingStepsCount: number;
  botPaused?: boolean;
  captureMode?: string | null;
}

export function FinalizeButton({
  consultantId,
  customerId,
  missing,
  isComplete,
  allStepsSent,
  pendingStepsCount,
  botPaused,
  captureMode,
}: Props) {
  const [sending, setSending] = useState(false);
  const [askNotice, setAskNotice] = useState(false);
  const ready = isComplete && allStepsSent;

  const blockers: string[] = [...missing];
  if (!allStepsSent) blockers.push(`${pendingStepsCount} passo(s) do fluxo`);

  const isManual = (captureMode || "manual") === "manual";
  const shouldAsk = isManual && !!botPaused;

  const runFinalize = async (sendNotice: boolean) => {
    if (sending) return;
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("finalize-capture", {
        body: { customerId, consultantId, sendNotice },
      });
      if (error) throw new Error(error.message || "Falha ao finalizar");
      const res = (data as any) || {};
      if (res.error) {
        const msg =
          res.error === "incomplete"
            ? `Faltam dados: ${(res.missing || []).join(", ")}`
            : String(res.error);
        throw new Error(msg);
      }
      if (res.already) {
        sonnerToast.info("Lead já está em processamento no portal.");
      } else if (res.mode === "queued_offline") {
        sonnerToast.warning(
          "Portal momentaneamente offline. Reprocessamos automaticamente em poucos minutos.",
        );
      } else {
        sonnerToast.success(
          sendNotice
            ? "🏆 Cadastro enviado ao portal! Cliente avisado no WhatsApp."
            : "🏆 Cadastro enviado ao portal! (sem aviso ao cliente)",
        );
      }
    } catch (e: any) {
      sonnerToast.error(e?.message || "Falha ao finalizar");
    } finally {
      setSending(false);
    }
  };

  const handleClick = () => {
    if (sending) return;
    if (shouldAsk) {
      setAskNotice(true);
      return;
    }
    void runFinalize(true);
  };

  return (
    <div
      className="sticky bottom-0 left-0 right-0 border-t border-border/60 bg-card/80 backdrop-blur-md px-3 py-1.5 z-10"
      style={{ paddingBottom: "calc(0.375rem + env(safe-area-inset-bottom, 0px))" }}
    >
      {!ready && blockers.length > 0 && (
        <div className="flex items-start gap-1.5 text-[10px] text-amber-400 mb-1.5">
          <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
          <p className="leading-tight truncate">
            <span className="font-bold">Falta: </span>
            {blockers.slice(0, 3).join(", ")}
            {blockers.length > 3 ? ` +${blockers.length - 3}` : ""}
          </p>
        </div>
      )}
      <Button
        onClick={handleClick}
        disabled={sending}
        className="w-full h-9 font-black uppercase tracking-wide bg-gradient-to-r from-emerald-500 to-lime-500 hover:from-emerald-400 hover:to-lime-400 text-black shadow-[0_0_24px_hsl(var(--primary)/0.5)]"
      >
        {sending ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <>
            <Trophy className="w-4 h-4 mr-2" />
            {ready ? "Finalizar Cadastro 🚀" : "Cadastrar mesmo assim"}
          </>
        )}
      </Button>

      <AlertDialog open={askNotice} onOpenChange={setAskNotice}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Avisar o cliente no WhatsApp?</AlertDialogTitle>
            <AlertDialogDescription>
              O bot está desligado para este lead. Deseja enviar a mensagem
              "Estamos enviando seu cadastro ao portal" agora? Você pode cadastrar
              sem enviar nada também.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setAskNotice(false);
                void runFinalize(false);
              }}
              className="bg-secondary text-secondary-foreground hover:bg-secondary/80"
            >
              Cadastrar sem avisar
            </AlertDialogAction>
            <AlertDialogAction
              onClick={() => {
                setAskNotice(false);
                void runFinalize(true);
              }}
            >
              Enviar mensagem e cadastrar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
