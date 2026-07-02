import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, CheckCircle2, Clock, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const BRL = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

type FilterType = "todos" | "credit" | "debit" | "ai" | "envio" | "recarga";

interface WalletTx {
  id: string;
  consultant_id: string;
  amount_cents: number;
  balance_after_cents: number | null;
  type: string;
  description: string | null;
  created_at: string;
}

interface TopupReq {
  id: string;
  consultant_id: string;
  amount_cents: number;
  status: string;
  note: string | null;
  created_at: string;
  approved_at: string | null;
  rejection_reason: string | null;
}

/** Extrato: histórico da carteira de créditos + recargas aguardando aprovação. */
export function ExtratoPanel({ userId, isAdmin }: { userId: string; isAdmin: boolean }) {
  const { toast } = useToast();
  const [filter, setFilter] = useState<FilterType>("todos");

  const { data: txs = [], isLoading: loadingTx } = useQuery({
    queryKey: ["extrato-wallet", userId, isAdmin],
    staleTime: 30_000,
    queryFn: async (): Promise<WalletTx[]> => {
      let q = supabase
        .from("wallet_transactions")
        .select("id, consultant_id, amount_cents, balance_after_cents, type, description, created_at")
        .order("created_at", { ascending: false })
        .limit(500);
      if (!isAdmin) q = q.eq("consultant_id", userId);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as WalletTx[];
    },
  });

  const { data: topups = [], isLoading: loadingTopups, refetch: refetchTopups } = useQuery({
    queryKey: ["extrato-topups", userId, isAdmin],
    enabled: isAdmin,
    staleTime: 30_000,
    queryFn: async (): Promise<TopupReq[]> => {
      const { data, error } = await supabase
        .from("wallet_manual_topup_requests")
        .select("id, consultant_id, amount_cents, status, note, created_at, approved_at, rejection_reason")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data || []) as TopupReq[];
    },
  });

  const filtered = useMemo(() => {
    return txs.filter((t) => {
      if (filter === "todos") return true;
      const type = t.type.toLowerCase();
      if (filter === "credit") return t.amount_cents > 0;
      if (filter === "debit") return t.amount_cents < 0;
      if (filter === "ai") return type.includes("ai") || type.includes("ia");
      if (filter === "envio") return type.includes("send") || type.includes("message") || type.includes("wpp");
      if (filter === "recarga") return type.includes("topup") || type.includes("recarga") || type.includes("credit");
      return true;
    });
  }, [txs, filter]);

  const pendingTopups = topups.filter((t) => t.status === "pending");

  const approveTopup = async (id: string) => {
    const { error } = await supabase
      .from("wallet_manual_topup_requests")
      .update({ status: "approved", approved_at: new Date().toISOString(), approved_by: userId })
      .eq("id", id);
    if (error) {
      toast({ title: "Erro ao aprovar", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Recarga aprovada" });
      refetchTopups();
    }
  };

  const rejectTopup = async (id: string) => {
    const reason = prompt("Motivo da recusa (opcional):") || "";
    const { error } = await supabase
      .from("wallet_manual_topup_requests")
      .update({ status: "rejected", rejection_reason: reason, approved_by: userId })
      .eq("id", id);
    if (error) {
      toast({ title: "Erro ao recusar", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Recarga recusada" });
      refetchTopups();
    }
  };

  return (
    <div className="space-y-5">
      {isAdmin && pendingTopups.length > 0 && (
        <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-600" />
            Recargas aguardando aprovação ({pendingTopups.length})
          </h3>
          <ul className="divide-y divide-border/40 -mx-1">
            {pendingTopups.map((t) => (
              <li key={t.id} className="flex items-center justify-between px-1 py-2 gap-2 flex-wrap">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{BRL(t.amount_cents)}</p>
                  <p className="text-[11px] text-muted-foreground">
                    Consultor: {t.consultant_id.slice(0, 8)}…
                    {t.note && ` · ${t.note}`}
                    {" · "}
                    {new Date(t.created_at).toLocaleString("pt-BR")}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button size="sm" variant="outline" className="h-7" onClick={() => rejectTopup(t.id)}>
                    Recusar
                  </Button>
                  <Button size="sm" className="h-7" onClick={() => approveTopup(t.id)}>
                    Aprovar
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-xl border border-border/60 bg-card">
        <header className="p-4 border-b border-border/60 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Extrato da carteira</h3>
            <span className="text-[11px] text-muted-foreground">
              {filtered.length.toLocaleString("pt-BR")} de {txs.length.toLocaleString("pt-BR")}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(["todos", "credit", "debit", "ai", "envio", "recarga"] as FilterType[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`px-3 py-1 rounded-full text-[11px] font-medium border transition ${
                  filter === f
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-border/60 text-muted-foreground hover:text-foreground"
                }`}
              >
                {f === "todos" ? "Todos" : f === "credit" ? "Créditos" : f === "debit" ? "Débitos" : f === "ai" ? "IA" : f === "envio" ? "Envios WPP" : "Recargas"}
              </button>
            ))}
          </div>
        </header>

        {loadingTx || (isAdmin && loadingTopups) ? (
          <div className="p-8 text-center text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin inline-block mr-2" /> Carregando…
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Nenhuma transação com esses filtros.</div>
        ) : (
          <ul className="divide-y divide-border/60">
            {filtered.slice(0, 200).map((t) => (
              <li key={t.id} className="flex items-center justify-between px-4 py-2.5 gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    <span className={t.amount_cents >= 0 ? "text-emerald-600 font-semibold" : "text-red-600 font-semibold"}>
                      {t.amount_cents >= 0 ? "+" : ""}
                      {BRL(t.amount_cents)}
                    </span>
                    <Badge variant="outline" className="ml-2 text-[10px]">{t.type}</Badge>
                  </p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {t.description || "—"} · {new Date(t.created_at).toLocaleString("pt-BR")}
                  </p>
                </div>
                {t.balance_after_cents != null && (
                  <div className="text-right shrink-0">
                    <p className="text-[10px] text-muted-foreground">Saldo</p>
                    <p className="text-xs font-medium">{BRL(t.balance_after_cents)}</p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
