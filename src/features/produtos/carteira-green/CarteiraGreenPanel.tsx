// =============================================================================
// Painel Carteira Green — layout enxuto (3 blocos).
// 1) Hero: título + 1 linha de KPIs inline.
// 2) Métricas do consultor (colapsável, fechado por padrão).
// 3) Tabela unificada "Clientes" (drawer com detalhes ao clicar).
// Tipografia: Space Grotesk (títulos) + DM Sans (corpo). Tokens padrão da plataforma.
// =============================================================================

import { useEffect, useMemo, useState } from "react";
import { Loader2, Wallet, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useBoletosCarteira, useDevolutivasCarteira, computeCarteiraStats } from "./hooks";
import { ConsultantMetricsCard } from "./ConsultantMetricsCard";
import { ClientesCarteiraTable } from "./ClientesCarteiraTable";
import { IGreenSyncStatusBadge } from "@/components/admin/IGreenSyncStatusBadge";

const SYNC_STEPS = ["Clientes", "Boletos", "Devolutivas", "Métricas", "Licenças"];

const N = (n: number) => n.toLocaleString("pt-BR");

export function CarteiraGreenPanel({ consultantId }: { consultantId: string }) {
  const { data: boletos = [], isLoading: loadingB, refetch: refetchB } = useBoletosCarteira(consultantId);
  const { data: devolutivas = [], isLoading: loadingD, refetch: refetchD } = useDevolutivasCarteira(consultantId);
  const [syncing, setSyncing] = useState(false);
  const [syncStartedAt, setSyncStartedAt] = useState<number | null>(null);
  const [, setTick] = useState(0);
  const [igreenCustomerCount, setIgreenCustomerCount] = useState<number | null>(null);

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
      <div className="flex items-center justify-center py-16 text-muted-foreground gap-2 font-body-alt">
        <Loader2 className="h-5 w-5 animate-spin" /> Carregando carteira…
      </div>
    );
  }

  const elapsedSec = syncStartedAt ? Math.floor((Date.now() - syncStartedAt) / 1000) : 0;
  const stepsDone = Math.min(SYNC_STEPS.length, Math.floor(elapsedSec / 2));

  const noData = boletos.length === 0 && !(igreenCustomerCount && igreenCustomerCount > 0);
  const abertos = boletos.filter(
    (b) => !b.pagamento && !String(b.status || "").toLowerCase().includes("pago"),
  ).length;

  return (
    <div className="font-body-alt space-y-4">
      {/* ═══ Faixa 1 · Hero enxuto (uma linha de KPIs) ═══════════════════════ */}
      <section className="rounded-2xl border border-border/60 bg-card overflow-hidden">
        <div className="p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                <Wallet className="h-3.5 w-3.5" />
                <span>Carteira iGreen</span>
              </div>
              <h2 className="mt-1 font-display text-xl sm:text-2xl font-semibold tracking-tight text-foreground">
                Sua carteira
              </h2>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <IGreenSyncStatusBadge userId={consultantId} />
              {lastSync && (
                <div className="rounded-full border border-border/60 bg-background/60 px-3 py-1.5 flex items-center gap-2 text-[11px]">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                  <span className="text-muted-foreground">Sincronizado</span>
                  <strong className="text-foreground font-medium">
                    {new Date(lastSync).toLocaleString("pt-BR")}
                  </strong>
                </div>
              )}
            </div>
          </div>

          {!noData && (
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
              <KpiInline value={N(igreenCustomerCount ?? 0)} label="clientes" />
              <Dot />
              <KpiInline value={N(abertos)} label="boletos abertos" />
              <Dot />
              <KpiInline value={`${stats.adimplenciaPct}%`} label="adimplência" tone={stats.adimplenciaPct >= 80 ? "good" : "warn"} />
              <Dot />
              <KpiInline value={N(stats.kwhCompensados)} label="kWh compensados" />
              {stats.vencidos > 0 && (
                <>
                  <Dot />
                  <KpiInline value={N(stats.vencidos)} label="vencidos" tone="bad" />
                </>
              )}
            </div>
          )}
        </div>

        {syncing && (
          <div className="border-t border-border/60 bg-muted/30 px-4 sm:px-5 py-2.5">
            <div className="flex items-center gap-2 mb-1.5 text-xs font-medium text-foreground">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              Sincronização em andamento…
            </div>
            <div className="flex flex-wrap gap-1.5">
              {SYNC_STEPS.map((s, i) => {
                const done = i < stepsDone;
                return (
                  <span
                    key={s}
                    className={cn(
                      "text-[10px] px-2 py-0.5 rounded-full border",
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
      </section>

      {noData ? (
        <section className="rounded-2xl border border-dashed border-border/60 p-10 text-center space-y-2 bg-card">
          <p className="font-display text-base font-semibold">Sem dados sincronizados ainda</p>
          <p className="text-xs text-muted-foreground">
            Dispare a sincronização a partir do Início ou do painel Admin.
          </p>
        </section>
      ) : (
        <>
          {/* ═══ Faixa 2 · Métricas do consultor (colapsável) ═══════════════ */}
          <section className="rounded-2xl border border-border/60 bg-card p-4">
            <ConsultantMetricsCard consultantId={consultantId} defaultOpen={false} />
          </section>

          {/* ═══ Faixa 3 · Tabela unificada de clientes ═════════════════════ */}
          <ClientesCarteiraTable
            consultantId={consultantId}
            boletos={boletos}
            devolutivas={devolutivas}
          />
        </>
      )}
    </div>
  );
}

function KpiInline({
  value,
  label,
  tone,
}: {
  value: string;
  label: string;
  tone?: "good" | "warn" | "bad";
}) {
  const toneCls =
    tone === "good"
      ? "text-emerald-600"
      : tone === "warn"
      ? "text-amber-600"
      : tone === "bad"
      ? "text-red-600"
      : "text-foreground";
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <strong className={cn("font-display font-semibold tabular-nums text-base leading-none", toneCls)}>
        {value}
      </strong>
      <span className="text-[11px] text-muted-foreground uppercase tracking-wider">{label}</span>
    </span>
  );
}

function Dot() {
  return <span className="h-1 w-1 rounded-full bg-border shrink-0" aria-hidden />;
}
