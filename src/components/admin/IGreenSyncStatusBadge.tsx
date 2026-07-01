import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, KeyRound, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

type Props = {
  userId: string;
  /** Chamado quando o consultor precisa configurar. Ex: abrir o Sheet de Configurações. */
  onConfigure?: () => void;
};

type LastRun = {
  status: string;
  finished_at: string | null;
  started_at: string;
  counts: Record<string, unknown> | null;
};

/**
 * Badge unificada de status da sincronização iGreen. Fica ao lado do botão
 * "Sincronizar" na aba Clientes/Carteira. Se o consultor não configurou o
 * portal iGreen, mostra CTA vermelho pedindo para ligar. Se configurou,
 * mostra o resultado da última execução (ok / waf / inválido / falha).
 */
export function IGreenSyncStatusBadge({ userId, onConfigure }: Props) {
  const [hasCred, setHasCred] = useState<boolean | null>(null);
  const [credStatus, setCredStatus] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<LastRun | null>(null);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    const load = async () => {
      const [{ data: c }, { data: runs }] = await Promise.all([
        supabase
          .from("consultants")
          .select("igreen_portal_email, igreen_credential_status")
          .eq("id", userId)
          .maybeSingle(),
        supabase
          .from("igreen_sync_runs")
          .select("status, finished_at, started_at, counts")
          .eq("consultant_id", userId)
          .order("started_at", { ascending: false })
          .limit(1),
      ]);
      if (!alive) return;
      setHasCred(!!c?.igreen_portal_email);
      setCredStatus((c as { igreen_credential_status?: string } | null)?.igreen_credential_status ?? null);
      setLastRun((runs?.[0] as LastRun | undefined) ?? null);
    };
    load();
    const t = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(t); };
  }, [userId]);

  if (hasCred === null) return null;

  if (!hasCred) {
    return (
      <Button
        size="sm"
        variant="destructive"
        onClick={onConfigure}
        className="gap-1.5"
      >
        <KeyRound className="h-3.5 w-3.5" />
        Ligar iGreen
      </Button>
    );
  }

  const status = lastRun?.status ?? credStatus ?? "unknown";
  const when = lastRun?.finished_at || lastRun?.started_at;
  const whenLabel = when ? formatDistanceToNow(new Date(when), { addSuffix: true, locale: ptBR }) : "aguardando";

  const style =
    status === "ok" || status === "valid"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : status === "waf_blocked"
      ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
      : status === "invalid_credentials"
      ? "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300"
      : status === "running"
      ? "border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300"
      : "border-muted bg-muted/40 text-muted-foreground";

  const Icon =
    status === "ok" || status === "valid" ? CheckCircle2
    : status === "waf_blocked" ? ShieldAlert
    : status === "invalid_credentials" ? AlertTriangle
    : CheckCircle2;

  const label =
    status === "ok" || status === "valid" ? "iGreen conectado"
    : status === "waf_blocked" ? "iGreen bloqueado (WAF)"
    : status === "invalid_credentials" ? "iGreen — senha inválida"
    : status === "running" ? "iGreen sincronizando…"
    : "iGreen aguardando 1º sync";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${style}`}
      title={`Última execução: ${whenLabel}`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
      <span className="opacity-70">· {whenLabel}</span>
    </span>
  );
}
