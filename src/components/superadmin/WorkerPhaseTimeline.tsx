import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Activity, CheckCircle2, XCircle, AlertTriangle, Clock, RefreshCw,
  Loader2, Image as ImageIcon, ChevronDown, ChevronRight, Search, ExternalLink,
} from "lucide-react";

interface PhaseLog {
  id: string;
  customer_id: string | null;
  phase: string;
  status: string;
  message: string | null;
  selector_used: string | null;
  screenshot_url: string | null;
  duration_ms: number | null;
  attempt: number | null;
  worker_version: string | null;
  created_at: string;
}

interface CustomerInfo {
  id: string;
  name: string | null;
  phone_whatsapp: string;
  status: string;
}

const STATUS_CONFIG: Record<string, { color: string; bg: string; icon: typeof CheckCircle2; label: string }> = {
  started:     { color: "text-info",    bg: "bg-info/10",    icon: Activity,        label: "Iniciado" },
  ok:          { color: "text-primary", bg: "bg-primary/10", icon: CheckCircle2,    label: "OK" },
  warn:        { color: "text-warning",   bg: "bg-warning/10",   icon: AlertTriangle,   label: "Aviso" },
  failed:      { color: "text-destructive",     bg: "bg-destructive/10",     icon: XCircle,         label: "Falhou" },
  aborted:     { color: "text-destructive",     bg: "bg-destructive/15",     icon: XCircle,         label: "Abortado" },
  "soft-skip": { color: "text-primary",  bg: "bg-primary/10",  icon: ChevronRight,    label: "Pulado" },
};

const formatDuration = (ms: number | null) => {
  if (!ms) return null;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

const formatTime = (iso: string) => new Date(iso).toLocaleString("pt-BR", {
  day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
});

export const WorkerPhaseTimeline = () => {
  const [logs, setLogs] = useState<PhaseLog[]>([]);
  const [customers, setCustomers] = useState<Map<string, CustomerInfo>>(new Map());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [workerVersion, setWorkerVersion] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("worker_phase_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) {
      console.error(error);
      setLoading(false);
      return;
    }

    const rows = (data || []) as PhaseLog[];
    setLogs(rows);

    // version detection
    const versions = Array.from(new Set(rows.map(r => r.worker_version).filter(Boolean)));
    setWorkerVersion(versions[0] || null);

    // load customer info for involved customers
    const customerIds = Array.from(new Set(rows.map(r => r.customer_id).filter(Boolean))) as string[];
    if (customerIds.length > 0) {
      const { data: cust } = await supabase
        .from("customers")
        .select("id, name, phone_whatsapp, status")
        .in("id", customerIds);
      const map = new Map<string, CustomerInfo>();
      (cust || []).forEach((c: any) => map.set(c.id, c));
      setCustomers(map);
    }

    setLoading(false);
  };

  useEffect(() => {
    load();
    // realtime subscription
    const channel = supabase
      .channel("worker_phase_logs_realtime")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "worker_phase_logs" }, (payload) => {
        setLogs(prev => [payload.new as PhaseLog, ...prev].slice(0, 500));
      })
      .subscribe();

    const interval = setInterval(load, 30000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, []);

  // group by customer
  const grouped = new Map<string, PhaseLog[]>();
  logs.forEach(log => {
    const key = log.customer_id || "no-customer";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(log);
  });

  const filteredGroups = Array.from(grouped.entries()).filter(([custId, items]) => {
    if (filterStatus !== "all") {
      const hasStatus = items.some(i => i.status === filterStatus);
      if (!hasStatus) return false;
    }
    if (!search) return true;
    const q = search.toLowerCase();
    const cust = customers.get(custId);
    return (
      custId.toLowerCase().includes(q) ||
      cust?.name?.toLowerCase().includes(q) ||
      cust?.phone_whatsapp?.includes(q) ||
      items.some(i => i.phase.toLowerCase().includes(q) || i.message?.toLowerCase().includes(q))
    );
  });

  const toggleExpanded = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const stats = {
    total: logs.length,
    failed: logs.filter(l => l.status === "failed" || l.status === "aborted").length,
    ok: logs.filter(l => l.status === "ok").length,
    warn: logs.filter(l => l.status === "warn" || l.status === "soft-skip").length,
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-info/20 to-info/10 flex items-center justify-center">
            <Activity className="w-5 h-5 text-info" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-foreground">Automação — Fases</h2>
            <p className="text-xs text-muted-foreground">
              Timeline em tempo real do worker do portal iGreen
              {workerVersion && <Badge className="ml-2 bg-primary/10 text-primary border-primary/20 text-[10px]">{workerVersion}</Badge>}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total de eventos" value={stats.total} icon={Activity} color="text-info" bg="from-info/10 to-info/5" />
        <StatCard label="Sucessos" value={stats.ok} icon={CheckCircle2} color="text-primary" bg="from-primary/10 to-primary/5" />
        <StatCard label="Avisos / Skips" value={stats.warn} icon={AlertTriangle} color="text-warning" bg="from-warning/10 to-warning/5" />
        <StatCard label="Falhas / Abortos" value={stats.failed} icon={XCircle} color="text-destructive" bg="from-destructive/10 to-destructive/5" />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por cliente, fase ou mensagem..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 bg-card/50 border-border/50 rounded-lg"
          />
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {["all", "failed", "aborted", "warn", "ok", "soft-skip"].map(s => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                filterStatus === s
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted"
              }`}
            >
              {s === "all" ? "Todos" : STATUS_CONFIG[s]?.label || s}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      {loading && logs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Carregando logs...</p>
        </div>
      ) : filteredGroups.length === 0 ? (
        <div className="premium-card text-center py-16">
          <Activity className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-muted-foreground font-medium">Nenhum log de fase encontrado</p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Logs aparecerão aqui assim que o worker (v10+) processar clientes interessados.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredGroups.map(([custId, items]) => {
            const cust = customers.get(custId);
            const sortedItems = [...items].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
            const lastStatus = items[0]?.status; // most recent (already DESC)
            const cfg = STATUS_CONFIG[lastStatus] || STATUS_CONFIG.started;
            const isExpanded = expanded.has(custId);
            const failedPhases = items.filter(i => i.status === "failed" || i.status === "aborted");

            return (
              <div key={custId} className="premium-card !p-0 overflow-hidden">
                <button
                  onClick={() => toggleExpanded(custId)}
                  className="w-full flex items-center gap-3 p-4 hover:bg-muted/30 transition-colors text-left"
                >
                  {isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
                  <div className={`w-9 h-9 rounded-lg ${cfg.bg} flex items-center justify-center shrink-0`}>
                    <cfg.icon className={`w-4.5 h-4.5 ${cfg.color}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-foreground truncate">
                        {cust?.name || (custId === "no-customer" ? "Sem cliente vinculado" : `ID ${custId.slice(0, 8)}…`)}
                      </p>
                      {cust?.phone_whatsapp && <span className="text-xs text-muted-foreground">{cust.phone_whatsapp}</span>}
                      {cust?.status && (
                        <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-5">{cust.status}</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {items.length} evento(s) · Última atividade: {formatTime(items[0].created_at)}
                      {failedPhases.length > 0 && (
                        <span className="text-destructive ml-2">· ⚠️ {failedPhases.length} falha(s)</span>
                      )}
                    </p>
                  </div>
                  <div className={`text-xs font-medium px-2.5 py-1 rounded-md ${cfg.bg} ${cfg.color} shrink-0`}>
                    {cfg.label}
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-border/50 bg-muted/10 p-4 space-y-2">
                    {sortedItems.map((item) => {
                      const ic = STATUS_CONFIG[item.status] || STATUS_CONFIG.started;
                      return (
                        <div key={item.id} className="flex items-start gap-3 p-3 rounded-lg bg-card/40 border border-border/30">
                          <div className={`w-7 h-7 rounded-md ${ic.bg} flex items-center justify-center shrink-0 mt-0.5`}>
                            <ic.icon className={`w-3.5 h-3.5 ${ic.color}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-semibold text-foreground">{item.phase}</span>
                              <span className={`text-[10px] font-medium ${ic.color}`}>{ic.label}</span>
                              {item.attempt && item.attempt > 1 && (
                                <span className="text-[10px] text-muted-foreground">tentativa {item.attempt}</span>
                              )}
                              {item.duration_ms && (
                                <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                  <Clock className="w-3 h-3" />{formatDuration(item.duration_ms)}
                                </span>
                              )}
                              <span className="text-[10px] text-muted-foreground ml-auto">{formatTime(item.created_at)}</span>
                            </div>
                            {item.message && (
                              <p className="text-xs text-muted-foreground mt-1 break-words">{item.message}</p>
                            )}
                            {item.selector_used && (
                              <p className="text-[10px] text-muted-foreground/70 mt-1 font-mono break-all">
                                Selector: {item.selector_used}
                              </p>
                            )}
                            {item.screenshot_url && (
                              <a
                                href={item.screenshot_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 mt-2"
                              >
                                <ImageIcon className="w-3.5 h-3.5" />
                                Ver screenshot
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

function StatCard({ label, value, icon: Icon, color, bg }: { label: string; value: number; icon: typeof Activity; color: string; bg: string }) {
  return (
    <div className="premium-card !p-4">
      <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${bg} flex items-center justify-center mb-3`}>
        <Icon className={`w-4.5 h-4.5 ${color}`} />
      </div>
      <p className="text-2xl font-bold text-foreground tracking-tight">{value}</p>
      <p className="text-[11px] text-muted-foreground mt-0.5 font-medium">{label}</p>
    </div>
  );
}
