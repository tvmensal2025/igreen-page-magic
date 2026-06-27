import { useEffect, useState } from "react";
import { useWalletGuard } from "@/hooks/useWalletGuard";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, Wallet, Loader2, Clock, Archive } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/ui/confirm-dialog";

/**
 * Popup obrigatório quando o saldo da carteira zera ou há campanha pausada.
 * Visual: Emerald Prestige — verde esmeralda + dourado, destructive só em débito.
 */
export function RechargeRequiredDialog() {
  const guard = useWalletGuard();
  const confirm = useConfirm();
  const [amount, setAmount] = useState<string>("100");
  const [loading, setLoading] = useState(false);
  const [forcedShortage, setForcedShortage] = useState<{ required_cents: number; balance_cents: number } | null>(null);

  // Escuta evento global disparado por chamadas a edge functions que retornam
  // 402 INSUFFICIENT_WALLET_BALANCE (ex.: facebook-create-campaign).
  useEffect(() => {
    function onForce(e: Event) {
      const detail = (e as CustomEvent).detail || {};
      setForcedShortage({
        required_cents: Number(detail.required_cents || 0),
        balance_cents: Number(detail.balance_cents || 0),
      });
      // Sugere valor que cobre o déficit + folga (mínimo R$ 50).
      // Sugere valor que cobre o déficit + R$ 50 de folga (mínimo R$ 50).
      const deficit = Math.max(0, Number(detail.required_cents || 0) - Number(detail.balance_cents || 0));
      const sugCents = Math.max(5000, Math.ceil((deficit + 5000) / 1000) * 1000);
      setAmount(String(sugCents / 100));
      guard.clearSnooze();
      guard.setOpen(true);
    }
    window.addEventListener("wallet:force-open", onForce as EventListener);
    return () => window.removeEventListener("wallet:force-open", onForce as EventListener);
  }, [guard]);

  if (!guard.open || !guard.consultantId) return null;


  const sumDaily = guard.pausedCampaigns.reduce((s, c) => s + (c.daily_budget_cents || 0), 0);
  const suggested = Math.max(5000, sumDaily * 7);

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
    const ok = await confirm({
      title: `Arquivar ${guard.pausedCampaigns.length} campanha(s) pausada(s)?`,
      description: "Isso encerra elas definitivamente.",
      confirmText: "Arquivar",
      tone: "danger",
    });
    if (!ok) return;
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

  const inDebt = guard.reason === "balance_zero" || guard.debtCents > 0;
  const title = forcedShortage
    ? "Saldo insuficiente para publicar"
    : inDebt ? "Carteira em débito" : "Campanhas pausadas";
  const deficitCents = forcedShortage
    ? Math.max(0, forcedShortage.required_cents - forcedShortage.balance_cents)
    : 0;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) { setForcedShortage(null); guard.snooze24h(); } }}>
      <DialogContent
        className="max-w-md p-0 overflow-hidden bg-card border-border/60"
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        {/* Header com gradiente esmeralda */}
        <div className="relative bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border-b border-border/40 px-6 pt-8 pb-5">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 ring-4 ring-primary/5">
            <AlertCircle className="h-6 w-6 text-primary" />
          </div>
          <DialogHeader className="space-y-1.5">
            <DialogTitle className="text-center text-lg font-semibold text-foreground">
              {title}
            </DialogTitle>
            <DialogDescription className="text-center text-sm text-muted-foreground leading-relaxed">
              {forcedShortage
                ? `Sua campanha precisa de R$ ${(forcedShortage.required_cents / 100).toFixed(2)} para ser publicada e você tem R$ ${(forcedShortage.balance_cents / 100).toFixed(2)}. Faltam R$ ${(deficitCents / 100).toFixed(2)} — recarregue para continuar.`
                : inDebt
                ? `Carteira com dívida de R$ ${(guard.debtCents / 100).toFixed(2)}. Recarregue para reativar.`
                : `${guard.pausedCampaigns.length} campanha(s) pausada(s) por saldo insuficiente.`}
            </DialogDescription>
          </DialogHeader>
        </div>

        {/* Banner de alerta destacado quando é shortage de publicação */}
        {forcedShortage && (
          <div className="mx-6 mt-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-xs text-destructive flex items-start gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <div className="leading-relaxed">
              <strong>Por que isso aconteceu?</strong> O Facebook exige o orçamento total da campanha (diário × duração + margem de segurança) reservado na carteira antes de publicar. Adicione pelo menos <strong>R$ {(deficitCents / 100).toFixed(2)}</strong> para liberar.
            </div>
          </div>
        )}


        <div className="px-6 py-5 space-y-4 max-h-[60vh] overflow-y-auto">
          {/* Saldo */}
          <div className="rounded-xl border border-border/50 bg-muted/30 p-3.5 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Wallet className="h-3.5 w-3.5" /> Saldo atual
              </span>
              <span className={`font-semibold tabular-nums ${guard.balanceCents <= 0 ? "text-destructive" : "text-foreground"}`}>
                R$ {(guard.balanceCents / 100).toFixed(2)}
              </span>
            </div>
            {guard.debtCents > 0 && (
              <div className="flex items-center justify-between text-sm pt-2 border-t border-border/40">
                <span className="text-destructive">Dívida pendente</span>
                <span className="font-semibold tabular-nums text-destructive">
                  R$ {(guard.debtCents / 100).toFixed(2)}
                </span>
              </div>
            )}
          </div>

          {/* Pausadas */}
          {guard.pausedCampaigns.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Pausadas ({guard.pausedCampaigns.length})
              </p>
              <ul className="max-h-32 space-y-1 overflow-y-auto rounded-lg border border-border/50 bg-background p-2">
                {guard.pausedCampaigns.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center justify-between gap-2 px-2 py-1.5 rounded text-xs hover:bg-muted/40"
                  >
                    <span className="truncate min-w-0 flex-1 text-foreground" title={c.name}>
                      {c.name}
                    </span>
                    <span className="shrink-0 text-muted-foreground tabular-nums">
                      R$ {(c.daily_budget_cents / 100).toFixed(2)}/dia
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Valor */}
          <div className="space-y-2">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Valor para recarregar
            </Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">R$</span>
                <Input
                  type="number"
                  min={50}
                  step={10}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  disabled={loading}
                  className="pl-9 font-semibold tabular-nums"
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAmount(String(suggested / 100))}
                disabled={loading}
                className="shrink-0 border-primary/30 text-primary hover:bg-primary/10 hover:text-primary"
              >
                Sugerido {(suggested / 100).toFixed(0)}
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {[50, 100, 200, 500, 1000].map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setAmount(String(v))}
                  disabled={loading}
                  className={`h-7 px-2.5 rounded-md text-xs font-medium border transition ${
                    Number(amount) === v
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background border-border/60 text-muted-foreground hover:border-primary/40 hover:text-foreground"
                  }`}
                >
                  R$ {v}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 pb-5 pt-1 space-y-2 border-t border-border/40 bg-muted/20 pt-4">
          <Button
            onClick={handleRecharge}
            disabled={loading}
            size="lg"
            className="w-full bg-gradient-to-r from-primary to-primary/85 hover:from-primary/90 hover:to-primary/75 text-primary-foreground font-semibold shadow-sm"
          >
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wallet className="mr-2 h-4 w-4" />}
            Recarregar R$ {Number(amount || 0).toFixed(2)}
          </Button>
          <div className="flex gap-2">
            {guard.pausedCampaigns.length > 0 && (
              <Button
                onClick={handleArchiveAll}
                variant="outline"
                size="sm"
                disabled={loading}
                className="flex-1 text-xs"
              >
                <Archive className="mr-1.5 h-3.5 w-3.5" />
                Arquivar
              </Button>
            )}
            <Button
              onClick={guard.snooze24h}
              variant="ghost"
              size="sm"
              disabled={loading}
              className="flex-1 text-xs text-muted-foreground"
            >
              <Clock className="mr-1.5 h-3.5 w-3.5" />
              Lembrar em 24h
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
