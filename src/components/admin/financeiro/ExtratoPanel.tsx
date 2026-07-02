import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Clock, Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useConsultantNames } from "./hooks";
import { RejeitarTopupDialog } from "./RejeitarTopupDialog";

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
  const [visible, setVisible] = useState(200);
  const [rejectId, setRejectId] = useState<string | null>(null);

  const { data: txs = [], isLoading: loadingTx } = useQuery({
    queryKey: ["extrato-wallet", userId, isAdmin],
    staleTime: 30_000,
    queryFn: async (): Promise<WalletTx[]> => {
      let q = supabase
        .from("wallet_transactions")
        .select("id, consultant_id, amount_cents, balance_after_cents, type, description, created_at")
        .order("created_at", { ascending: false })
        .limit(1000);
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

  useEffect(() => setVisible(200), [filter]);

  const consultantIds = useMemo(() => {
    const ids = new Set<string>();
    for (const t of txs) ids.add(t.consultant_id);
    for (const t of topups) ids.add(t.consultant_id);
    return Array.from(ids);
  }, [txs, topups]);
  const { data: names = {} } = useConsultantNames(consultantIds);

  const pendingTopups = topups.filter((t) => t.status === "pending");

  const approveTopup = async (id: string) => {
    const { error } = await supabase
      .from("wallet_manual_topup_requests")
      .update({ status: "approved", approved_at: new Date().toISOString(), approved_by: userId })
      .eq("id", id);
    if (error) toast({ title: "Erro ao aprovar", description: error.message, variant: "destructive" });
    else {
      toast({ title: "Recarga aprovada" });
      refetchTopups();
    }
  };

  const rejectTopup = async (id: string, motivo: string) => {
    const { error } = await supabase
      .from("wallet_manual_topup_requests")
      .update({ status: "rejected", rejection_reason: motivo || null, approved_by: userId })
      .eq("id", id);
    if (error) toast({ title: "Erro ao recusar", description: error.message, variant: "destructive" });
    else {
      toast({ title: "Recarga recusada" });
      refetchTopups();
    }
    setRejectId(null);
  };

  const exportCsv = () => {
    const header = ["Data", "Consultor", "Tipo", "Descrição", "Valor (R$)", "Saldo após (R$)"];
    const esc = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = filtered.map((t) =>
      [
        new Date(t.created_at).toLocaleString("pt-BR"),
        names[t.consultant_id] || t.consultant_id.slice(0, 8),
        t.type,
        t.description || "",
        (t.amount_cents / 100).toFixed(2).replace(".", ","),
        t.balance_after_cents != null ? (t.balance_after_cents / 100).toFixed(2).replace(".", ",") : "",
      ].map(esc).join(";"),
    );
    const csv = "\uFEFF" + header.join(";") + "\n" + lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `extrato-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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
                    {names[t.consultant_id] || `${t.consultant_id.slice(0, 8)}…`}
                    {t.note && ` · ${t.note}`}
                    {" · "}
                    {new Date(t.created_at).toLocaleString("pt-BR")}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button size="sm" variant="outline" className="h-7" onClick={() => setRejectId(t.id)}>
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
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h3 className="text-sm font-semibold">Extrato da carteira</h3>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground">
                {filtered.length.toLocaleString("pt-BR")} de {txs.length.toLocaleString("pt-BR")}
              </span>
              <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={exportCsv} disabled={filtered.length === 0}>
                <Download className="h-3 w-3 mr-1" /> CSV
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Filtro por tipo">
            {(["todos", "credit", "debit", "ai", "envio", "recarga"] as FilterType[]).map((f) => (
              <button
                key={f}
                type="button"
                role="radio"
                aria-checked={filter === f}
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
          <>
            <ul className="divide-y divide-border/60">
              {filtered.slice(0, visible).map((t) => (
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
                      {isAdmin && (
                        <span className="font-medium text-foreground/70">
                          {names[t.consultant_id] || `${t.consultant_id.slice(0, 8)}…`} ·{" "}
                        </span>
                      )}
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
            {filtered.length > visible && (
              <div className="p-3 text-center border-t border-border/60">
                <Button variant="outline" size="sm" onClick={() => setVisible((v) => v + 200)}>
                  Mostrar mais 200 ({filtered.length - visible} restantes)
                </Button>
              </div>
            )}
          </>
        )}
      </section>

      <RejeitarTopupDialog
        open={!!rejectId}
        onOpenChange={(v) => !v && setRejectId(null)}
        onConfirm={(motivo) => rejectId && rejectTopup(rejectId, motivo)}
      />
    </div>
  );
}
