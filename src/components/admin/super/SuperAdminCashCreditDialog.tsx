import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { HandCoins, Loader2 } from "lucide-react";
import { toast } from "@/components/ui/sonner";

/**
 * Super Admin credita saldo manual diretamente na carteira do consultor.
 * Usado quando o consultor paga em dinheiro/PIX fora do Stripe.
 */
export function SuperAdminCashCreditDialog({
  consultantId,
  consultantName,
  trigger,
  onCredited,
}: {
  consultantId: string;
  consultantName: string;
  trigger?: React.ReactNode;
  onCredited?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("100");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit() {
    const cents = Math.round(Number(amount || 0) * 100);
    if (cents < 100) {
      toast.error("Valor mínimo: R$ 1,00");
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("wallet-manual-credit", {
        body: { consultant_id: consultantId, amount_cents: cents, note, action: "approve" },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`R$ ${(cents/100).toFixed(2)} creditado para ${consultantName}`);
      setOpen(false);
      setNote("");
      onCredited?.();
    } catch (e) {
      toast.error("Erro: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm" className="gap-1.5 text-xs">
            <HandCoins className="w-3.5 h-3.5" /> Crédito em dinheiro
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Creditar saldo manualmente</DialogTitle>
          <DialogDescription>
            Para <strong>{consultantName}</strong>. Usa quando o pagamento foi feito em dinheiro/PIX direto.
            Dívida pendente é quitada primeiro.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Valor recebido (R$)</Label>
            <Input type="number" min={1} step={10} value={amount} onChange={(e) => setAmount(e.target.value)} disabled={loading} />
            <div className="flex gap-1.5 mt-2">
              {[50, 100, 200, 500].map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setAmount(String(v))}
                  className="h-7 px-2.5 rounded-md text-xs border border-border/60 hover:border-primary/40"
                  disabled={loading}
                >R$ {v}</button>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-xs">Observação (opcional)</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} disabled={loading} rows={2} placeholder="Ex: PIX recebido em 20/06" />
          </div>
          <Button onClick={submit} disabled={loading} className="w-full">
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Confirmar crédito de R$ {Number(amount || 0).toFixed(2)}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
