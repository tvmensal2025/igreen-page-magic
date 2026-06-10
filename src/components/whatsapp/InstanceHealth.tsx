import { useEffect, useState, useCallback } from "react";
import { Activity, ShieldAlert, ShieldCheck, PauseCircle, PlayCircle, AlertTriangle, Flame, Plug, Hourglass, AlertOctagon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/ui/confirm-dialog";

/**
 * Painel de saúde anti-ban da instância.
 *
 * Mostra ao consultor o estado real do chip:
 *
 *   • Dia do warmup e cota.
 *   • Modo recuperação (pausa operacional).
 *   • Revisão manual ativa (hard-lock após desconexão fatal 403/401/440).
 *   • Sinais de risco ativos nas últimas 6h.
 *   • Kill switch manual ("Pausar envios por 24h").
 *
 * IMPORTANTE: o botão "Encerrar modo recuperação" só aparece quando NÃO há
 * revisão manual ativa. Em revisão manual, a única coisa a fazer é aguardar
 * (ou trocar de chip pelo painel de conexão acima). Liberar nesse estado pode
 * acelerar um bloqueio definitivo do número.
 */

interface InstanceHealthProps {
  instanceName: string;
}

interface QuotaState {
  allowed: boolean;
  reason?: string;
  warmup_day?: number;
  cap?: number;
  sent?: number;
  remaining?: number;
  min_interval_ms?: number;
  next_allowed_at?: string;
  until?: string;
}

interface InstanceMeta {
  recovery_mode_until: string | null;
  manual_review_required?: boolean | null;
  fatal_disconnect_reason?: number | null;
  fatal_disconnect_at?: string | null;
  fatal_lock_until?: string | null;
}

interface RiskRow {
  signal_type: string;
  severity: string;
  created_at: string;
}

function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  } catch { return iso; }
}

function reasonLabel(reason?: string): string {
  switch (reason) {
    case "fatal_lock_manual_review": return "Número em revisão manual (não reconectar agora)";
    case "recovery_mode": return "Modo recuperação ativo";
    case "fatal_disconnect_pending_confirmation": return "Desconexão grave — aguardando confirmação manual";
    case "too_many_reconnects": return "Muitas reconexões — circuit breaker ativo";
    case "too_many_send_failures": return "Muitas falhas de envio — circuit breaker ativo";
    case "daily_cap_reached": return "Cota diária do warmup atingida";
    case "min_interval_not_elapsed": return "Aguardando intervalo mínimo entre envios";
    case "instance_not_found": return "Instância não cadastrada";
    case "rpc_error":
    case "exception":
    case "empty_response": return "Verificação indisponível no momento";
    default: return reason || "—";
  }
}

export function InstanceHealth({ instanceName }: InstanceHealthProps) {
  const confirm = useConfirm();
  const [quota, setQuota] = useState<QuotaState | null>(null);
  const [meta, setMeta] = useState<InstanceMeta | null>(null);
  const [signals, setSignals] = useState<RiskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const load = useCallback(async () => {
    if (!instanceName) return;
    try {
      const [{ data: q }, { data: m }, { data: s }] = await Promise.all([
        (supabase as any).rpc("check_send_quota", { p_instance: instanceName }),
        (supabase as any)
          .from("whatsapp_instances")
          .select("recovery_mode_until, manual_review_required, fatal_disconnect_reason, fatal_disconnect_at, fatal_lock_until")
          .eq("instance_name", instanceName)
          .maybeSingle(),
        (supabase as any)
          .from("instance_risk_signals")
          .select("signal_type,severity,created_at")
          .eq("instance_name", instanceName)
          .gt("expires_at", new Date().toISOString())
          .order("created_at", { ascending: false })
          .limit(20),
      ]);
      setQuota(q ?? null);
      setMeta(m ?? { recovery_mode_until: null });
      setSignals((s ?? []) as RiskRow[]);
    } catch (e) {
      console.warn("[InstanceHealth] load error:", e);
    } finally {
      setLoading(false);
    }
  }, [instanceName]);

  useEffect(() => {
    void load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  const pauseNow = async () => {
    const ok = await confirm({ title: "Pausar todos os envios automáticos por 24h?", confirmText: "Pausar 24h", tone: "danger" });
    if (!ok) return;
    setActionLoading(true);
    try {
      const { error } = await (supabase as any).rpc("pause_sending_now", {
        p_instance: instanceName, p_hours: 24,
      });
      if (error) throw error;
      toast({ title: "Envios pausados por 24h" });
      await load();
    } catch (e: any) {
      toast({ title: "Falha ao pausar", description: e?.message, variant: "destructive" });
    } finally {
      setActionLoading(false);
    }
  };

  const clearRecovery = async () => {
    const ok = await confirm({
      title: "Liberar modo recuperação?",
      description: "Só libere se você JÁ confirmou no app oficial do WhatsApp que o número está funcionando normalmente.",
      confirmText: "Liberar",
      tone: "info",
    });
    if (!ok) return;
    setActionLoading(true);
    try {
      const { error } = await (supabase as any).rpc("clear_recovery_mode", {
        p_instance: instanceName,
      });
      if (error) {
        if (String(error.message || "").includes("fatal_lock_active_admin_required")) {
          toast({
            title: "Não é possível liberar agora",
            description: "Este número está em revisão manual após desconexão grave. Aguarde a liberação por um administrador ou troque de chip pelo painel acima.",
            variant: "destructive",
          });
          return;
        }
        throw error;
      }
      toast({ title: "Modo recuperação encerrado" });
      await load();
    } catch (e: any) {
      toast({ title: "Falha ao liberar", description: e?.message, variant: "destructive" });
    } finally {
      setActionLoading(false);
    }
  };


  if (loading) {
    return (
      <div className="mt-4 rounded-xl border border-border/50 bg-card/50 p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Activity className="w-3.5 h-3.5 animate-pulse" />
          Carregando saúde da instância...
        </div>
      </div>
    );
  }

  const fatalLocked =
    !!meta?.manual_review_required ||
    (!!meta?.fatal_lock_until && new Date(meta.fatal_lock_until) > new Date());
  const inRecovery = !!meta?.recovery_mode_until && new Date(meta.recovery_mode_until) > new Date();
  const reconnects = signals.filter(s => s.signal_type === "reconnect").length;
  const failures = signals.filter(s => s.signal_type === "send_failure").length;
  const fatals = signals.filter(s => s.signal_type === "disconnect_fatal").length;
  const usedPct = quota?.cap ? Math.min(100, Math.round(((quota.sent ?? 0) / quota.cap) * 100)) : 0;

  return (
    <div className="mt-4 rounded-xl border border-border/50 bg-card/50 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border/40 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {quota?.allowed && !inRecovery && !fatalLocked
            ? <ShieldCheck className="w-4 h-4 text-primary" />
            : <ShieldAlert className="w-4 h-4 text-warning" />}
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Saúde do chip — anti-ban
          </span>
        </div>
        <div className="flex items-center gap-2">
          {!inRecovery && !fatalLocked && (
            <Button
              size="sm" variant="ghost"
              onClick={pauseNow} disabled={actionLoading}
              className="h-7 gap-1.5 text-[11px] text-warning hover:text-warning hover:bg-warning/5"
            >
              <PauseCircle className="w-3.5 h-3.5" /> Pausar envios por 24h
            </Button>
          )}
        </div>
      </div>

      <div className="p-4 space-y-3">
        {fatalLocked && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <AlertOctagon className="w-4 h-4 text-destructive" />
              <span className="text-xs font-bold text-destructive uppercase tracking-wider">
                Número em revisão manual
              </span>
            </div>
            <p className="text-[12px] text-foreground leading-relaxed">
              Este número sofreu uma desconexão grave
              {meta?.fatal_disconnect_reason ? ` (código ${meta.fatal_disconnect_reason})` : ""}
              {meta?.fatal_disconnect_at ? ` em ${fmtDateTime(meta.fatal_disconnect_at)}` : ""}.
              O WhatsApp pode ter restringido ou bloqueado o chip.
            </p>
            <ul className="text-[11px] text-muted-foreground list-disc list-inside leading-relaxed space-y-0.5">
              <li>Abra o WhatsApp no celular e verifique se o número está normal.</li>
              <li><strong>Não reconecte aqui</strong> antes da confirmação manual.</li>
              <li>Se quiser usar outro chip, vá em <strong>Desconectar / trocar chip</strong> no painel de conexão acima.</li>
              <li>Os disparos automáticos estão bloqueados até liberação por administrador.</li>
            </ul>
            {meta?.fatal_lock_until && (
              <p className="text-[11px] text-muted-foreground">
                Trava ativa até: <strong>{fmtDateTime(meta.fatal_lock_until)}</strong>
              </p>
            )}
          </div>
        )}

        {inRecovery && !fatalLocked && (
          <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Flame className="w-4 h-4 text-warning" />
              <span className="text-xs font-bold text-warning">MODO RECUPERAÇÃO ATIVO</span>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Todos os disparos automáticos estão bloqueados até <strong>{fmtDateTime(meta!.recovery_mode_until)}</strong>.
              Este botão <strong>não reconecta o chip</strong> — apenas destrava os envios automáticos.
              Só clique se você já confirmou no celular que o WhatsApp voltou ao normal há pelo menos 1h.
            </p>
            <Button
              size="sm" variant="outline"
              onClick={clearRecovery} disabled={actionLoading}
              className="h-7 gap-1.5 text-[11px] border-primary/30 text-primary hover:bg-primary/10"
            >
              <PlayCircle className="w-3.5 h-3.5" /> Encerrar modo recuperação (destravar envios)
            </Button>
          </div>
        )}


        {/* Warmup / cota */}
        <div className="grid grid-cols-3 gap-3">
          <Stat
            icon={<Hourglass className="w-3.5 h-3.5" />}
            label="Dia warmup"
            value={quota?.warmup_day ? `D${quota.warmup_day}${quota.warmup_day >= 14 ? "+" : ""}` : "—"}
          />
          <Stat
            icon={<Activity className="w-3.5 h-3.5" />}
            label="Hoje"
            value={quota?.cap ? `${quota.sent ?? 0}/${quota.cap}` : "—"}
            sub={quota?.cap ? `${usedPct}%` : undefined}
          />
          <Stat
            icon={<Plug className="w-3.5 h-3.5" />}
            label="Intervalo mín."
            value={quota?.min_interval_ms ? `${Math.round(quota.min_interval_ms / 1000)}s` : "—"}
          />
        </div>

        {quota && quota.cap && (
          <div className="w-full h-1.5 rounded-full bg-secondary overflow-hidden">
            <div
              className={`h-full transition-all ${usedPct >= 90 ? "bg-destructive" : usedPct >= 70 ? "bg-warning" : "bg-primary"}`}
              style={{ width: `${usedPct}%` }}
            />
          </div>
        )}

        {/* Status atual de envio */}
        {!inRecovery && !fatalLocked && (
          <div className={`rounded-lg px-3 py-2 text-[11px] ${quota?.allowed ? "bg-primary/5 border border-primary/20 text-primary" : "bg-warning/5 border border-warning/20 text-warning"}`}>
            {quota?.allowed
              ? <>✓ Envios automáticos liberados ({quota.remaining} restantes hoje)</>
              : <>⏸ {reasonLabel(quota?.reason)}{quota?.next_allowed_at ? ` — libera em ${fmtDateTime(quota.next_allowed_at)}` : ""}</>}
          </div>
        )}

        {/* Sinais de risco 6h */}
        {(reconnects + failures + fatals) > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Últimas 6h:</span>
            {reconnects > 0 && (
              <Badge variant="outline" className="text-[10px] border-warning/30 text-warning bg-warning/5">
                <AlertTriangle className="w-3 h-3 mr-1" /> {reconnects} reconexões
              </Badge>
            )}
            {failures > 0 && (
              <Badge variant="outline" className="text-[10px] border-warning/30 text-warning bg-warning/5">
                {failures} falhas
              </Badge>
            )}
            {fatals > 0 && (
              <Badge variant="outline" className="text-[10px] border-destructive/30 text-destructive bg-destructive/5">
                <Flame className="w-3 h-3 mr-1" /> {fatals} desconexões graves
              </Badge>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-secondary/40 border border-border/30 px-3 py-2">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        {icon} {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-sm font-bold font-mono text-foreground">{value}</span>
        {sub && <span className="text-[10px] text-muted-foreground">{sub}</span>}
      </div>
    </div>
  );
}
