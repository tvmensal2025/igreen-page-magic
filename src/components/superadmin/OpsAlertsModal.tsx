/**
 * Modal Super Admin — histórico de alertas operacionais (enviou / não enviou).
 * Fontes: infra_metrics (ops_alert, minio_alert) + platform_low_balance_alerts.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Bell, CheckCircle2, Loader2, RefreshCw, XCircle } from "lucide-react";

type OpsRow = {
  id: string;
  metric_key: string;
  created_at: string;
  meta: {
    key?: string;
    severity?: string;
    text?: string;
    sent?: boolean;
    reason?: string;
    status?: number;
    channel?: string;
    consultant_id?: string;
    consultant_name?: string;
    consultant_wa_sent?: boolean;
    consultant_wa_reason?: string;
    alert_phone?: string | null;
    balance_cents?: number;
    debt_cents?: number;
  };
};

type LowBalanceRow = {
  consultant_id: string;
  last_notified_at: string;
  last_balance_cents: number | null;
  last_debt_cents: number | null;
  consultants?: { name: string | null; display_name: string | null } | null;
};

function fmtMoney(cents: number | null | undefined): string {
  const n = Number(cents);
  if (!Number.isFinite(n)) return "—";
  return (n / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function labelKey(key?: string): string {
  const k = String(key || "");
  if (k === "igreen_fone_wallets_zero") return "iGreen Fone — carteiras zeradas";
  if (k.startsWith("igreen_fone")) return "iGreen Fone zerado";
  if (k.startsWith("worker:")) return "Worker / serviço";
  if (k === "velip_credit") return "Velip crédito";
  if (k === "ops_daily_ok") return "Resumo do dia (ok)";
  if (k === "smoke_test") return "Teste de alerta";
  if (k.includes("minio")) return "MinIO";
  if (k.includes("cadence")) return "Cadência";
  if (k.includes("whapi")) return "Whapi";
  return k || "Alerta";
}

function SentBadge({ sent, reason }: { sent?: boolean; reason?: string }) {
  if (sent === true) {
    return (
      <Badge variant="secondary" className="text-[10px] gap-1 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="w-3 h-3" /> Enviado
      </Badge>
    );
  }
  const why = reason === "sa_dedup"
    ? "Dedup"
    : reason === "config_missing"
      ? "Sem config"
      : reason || "Não enviado";
  return (
    <Badge variant="destructive" className="text-[10px] gap-1">
      <XCircle className="w-3 h-3" /> {why}
    </Badge>
  );
}

export function OpsAlertsModal() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ops, setOps] = useState<OpsRow[]>([]);
  const [lowBalance, setLowBalance] = useState<LowBalanceRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [{ data: metrics, error: mErr }, { data: low, error: lErr }] = await Promise.all([
        supabase
          .from("infra_metrics" as never)
          .select("id, metric_key, created_at, meta")
          .in("metric_key", ["ops_alert", "minio_alert"])
          .order("created_at", { ascending: false })
          .limit(80),
        supabase
          .from("platform_low_balance_alerts" as never)
          .select(
            "consultant_id, last_notified_at, last_balance_cents, last_debt_cents, consultants(name, display_name)",
          )
          .order("last_notified_at", { ascending: false })
          .limit(40),
      ]);
      if (mErr) throw mErr;
      setOps((metrics as OpsRow[]) || []);
      // RLS pode negar low-balance até a policy; não quebra o modal.
      if (lErr) {
        console.warn("[ops-alerts] low_balance:", lErr.message);
        setLowBalance([]);
      } else {
        setLowBalance((low as LowBalanceRow[]) || []);
      }
    } catch (e) {
      setError((e as Error)?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5 shrink-0">
          <Bell className="w-3.5 h-3.5" />
          Ver alertas
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[calc(100%-2rem)] max-w-2xl max-h-[min(90dvh,880px)] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-primary" />
            Alertas operacionais
          </DialogTitle>
          <DialogDescription>
            Histórico do que foi (ou não) enviado no WhatsApp — super-admin e iGreen Fone dos consultores.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-2 pb-2 border-b border-border">
          <p className="text-[11px] text-muted-foreground">
            Inclui enviados, falhas, dedup e falta de telefone.
          </p>
          <Button size="sm" variant="ghost" onClick={() => void load()} disabled={loading} className="h-8 gap-1">
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Atualizar
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-5 pr-1 min-h-0">
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <section className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              iGreen Fone — último aviso por consultor
            </h4>
            {loading && lowBalance.length === 0 ? (
              <p className="text-xs text-muted-foreground">Carregando…</p>
            ) : lowBalance.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhum aviso de saldo zerado registrado.</p>
            ) : (
              <ul className="space-y-2">
                {lowBalance.map((r) => {
                  const nome =
                    r.consultants?.display_name ||
                    r.consultants?.name ||
                    r.consultant_id.slice(0, 8);
                  return (
                    <li
                      key={r.consultant_id}
                      className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-sm"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{nome}</span>
                        <Badge variant="outline" className="text-[10px]">
                          saldo {fmtMoney(r.last_balance_cents)}
                        </Badge>
                        {(r.last_debt_cents ?? 0) > 0 && (
                          <Badge variant="destructive" className="text-[10px]">
                            dívida {fmtMoney(r.last_debt_cents)}
                          </Badge>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        Último aviso:{" "}
                        {new Date(r.last_notified_at).toLocaleString("pt-BR")}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Histórico recente (WhatsApp)
            </h4>
            {loading && ops.length === 0 ? (
              <p className="text-xs text-muted-foreground">Carregando…</p>
            ) : ops.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhum alerta nos registros.</p>
            ) : (
              <ul className="space-y-2">
                {ops.map((row) => {
                  const m = row.meta || {};
                  const sev = String(m.severity || "");
                  return (
                    <li
                      key={row.id}
                      className="rounded-lg border border-border/70 bg-card px-3 py-2.5 space-y-1.5"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{labelKey(m.key)}</span>
                        <SentBadge sent={m.sent} reason={m.reason} />
                        {sev && (
                          <Badge
                            variant={sev === "critical" ? "destructive" : "secondary"}
                            className="text-[10px]"
                          >
                            {sev === "critical" ? "crítico" : "aviso"}
                          </Badge>
                        )}
                        <span className="text-[10px] text-muted-foreground ml-auto">
                          {new Date(row.created_at).toLocaleString("pt-BR")}
                        </span>
                      </div>
                      {m.consultant_name && (
                        <p className="text-xs">
                          Consultor: <span className="font-medium">{m.consultant_name}</span>
                          {typeof m.consultant_wa_sent === "boolean" && (
                            <span className="text-muted-foreground">
                              {" · "}Zap consultor:{" "}
                              {m.consultant_wa_sent
                                ? "enviado"
                                : `não (${m.consultant_wa_reason || "falhou"})`}
                            </span>
                          )}
                        </p>
                      )}
                      {m.text && (
                        <pre className="text-[11px] text-muted-foreground whitespace-pre-wrap font-sans leading-relaxed max-h-28 overflow-y-auto">
                          {m.text}
                        </pre>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
