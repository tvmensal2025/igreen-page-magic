import { useState } from "react";
import { useWalletGuard } from "@/hooks/useWalletGuard";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, Wallet, Loader2 } from "lucide-react";
import { toast } from "sonner";

/**
 * Popup obrigatório quando o saldo da carteira de anúncios zera ou tem campanha
 * pausada por falta de saldo. Bloqueia a UI até o consultor:
 *   1. Recarregar (Stripe checkout, valor livre)
 *   2. Encerrar/arquivar as campanhas pausadas
 *   3. "Lembrar em 24h" (snooze) — escritório bloqueado, campanha continua pausada
 *
 * Montado globalmente em App.tsx. Só dispara quando há sessão ativa.
 */
export function RechargeRequiredDialog() {
  const guard = useWalletGuard();
  const [amount, setAmount] = useState<string>("100");
  const [loading, setLoading] = useState(false);

  if (!guard.open || !guard.consultantId) return null;

  const sumDaily = guard.pausedCampaigns.reduce((s, c) => s + (c.daily_budget_cents || 0), 0);
  const suggested = Math.max(5000, sumDaily * 7); // 7 dias do total pausado, mín R$ 50

  async function handleRecharge() {
    const amountCents = Math.round(Number(amount || 0) * 100);
    if (amountCents < 5000) {
      toast.error("Valor mínimo: R$ 50,00");
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("wallet-create-topup", {
        body: { amount_cents: amountCents },
      });
      if (error) throw error;
      if (data?.url) {
        window.location.href = data.url;
      } else {
        throw new Error(data?.error || "Falha ao criar checkout");
      }
    } catch (e) {
      toast.error("Erro: " + (e instanceof Error ? e.message : String(e)));
      setLoading(false);
    }
  }

  async function handleArchiveAll() {
    if (!confirm(`Arquivar ${guard.pausedCampaigns.length} campanha(s) pausada(s)? Isso encerra elas definitivamente.`)) return;
    setLoading(true);
    try {
      const ids = guard.pausedCampaigns.map((c) => c.id);
      const { error } = await supabase
        .from("facebook_campaigns")
        .update({ status: "archived", pause_pending: false })
        .in("id", ids);
      if (error) throw error;
      toast.success("Campanhas arquivadas");
      await guard.refresh();
    } catch (e) {
      toast.error("Erro: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setLoading(false);
    }
  }

  const title = guard.reason === "balance_zero"
    ? "Carteira em débito"
    : "Campanhas pausadas — sem saldo";

  return (
    <Dialog open onOpenChange={(o) => { if (!o) guard.snooze24h(); }}>
      <DialogContent className="max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
            <AlertCircle className="h-6 w-6 text-destructive" />
          </div>
          <DialogTitle className="text-center">{title}</DialogTitle>
          <DialogDescription className="text-center">
            {guard.debtCents > 0
              ? `Sua carteira está com dívida de R$ ${(guard.debtCents/100).toFixed(2)}. Recarregue para reativar.`
              : `${guard.pausedCampaigns.length} campanha(s) foram pausadas automaticamente porque o saldo zerou.`}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border bg-muted/40 p-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1 text-muted-foreground"><Wallet className="h-3.5 w-3.5" /> Saldo atual</span>
            <span className={guard.balanceCents <= 0 ? "font-bold text-destructive" : "font-semibold"}>
              R$ {(guard.balanceCents/100).toFixed(2)}
            </span>
          </div>
          {guard.debtCents > 0 && (
            <div className="mt-1 flex items-center justify-between text-destructive">
              <span>Dívida pendente</span>
              <span className="font-semibold">R$ {(guard.debtCents/100).toFixed(2)}</span>
            </div>
          )}
        </div>

        {guard.pausedCampaigns.length > 0 && (
          <div className="space-y-1 text-xs">
            <p className="font-medium text-muted-foreground">Pausadas:</p>
            <ul className="max-h-24 space-y-0.5 overflow-y-auto rounded border bg-background p-2">
              {guard.pausedCampaigns.map((c) => (
                <li key={c.id} className="truncate">
                  • {c.name} <span className="text-muted-foreground">(R$ {(c.daily_budget_cents/100).toFixed(2)}/dia)</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="space-y-2">
          <Label className="text-xs">Valor para recarregar (R$)</Label>
          <div className="flex gap-2">
            <Input
              type="number" min={50} step={10} value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={loading}
            />
            <Button variant="outline" size="sm" onClick={() => setAmount(String(suggested/100))} disabled={loading}>
              Sugerido R$ {(suggested/100).toFixed(0)}
            </Button>
          </div>
          <div className="flex flex-wrap gap-1">
            {[50, 100, 200, 500, 1000].map((v) => (
              <Button key={v} variant="ghost" size="sm" className="h-7 px-2 text-xs"
                onClick={() => setAmount(String(v))} disabled={loading}>
                R$ {v}
              </Button>
            ))}
          </div>
        </div>

        <div className="grid gap-2">
          <Button onClick={handleRecharge} disabled={loading} size="lg" className="w-full">
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Recarregar R$ {Number(amount || 0).toFixed(2)}
          </Button>
          {guard.pausedCampaigns.length > 0 && (
            <Button onClick={handleArchiveAll} variant="outline" size="sm" disabled={loading}>
              Arquivar campanhas pausadas
            </Button>
          )}
          <Button onClick={guard.snooze24h} variant="ghost" size="sm" disabled={loading}>
            Lembrar em 24h (campanhas continuam pausadas)
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
