import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Zap, Phone, Shield, FileText, TrendingUp, Network, RefreshCw, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface IGreenSyncStatusBarProps {
  consultantId: string;
  className?: string;
}

interface Snapshot {
  energia: number | null;
  rede: number | null;
  telecom: number | null;
  seguros: number | null;
  boletos: number | null;
  metricas: number | null;
  metricasUpdatedAt: string | null;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  consultantIgreenId: string | null;
  portalIgreenId: string | null;
}

async function countTable(
  table: string,
  consultantId: string,
): Promise<number | null> {
  try {
    const { count, error } = await supabase
      .from(table as never)
      .select("*", { count: "exact", head: true })
      .eq("consultant_id", consultantId);
    if (error) return null;
    return count ?? 0;
  } catch {
    return null;
  }
}

/**
 * Card de "Última sincronização iGreen" — mostra a fotografia real
 * do que está no banco pro consultor logado, contando direto nas
 * tabelas de destino (não depende do shape do último run).
 */
export function IGreenSyncStatusBar({ consultantId, className }: IGreenSyncStatusBarProps) {
  const { data, isFetching, refetch } = useQuery({
    queryKey: ["igreen-sync-snapshot", consultantId],
    enabled: !!consultantId,
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async (): Promise<Snapshot> => {
      const [
        energia,
        rede,
        telecom,
        seguros,
        boletos,
        metricasRow,
        lastRun,
        consultant,
      ] = await Promise.all([
        countTable("customers", consultantId),
        countTable("network_members", consultantId),
        countTable("igreen_telecom_customers", consultantId),
        countTable("igreen_seguros_customers", consultantId),
        countTable("igreen_customer_boletos", consultantId),
        supabase
          .from("igreen_consultant_metrics" as never)
          .select("updated_at, created_at")
          .eq("consultant_id", consultantId)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("igreen_sync_runs" as never)
          .select("status, finished_at, started_at")
          .eq("consultant_id", consultantId)
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("consultants")
          .select("igreen_id, igreen_consultor_id")
          .eq("id", consultantId)
          .maybeSingle(),
      ]);

      const metricRow = (metricasRow.data ?? null) as { updated_at?: string | null; created_at?: string | null } | null;
      const runRow = (lastRun.data ?? null) as { status?: string | null; finished_at?: string | null; started_at?: string | null } | null;
      const consultantRow = (consultant.data ?? null) as { igreen_id?: string | null; igreen_consultor_id?: string | null } | null;

      return {
        energia,
        rede,
        telecom,
        seguros,
        boletos,
        metricas: metricRow ? 1 : 0,
        metricasUpdatedAt: metricRow?.updated_at ?? metricRow?.created_at ?? null,
        lastRunAt: runRow?.finished_at ?? runRow?.started_at ?? null,
        lastRunStatus: runRow?.status ?? null,
        consultantIgreenId: consultantRow?.igreen_id ?? null,
        portalIgreenId: consultantRow?.igreen_consultor_id ?? null,
      };
    },
  });

  if (!data) {
    return (
      <div className={cn("rounded-lg border border-border/50 bg-card/60 p-4 text-xs text-muted-foreground", className)}>
        Carregando status do iGreen…
      </div>
    );
  }

  const identityMismatch =
    data.consultantIgreenId &&
    data.portalIgreenId &&
    data.consultantIgreenId !== data.portalIgreenId;

  const whenLabel = data.lastRunAt
    ? new Date(data.lastRunAt).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  const metricasLabel = (() => {
    if (data.metricas === null) return null;
    if (data.metricas === 0) return 0;
    if (data.metricasUpdatedAt) {
      return new Date(data.metricasUpdatedAt).toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
      });
    }
    return "OK";
  })();

  const tiles: Array<{
    icon: JSX.Element;
    label: string;
    value: number | string | null;
  }> = [
    { icon: <Zap className="w-4 h-4" />, label: "Energia", value: data.energia },
    { icon: <Network className="w-4 h-4" />, label: "Rede", value: data.rede },
    { icon: <Phone className="w-4 h-4" />, label: "Telecom", value: data.telecom },
    { icon: <Shield className="w-4 h-4" />, label: "Seguros", value: data.seguros },
    { icon: <FileText className="w-4 h-4" />, label: "Boletos", value: data.boletos },
    { icon: <TrendingUp className="w-4 h-4" />, label: "Métricas", value: metricasLabel },
  ];

  const statusColor =
    data.lastRunStatus === "success"
      ? "text-emerald-500"
      : data.lastRunStatus === "error" || data.lastRunStatus === "failed"
        ? "text-rose-500"
        : "text-muted-foreground";

  return (
    <div className={cn("rounded-xl border border-border/60 bg-card p-4 space-y-4", className)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            Última sincronização iGreen
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {whenLabel ? (
              <>
                {whenLabel}
                {data.lastRunStatus && (
                  <>
                    {" · "}
                    <span className={statusColor}>{data.lastRunStatus}</span>
                  </>
                )}
              </>
            ) : (
              "Ainda não sincronizado"
            )}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          className="h-8 gap-1.5 text-xs"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", isFetching && "animate-spin")} />
          Atualizar
        </Button>
      </div>

      {identityMismatch && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            O ID do cadastro (<b>{data.consultantIgreenId}</b>) é diferente do ID retornado pelo Portal iGreen (<b>{data.portalIgreenId}</b>). O sync usa o ID do portal.
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        {tiles.map((t) => {
          const isEmpty = t.value === 0;
          const isUnknown = t.value === null || t.value === undefined;
          return (
            <div
              key={t.label}
              className={cn(
                "flex flex-col items-start gap-1 rounded-lg border border-border/50 bg-background/40 p-3",
                isUnknown && "opacity-60",
              )}
            >
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="text-primary">{t.icon}</span>
                {t.label}
              </div>
              <div
                className={cn(
                  "text-xl font-semibold tabular-nums text-foreground",
                  isEmpty && "text-amber-500",
                  isUnknown && "text-muted-foreground",
                )}
              >
                {isUnknown
                  ? "—"
                  : typeof t.value === "number"
                    ? t.value.toLocaleString("pt-BR")
                    : t.value}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
