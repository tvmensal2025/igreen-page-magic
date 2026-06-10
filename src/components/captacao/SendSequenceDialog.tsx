// Single-step dispatcher: envia UM passo de cada vez, aguarda o lead responder
// (via Realtime em conversations) antes de liberar o próximo. Substitui o loop
// antigo que disparava todos os passos em rajada.
import { useState, useRef, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Send, Check, AlertCircle, Clock } from "lucide-react";
import { sendStepWithFeedback } from "@/lib/whatsapp/send";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface SequenceStep {
  step_key: string;
  step_id: string;
  title: string;
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  consultantId: string;
  customerId: string;
  customerName?: string | null;
  steps: SequenceStep[]; // só passos pendentes (em ordem)
  variant?: "A" | "B" | "C" | "D" | "E";
  onStepSent: (stepKey: string) => void;
  onAskName?: () => void;
}

type Phase = "idle" | "sending" | "waiting_inbound" | "ready_next" | "done" | "error";

export function SendSequenceDialog({
  open, onOpenChange, consultantId, customerId, customerName, steps, variant, onStepSent, onAskName,
}: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [idx, setIdx] = useState(0); // índice do PRÓXIMO a enviar
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastErrorCode, setLastErrorCode] = useState<string | null>(null);
  const sentAtRef = useRef<number>(0);
  // Trava síncrona para impedir duplo-clique antes do React atualizar `phase`.
  const inFlightRef = useRef<boolean>(false);

  useEffect(() => {
    if (open) {
      setPhase("idle");
      setIdx(0);
      setLastError(null);
      setLastErrorCode(null);
      sentAtRef.current = 0;
      inFlightRef.current = false;
    }
  }, [open, customerId]);

  // Realtime: quando o lead responde (inbound), libera o próximo passo.
  useEffect(() => {
    if (!open || phase !== "waiting_inbound") return;
    const channel = supabase
      .channel(`seq-inbound-${customerId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "conversations",
          filter: `customer_id=eq.${customerId}`,
        },
        (payload) => {
          const row = payload.new as { message_direction?: string; created_at?: string };
          if (row?.message_direction !== "inbound") return;
          const created = row.created_at ? new Date(row.created_at).getTime() : Date.now();
          if (created < sentAtRef.current) return;
          setPhase("ready_next");
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [open, phase, customerId]);

  const nextStep = steps[idx];

  const sendNext = async (opts?: { force?: boolean }) => {
    if (!nextStep) return;
    // Trava síncrona — evita disparo duplicado se o consultor clicar 2x rápido.
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setPhase("sending");
    setLastError(null);
    setLastErrorCode(null);
    try {
      const res = await sendStepWithFeedback(
        {
          consultantId,
          customerId,
          stepId: nextStep.step_id,
          part: "all",
          continueFlow: false,
          variant,
          force: opts?.force,
        },
        { silent: true },
      );
      if (res.ok) {
        onStepSent(nextStep.step_key);
        sentAtRef.current = Date.now();
        const newIdx = idx + 1;
        setIdx(newIdx);
        if (newIdx >= steps.length) {
          setPhase("done");
          toast.success("Todos os passos enviados!");
        } else {
          setPhase("waiting_inbound");
        }
      } else {
        setLastError(res.message || res.code || "erro");
        setLastErrorCode(res.code || null);
        setPhase("error");
        if (res.code === "name_not_captured_yet") {
          toast.error("Peça o nome do lead primeiro.");
        } else if (res.code === "awaiting_inbound") {
          setPhase("waiting_inbound");
        } else if (res.code === "instance_disconnected" || res.code === "whapi_token_missing") {
          toast.error(res.message || "Whatsapp do consultor com problema");
        }
      }
    } finally {
      inFlightRef.current = false;
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && phase === "sending") return; onOpenChange(o); }}>
      <DialogContent className="max-w-sm p-0">
        <DialogHeader className="p-3 pb-2 border-b border-border">
          <DialogTitle className="text-sm flex items-center gap-2">
            Envio passo-a-passo
            {variant && <Badge variant="outline" className="text-[10px]">Fluxo {variant}</Badge>}
          </DialogTitle>
          <p className="text-[11px] text-muted-foreground truncate">
            Para: <span className="font-semibold">{customerName || "Cliente interessado"}</span> · {idx}/{steps.length} enviados
          </p>
        </DialogHeader>

        <div className="p-3 space-y-3">
          {phase === "done" ? (
            <div className="text-center py-4">
              <Check className="w-8 h-8 text-primary mx-auto mb-2" />
              <p className="text-sm font-semibold">Sequência concluída!</p>
            </div>
          ) : !nextStep ? (
            <p className="text-xs text-muted-foreground text-center py-4">Nenhum passo pendente.</p>
          ) : (
            <>
              <div className="rounded-md border border-border bg-secondary/20 p-2.5">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">
                  Próximo passo
                </p>
                <p className="text-sm font-semibold">{nextStep.title}</p>
              </div>

              {phase === "waiting_inbound" && (
                <div className="rounded-md border border-warning/40 bg-warning/10 p-2.5 flex items-start gap-2">
                  <Clock className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                  <div className="text-xs text-foreground">
                    <p className="font-semibold">Aguardando resposta do cliente interessado…</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Assim que {customerName?.split(" ")[0] || "ele"} responder, libero o próximo passo automaticamente.
                    </p>
                  </div>
                </div>
              )}

              {phase === "error" && lastError && (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 flex items-start gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 text-destructive shrink-0 mt-0.5" />
                  <p className="text-[11px] text-foreground">{lastError}</p>
                </div>
              )}
            </>
          )}
        </div>

        <div className="p-3 border-t border-border flex gap-2">
          {phase === "done" || !nextStep ? (
            <Button size="sm" className="flex-1 h-9" onClick={() => onOpenChange(false)}>
              Fechar
            </Button>
          ) : (
            <>
              <Button variant="outline" size="sm" className="flex-1 h-9" onClick={() => onOpenChange(false)} disabled={phase === "sending"}>
                Fechar
              </Button>

              {phase === "error" && lastErrorCode === "name_not_captured_yet" && onAskName ? (
                <Button size="sm" className="flex-1 h-9 gap-1.5" onClick={() => { onAskName(); onOpenChange(false); }}>
                  Pedir nome
                </Button>
              ) : phase === "waiting_inbound" ? (
                <Button size="sm" variant="secondary" className="flex-1 h-9 gap-1.5" onClick={() => sendNext({ force: true })} title="Enviar mesmo sem o cliente interessado ter respondido">
                  <Send className="w-3.5 h-3.5" /> Forçar envio
                </Button>
              ) : (
                <Button size="sm" className="flex-1 h-9 gap-1.5 font-bold" onClick={() => sendNext()} disabled={phase === "sending"}>
                  {phase === "sending" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  {phase === "sending" ? "Enviando…" : idx === 0 ? "Enviar 1º passo" : "Enviar próximo passo"}
                </Button>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
