import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { History, CheckCircle2, XCircle, AlertTriangle, RefreshCw, Users, Sparkles, X, Pencil, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { labelForStageKey } from "@/lib/posVendaSchedule";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { toast } from "sonner";

type LogSource = "pos_venda" | "crm";

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

type LogEntry = {
  id: string;
  stage_key: string;
  remote_jid: string | null;
  customer_name: string | null;
  message_preview: string | null;
  status: string;
  created_at: string;
};

interface AutoMessageLogProps {
  consultantId: string;
}

function statusIcon(status: string) {
  if (status === "sent") return <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />;
  if (status === "partial") return <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" />;
  if (status === "skipped_by_consultant") return <XCircle className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />;
  if (status.startsWith("no_channel")) return <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" />;
  return <XCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />;
}

function statusLabel(status: string): string {
  if (status === "sent") return "Enviado";
  if (status === "partial") return "Enviado parcialmente";
  if (status === "skipped_by_consultant") return "Cancelado pelo consultor";
  if (status.startsWith("no_channel")) return "Sem canal WhatsApp";
  return status;
}

function deleteConfirmCopy(source: LogSource, status: string): { title: string; description: string } {
  if (status === "skipped_by_consultant") {
    return {
      title: "Desfazer cancelamento?",
      description:
        source === "pos_venda"
          ? "Este envio volta para a fila automática de pós-venda (30/60/90/120 dias)."
          : "Remove o registro de cancelamento deste estágio no CRM.",
    };
  }
  if (status === "sent" || status === "partial") {
    return {
      title: "Apagar do histórico?",
      description:
        source === "pos_venda"
          ? "A mensagem já foi enviada. Se apagar, o motor pode tentar enviar de novo no próximo cron — use só para corrigir erro."
          : "A mensagem já foi enviada. Apagar o registro não desfaz o WhatsApp, só limpa o histórico aqui.",
    };
  }
  return {
    title: "Excluir este registro?",
    description: "O item some do histórico. Em pós-venda, o sistema pode tentar processar de novo.",
  };
}

function LogList({
  logs,
  source,
  stageLabel,
  emptyTitle,
  emptyHint,
  busyId,
  onDelete,
  onEdit,
}: {
  logs: LogEntry[];
  source: LogSource;
  stageLabel: (key: string) => string;
  emptyTitle: string;
  emptyHint: string;
  busyId: string | null;
  onDelete: (log: LogEntry) => void;
  onEdit: (log: LogEntry) => void;
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
        {logs.map((log) => {
          const busy = busyId === log.id;
          return (
            <div
              key={log.id}
              className="flex items-start gap-2 p-3 rounded-lg bg-secondary/30 border border-border/30 group"
            >
              {statusIcon(log.status)}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap pr-1">
                  <span className="text-xs font-medium text-foreground">
                    {log.customer_name || log.remote_jid?.split("@")[0] || "Desconhecido"}
                  </span>
                  <Badge variant="secondary" className="text-[9px]">{stageLabel(log.stage_key)}</Badge>
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(log.created_at).toLocaleString("pt-BR")}
                  </span>
                </div>
                {log.message_preview && (
                  <p className="text-[11px] text-muted-foreground mt-1 line-clamp-3">{log.message_preview}</p>
                )}
                <p className="text-[10px] text-muted-foreground mt-0.5">{statusLabel(log.status)}</p>
              </div>
              <div className="flex shrink-0 gap-0.5 opacity-80 group-hover:opacity-100">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  title="Editar anotação"
                  disabled={busy}
                  onClick={() => onEdit(log)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                  title="Excluir do histórico"
                  disabled={busy}
                  onClick={() => onDelete(log)}
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}

export function AutoMessageLog({ consultantId }: AutoMessageLogProps) {
  const confirm = useConfirm();
  const [crmLogs, setCrmLogs] = useState<CrmLogEntry[]>([]);
  const [posLogs, setPosLogs] = useState<PosVendaLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"pos_venda" | "crm">("pos_venda");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editSource, setEditSource] = useState<LogSource>("pos_venda");
  const [editLog, setEditLog] = useState<LogEntry | null>(null);
  const [editPreview, setEditPreview] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

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

  async function handleDelete(source: LogSource, log: LogEntry) {
    const copy = deleteConfirmCopy(source, log.status);
    const ok = await confirm({
      title: copy.title,
      description: `${log.customer_name || "Cliente"} · ${source === "pos_venda" ? labelForStageKey(log.stage_key) : log.stage_key}\n\n${copy.description}`,
      confirmText: "Excluir",
      cancelText: "Manter",
      tone: "danger",
    });
    if (!ok) return;

    setBusyId(log.id);
    const table = source === "pos_venda" ? "customer_auto_message_log" : "crm_auto_message_log";
    const { error: delErr } = await supabase
      .from(table)
      .delete()
      .eq("id", log.id)
      .eq("consultant_id", consultantId);
    setBusyId(null);

    if (delErr) {
      toast.error("Não foi possível excluir", { description: delErr.message });
      return;
    }

    if (source === "pos_venda") {
      setPosLogs((prev) => prev.filter((r) => r.id !== log.id));
    } else {
      setCrmLogs((prev) => prev.filter((r) => r.id !== log.id));
    }
    toast.success(
      log.status === "skipped_by_consultant"
        ? "Cancelamento desfeito — envio pode voltar à fila"
        : "Registro removido do histórico",
    );
  }

  function openEdit(source: LogSource, log: LogEntry) {
    setEditSource(source);
    setEditLog(log);
    setEditPreview(log.message_preview || "");
    setEditOpen(true);
  }

  async function saveEdit() {
    if (!editLog) return;
    setSavingEdit(true);
    const table = editSource === "pos_venda" ? "customer_auto_message_log" : "crm_auto_message_log";
    const { error: upErr } = await supabase
      .from(table)
      .update({ message_preview: editPreview.trim() || null })
      .eq("id", editLog.id)
      .eq("consultant_id", consultantId);
    setSavingEdit(false);

    if (upErr) {
      toast.error("Erro ao salvar", { description: upErr.message });
      return;
    }

    const patch = { message_preview: editPreview.trim() || null };
    if (editSource === "pos_venda") {
      setPosLogs((prev) => prev.map((r) => (r.id === editLog.id ? { ...r, ...patch } : r)));
    } else {
      setCrmLogs((prev) => prev.map((r) => (r.id === editLog.id ? { ...r, ...patch } : r)));
    }
    toast.success("Histórico atualizado");
    setEditOpen(false);
    setEditLog(null);
  }

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
            Use ✕ para excluir ou desfazer cancelamento; lápis para editar a anotação.
          </p>
          <LogList
            logs={posLogs}
            source="pos_venda"
            stageLabel={labelForStageKey}
            emptyTitle="Nenhum envio automático de pós-venda ainda"
            emptyHint="Quando você aprovar clientes no CRM → Clientes ativos, as mensagens enviadas pelo cron aparecerão aqui."
            busyId={busyId}
            onDelete={(log) => void handleDelete("pos_venda", log)}
            onEdit={(log) => openEdit("pos_venda", log)}
          />
        </TabsContent>

        <TabsContent value="crm" className="mt-3">
          <p className="text-[11px] text-muted-foreground mb-3">
            Envios ao mover cards no quadro de clientes interessados (WhatsApp).
            Use ✕ para excluir; lápis para editar a anotação.
          </p>
          <LogList
            logs={crmLogs}
            source="crm"
            stageLabel={(k) => k}
            emptyTitle="Nenhuma mensagem automática do CRM ainda"
            emptyHint="Mensagens disparadas ao mover deals no Kanban de leads aparecem nesta aba."
            busyId={busyId}
            onDelete={(log) => void handleDelete("crm", log)}
            onEdit={(log) => openEdit("crm", log)}
          />
        </TabsContent>
      </Tabs>

      <Dialog open={editOpen} onOpenChange={(o) => !savingEdit && setEditOpen(o)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Editar anotação</DialogTitle>
            <DialogDescription>
              {editLog?.customer_name || "Cliente"}
              {editLog ? ` · ${editSource === "pos_venda" ? labelForStageKey(editLog.stage_key) : editLog.stage_key}` : ""}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={editPreview}
            onChange={(e) => setEditPreview(e.target.value)}
            placeholder="Texto exibido no histórico (preview da mensagem ou observação)"
            className="min-h-[100px] text-sm"
            disabled={savingEdit}
          />
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" disabled={savingEdit} onClick={() => setEditOpen(false)}>
              Cancelar
            </Button>
            <Button disabled={savingEdit} onClick={() => void saveEdit()}>
              {savingEdit ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
