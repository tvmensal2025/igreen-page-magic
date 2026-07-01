// =============================================================================
// Painel Carteira Green — layout em faixas bento (sem sidebar local).
// A navegação principal já vive na sidebar do Admin; aqui usamos faixas
// horizontais de altura variada para dar hierarquia sem redundância.
// Tipografia local: Space Grotesk (títulos) + DM Sans (corpo).
// Cores: apenas tokens padrão da plataforma (bg-card, border-border, etc).
// =============================================================================

import { useEffect, useMemo, useState } from "react";
import { Loader2, Wallet, Users, FileText, Leaf, Activity, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useBoletosCarteira, useDevolutivasCarteira, computeCarteiraStats } from "./hooks";
import { StatusCards } from "./StatusCards";
import { BoletosList } from "./BoletosList";
import { DevolutivasList } from "./DevolutivasList";
import { PaymentIntent } from "./PaymentIntent";
import { ConsultantMetricsCard } from "./ConsultantMetricsCard";

const SYNC_STEPS = ["Clientes", "Boletos", "Devolutivas", "Métricas", "Licenças"];

const N = (n: number) => n.toLocaleString("pt-BR");

function HeroKpi({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Users;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex-1 min-w-[140px] rounded-lg border border-border/60 bg-background/40 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-body-alt">
        <Icon className="h-3 w-3" />
        <span>{label}</span>
      </div>
      <p className="mt-1 font-display text-xl font-semibold leading-none tabular-nums text-foreground">
        {value}
      </p>
      {hint && <p className="mt-1 text-[10px] text-muted-foreground font-body-alt">{hint}</p>}
    </div>
  );
}

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
    <div className="font-body-alt space-y-5">
      {/* ═══ Faixa 1 · Hero + KPI ribbon ═══════════════════════════════════ */}
      <section className="rounded-2xl border border-border/60 bg-card overflow-hidden">
        <div className="p-5 sm:p-6 flex flex-col gap-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-muted-foreground font-body-alt">
                <Wallet className="h-3.5 w-3.5" />
                <span>Carteira iGreen</span>
              </div>
              <h2 className="mt-1.5 font-display text-2xl sm:text-[26px] font-semibold tracking-tight text-foreground">
                Sua carteira em números
              </h2>
              <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
                Boletos, devolutivas, injeção e sinais de pagamento — espelho vivo do escritório iGreen.
              </p>
            </div>
            {lastSync && (
              <div className="rounded-full border border-border/60 bg-background/60 px-3 py-1.5 flex items-center gap-2 text-[11px] font-body-alt">
                <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                <span className="text-muted-foreground">Última sincronização</span>
                <strong className="text-foreground font-medium">
                  {new Date(lastSync).toLocaleString("pt-BR")}
                </strong>
              </div>
            )}
          </div>

          {!noData && (
            <div className="flex flex-wrap gap-2.5">
              <HeroKpi
                icon={Users}
                label="Clientes sincronizados"
                value={N(igreenCustomerCount ?? 0)}
                hint="carteira iGreen"
              />
              <HeroKpi
                icon={FileText}
                label="Boletos em aberto"
                value={N(abertos)}
                hint={boletos.length ? `de ${N(boletos.length)} no total` : undefined}
              />
              <HeroKpi
                icon={Activity}
                label="Adimplência"
                value={`${stats.adimplenciaPct}%`}
                hint={`${stats.inadimplenciaPct}% em atraso`}
              />
              <HeroKpi
                icon={Leaf}
                label="kWh compensados"
                value={N(stats.kwhCompensados)}
                hint={`${N(stats.comInjecao)} com injeção`}
              />
            </div>
          )}
        </div>

        {syncing && (
          <div className="border-t border-border/60 bg-muted/30 px-5 py-3">
            <div className="flex items-center gap-2 mb-2 text-xs font-medium text-foreground">
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
                      "text-[10px] px-2 py-1 rounded-full border font-body-alt",
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
          {/* ═══ Faixa 2 · Métricas do consultor (bento largo) ══════════════ */}
          <section className="rounded-2xl border border-border/60 bg-card p-4 sm:p-5">
            <ConsultantMetricsCard consultantId={consultantId} />
          </section>

          {/* ═══ Faixa 3 · Status + Intenção de pagamento (bento 3/2) ═══════ */}
          {boletos.length > 0 && (
            <section className="grid gap-4 lg:grid-cols-5">
              <div className="lg:col-span-3 rounded-2xl border border-border/60 bg-card p-4 sm:p-5">
                <div className="mb-3">
                  <h3 className="font-display text-sm font-semibold text-foreground">Status da carteira</h3>
                  <p className="text-[11px] text-muted-foreground">Faturamento, adimplência e injeção.</p>
                </div>
                <StatusCards stats={stats} />
              </div>
              <div className="lg:col-span-2 rounded-2xl border border-border/60 bg-card overflow-hidden">
                <PaymentIntent boletos={boletos} />
              </div>
            </section>
          )}

          {/* ═══ Faixa 4 · Financeiro (bento 3/2) ═══════════════════════════ */}
          {(boletos.length > 0 || devolutivas.length > 0) && (
            <section className="grid gap-4 lg:grid-cols-5">
              <div className="lg:col-span-3 rounded-2xl border border-border/60 bg-card overflow-hidden">
                <BoletosList boletos={boletos} />
              </div>
              <div className="lg:col-span-2 rounded-2xl border border-border/60 bg-card overflow-hidden">
                <DevolutivasList devolutivas={devolutivas} />
              </div>
            </section>
          )}

          {boletos.length === 0 && igreenCustomerCount != null && (
            <section className="rounded-2xl border border-border/60 bg-muted/30 p-5 text-sm">
              <strong className="font-display font-semibold">{igreenCustomerCount}</strong>{" "}
              {igreenCustomerCount === 1 ? "cliente sincronizado" : "clientes sincronizados"} — sem boletos em aberto no momento.
            </section>
          )}
        </>
      )}
    </div>
  );
}
