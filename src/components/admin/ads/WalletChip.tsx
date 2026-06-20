import { useEffect, useState } from "react";
import { Wallet, Plus, Loader2, AlertTriangle, ArrowUpRight, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  getWalletBalance,
  getWalletFeed,
  createTopupSession,
  type WalletBalance,
  type WalletFeed,
} from "@/services/facebookAds";
import { ManualTopupRequestDialog } from "@/components/wallet/ManualTopupRequestDialog";

const QUICK_AMOUNTS = [50_00, 100_00, 200_00, 500_00];
const fmt = (cents: number) => `R$ ${(cents / 100).toFixed(2)}`;

function formatDateLabel(date: string) {
  const d = new Date(date + "T12:00:00");
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const diff = Math.round((today.getTime() - d.getTime()) / 86400000);
  if (diff === 0) return "Hoje";
  if (diff === 1) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

export function WalletChip({ consultantId }: { consultantId: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [balance, setBalance] = useState<WalletBalance | null>(null);
  const [feed, setFeed] = useState<WalletFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [topping, setTopping] = useState<number | null>(null);
  const [showFeed, setShowFeed] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [b, f] = await Promise.all([
        getWalletBalance(consultantId),
        getWalletFeed(consultantId, 50),
      ]);
      setBalance(b); setFeed(f);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [consultantId]);
  useEffect(() => { if (open) load(); /* refresh on open */ }, [open]);

  async function handleTopup(cents: number) {
    setTopping(cents);
    try {
      const { url } = await createTopupSession(cents);
      window.location.href = url;
    } catch (e: any) {
      toast({ title: "Não foi possível iniciar a recarga", description: e?.message || "Tente novamente.", variant: "destructive" });
      setTopping(null);
    }
  }

  const low = balance && balance.balance_cents <= balance.auto_pause_at_cents;
  const inDebt = balance && balance.debt_cents > 0;

  const tone = inDebt
    ? "border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/15"
    : low
      ? "border-warning/40 bg-warning/10 text-warning hover:bg-warning/15"
      : "border-primary/30 bg-primary/10 text-primary hover:bg-primary/15";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-full border text-xs font-semibold transition ${tone}`}
          aria-label="Abrir carteira"
        >
          <Wallet className="w-3.5 h-3.5" />
          {loading || !balance ? <Loader2 className="w-3 h-3 animate-spin" /> : fmt(balance.balance_cents)}
        </button>
      </DialogTrigger>

      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="w-5 h-5 text-primary" /> Carteira de anúncios
          </DialogTitle>
        </DialogHeader>

        {loading || !balance ? (
          <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl bg-gradient-to-br from-primary/15 to-primary/5 border border-primary/20 p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Saldo disponível</p>
              <p className="text-3xl font-bold text-foreground mt-1">{fmt(balance.balance_cents)}</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground">
                <span>Recarregado: <strong className="text-foreground">{fmt(balance.total_topped_up_cents)}</strong></span>
                <span>Gasto: <strong className="text-foreground">{fmt(balance.total_spent_cents)}</strong></span>
              </div>
              {inDebt && (
                <div className="mt-3 flex items-start gap-2 text-xs text-destructive rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <div><strong>Em débito: {fmt(balance.debt_cents)}</strong> — recarregue para reativar campanhas.</div>
                </div>
              )}
              {!inDebt && low && (
                <div className="mt-3 flex items-center gap-2 text-xs text-warning rounded-md bg-warning/10 px-3 py-2">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Saldo baixo — campanhas serão pausadas em breve.
                </div>
              )}
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Adicionar saldo</p>
              <div className="grid grid-cols-2 gap-2">
                {QUICK_AMOUNTS.map((c) => (
                  <Button
                    key={c}
                    variant="outline"
                    className="h-12 text-sm font-semibold"
                    disabled={topping !== null}
                    onClick={() => handleTopup(c)}
                  >
                    {topping === c
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : <><Plus className="w-3.5 h-3.5 mr-1" /> {fmt(c)}</>}
                  </Button>
                ))}
              </div>
            </div>

            {feed && (feed.groups.length > 0 || feed.others.length > 0) && (
              <div className="rounded-lg border border-border/40">
                <button
                  type="button"
                  onClick={() => setShowFeed((v) => !v)}
                  className="w-full px-3 py-2 flex items-center justify-between text-xs font-medium text-muted-foreground hover:bg-muted/30 transition"
                >
                  <span>Últimas movimentações</span>
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showFeed ? "" : "-rotate-90"}`} />
                </button>
                {showFeed && (
                  <ul className="border-t border-border/40 max-h-64 overflow-y-auto divide-y divide-border/30">
                    {feed.groups.map((g) => (
                      <li key={g.key} className="px-3 py-2 text-xs flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-foreground font-medium truncate">{formatDateLabel(g.date)} · {g.campaign_name}</div>
                          <div className="text-muted-foreground">{g.leads} conversa{g.leads === 1 ? "" : "s"} · {g.impressions.toLocaleString("pt-BR")} impr.</div>
                        </div>
                        <span className="text-destructive whitespace-nowrap">−{fmt(g.total_amount_cents)}</span>
                      </li>
                    ))}
                    {feed.others.map((t) => (
                      <li key={t.id} className="px-3 py-2 text-xs flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-muted-foreground min-w-0">
                          <ArrowUpRight className="w-3 h-3 text-primary shrink-0" />
                          <span className="truncate">{t.description || (t.type === "topup" ? "Recarga" : t.type)}</span>
                        </span>
                        <span className={t.type === "refund" ? "text-warning" : "text-primary"}>+{fmt(t.amount_cents)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
