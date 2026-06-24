import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { History, CheckCircle2, XCircle, AlertTriangle, RefreshCw, Users, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { labelForStageKey } from "@/lib/posVendaSchedule";

interface CrmLogEntry {
  id: string;
  deal_id: string;
  stage_key: string;
  remote_jid: string | null;
  customer_name: string | null;
  message_preview: string | null;
  status: string;
  created_at: string;
}

interface PosVendaLogEntry {
  id: string;
  customer_id: string;
  stage_key: string;
  remote_jid: string | null;
  customer_name: string | null;
  message_preview: string | null;
  status: string;
  created_at: string;
}

interface AutoMessageLogProps {
  consultantId: string;
}

function statusIcon(status: string) {
  if (status === "sent") return <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />;
  if (status === "partial") return <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" />;
  if (status.startsWith("no_channel")) return <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" />;
  return <XCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />;
}

function LogList({
  logs,
  stageLabel,
  emptyTitle,
  emptyHint,
}: {
  logs: Array<{
    id: string;
    stage_key: string;
    remote_jid: string | null;
    customer_name: string | null;
    message_preview: string | null;
    status: string;
    created_at: string;
  }>;
  stageLabel: (key: string) => string;
  emptyTitle: string;
  emptyHint: string;
}) {
  if (logs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 gap-2">
        <History className="h-7 w-7 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">{emptyTitle}</p>
        <p className="text-xs text-muted-foreground/60 max-w-md text-center">{emptyHint}</p>
      </div>
    );
  }

  return (
    <ScrollArea className="max-h-[500px]">
      <div className="space-y-2">
        {logs.map((log) => (
          <div key={log.id} className="flex items-start gap-3 p-3 rounded-lg bg-secondary/30 border border-border/30">
            {statusIcon(log.status)}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-medium text-foreground">
                  {log.customer_name || log.remote_jid?.split("@")[0] || "Desconhecido"}
                </span>
                <Badge variant="secondary" className="text-[9px]">{stageLabel(log.stage_key)}</Badge>
                <span className="text-[10px] text-muted-foreground">
                  {new Date(log.created_at).toLocaleString("pt-BR")}
                </span>
              </div>
              {log.message_preview && (
                <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{log.message_preview}</p>
              )}
              {log.status !== "sent" && log.status !== "partial" && (
                <p className="text-[10px] text-warning mt-0.5">{log.status}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

export function AutoMessageLog({ consultantId }: AutoMessageLogProps) {
  const [crmLogs, setCrmLogs] = useState<CrmLogEntry[]>([]);
  const [posLogs, setPosLogs] = useState<PosVendaLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"pos_venda" | "crm">("pos_venda");

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [crmRes, posRes] = await Promise.all([
      supabase
        .from("crm_auto_message_log")
        .select("*")
        .eq("consultant_id", consultantId)
        .order("created_at", { ascending: false })
        .limit(200),
      supabase
        .from("customer_auto_message_log")
        .select("*")
        .eq("consultant_id", consultantId)
        .order("created_at", { ascending: false })
        .limit(200),
    ]);

    if (crmRes.error || posRes.error) {
      setError(crmRes.error?.message || posRes.error?.message || "Erro ao carregar");
    } else {
      setCrmLogs((crmRes.data || []) as CrmLogEntry[]);
      setPosLogs((posRes.data || []) as PosVendaLogEntry[]);
    }
    setLoading(false);
  }, [consultantId]);

  useEffect(() => {
    fetchLogs();

    const ch1 = supabase
      .channel(`crm-auto-log-${consultantId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "crm_auto_message_log", filter: `consultant_id=eq.${consultantId}` },
        (payload) => setCrmLogs((prev) => [payload.new as CrmLogEntry, ...prev]),
      )
      .subscribe();

    const ch2 = supabase
      .channel(`pos-auto-log-${consultantId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "customer_auto_message_log", filter: `consultant_id=eq.${consultantId}` },
        (payload) => setPosLogs((prev) => [payload.new as PosVendaLogEntry, ...prev]),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch1);
      supabase.removeChannel(ch2);
    };
  }, [consultantId, fetchLogs]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
        Carregando histórico...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <AlertTriangle className="h-8 w-8 text-warning/50" />
        <p className="text-sm text-muted-foreground">Erro ao carregar histórico</p>
        <Button variant="outline" size="sm" onClick={fetchLogs} className="gap-2">
          <RefreshCw className="h-3 w-3" /> Tentar novamente
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <History className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">Histórico de mensagens automáticas</h3>
        <Button variant="ghost" size="sm" onClick={fetchLogs} className="ml-auto h-7 w-7 p-0">
          <RefreshCw className="h-3 w-3" />
        </Button>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "pos_venda" | "crm")}>
        <TabsList className="grid w-full grid-cols-2 h-9">
          <TabsTrigger value="pos_venda" className="text-xs gap-1.5">
            <Sparkles className="w-3.5 h-3.5" />
            Pós-venda ({posLogs.length})
          </TabsTrigger>
          <TabsTrigger value="crm" className="text-xs gap-1.5">
            <Users className="w-3.5 h-3.5" />
            CRM leads ({crmLogs.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pos_venda" className="mt-3">
          <p className="text-[11px] text-muted-foreground mb-3">
            Envios da esteira iGreen: aprovado, 30, 60, 90 e 120 dias (e reprovado).
          </p>
          <LogList
            logs={posLogs}
            stageLabel={labelForStageKey}
            emptyTitle="Nenhum envio automático de pós-venda ainda"
            emptyHint="Quando você aprovar clientes no CRM → Clientes ativos, as mensagens enviadas pelo cron aparecerão aqui."
          />
        </TabsContent>

        <TabsContent value="crm" className="mt-3">
          <p className="text-[11px] text-muted-foreground mb-3">
            Envios ao mover cards no funil de clientes interessados (WhatsApp).
          </p>
          <LogList
            logs={crmLogs}
            stageLabel={(k) => k}
            emptyTitle="Nenhuma mensagem automática do CRM ainda"
            emptyHint="Mensagens disparadas ao mover deals no Kanban de leads aparecem nesta aba."
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
