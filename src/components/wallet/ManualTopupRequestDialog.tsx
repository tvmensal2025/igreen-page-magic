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
 * Botão pro consultor declarar "paguei R$X em dinheiro ao Super Admin".
 * Cria um pedido pendente que o Super Admin aprova/rejeita.
 */
export function ManualTopupRequestDialog() {
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
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Não autenticado");
      const { error } = await supabase.from("wallet_manual_topup_requests").insert({
        consultant_id: user.id,
        amount_cents: cents,
        created_by: user.id,
        created_by_role: "consultant",
        note: note || null,
      });
      if (error) throw error;
      toast.success("Pedido registrado! Aguarde a aprovação do Super Admin.");
      setOpen(false);
      setNote("");
    } catch (e) {
      toast.error("Erro: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="w-full justify-start gap-2 text-xs">
          <HandCoins className="w-3.5 h-3.5" />
          Paguei em dinheiro ao Super Admin
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Registrar pagamento em dinheiro</DialogTitle>
          <DialogDescription>
            Use quando você já entregou o valor em mãos. O Super Admin precisa aprovar antes do saldo entrar.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Valor pago (R$)</Label>
            <Input type="number" min={1} step={10} value={amount} onChange={(e) => setAmount(e.target.value)} disabled={loading} />
          </div>
          <div>
            <Label className="text-xs">Observação (opcional)</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ex: paguei dia 20/06 no escritório"
              disabled={loading}
              rows={2}
            />
          </div>
          <Button onClick={submit} disabled={loading} className="w-full">
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Enviar pedido de aprovação
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
