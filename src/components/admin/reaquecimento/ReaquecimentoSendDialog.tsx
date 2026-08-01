import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Send, Calendar, AlertCircle } from "lucide-react";
import { toast } from "@/components/ui/sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "single" | "batch";
  consultantId: string;
  customerId: string | null;
  customerIds: string[];
  onSendComplete: () => void;
}

export function ReaquecimentoSendDialog({
  open, onOpenChange, mode, consultantId, customerId, customerIds, onSendComplete,
}: Props) {
  const [message, setMessage] = useState("");
  const [scheduleAt, setScheduleAt] = useState("");
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState<{ sent: number; failed: number; total: number } | null>(null);
  const [customerName, setCustomerName] = useState<string>("");
  const [conversationStep, setConversationStep] = useState<string>("");
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [hasNoTemplate, setHasNoTemplate] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (mode === "single" && customerId) {
      loadSingle(customerId);
    } else if (mode === "batch") {
      // Em lote, não pré-popula nada — backend usa template ativo de cada step
      setMessage("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, customerId, mode]);

  async function loadSingle(id: string) {
    const { data: customer } = await supabase
      .from("customers")
      .select("id, name, phone_whatsapp, conversation_step, electricity_bill_value")
      .eq("id", id)
      .maybeSingle();
    if (!customer) return;
    setCustomerName(customer.name || "Sem nome");
    setConversationStep(customer.conversation_step || "");

    // Busca template ativo pra esse step
    const { data: tpl } = await (supabase as any)
      .from("reactivation_templates")
      .select("id, message_text")
      .eq("consultant_id", consultantId)
      .eq("conversation_step", customer.conversation_step || "")
      .eq("is_active", true)
      .maybeSingle();

    if (tpl) {
      setTemplateId(tpl.id);
      // Pre-render variáveis no preview
      const firstName = String(customer.name || "").trim().split(/\s+/)[0];
      const valor = customer.electricity_bill_value
        ? Number(customer.electricity_bill_value).toLocaleString("pt-BR", { minimumFractionDigits: 2 })
        : "";
      setMessage(
        String(tpl.message_text)
          .split("{{nome}}").join(firstName)
          .split("{{valor_conta}}").join(valor),
      );
      setHasNoTemplate(false);
    } else {
      setTemplateId(null);
      setMessage("");
      setHasNoTemplate(true);
    }
  }

  async function handleSend() {
    setSending(true);
    setProgress(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        toast.error("Sessão expirada — faça login novamente");
        setSending(false);
        return;
      }

      const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL || "";
      const url = `${supabaseUrl}/functions/v1/reactivation-send`;

      const body = mode === "single"
        ? {
            mode: "single",
            customer_id: customerId,
            message_text: message,
            template_id: templateId,
            schedule_at: scheduleAt || null,
          }
        : {
            mode: "batch",
            customer_ids: customerIds,
          };

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (!res.ok) {
        toast.error("Erro: " + (data.error || res.statusText));
        setSending(false);
        return;
      }

      if (mode === "single") {
        if (data.scheduled) {
          toast.success(`Mensagem agendada para ${customerName}`);
        } else if (data.ok) {
          toast.success(`Enviado para ${customerName}`);
        } else {
          toast.error(`Falha ao enviar: ${data.error || "desconhecido"}`);
        }
      } else {
        setProgress({ sent: data.sent, failed: data.failed, total: data.total });
        toast.success(`Lote concluído: ${data.sent} enviados, ${data.failed} falharam`);
      }
      onSendComplete();
      // Fecha após 1.5s pra usuário ver o feedback
      setTimeout(() => onOpenChange(false), 1500);
    } catch (e) {
      toast.error("Erro: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSending(false);
    }
  }

  const charCount = message.length;
  const charsValid = charCount > 0 && charCount <= 4096;
  const minSendTime = new Date(Date.now() + 60_000).toISOString().slice(0, 16);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>
            {mode === "single" ? "Reaquecer lead" : `Reaquecer ${customerIds.length} leads em lote`}
          </DialogTitle>
          <DialogDescription>
            {mode === "single"
              ? `Lead: ${customerName} · passo: ${conversationStep}`
              : `Cada lead receberá o template ativo do seu passo. Intervalo de 2s entre envios.`}
          </DialogDescription>
        </DialogHeader>

        {mode === "single" && (
          <>
            {hasNoTemplate && (
              <div className="flex items-start gap-2 rounded-md bg-warning/10 p-3 text-xs text-warning dark:text-warning">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Não existe template ativo para o passo <code>{conversationStep}</code>.
                  Você pode digitar uma mensagem manualmente abaixo.
                </span>
              </div>
            )}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Mensagem</Label>
                <span className={`text-[10px] ${charsValid ? "text-muted-foreground" : "text-destructive"}`}>
                  {charCount}/4096
                </span>
              </div>
              <Textarea
                rows={5}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Digite a mensagem que será enviada ao cliente interessado…"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="schedule" className="flex items-center gap-2 text-xs">
                <Calendar className="h-3 w-3" />
                Agendar para (opcional)
              </Label>
              <Input
                id="schedule"
                type="datetime-local"
                min={minSendTime}
                value={scheduleAt}
                onChange={(e) => setScheduleAt(e.target.value)}
              />
              <p className="text-[10px] text-muted-foreground">
                Deixe em branco pra enviar agora. Limite: 1 minuto a 90 dias no futuro.
              </p>
            </div>
          </>
        )}

        {mode === "batch" && progress && (
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <p>✅ Enviados: {progress.sent}</p>
            <p>❌ Falharam: {progress.failed}</p>
            <p>📊 Total: {progress.total}</p>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
            Cancelar
          </Button>
          <Button
            onClick={handleSend}
            disabled={sending || (mode === "single" && !charsValid)}
          >
            {sending ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Send className="mr-1 h-3 w-3" />
            )}
            {mode === "single"
              ? scheduleAt ? "Agendar" : "Enviar agora"
              : "Enviar lote"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
