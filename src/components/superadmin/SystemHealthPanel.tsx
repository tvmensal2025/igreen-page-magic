import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Copy, Power, RefreshCw, Wifi, WifiOff } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { useConfirm } from "@/components/ui/confirm-dialog";

interface DownInstance {
  id: string;
  consultantName: string;
  license: string | null;
  phone: string | null;
  instanceName: string;
  status: string;
  lastSeen: string | null;
}

interface Health {
  pausedGlobal: number;
  instancesNeedReconnect: number;
  errors24h: number;
  decisions24h: number;
  transitions24h: number;
  downInstances: DownInstance[];
}

function timeAgo(iso: string | null): string {
  if (!iso) return "sem checagem";
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  return `há ${d}d`;
}

export function SystemHealthPanel() {
  const confirm = useConfirm();
  const [data, setData] = useState<Health | null>(null);
  const [loading, setLoading] = useState(false);
  const [unpausing, setUnpausing] = useState(false);

  async function load() {
    setLoading(true);
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const downStatuses = ["needs_reconnect", "disconnected", "close"];
    const [paused, downRows, errors, decisions, trans] = await Promise.all([
      supabase.from("customers").select("id", { count: "exact", head: true })
        .eq("bot_paused", true).eq("bot_paused_reason", "manual_global_pause"),
      supabase.from("whatsapp_instances" as any)
        .select("id, instance_name, connected_phone, status, last_health_check_at, consultant_id")
        .in("status", downStatuses),
      supabase.from("customers").select("id", { count: "exact", head: true })
        .not("error_message", "is", null).gte("updated_at", since),
      supabase.from("ai_decisions" as any).select("id", { count: "exact", head: true })
        .gte("created_at", since),
      supabase.from("bot_step_transitions" as any).select("id", { count: "exact", head: true })
        .gte("created_at", since),
    ]);
    const rows: any[] = (downRows as any).data || [];
    const consultantIds = Array.from(
      new Set(rows.map((r) => r.consultant_id).filter(Boolean))
    );
    const consultantMap = new Map<string, { name?: string; license?: string | null }>();
    if (consultantIds.length > 0) {
      const { data: cons } = await supabase
        .from("consultants")
        .select("id, name, license")
        .in("id", consultantIds);
      (cons || []).forEach((c: any) => consultantMap.set(c.id, { name: c.name, license: c.license }));
    }
    const downInstances: DownInstance[] = rows.map((r) => {
      const c = consultantMap.get(r.consultant_id);
      return {
        id: r.id,
        consultantName: c?.name || "Sem consultor",
        license: c?.license ?? null,
        phone: r.connected_phone ?? null,
        instanceName: r.instance_name,
        status: r.status,
        lastSeen: r.last_health_check_at,
      };
    });

    setData({
      pausedGlobal: paused.count ?? 0,
      instancesNeedReconnect: downInstances.length,
      errors24h: errors.count ?? 0,
      decisions24h: decisions.count ?? 0,
      transitions24h: trans.count ?? 0,
      downInstances,
    });
    setLoading(false);
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  async function unpauseGlobal() {
    const ok = await confirm({ title: `Religar bot para ${data?.pausedGlobal ?? 0} conversas pausadas?`, description: "Conversas pausadas globalmente voltarão a receber respostas automáticas.", confirmText: "Religar", tone: "info" });
    if (!ok) return;
    setUnpausing(true);
    const { data: affected, error } = await supabase.rpc("admin_unpause_global_bot" as any);
    setUnpausing(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`✅ ${affected} conversas religadas`);
    load();
  }

  if (!data) return null;

  const ok = data.decisions24h > 0 || data.transitions24h > 0;
  const evolutionDown = data.instancesNeedReconnect > 0;
  const globalPaused = data.pausedGlobal > 0;

  return (
    <Card className="p-5 mb-4 bg-card/50 border-border/50">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <h3 className="text-sm font-semibold">Saúde do sistema</h3>
          {ok && !evolutionDown && !globalPaused ? (
            <Badge className="bg-primary/20 text-primary border-primary/40">🟢 Operacional</Badge>
          ) : (
            <Badge className="bg-destructive/20 text-destructive border-destructive/40">🔴 Atenção</Badge>
          )}
        </div>
        <Button size="sm" variant="ghost" onClick={load} disabled={loading} className="shrink-0">
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 mb-4">
        <Metric label="Decisões IA / 24h" value={data.decisions24h} good={data.decisions24h > 0} />
        <Metric label="Transições / 24h" value={data.transitions24h} good={data.transitions24h > 0} />
        <Metric label="Erros / 24h" value={data.errors24h} good={data.errors24h === 0} />
        <Metric
          label="Inst. derrubadas"
          value={data.instancesNeedReconnect}
          good={data.instancesNeedReconnect === 0}
          icon={evolutionDown ? <WifiOff className="w-3 h-3" /> : <Wifi className="w-3 h-3" />}
          tooltip={data.downInstances.map((i) => `${i.consultantName}${i.license ? ` (${i.license})` : ""}`).join("\n")}
        />
        <Metric label="Pausa global" value={data.pausedGlobal} good={data.pausedGlobal === 0} />
      </div>

      {globalPaused && (
        <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg bg-warning/10 border border-warning/30">
          <div className="flex items-center gap-2 text-sm min-w-0">
            <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
            <span><strong>{data.pausedGlobal}</strong> conversas estão com bot DESLIGADO (pausa manual global).</span>
          </div>
          <Button size="sm" onClick={unpauseGlobal} disabled={unpausing} className="gap-1 shrink-0">
            <Power className="w-3.5 h-3.5" />
            {unpausing ? "Religando..." : "Religar bot global"}
          </Button>
        </div>
      )}

      {evolutionDown && (
        <div className="p-3 mt-2 rounded-lg bg-destructive/10 border border-destructive/30 text-sm space-y-2">
          <div className="flex items-center gap-2 font-medium text-destructive">
            <WifiOff className="w-4 h-4 text-destructive" />
            <span>
              {data.instancesNeedReconnect} instância(s) WhatsApp caída(s) — reabrir QR no painel WhatsApp:
            </span>
          </div>
          <ul className="space-y-1.5 pl-1">
            {data.downInstances.slice(0, 8).map((inst) => {
              const copyText = [inst.consultantName, inst.license, inst.phone, inst.instanceName]
                .filter(Boolean)
                .join(" · ");
              return (
                <li
                  key={inst.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-2 rounded-md bg-destructive/5 border border-destructive/20"
                >
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                    <span className="font-semibold text-foreground">{inst.consultantName}</span>
                    {inst.license && (
                      <Badge variant="outline" className="h-4 px-1.5 text-[10px] border-destructive/40 text-destructive">
                        {inst.license}
                      </Badge>
                    )}
                    {inst.phone && <span className="text-muted-foreground">📱 {inst.phone}</span>}
                    <span className="text-muted-foreground/70">·</span>
                    <code className="text-[10px] text-muted-foreground bg-background/40 px-1 py-0.5 rounded">
                      {inst.instanceName}
                    </code>
                    <span className="text-muted-foreground/70">·</span>
                    <span className="text-warning/90">{timeAgo(inst.lastSeen)}</span>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[11px] gap-1"
                    onClick={() => {
                      navigator.clipboard.writeText(copyText);
                      toast.success("Dados copiados");
                    }}
                  >
                    <Copy className="w-3 h-3" />
                    Copiar
                  </Button>
                </li>
              );
            })}
            {data.downInstances.length > 8 && (
              <li className="text-[11px] text-muted-foreground pl-2">
                + {data.downInstances.length - 8} outra(s) instância(s) caída(s)
              </li>
            )}
          </ul>
        </div>
      )}
    </Card>
  );
}

function Metric({
  label,
  value,
  good,
  icon,
  tooltip,
}: {
  label: string;
  value: number;
  good: boolean;
  icon?: React.ReactNode;
  tooltip?: string;
}) {
  return (
    <div
      className={`p-3 rounded-lg border ${good ? "bg-primary/5 border-primary/20" : "bg-destructive/5 border-destructive/20"}`}
      title={tooltip}
    >
      <div className="flex items-center gap-1 text-[10px] text-muted-foreground uppercase tracking-wider">
        {icon}
        {label}
      </div>
      <div className={`text-2xl font-bold mt-1 ${good ? "text-primary" : "text-destructive"}`}>{value}</div>
    </div>
  );
}
