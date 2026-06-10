import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Props {
  consultantId: string;
  onSynced?: () => void;
  size?: "default" | "sm";
}

interface SyncResult {
  synced: number;
  total_campaigns: number;
  auto_paused: number;
  errors: Array<{ campaign_id: string; fb_campaign_id: string | null; error: string }>;
  scope: "consultant" | "all";
}

/**
 * Botão "Sincronizar agora" — força a edge function `facebook-sync-metrics`
 * a buscar dados frescos da Meta para as campanhas do consultor logado.
 * Mostra um relatório claro: quantas sincronizaram, quais deram erro e por quê.
 */
export function SyncMetricsButton({ consultantId, onSynced, size = "sm" }: Props) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const { toast } = useToast();

  async function handleSync() {
    setLoading(true);
    setErrorMsg(null);
    try {
      const { data, error } = await supabase.functions.invoke("facebook-sync-metrics", {
        body: { consultant_id: consultantId },
      });
      if (error) throw error;
      const d = data as SyncResult & { error?: string };
      if (d?.error) throw new Error(d.error);
      setResult(d);

      const errs = d.errors?.length || 0;
      if (d.synced > 0 && errs === 0) {
        toast({
          title: "Métricas atualizadas",
          description: `${d.synced} campanha${d.synced === 1 ? "" : "s"} sincronizada${d.synced === 1 ? "" : "s"} com a Meta.`,
        });
      } else if (d.synced > 0 && errs > 0) {
        toast({
          title: `${d.synced} campanhas sincronizadas, ${errs} com erro`,
          description: "Veja o detalhe no relatório.",
          variant: "destructive",
        });
        setReportOpen(true);
      } else if (d.total_campaigns === 0) {
        toast({
          title: "Nenhuma campanha pra sincronizar",
          description: "Crie sua primeira campanha em Modelos.",
        });
      } else {
        toast({
          title: "Falha em todas as campanhas",
          description: "Veja o relatório.",
          variant: "destructive",
        });
        setReportOpen(true);
      }
      onSynced?.();
    } catch (e: any) {
      const msg = e?.message || "Erro desconhecido";
      setErrorMsg(msg);
      toast({
        title: "Falha ao sincronizar",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <Button
          size={size}
          variant="outline"
          onClick={handleSync}
          disabled={loading}
          className="gap-1.5"
          title="Puxar dados atualizados da Meta agora"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          {loading ? "Sincronizando..." : "Sincronizar agora"}
        </Button>
        {result && !loading && (
          <Button size={size} variant="ghost" onClick={() => setReportOpen(true)} className="gap-1.5 text-xs">
            {result.errors.length > 0 ? (
              <AlertTriangle className="w-3.5 h-3.5 text-warning" />
            ) : (
              <CheckCircle2 className="w-3.5 h-3.5 text-primary" />
            )}
            Ver último sync
          </Button>
        )}
      </div>

      <Dialog open={reportOpen} onOpenChange={setReportOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-primary" />
              Relatório de sincronização
            </DialogTitle>
            <DialogDescription>
              Detalhes do último puxe de dados da Meta.
            </DialogDescription>
          </DialogHeader>

          {result && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-primary/10 border border-primary/30 p-2">
                  <div className="text-xs text-muted-foreground">Sincronizadas</div>
                  <div className="text-lg font-bold text-primary">{result.synced}</div>
                </div>
                <div className="rounded-lg bg-secondary p-2">
                  <div className="text-xs text-muted-foreground">Total</div>
                  <div className="text-lg font-bold text-foreground">{result.total_campaigns}</div>
                </div>
                <div className={`rounded-lg p-2 border ${result.errors.length > 0 ? "bg-destructive/10 border-destructive/30" : "bg-secondary border-border"}`}>
                  <div className="text-xs text-muted-foreground">Erros</div>
                  <div className={`text-lg font-bold ${result.errors.length > 0 ? "text-destructive" : "text-foreground"}`}>
                    {result.errors.length}
                  </div>
                </div>
              </div>

              {result.auto_paused > 0 && (
                <div className="rounded-lg bg-warning/10 border border-warning/30 p-2 text-xs">
                  <strong className="text-warning">⚠ {result.auto_paused} campanha(s) auto-pausada(s)</strong>
                  <p className="text-muted-foreground mt-0.5">
                    Por saldo baixo, criativo cansado, ou CPL elevado. Veja a lista de campanhas para detalhes.
                  </p>
                </div>
              )}

              {result.errors.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-xs font-semibold text-destructive">Erros por campanha:</div>
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {result.errors.map((e, i) => (
                      <div key={i} className="rounded border border-destructive/20 bg-destructive/5 p-2 text-xs">
                        <code className="text-muted-foreground">{e.fb_campaign_id || e.campaign_id.slice(0, 8)}</code>
                        <p className="text-foreground mt-0.5">{e.error}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {result.errors.length === 0 && result.synced > 0 && (
                <div className="rounded-lg bg-primary/10 border border-primary/30 p-2 text-xs text-primary flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  Todas as campanhas sincronizadas com sucesso.
                </div>
              )}
            </div>
          )}

          {errorMsg && !result && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive">
              {errorMsg}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setReportOpen(false)}>Fechar</Button>
            <Button onClick={handleSync} disabled={loading}>
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <RefreshCw className="w-3.5 h-3.5 mr-1" />}
              Sincronizar de novo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
