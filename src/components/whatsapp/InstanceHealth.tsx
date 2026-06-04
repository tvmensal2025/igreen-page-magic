import { useEffect, useState, useCallback } from "react";
import { Activity, ShieldAlert, ShieldCheck, PauseCircle, PlayCircle, Flame, Plug, Hourglass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

/**
 * Painel de saúde anti-ban da instância (Plano A — padrão Wazzap/Whapi/Chatarmin 2026).
 *
 * Mostra para o consultor — em tempo real — exatamente o que o backend
 * está permitindo/bloqueando para o chip dele:
 *
 *   • Dia do warmup (D1..D14+) e cota usada / restante de hoje.
 *   • Modo recuperação (bloqueio pós-incidente de até 14 dias).
 *   • Sinais de risco ativos nas últimas 6h (reconexões, falhas, fatais).
 *   • Kill switch manual ("Pausar envios por 24h").
 *   • Botão para sair do modo recuperação após reconectar o chip com sucesso.
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
          .select("recovery_mode_until")
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
    if (!confirm("Pausar todos os envios automáticos por 24h?")) return;
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
    if (!confirm(
      "Só libere se você já reconectou o chip e o WhatsApp está funcionando normalmente.\n\n" +
      "Liberar agora?"
    )) return;
    setActionLoading(true);
    try {
      const { error } = await (supabase as any).rpc("clear_recovery_mode", {
        p_instance: instanceName,
      });
      if (error) throw error;
      toast({ title: "Modo recuperação encerrado" });
      await load();
    } catch (e: any) {
      toast({ title: "Falha ao liberar", description: e?.message, variant: "destructive" });
    } finally {
      setActionLoading(false);
    }
  };

  const reconnectInstance = async () => {
    setReconnectLoading(true);
    setQrBase64(null);
    setPairingCode(null);
    setReconnectOpen(true);
    try {
      const { data, error } = await (supabase as any).functions.invoke("evolution-instance-reconnect", {
        body: { instanceName, forceLogout: true },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setQrBase64(data?.qr_base64 ?? null);
      setPairingCode(data?.pairing_code ?? null);
      toast({ title: "Sessão derrubada", description: "Escaneie o QR no WhatsApp do celular para reconectar." });
      await load();
    } catch (e: any) {
      toast({ title: "Falha ao reconectar", description: e?.message, variant: "destructive" });
      setReconnectOpen(false);
    } finally {
      setReconnectLoading(false);
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

  const inRecovery = !!meta?.recovery_mode_until && new Date(meta.recovery_mode_until) > new Date();
  const reconnects = signals.filter(s => s.signal_type === "reconnect").length;
  const failures = signals.filter(s => s.signal_type === "send_failure").length;
  const fatals = signals.filter(s => s.signal_type === "disconnect_fatal").length;
  const usedPct = quota?.cap ? Math.min(100, Math.round(((quota.sent ?? 0) / quota.cap) * 100)) : 0;

  return (
    <div className="mt-4 rounded-xl border border-border/50 bg-card/50 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border/40 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {quota?.allowed && !inRecovery
            ? <ShieldCheck className="w-4 h-4 text-green-400" />
            : <ShieldAlert className="w-4 h-4 text-yellow-400" />}
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Saúde do chip — anti-ban
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm" variant="ghost"
            onClick={reconnectInstance} disabled={reconnectLoading}
            className="h-7 gap-1.5 text-[11px] text-blue-400 hover:text-blue-300 hover:bg-blue-500/5"
            title="Derruba a sessão atual e gera um novo QR para escanear no celular"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${reconnectLoading ? "animate-spin" : ""}`} /> Reconectar chip
          </Button>
          {!inRecovery && (
            <Button
              size="sm" variant="ghost"
              onClick={pauseNow} disabled={actionLoading}
              className="h-7 gap-1.5 text-[11px] text-orange-400 hover:text-orange-300 hover:bg-orange-500/5"
            >
              <PauseCircle className="w-3.5 h-3.5" /> Pausar envios por 24h
            </Button>
          )}
        </div>
      </div>

      <Dialog open={reconnectOpen} onOpenChange={setReconnectOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <QrCode className="w-5 h-5" /> Reconectar WhatsApp
            </DialogTitle>
            <DialogDescription>
              Abra o WhatsApp no celular → <strong>Configurações → Aparelhos conectados → Conectar um aparelho</strong> e escaneie o QR abaixo.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center justify-center py-4 gap-3">
            {reconnectLoading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <RefreshCw className="w-4 h-4 animate-spin" /> Gerando novo QR…
              </div>
            )}
            {qrBase64 && (
              <img
                src={qrBase64.startsWith("data:") ? qrBase64 : `data:image/png;base64,${qrBase64}`}
                alt="QR Code WhatsApp"
                className="w-64 h-64 rounded-lg border border-border bg-white p-2"
              />
            )}
            {pairingCode && (
              <div className="text-center">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Ou use o código de pareamento</p>
                <p className="font-mono text-lg font-bold tracking-widest">{pairingCode}</p>
              </div>
            )}
            {!reconnectLoading && !qrBase64 && !pairingCode && (
              <p className="text-sm text-muted-foreground">Nenhum QR retornado. Verifique se a instância existe na Evolution.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <div className="p-4 space-y-3">
        {inRecovery && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Flame className="w-4 h-4 text-red-400" />
              <span className="text-xs font-bold text-red-400">MODO RECUPERAÇÃO ATIVO</span>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Todos os disparos automáticos estão bloqueados até <strong>{fmtDateTime(meta!.recovery_mode_until)}</strong>.
              Ativado automaticamente após desconexão grave. Reconecte o chip pelo QR e só libere quando
              tiver certeza que o WhatsApp voltou ao normal.
            </p>
            <Button
              size="sm" variant="outline"
              onClick={clearRecovery} disabled={actionLoading}
              className="h-7 gap-1.5 text-[11px] border-green-500/30 text-green-400 hover:bg-green-500/10"
            >
              <PlayCircle className="w-3.5 h-3.5" /> Liberar — chip reconectado e estável
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
              className={`h-full transition-all ${usedPct >= 90 ? "bg-red-400" : usedPct >= 70 ? "bg-yellow-400" : "bg-green-400"}`}
              style={{ width: `${usedPct}%` }}
            />
          </div>
        )}

        {/* Status atual de envio */}
        {!inRecovery && (
          <div className={`rounded-lg px-3 py-2 text-[11px] ${quota?.allowed ? "bg-green-500/5 border border-green-500/20 text-green-400" : "bg-yellow-500/5 border border-yellow-500/20 text-yellow-400"}`}>
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
              <Badge variant="outline" className="text-[10px] border-yellow-500/30 text-yellow-400 bg-yellow-500/5">
                <AlertTriangle className="w-3 h-3 mr-1" /> {reconnects} reconexões
              </Badge>
            )}
            {failures > 0 && (
              <Badge variant="outline" className="text-[10px] border-orange-500/30 text-orange-400 bg-orange-500/5">
                {failures} falhas
              </Badge>
            )}
            {fatals > 0 && (
              <Badge variant="outline" className="text-[10px] border-red-500/30 text-red-400 bg-red-500/5">
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
