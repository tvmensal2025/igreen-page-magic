// =============================================================================
// Painel Carteira Green — espelha o /clientes-green do escritório iGreen.
// Mostra boletos, devolutivas e sinais de pagamento a partir dos dados já
// capturados pelo worker `sync-igreen-customers`.
// =============================================================================

import { useMemo, useState } from "react";
import { RefreshCw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { runIgreenSync } from "@/lib/igreenSync";
import { useBoletosCarteira, useDevolutivasCarteira, computeCarteiraStats } from "./hooks";
import { StatusCards } from "./StatusCards";
import { BoletosList } from "./BoletosList";
import { DevolutivasList } from "./DevolutivasList";
import { PaymentIntent } from "./PaymentIntent";

const SYNC_STEPS = [
  "Clientes",
  "Boletos",
  "Devolutivas",
  "Métricas",
  "Rede",
  "Telecom",
  "Seguros",
  "Licenças",
];

export function CarteiraGreenPanel({ consultantId }: { consultantId: string }) {
  const { data: boletos = [], isLoading: loadingB, refetch: refetchB } = useBoletosCarteira(consultantId);
  const { data: devolutivas = [], isLoading: loadingD, refetch: refetchD } = useDevolutivasCarteira(consultantId);
  const [syncing, setSyncing] = useState(false);
  const [syncStartedAt, setSyncStartedAt] = useState<number | null>(null);
  const { toast } = useToast();

  const stats = useMemo(() => computeCarteiraStats(boletos), [boletos]);
  const lastSync = boletos[0]?.synced_at;
  const lastSyncTs = lastSync ? new Date(lastSync).getTime() : 0;

  const handleSync = async () => {
    setSyncing(true);
    setSyncStartedAt(Date.now());
    const res = await runIgreenSync(consultantId, "sync_all");
    if (!res.ok) {
      setSyncing(false);
      setSyncStartedAt(null);
      toast({
        title: "Falha ao sincronizar",
        description: (res as { error: string }).error,
        variant: "destructive",
      });
      return;
    }
    toast({
      title: "Sincronização iniciada",
      description: "Puxando clientes, boletos, devolutivas, métricas, rede, telecom, seguros e licenças…",
    });
    // Polling: recarrega a cada 10s por até 60s; para quando synced_at avança.
    const startedAt = Date.now();
    const baseline = lastSyncTs;
    const interval = setInterval(async () => {
      const [b] = await Promise.all([refetchB(), refetchD()]);
      const newTs = b.data?.[0]?.synced_at ? new Date(b.data[0].synced_at).getTime() : 0;
      const elapsed = Date.now() - startedAt;
      if (newTs > baseline || elapsed > 60_000) {
        clearInterval(interval);
        setSyncing(false);
        setSyncStartedAt(null);
        if (newTs > baseline) {
          toast({ title: "Carteira atualizada", description: "Dados recém-sincronizados carregados." });
        }
      }
    }, 10_000);
  };

  if (loadingB || loadingD) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
        <Loader2 className="h-5 w-5 animate-spin" /> Carregando carteira…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold">Carteira Green</h2>
          <p className="text-xs text-muted-foreground">
            Boletos, devolutivas e injeção de energia — espelho do escritório iGreen.
            {lastSync && (
              <> · Última sync: {new Date(lastSync).toLocaleString("pt-BR")}</>
            )}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={handleSync} disabled={syncing}>
          {syncing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          Sincronizar agora
        </Button>
      </header>

      {boletos.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/60 p-8 text-center space-y-2">
          <p className="text-sm font-medium">Sem dados sincronizados ainda</p>
          <p className="text-xs text-muted-foreground">
            Clique em "Sincronizar agora" para puxar sua carteira do escritório iGreen.
          </p>
        </div>
      ) : (
        <>
          <StatusCards stats={stats} />
          <PaymentIntent boletos={boletos} />
          <div className="grid gap-6 lg:grid-cols-5">
            <div className="lg:col-span-3">
              <BoletosList boletos={boletos} />
            </div>
            <div className="lg:col-span-2">
              <DevolutivasList devolutivas={devolutivas} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
