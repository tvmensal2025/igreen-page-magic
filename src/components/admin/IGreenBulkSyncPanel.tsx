import { useEffect, useMemo, useState } from "react";
import { Loader2, PlayCircle, RefreshCw, Users2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

/**
 * Painel admin para disparar "Sincronizar TODOS" os consultores com credenciais
 * iGreen configuradas. Reaproveita o fluxo `source=bulk_manual` da edge
 * `sync-igreen-customers`, que já roda em background (EdgeRuntime.waitUntil)
 * consultor-a-consultor com 3s de espaçamento. O progresso é lido da tabela
 * `igreen_bulk_sync_state`.
 */

interface BulkState {
  id: string;
  status: string;
  total: number;
  completed: number;
  failed: number;
  current_consultant_id: string | null;
  consultant_ids: string[];
  results: Record<string, { name?: string; success?: boolean; error?: string | null }>;
  updated_at: string;
}

export function IGreenBulkSyncPanel() {
  const { toast } = useToast();
  const [starting, setStarting] = useState(false);
  const [eligibleCount, setEligibleCount] = useState<number | null>(null);
  const [state, setState] = useState<BulkState | null>(null);

  // Conta consultores elegíveis (têm email+senha do portal).
  useEffect(() => {
    (async () => {
      const { count } = await supabase
        .from("consultants")
        .select("id", { count: "exact", head: true })
        .eq("approved", true)
        .not("igreen_portal_email", "is", null)
        .not("igreen_portal_password", "is", null);
      setEligibleCount(count ?? 0);
    })();
  }, []);

  // Puxa o bulk_state mais recente e faz polling enquanto está rodando.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const { data } = await supabase
        .from("igreen_bulk_sync_state")
        .select("id,status,total,completed,failed,current_consultant_id,consultant_ids,results,updated_at")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (alive && data) setState(data as unknown as BulkState);
    };
    load();
    const iv = setInterval(load, 5000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  const running = state?.status === "running";
  const progressPct = useMemo(() => {
    if (!state?.total) return 0;
    return Math.min(100, Math.round(((state.completed + state.failed) / state.total) * 100));
  }, [state]);

  const failedIds = useMemo(() => {
    if (!state?.results) return [] as string[];
    return Object.entries(state.results).filter(([, v]) => v && !v.success).map(([id]) => id);
  }, [state]);

  const startAll = async (retryOnly = false) => {
    setStarting(true);
    try {
      const body: Record<string, unknown> = { source: "bulk_manual", mode: "sync_all" };
      if (retryOnly && failedIds.length > 0) body.consultant_ids = failedIds;
      const { data, error } = await supabase.functions.invoke("sync-igreen-customers", { body });
      if (error) throw error;
      toast({
        title: retryOnly ? "Retomando falhas" : "Sincronização iniciada",
        description: `${(data as any)?.total_consultants ?? 0} consultor(es) na fila. Roda em background (~3-6 min por consultor).`,
      });
    } catch (e: any) {
      toast({ title: "Falha ao iniciar", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-3 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Users2 className="w-4 h-4 text-primary shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-medium">Sincronizar TODOS os consultores</div>
            <div className="text-[11px] text-muted-foreground truncate">
              {eligibleCount == null
                ? "Contando consultores com credenciais…"
                : `${eligibleCount} consultor(es) com credenciais iGreen configuradas. Roda 1 por vez em background.`}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {failedIds.length > 0 && !running && (
            <Button size="sm" variant="outline" onClick={() => startAll(true)} disabled={starting} className="h-7 text-[11px] gap-1">
              <RefreshCw className="w-3 h-3" /> Retomar falhas ({failedIds.length})
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => startAll(false)}
            disabled={starting || running || !eligibleCount}
            className="h-7 text-[11px] gap-1"
          >
            {starting || running ? <Loader2 className="w-3 h-3 animate-spin" /> : <PlayCircle className="w-3 h-3" />}
            {running ? "Rodando…" : starting ? "Iniciando…" : "Sincronizar TODOS"}
          </Button>
        </div>
      </div>

      {state && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              {state.status === "running" ? "Em progresso" : state.status === "finished" ? "Concluído" : state.status}
              {" · "}
              {state.completed + state.failed}/{state.total} processados
              {state.failed > 0 && ` · ${state.failed} falha(s)`}
            </span>
            <span>{progressPct}%</span>
          </div>
          <div className="h-1.5 w-full bg-muted rounded overflow-hidden">
            <div
              className={`h-full transition-all ${state.failed > 0 ? "bg-amber-500" : "bg-primary"}`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
          {running && state.current_consultant_id && (
            <div className="text-[10px] text-muted-foreground">
              Atual: <code className="text-primary">{(state.results?.[state.current_consultant_id]?.name) || state.current_consultant_id}</code>
            </div>
          )}
          {!running && state.failed > 0 && (
            <div className="text-[10px] text-amber-600 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              {state.failed} consultor(es) falharam — use "Retomar falhas" para tentar de novo.
            </div>
          )}
          {!running && state.failed === 0 && state.completed === state.total && state.total > 0 && (
            <div className="text-[10px] text-emerald-600 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> Todos sincronizados com sucesso.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
