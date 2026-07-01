// =============================================================================
// Painel Carteira Green — layout com sidebar local por seção.
// Apenas Resumo + Financeiro. Rede/Produtos vivem em abas próprias do Admin,
// e Diagnóstico foi movido para o Sheet de Configurações.
// =============================================================================

import { useEffect, useMemo, useState } from "react";
import { Loader2, LayoutDashboard, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useBoletosCarteira, useDevolutivasCarteira, computeCarteiraStats } from "./hooks";
import { StatusCards } from "./StatusCards";
import { BoletosList } from "./BoletosList";
import { DevolutivasList } from "./DevolutivasList";
import { PaymentIntent } from "./PaymentIntent";
import { ConsultantMetricsCard } from "./ConsultantMetricsCard";

type SectionId = "resumo" | "financeiro";

const SYNC_STEPS = ["Clientes", "Boletos", "Devolutivas", "Métricas", "Licenças"];

function SectionNav({
  active,
  onChange,
  counts,
}: {
  active: SectionId;
  onChange: (s: SectionId) => void;
  counts: Record<SectionId, number | null>;
}) {
  const items: { id: SectionId; label: string; icon: typeof LayoutDashboard }[] = [
    { id: "resumo", label: "Resumo", icon: LayoutDashboard },
    { id: "financeiro", label: "Financeiro", icon: Wallet },
  ];
  return (
    <nav className="md:w-56 md:shrink-0">
      <ul className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible pb-1 md:pb-0">
        {items.map((it) => {
          const isActive = active === it.id;
          const Icon = it.icon;
          const count = counts[it.id];
          return (
            <li key={it.id} className="md:w-full">
              <button
                type="button"
                onClick={() => onChange(it.id)}
                className={cn(
                  "group w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-left whitespace-nowrap transition-colors border-l-2",
                  isActive
                    ? "bg-accent text-accent-foreground border-primary"
                    : "border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="flex-1">{it.label}</span>
                {count != null && count > 0 && (
                  <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-normal">
                    {count}
                  </Badge>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function CarteiraGreenPanel({ consultantId }: { consultantId: string }) {
  const { data: boletos = [], isLoading: loadingB, refetch: refetchB } = useBoletosCarteira(consultantId);
  const { data: devolutivas = [], isLoading: loadingD, refetch: refetchD } = useDevolutivasCarteira(consultantId);
  const [syncing, setSyncing] = useState(false);
  const [syncStartedAt, setSyncStartedAt] = useState<number | null>(null);
  const [, setTick] = useState(0);
  const [igreenCustomerCount, setIgreenCustomerCount] = useState<number | null>(null);

  const [section, setSectionState] = useState<SectionId>(() => {
    if (typeof window === "undefined") return "resumo";
    const s = new URLSearchParams(window.location.search).get("sec");
    return s === "financeiro" ? "financeiro" : "resumo";
  });
  const setSection = (s: SectionId) => {
    setSectionState(s);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("sec", s);
      window.history.replaceState({}, "", url.toString());
    } catch {}
  };

  useEffect(() => {
    if (!syncing) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [syncing]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const c = await supabase
        .from("customers")
        .select("id", { count: "exact", head: true })
        .eq("consultant_id", consultantId)
        .eq("customer_origin", "igreen_sync");
      if (!alive) return;
      setIgreenCustomerCount(c.count ?? 0);
    })();
    return () => { alive = false; };
  }, [consultantId, boletos.length]);

  const stats = useMemo(() => computeCarteiraStats(boletos), [boletos]);
  const lastSync = boletos[0]?.synced_at;
  const lastSyncTs = lastSync ? new Date(lastSync).getTime() : 0;

  useEffect(() => {
    let cancelled = false;
    let baseline = lastSyncTs;
    let started = false;
    const check = async () => {
      const { data } = await refetchB();
      const newTs = data?.[0]?.synced_at ? new Date(data[0].synced_at).getTime() : 0;
      if (cancelled) return;
      if (newTs > baseline) {
        if (!started) {
          started = true;
          setSyncing(true);
          setSyncStartedAt(Date.now());
        }
        baseline = newTs;
        await refetchD();
        setTimeout(() => {
          if (!cancelled) {
            setSyncing(false);
            setSyncStartedAt(null);
          }
        }, 4000);
      }
    };
    const interval = setInterval(check, 30_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [lastSyncTs, refetchB, refetchD]);

  if (loadingB || loadingD) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
        <Loader2 className="h-5 w-5 animate-spin" /> Carregando carteira…
      </div>
    );
  }

  const elapsedSec = syncStartedAt ? Math.floor((Date.now() - syncStartedAt) / 1000) : 0;
  const stepsDone = Math.min(SYNC_STEPS.length, Math.floor(elapsedSec / 2));

  const noData = boletos.length === 0 && !(igreenCustomerCount && igreenCustomerCount > 0);

  const counts: Record<SectionId, number | null> = {
    resumo: igreenCustomerCount,
    financeiro: boletos.length + devolutivas.length,
  };

  return (
    <div className="space-y-4">
      <header className="flex items-baseline justify-between gap-3 flex-wrap">
        <p className="text-xs text-muted-foreground">
          Boletos, devolutivas, injeção e sinais de pagamento — espelho do escritório iGreen.
        </p>
        {lastSync && (
          <p className="text-[11px] text-muted-foreground">
            Última sync: <strong className="text-foreground">{new Date(lastSync).toLocaleString("pt-BR")}</strong>
          </p>
        )}
      </header>

      {syncing && (
        <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
          <p className="text-xs font-medium mb-2 text-foreground">Sincronização em andamento…</p>
          <div className="flex flex-wrap gap-1.5">
            {SYNC_STEPS.map((s, i) => {
              const done = i < stepsDone;
              return (
                <span
                  key={s}
                  className={cn(
                    "text-[10px] px-2 py-1 rounded-full border",
                    done
                      ? "bg-accent border-border text-foreground"
                      : "bg-background border-border/60 text-muted-foreground",
                  )}
                >
                  {done ? "✓ " : "· "}{s}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {noData ? (
        <div className="rounded-xl border border-dashed border-border/60 p-8 text-center space-y-2">
          <p className="text-sm font-medium">Sem dados sincronizados ainda</p>
          <p className="text-xs text-muted-foreground">
            Dispare a sincronização a partir do Início ou do painel Admin.
          </p>
        </div>
      ) : (
        <div className="flex flex-col md:flex-row gap-4 md:gap-6">
          <SectionNav active={section} onChange={setSection} counts={counts} />

          <div className="flex-1 min-w-0 space-y-6">
            {section === "resumo" && (
              <>
                {boletos.length === 0 && igreenCustomerCount != null && (
                  <div className="rounded-lg border border-border/60 bg-muted/30 p-4 text-sm">
                    <strong>{igreenCustomerCount}</strong>{" "}
                    {igreenCustomerCount === 1 ? "cliente sincronizado" : "clientes sincronizados"} — sem boletos em aberto no momento.
                  </div>
                )}
                <ConsultantMetricsCard consultantId={consultantId} />
                {boletos.length > 0 && <StatusCards stats={stats} />}
                {boletos.length > 0 && <PaymentIntent boletos={boletos} />}
              </>
            )}

            {section === "financeiro" && (
              boletos.length > 0 || devolutivas.length > 0 ? (
                <div className="grid gap-6 lg:grid-cols-5">
                  <div className="lg:col-span-3">
                    <BoletosList boletos={boletos} />
                  </div>
                  <div className="lg:col-span-2">
                    <DevolutivasList devolutivas={devolutivas} />
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-border/60 p-8 text-center space-y-1">
                  <p className="text-sm font-medium">Sem movimento financeiro</p>
                  <p className="text-xs text-muted-foreground">Nenhum boleto ou devolutiva sincronizado.</p>
                </div>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}
