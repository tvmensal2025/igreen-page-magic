/**
 * Banner de saúde da conexão Velip — aparece no topo da aba Ligação.
 * Mostra saldo Velip + gasto hoje / semana / mês do consultor logado.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AlertCircle, CheckCircle2, Loader2, RefreshCw, Wallet, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Spend {
  spend_today: number;
  spend_week: number;
  spend_month: number;
  answered_count: number;
  avg_cost_per_answered: number;
}
interface Health {
  ok: boolean;
  configured: boolean;
  webhook_configured?: boolean;
  saldo?: number | null;
  spend?: Spend | null;
  error?: string | null;
}

const fmt = (n: number | null | undefined) =>
  n == null || Number.isNaN(n)
    ? "—"
    : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);

export function VelipHealthBanner() {
  const [state, setState] = useState<Health | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("voice-dialer-health", { body: {} });
      if (error) setState({ ok: false, configured: false, error: error.message });
      else setState(data as Health);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { void load(); }, []);

  if (!state) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border/40 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Verificando conexão Velip…
      </div>
    );
  }

  if (!state.configured) {
    return (
      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
        <div className="flex items-center gap-2 font-medium">
          <AlertCircle className="h-4 w-4" /> Velip não conectado
        </div>
        <p className="mt-1">Configure <code>VELIP_API_TOKEN</code> e <code>VELIP_WEBHOOK_AUTH</code> nos secrets para começar a discar.</p>
      </div>
    );
  }

  if (!state.ok) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-medium">
            <AlertCircle className="h-4 w-4" /> Velip indisponível — {state.error || "erro desconhecido"}
          </div>
          <Button size="sm" variant="ghost" onClick={load} disabled={busy}>
            <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>
    );
  }

  const saldo = state.saldo;
  const spendMonth = state.spend?.spend_month ?? 0;
  const avgDay = spendMonth / 30;
  const lowBalance = saldo != null && avgDay > 0 && saldo < avgDay;
  const critical = saldo != null && avgDay > 0 && saldo < avgDay * 3;

  const isOk = !critical && !lowBalance;
  const toneClass = critical
    ? "border-destructive/50 bg-destructive/10 text-destructive"
    : lowBalance
      ? "border-amber-500/50 bg-amber-500/10 text-amber-900 dark:text-amber-100"
      : "border-primary bg-primary text-primary-foreground";

  return (
    <div className={`rounded-md border px-3 py-2.5 text-xs ${toneClass}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-3.5 w-3.5" />
          <span className="font-medium">Velip conectado</span>
          {state.webhook_configured === false && (
            <span className={isOk ? "text-amber-100" : "text-amber-700 dark:text-amber-300"}>(webhook sem auth)</span>
          )}
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={load}
          disabled={busy}
          className={`h-6 px-2 ${isOk ? "text-primary-foreground hover:bg-white/15 hover:text-primary-foreground" : ""}`}
        >
          <RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} />
        </Button>
      </div>
      <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
        {/* API v2 da Velip não expõe saldo — quando null, orientar o painel deles */}
        <Metric
          icon={<Wallet className="h-3 w-3" />}
          label="Saldo"
          value={saldo == null ? "ver painel Velip" : fmt(saldo)}
          strong={saldo != null}
          onGreen={isOk}
        />
        <Metric icon={<TrendingUp className="h-3 w-3" />} label="Hoje" value={fmt(state.spend?.spend_today ?? 0)} onGreen={isOk} />
        <Metric label="7 dias" value={fmt(state.spend?.spend_week ?? 0)} onGreen={isOk} />
        <Metric label="30 dias" value={fmt(spendMonth)} onGreen={isOk} />
      </div>
      {state.spend && state.spend.answered_count > 0 && (
        <div className="mt-1.5 text-[10.5px] opacity-80">
          {state.spend.answered_count} atendidas · custo médio {fmt(state.spend.avg_cost_per_answered)}
        </div>
      )}
      {critical && (
        <div className="mt-1.5 font-semibold">⚠️ Saldo insuficiente para 3 dias no ritmo atual.</div>
      )}
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
  strong,
  onGreen,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  strong?: boolean;
  onGreen?: boolean;
}) {
  return (
    <div className={`flex flex-col rounded px-2 py-1 ${onGreen ? "bg-white/15" : "bg-background/40"}`}>
      <span className="flex items-center gap-1 text-[10px] uppercase tracking-wide opacity-80">
        {icon} {label}
      </span>
      <span className={strong ? "text-sm font-bold" : "text-sm font-semibold"}>{value}</span>
    </div>
  );
}
