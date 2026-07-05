import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Zap, Users, Phone, Shield, FileText, TrendingUp, Network } from "lucide-react";
import { cn } from "@/lib/utils";

interface IGreenSyncStatusBarProps {
  consultantId: string;
  className?: string;
}

interface Row {
  status: string | null;
  counts: Record<string, unknown> | null;
  finished_at: string | null;
  started_at: string | null;
  consultant_igreen_id?: string | null;
  portal_igreen_id?: string | null;
}

function pickNumber(obj: unknown, keys: string[]): number | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "number") return v;
    if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) return Number(v);
  }
  return null;
}

function extractCount(counts: Record<string, unknown> | null, key: string, subkeys: string[]): number | null {
  if (!counts) return null;
  const node = counts[key];
  if (typeof node === "number") return node;
  return pickNumber(node, subkeys);
}

function pickBoolAsNumber(obj: unknown, keys: string[]): number | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  for (const key of keys) {
    const v = o[key];
    if (typeof v === "boolean") return v ? 1 : 0;
  }
  return null;
}

/**
 * Mostra em uma barrinha o que a última sync do consultor efetivamente
 * trouxe do portal iGreen — clientes, rede, telecom, seguros, boletos,
 * métricas. Números vindos direto de `igreen_sync_runs.counts` e da
 * fase B agregada em `counts.extras` (o worker grava lá quando termina).
 */
export function IGreenSyncStatusBar({ consultantId, className }: IGreenSyncStatusBarProps) {
  const { data } = useQuery({
    queryKey: ["igreen-sync-status", consultantId],
    enabled: !!consultantId,
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async (): Promise<Row | null> => {
      const [{ data: run }, { data: consultant }] = await Promise.all([
        supabase
          .from("igreen_sync_runs" as never)
          .select("status, counts, finished_at, started_at")
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
      if (!run) return null;
      return {
        ...(run as Row),
        consultant_igreen_id: (consultant as { igreen_id?: string | null } | null)?.igreen_id ?? null,
        portal_igreen_id: (consultant as { igreen_consultor_id?: string | null } | null)?.igreen_consultor_id ?? null,
      };
    },
  });

  if (!data) return null;

  const counts = data.counts ?? {};
  const extras = ((counts as any).extras ?? {}) as Record<string, unknown>;

  const energia = extractCount(counts, "customers", ["processed", "total_from_portal", "updated"]);
  const network = extractCount(extras, "network", ["total_members", "updated", "persisted", "imported", "processed", "total"]);
  const telecom = extractCount(extras, "telecom", ["telecom_received", "telecom_saved", "telecom_valid_rows", "persisted", "imported", "processed", "total"]);
  const seguros = extractCount(extras, "seguros", ["seguros_received", "seguros_saved", "seguros_valid_rows", "persisted", "imported", "processed", "total"]);
  const boletos = extractCount(extras, "boletos", ["boletos_received", "boletos_saved", "persisted", "imported", "processed", "total"]);
  const metrics = extractCount(extras, "metrics", ["metrics_received", "persisted", "saved", "processed"]) ?? pickBoolAsNumber(extras.metrics, ["metrics_saved"]);
  const telecomDiag = (extras.diagnostics as { telecom?: Record<string, unknown> } | undefined)?.telecom;
  const segurosDiag = (extras.diagnostics as { seguros?: Record<string, unknown> } | undefined)?.seguros;
  const identityMismatch = data.consultant_igreen_id && data.portal_igreen_id && data.consultant_igreen_id !== data.portal_igreen_id;

  const items: Array<{ icon: JSX.Element; label: string; value: number | null; hint?: string }> = [
    { icon: <Zap className="w-3 h-3" />, label: "Energia", value: energia },
    { icon: <Network className="w-3 h-3" />, label: "Rede", value: network },
    { icon: <Phone className="w-3 h-3" />, label: "Telecom", value: telecom, hint: telecom === 0 ? `Portal iGreen devolveu 0 clientes de Telecom${telecomDiag?.crm_columns != null ? ` (${telecomDiag.crm_columns} colunas lidas)` : ""}` : undefined },
    { icon: <Shield className="w-3 h-3" />, label: "Seguros", value: seguros, hint: seguros === 0 ? `Portal iGreen devolveu 0 clientes de Seguros${segurosDiag?.crm_columns != null ? ` (${segurosDiag.crm_columns} colunas lidas)` : ""}` : undefined },
    { icon: <FileText className="w-3 h-3" />, label: "Boletos", value: boletos },
    { icon: <TrendingUp className="w-3 h-3" />, label: "Métricas", value: metrics },
  ];

  const when = data.finished_at || data.started_at;
  const whenLabel = when ? new Date(when).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : null;

  return (
    <div className={cn(
      "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border/50 bg-card/60 px-3 py-2 text-[11px] text-muted-foreground",
      className,
    )}>
      <div className="flex items-center gap-1.5 font-medium text-foreground/80">
        <Users className="w-3.5 h-3.5 text-primary" /> iGreen sync
      </div>
      {identityMismatch && (
        <span
          className="inline-flex items-center gap-1 text-amber-500/80"
          title="O ID salvo no cadastro é diferente do ID retornado pelo login do Escritório iGreen. O sistema usa o ID do portal para a sincronização."
        >
          Portal: <b className="text-foreground/90">{data.portal_igreen_id}</b>
        </span>
      )}
      {items.map((it) => (
        <span
          key={it.label}
          title={it.hint}
          className={cn(
            "inline-flex items-center gap-1",
            it.value == null && "opacity-40",
            it.value === 0 && "text-amber-500/70",
          )}
        >
          {it.icon}
          <span>{it.label}:</span>
          <b className="text-foreground/90">{it.value ?? "—"}</b>
        </span>
      ))}
      {whenLabel && <span className="ml-auto text-[10px]">Última: {whenLabel}</span>}
    </div>
  );
}
