/**
 * Banner de saúde da conexão Velip — aparece no topo da aba Ligação.
 * Só mostra alerta quando algo está errado. Estado saudável fica discreto.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AlertCircle, CheckCircle2, Loader2, RefreshCw, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Health {
  ok: boolean;
  configured: boolean;
  webhook_configured?: boolean;
  saldo?: number | null;
  error?: string | null;
}

function fmtSaldo(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
}

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

  useEffect(() => { load(); }, []);

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

  const lowBalance = state.saldo != null && state.saldo < 20;
  return (
    <div className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-xs ${
      lowBalance
        ? "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200"
        : "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200"
    }`}>
      <div className="flex items-center gap-2">
        <CheckCircle2 className="h-3.5 w-3.5" />
        <span className="font-medium">Velip conectado</span>
        {state.webhook_configured === false && (
          <span className="text-amber-700 dark:text-amber-300">(webhook sem auth)</span>
        )}
      </div>
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1">
          <Wallet className="h-3.5 w-3.5" /> Saldo: <strong>{fmtSaldo(state.saldo)}</strong>
        </span>
        <Button size="sm" variant="ghost" onClick={load} disabled={busy} className="h-6 px-2">
          <RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} />
        </Button>
      </div>
    </div>
  );
}
