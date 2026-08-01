import { useCallback, useEffect, useMemo, useState } from "react";
import { HandCoins, Loader2, RefreshCw, Search, UserCheck, UserX } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { toUserFacingError } from "@/lib/userFacingError";
import { PlatformPnLCard } from "@/components/admin/super/PlatformPnLCard";
import { SuperAdminCashCreditDialog } from "@/components/admin/super/SuperAdminCashCreditDialog";

type ConsultantRow = {
  id: string;
  name: string;
  license: string;
  phone: string | null;
  approved: boolean | null;
  balance_cents: number;
  debt_cents: number;
  total_spent_cents: number;
  total_topped_up_cents: number;
  auto_pause_at_cents: number;
};

const fmt = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Painel SuperAdmin: lucro da plataforma (P&L) + carteiras dos consultores.
 * P&L = quanto entrou (Stripe) − taxas − gasto Meta + margem cobrada.
 */
export function PlatformFinancePanel() {
  const { toast } = useToast();
  const [rows, setRows] = useState<ConsultantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: consultants, error: cErr }, { data: wallets, error: wErr }] = await Promise.all([
        supabase
          .from("consultants")
          .select("id, name, license, phone, approved")
          .order("name"),
        supabase
          .from("consultant_wallet")
          .select("consultant_id, balance_cents, debt_cents, total_spent_cents, total_topped_up_cents, auto_pause_at_cents"),
      ]);
      if (cErr) throw cErr;
      if (wErr) throw wErr;

      const walletMap = new Map(
        ((wallets as any[]) || []).map((w) => [w.consultant_id as string, w]),
      );

      const next: ConsultantRow[] = ((consultants as any[]) || []).map((c) => {
        const w = walletMap.get(c.id);
        return {
          id: c.id,
          name: c.name || "Sem nome",
          license: c.license || "—",
          phone: c.phone || null,
          approved: c.approved,
          balance_cents: Number(w?.balance_cents ?? 0),
          debt_cents: Number(w?.debt_cents ?? 0),
          total_spent_cents: Number(w?.total_spent_cents ?? 0),
          total_topped_up_cents: Number(w?.total_topped_up_cents ?? 0),
          auto_pause_at_cents: Number(w?.auto_pause_at_cents ?? 0),
        };
      });

      setRows(next);
    } catch (e) {
      console.error("[PlatformFinancePanel] load", e);
      toast({
        title: "Não foi possível carregar as carteiras",
        description: toUserFacingError(e, "Tente atualizar em alguns segundos."),
        variant: "destructive",
        duration: 14000,
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.license.toLowerCase().includes(q) ||
        (r.phone || "").includes(q),
    );
  }, [rows, search]);

  async function toggleApproval(id: string, current: boolean | null) {
    setTogglingId(id);
    try {
      const { error } = await supabase
        .from("consultants")
        .update({ approved: !current })
        .eq("id", id);
      if (error) throw error;
      toast({
        title: !current ? "Consultor aprovado" : "Acesso revogado",
        duration: 8000,
      });
      await load();
    } catch (e) {
      console.error("[PlatformFinancePanel] toggleApproval", e);
      toast({
        title: "Não foi possível alterar o acesso",
        description: toUserFacingError(e),
        variant: "destructive",
        duration: 14000,
      });
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <div className="space-y-8 max-w-6xl">
      <div className="space-y-1">
        <h2 className="text-lg font-bold font-heading text-foreground">Lucro da plataforma</h2>
        <p className="text-sm text-muted-foreground max-w-3xl">
          Aqui você vê o dinheiro real da plataforma: o que entrou pelo Stripe, taxas, gasto na Meta,
          o que foi cobrado dos consultores e a margem. Também dá para creditar saldo e ajustar cada
          consultor.
        </p>
      </div>

      <PlatformPnLCard />

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Carteiras dos consultores</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Credite saldo (PIX/dinheiro) e aprove ou revogue o acesso do consultor.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar nome, licença…"
                className="h-9 w-56 pl-8 text-xs"
              />
            </div>
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading} className="h-9 gap-1.5">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-10">Nenhum consultor encontrado.</p>
        ) : (
          <div className="space-y-2">
            {filtered.map((r) => (
              <div
                key={r.id}
                className="rounded-xl border border-border/50 bg-card/40 p-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-foreground truncate">{r.name}</p>
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${
                        r.approved
                          ? "border-primary/30 text-primary"
                          : "border-warning/40 text-warning"
                      }`}
                    >
                      {r.approved ? "Aprovado" : "Pendente"}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {r.license}
                    {r.phone ? ` · ${r.phone}` : ""}
                  </p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs pt-1">
                    <span>
                      Saldo: <strong className="text-foreground">{fmt(r.balance_cents)}</strong>
                    </span>
                    {r.debt_cents > 0 && (
                      <span className="text-destructive">
                        Dívida: <strong>{fmt(r.debt_cents)}</strong>
                      </span>
                    )}
                    <span className="text-muted-foreground">Gasto: {fmt(r.total_spent_cents)}</span>
                    <span className="text-muted-foreground">Creditado: {fmt(r.total_topped_up_cents)}</span>
                    <span className="text-muted-foreground">Auto-pause: {fmt(r.auto_pause_at_cents)}</span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <SuperAdminCashCreditDialog
                    consultantId={r.id}
                    consultantName={r.name}
                    onCredited={() => void load()}
                    trigger={
                      <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                        <HandCoins className="w-3.5 h-3.5" /> Creditar
                      </Button>
                    }
                  />

                  <Button
                    variant={r.approved ? "ghost" : "default"}
                    size="sm"
                    className="h-8 gap-1.5 text-xs"
                    disabled={togglingId === r.id}
                    onClick={() => void toggleApproval(r.id, r.approved)}
                  >
                    {togglingId === r.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : r.approved ? (
                      <UserX className="w-3.5 h-3.5" />
                    ) : (
                      <UserCheck className="w-3.5 h-3.5" />
                    )}
                    {r.approved ? "Revogar" : "Aprovar"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
