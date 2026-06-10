import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Calendar, Clock, Trash2, Plus, Send, CalendarClock, MessageSquare, Phone, CheckCircle2, XCircle, Loader2, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface ScheduledMessage {
  id: string;
  remote_jid: string;
  message_text: string;
  scheduled_at: string;
  status: string;
  sent_at: string | null;
}

interface SchedulePanelProps {
  consultantId: string;
  instanceName: string;
}

export function SchedulePanel({ consultantId, instanceName }: SchedulePanelProps) {
  const [messages, setMessages] = useState<ScheduledMessage[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [phone, setPhone] = useState("");
  const [text, setText] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const fetchMessages = useCallback(async () => {
    const { data } = await supabase
      .from("scheduled_messages")
      .select("*")
      .eq("consultant_id", consultantId)
      .order("scheduled_at", { ascending: true });
    if (data) setMessages(data as ScheduledMessage[]);
  }, [consultantId]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  const handleCreate = async () => {
    if (!phone.trim() || !text.trim() || !scheduledAt) return;
    setSaving(true);
    try {
      const remoteJid = phone.includes("@") ? phone : `${phone.replace(/\D/g, "")}@s.whatsapp.net`;
      const { error } = await supabase.from("scheduled_messages").insert({
        consultant_id: consultantId,
        instance_name: instanceName,
        remote_jid: remoteJid,
        message_text: text,
        scheduled_at: new Date(scheduledAt).toISOString(),
      });
      if (error) throw error;
      toast({ title: "✅ Mensagem agendada com sucesso!" });
      setPhone("");
      setText("");
      setScheduledAt("");
      setShowForm(false);
      fetchMessages();
    } catch {
      toast({ title: "Erro ao agendar", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    await supabase.from("scheduled_messages").delete().eq("id", id);
    fetchMessages();
  };

  const pendingCount = messages.filter((m) => m.status === "pending").length;
  const sentCount = messages.filter((m) => m.status === "sent").length;
  const failedCount = messages.filter((m) => m.status === "failed").length;

  const statusConfig = (status: string) => {
    switch (status) {
      case "pending":
        return { icon: <Clock className="w-3 h-3" />, label: "Pendente", cls: "bg-warning/15 text-warning border-warning/25" };
      case "sent":
        return { icon: <CheckCircle2 className="w-3 h-3" />, label: "Enviada", cls: "bg-primary/15 text-primary border-primary/25" };
      case "failed":
        return { icon: <XCircle className="w-3 h-3" />, label: "Falhou", cls: "bg-destructive/15 text-destructive border-destructive/25" };
      default:
        return { icon: <AlertCircle className="w-3 h-3" />, label: status, cls: "bg-secondary text-muted-foreground border-border" };
    }
  };

  const formatScheduleDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return format(d, "dd MMM yyyy 'às' HH:mm", { locale: ptBR });
    } catch {
      return dateStr;
    }
  };

  const isFormValid = phone.trim() && text.trim() && scheduledAt;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-card via-card to-info/10">
      <div className="absolute -top-20 -right-20 w-40 h-40 bg-info/3 rounded-full blur-3xl" />

      <div className="relative p-5 sm:p-7">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-info/20 to-info/10 flex items-center justify-center border border-info/20">
              <CalendarClock className="w-5 h-5 text-info" />
            </div>
            <div>
              <h3 className="font-heading font-bold text-foreground text-lg">Agendamentos</h3>
              <p className="text-xs text-muted-foreground">Programe envios automáticos de mensagens</p>
            </div>
          </div>
          <Button
            onClick={() => setShowForm(!showForm)}
            className="gap-2 rounded-xl font-bold shadow-lg shadow-green-500/10"
            style={{ background: "var(--gradient-green)" }}
          >
            <Plus className="w-4 h-4" />
            {showForm ? "Fechar" : "Agendar"}
          </Button>
        </div>

        {/* Stats */}
        {messages.length > 0 && (
          <div className="grid grid-cols-3 gap-3 mb-5">
            <div className="rounded-xl border border-warning/15 bg-warning/5 p-3 text-center">
              <p className="text-xl font-bold text-warning">{pendingCount}</p>
              <p className="text-[10px] text-warning/70 font-medium">Pendentes</p>
            </div>
            <div className="rounded-xl border border-primary/15 bg-primary/5 p-3 text-center">
              <p className="text-xl font-bold text-primary">{sentCount}</p>
              <p className="text-[10px] text-primary/70 font-medium">Enviadas</p>
            </div>
            <div className="rounded-xl border border-destructive/15 bg-destructive/5 p-3 text-center">
              <p className="text-xl font-bold text-destructive">{failedCount}</p>
              <p className="text-[10px] text-destructive/70 font-medium">Falharam</p>
            </div>
          </div>
        )}

        {/* Create form */}
        {showForm && (
          <div className="mb-5 rounded-xl border border-info/15 bg-gradient-to-br from-info/5 to-transparent p-5 space-y-4 animate-in slide-in-from-top-2 duration-300">
            <p className="text-sm font-bold text-foreground flex items-center gap-2">
              <Send className="w-4 h-4 text-info" /> Nova Mensagem Agendada
            </p>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-foreground flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5 text-info" /> Telefone
              </Label>
              <Input
                placeholder="5511999999999"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                disabled={saving}
                className="rounded-xl bg-secondary/50 border-border/50"
              />
              <p className="text-[10px] text-muted-foreground/60">Número com DDD, sem espaços ou caracteres especiais</p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-foreground flex items-center gap-1.5">
                <MessageSquare className="w-3.5 h-3.5 text-info" /> Mensagem
              </Label>
              <Textarea
                placeholder="Digite a mensagem que será enviada..."
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={3}
                disabled={saving}
                className="rounded-xl bg-secondary/30 border-border/40 resize-none"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-foreground flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-info" /> Data e Hora
              </Label>
              <Input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                min={new Date().toISOString().slice(0, 16)}
                disabled={saving}
                className="rounded-xl bg-secondary/50 border-border/50"
              />
            </div>

            <div className="flex items-center gap-2 pt-1">
              <Button
                onClick={handleCreate}
                disabled={!isFormValid || saving}
                className="gap-2 rounded-xl h-11 font-bold shadow-lg shadow-green-500/10"
                style={{ background: "var(--gradient-green)" }}
              >
                {saving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                {saving ? "Agendando..." : "Agendar Envio"}
              </Button>
              <Button
                variant="ghost"
                onClick={() => setShowForm(false)}
                disabled={saving}
                className="rounded-xl text-muted-foreground"
              >
                Cancelar
              </Button>
            </div>
          </div>
        )}

        {/* Messages list */}
        {messages.length === 0 ? (
          <div className="text-center py-10">
            <div className="w-14 h-14 rounded-2xl bg-info/10 border border-info/15 flex items-center justify-center mx-auto mb-3">
              <CalendarClock className="w-7 h-7 text-info/50" />
            </div>
            <p className="text-sm text-muted-foreground font-medium">Nenhuma mensagem agendada</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Clique em "Agendar" para programar seu primeiro envio</p>
          </div>
        ) : (
          <ScrollArea className="max-h-[400px]">
            <div className="space-y-2">
              {messages.map((msg) => {
                const sc = statusConfig(msg.status);
                const isPending = msg.status === "pending";
                return (
                  <div
                    key={msg.id}
                    className={`group rounded-xl border px-4 py-3 transition-all ${
                      isPending
                        ? "border-border/40 bg-secondary/20 hover:border-info/20"
                        : msg.status === "sent"
                        ? "border-primary/10 bg-primary/5"
                        : "border-destructive/10 bg-destructive/5"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-sm font-bold text-foreground">
                            {msg.remote_jid.split("@")[0]}
                          </span>
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md border flex items-center gap-1 ${sc.cls}`}>
                            {sc.icon}
                            {sc.label}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground/80 line-clamp-2 mb-2">
                          {msg.message_text}
                        </p>
                        <div className="flex items-center gap-1.5">
                          <Calendar className="w-3 h-3 text-info/60" />
                          <span className="text-[11px] text-muted-foreground/70 font-medium">
                            {formatScheduleDate(msg.scheduled_at)}
                          </span>
                          {msg.sent_at && (
                            <>
                              <span className="text-muted-foreground/30 mx-1">•</span>
                              <CheckCircle2 className="w-3 h-3 text-primary/60" />
                              <span className="text-[11px] text-primary/60 font-medium">
                                Enviada {formatScheduleDate(msg.sent_at)}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      {isPending && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="shrink-0 text-destructive/60 hover:text-destructive hover:bg-destructive/10 h-8 w-8 opacity-0 group-hover:opacity-100 transition-all"
                          onClick={() => handleDelete(msg.id)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  );
}
