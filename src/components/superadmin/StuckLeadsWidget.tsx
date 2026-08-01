import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, Clock, RefreshCw, Phone, MessageSquare, Send, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "@/components/ui/sonner";

interface StuckLead {
  id: string;
  name: string | null;
  phone_whatsapp: string;
  conversation_step: string | null;
  last_bot_reply_at: string | null;
  rescue_attempts: number | null;
  status: string;
  consultant_id: string | null;
}

const ACTIVE_STUCK_STEPS = [
  "welcome", "menu_inicial", "pos_video",
  "aguardando_conta", "confirmando_dados_conta",
  "ask_tipo_documento", "aguardando_doc_frente", "aguardando_doc_verso",
  "confirmando_dados_doc",
  "ask_name", "ask_cpf", "ask_rg", "ask_birth_date",
  "ask_phone_confirm", "ask_phone", "ask_email",
  "ask_cep", "ask_number", "ask_complement",
  "ask_installation_number", "ask_bill_value",
  "ask_doc_frente_manual", "ask_doc_verso_manual",
  "ask_finalizar", "finalizando",
  "editing_conta_menu", "editing_conta_nome", "editing_conta_endereco",
  "editing_conta_cep", "editing_conta_distribuidora", "editing_conta_instalacao",
  "editing_conta_valor",
  "editing_doc_menu", "editing_doc_nome", "editing_doc_cpf",
  "editing_doc_rg", "editing_doc_nascimento",
] as const;

const STEP_LABELS: Record<string, string> = {
  ask_name: "Aguardando nome",
  ask_cpf: "Aguardando CPF",
  ask_rg: "Aguardando RG",
  ask_birth_date: "Aguardando nascimento",
  ask_phone_confirm: "Confirmando telefone",
  ask_phone: "Aguardando telefone",
  ask_email: "Aguardando email",
  ask_cep: "Aguardando CEP",
  ask_number: "Aguardando número",
  ask_complement: "Aguardando complemento",
  ask_installation_number: "Aguardando nº instalação",
  ask_bill_value: "Aguardando valor da conta",
  aguardando_conta: "Aguardando foto da conta",
  aguardando_doc_frente: "Aguardando frente do doc",
  aguardando_doc_verso: "Aguardando verso do doc",
  confirmando_dados_conta: "Confirmando dados da conta",
  confirmando_dados_doc: "Confirmando dados do doc",
  ask_finalizar: "Aguardando finalização",
};

const STATUS_BADGES: Record<string, { label: string; className: string }> = {
  stuck_finalizar: { label: "🛑 Travado em Finalizar", className: "bg-destructive/15 text-destructive border-destructive/30" },
  stuck_contact: { label: "📵 Falta contato", className: "bg-warning/15 text-warning border-warning/30" },
  email_pendente_revisao: { label: "✉️ Email pendente", className: "bg-warning/15 text-warning border-warning/30" },
  contato_incompleto: { label: "⚠️ Sem celular real", className: "bg-warning/15 text-warning border-warning/30" },
};

function formatIdle(iso: string | null): { text: string; severity: "low" | "medium" | "high" } {
  if (!iso) return { text: "—", severity: "low" };
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 60) return { text: `${min}min`, severity: "low" };
  if (min < 60 * 6) return { text: `${Math.floor(min / 60)}h`, severity: "medium" };
  return { text: `${Math.floor(min / 60)}h`, severity: "high" };
}

export function StuckLeadsWidget() {
  const [leads, setLeads] = useState<StuckLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pendingAction, setPendingAction] = useState<null | "rescue" | "complete" | "abandoned">(null);
  const [executing, setExecuting] = useState(false);

  const load = async () => {
    setLoading(true);
    const cutoff = new Date(Date.now() - 10 * 60_000).toISOString();
    const activeSteps = `(${ACTIVE_STUCK_STEPS.join(",")})`;
    // CRÍTICO: só mostrar leads que vieram do cadastro AUTOMÁTICO via WhatsApp.
    // Leads importados (telefone "sem_celular_*", "sem_celular_xxx") NÃO entram.
    // Leads sem `last_bot_reply_at` (nunca conversaram pelo bot) NÃO entram.
    const { data } = await supabase
      .from("customers")
      .select("id, name, phone_whatsapp, conversation_step, last_bot_reply_at, rescue_attempts, status, consultant_id")
      .not("phone_whatsapp", "ilike", "sem_celular%")
      .not("phone_whatsapp", "ilike", "sem_%")
      .not("last_bot_reply_at", "is", null)
      .lt("last_bot_reply_at", cutoff)
      .filter("conversation_step", "in", activeSteps)
      .not("status", "in", "(complete,cadastro_concluido,portal_submitting,registered_igreen,approved,awaiting_signature,automation_failed,abandoned,contato_incompleto)")
      .order("last_bot_reply_at", { ascending: true })
      .limit(50);
    setLeads((data as any) || []);
    setLoading(false);
    setSelectedIds((prev) => {
      const ids = new Set((data as any[] | null)?.map((l) => l.id) || []);
      const next = new Set<string>();
      prev.forEach((id) => ids.has(id) && next.add(id));
      return next;
    });
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelectedIds((prev) => (prev.size === leads.length ? new Set() : new Set(leads.map((l) => l.id))));
  };

  const executeAction = async () => {
    if (!pendingAction || selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    setExecuting(true);
    try {
      if (pendingAction === "rescue") {
        const { error } = await supabase.functions.invoke("bot-stuck-recovery", {
          body: { customer_ids: ids },
        });
        if (error) throw error;
        toast.success(`Resgate disparado para ${ids.length} lead(s)`);
      } else {
        const newStatus = pendingAction === "complete" ? "complete" : "abandoned";
        const updates: Record<string, any> = { status: newStatus };
        if (pendingAction === "complete") updates.conversation_step = null;
        const { error } = await supabase.from("customers").update(updates as never).in("id", ids);
        if (error) throw error;
        toast.success(
          pendingAction === "complete"
            ? `${ids.length} lead(s) marcado(s) como convertido(s)`
            : `${ids.length} lead(s) marcado(s) como abandonado(s)`,
        );
      }
      setSelectedIds(new Set());
      setTimeout(load, 1500);
    } catch (e: any) {
      toast.error(`Erro: ${e?.message || e}`);
    } finally {
      setExecuting(false);
      setPendingAction(null);
    }
  };

  const actionConfig = {
    rescue: {
      title: "Disparar resgate?",
      desc: `Será enviada mensagem de resgate via WhatsApp para ${selectedIds.size} lead(s) selecionado(s).`,
      confirmLabel: "Sim, enviar",
    },
    complete: {
      title: "Marcar como convertidos?",
      desc: `${selectedIds.size} lead(s) serão marcados como concluídos. Eles sairão da lista e não receberão mais mensagens automáticas.`,
      confirmLabel: "Sim, marcar convertidos",
    },
    abandoned: {
      title: "Marcar como abandonados?",
      desc: `${selectedIds.size} lead(s) serão marcados como abandonados (sem envio de mensagem). Eles sairão da lista e não receberão mais resgates.`,
      confirmLabel: "Sim, abandonar",
    },
  } as const;

  return (
    <div className="premium-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-warning/10 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-4.5 h-4.5 text-warning" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">Clientes interessados Travados</h3>
            <p className="text-xs text-muted-foreground">Sem resposta há mais de 10 min</p>
          </div>
        </div>
        <div className="flex gap-2 items-center shrink-0">
          <Badge variant="outline" className="text-xs">
            {leads.length} parado(s)
          </Badge>
          <Button size="sm" variant="ghost" onClick={load} disabled={loading} className="h-8 w-8 p-0">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-8 text-xs text-muted-foreground">Carregando...</div>
      ) : leads.length === 0 ? (
        <div className="text-center py-8 text-xs text-muted-foreground">
          ✨ Nenhum cliente interessado travado. Tudo fluindo normalmente.
        </div>
      ) : (
        <>
          {/* Toolbar de seleção */}
          <div className="flex items-center justify-between gap-3 mb-3 px-1">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <Checkbox
                checked={selectedIds.size > 0 && selectedIds.size === leads.length}
                onCheckedChange={toggleAll}
              />
              <span className="text-xs text-muted-foreground">
                {selectedIds.size === 0
                  ? "Selecionar todos"
                  : `${selectedIds.size} selecionado(s)`}
              </span>
            </label>
          </div>

          {/* Barra de ações em massa */}
          {selectedIds.size > 0 && (
            <div className="flex flex-wrap gap-2 mb-3 p-2 rounded-lg border border-border/40 bg-card/40">
              <Button
                size="sm"
                variant="default"
                onClick={() => setPendingAction("rescue")}
                disabled={executing}
                className="h-8"
              >
                <Send className="w-3.5 h-3.5 mr-1.5" />
                Continuar resgate
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPendingAction("complete")}
                disabled={executing}
                className="h-8 border-primary/30 text-primary hover:bg-primary/10 hover:text-primary"
              >
                <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
                Marcar convertido
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPendingAction("abandoned")}
                disabled={executing}
                className="h-8 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <XCircle className="w-3.5 h-3.5 mr-1.5" />
                Marcar abandonado
              </Button>
            </div>
          )}

          <div className="space-y-1.5 max-h-96 overflow-auto">
          {leads.map((lead) => {
            const idle = formatIdle(lead.last_bot_reply_at);
            const stepLabel = STEP_LABELS[lead.conversation_step || ""] || lead.conversation_step || "—";
            const sevColor =
              idle.severity === "high"
                ? "text-destructive bg-destructive/10 border-destructive/20"
                : idle.severity === "medium"
                ? "text-warning bg-warning/10 border-warning/20"
                : "text-info bg-info/10 border-info/20";
            const isSelected = selectedIds.has(lead.id);
            return (
              <div
                key={lead.id}
                className={`flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg border transition-colors ${
                  isSelected
                    ? "border-primary/40 bg-primary/5"
                    : "border-border/40 bg-card/40 hover:bg-card/70"
                }`}
              >
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => toggleOne(lead.id)}
                  className="shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground truncate">
                      {lead.name || "Sem nome"}
                    </span>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                      <Phone className="w-2.5 h-2.5 mr-1" />
                      {lead.phone_whatsapp}
                    </Badge>
                    {STATUS_BADGES[lead.status] && (
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${STATUS_BADGES[lead.status].className}`}>
                        {STATUS_BADGES[lead.status].label}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <MessageSquare className="w-3 h-3 text-muted-foreground" />
                    <span className="text-[11px] text-muted-foreground">{stepLabel}</span>
                    {(lead.rescue_attempts ?? 0) > 0 && (
                      <span className="text-[10px] text-muted-foreground">
                        · {lead.rescue_attempts} tentativa(s) de resgate
                      </span>
                    )}
                  </div>
                </div>
                <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-medium ${sevColor}`}>
                  <Clock className="w-3 h-3" />
                  {idle.text}
                </div>
              </div>
            );
          })}
          </div>
        </>
      )}

      <AlertDialog open={pendingAction !== null} onOpenChange={(o) => !o && setPendingAction(null)}>
        <AlertDialogContent className="w-[calc(100%-2rem)] max-h-[90vh] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingAction && actionConfig[pendingAction].title}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingAction && actionConfig[pendingAction].desc}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={executing}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={executeAction} disabled={executing}>
              {executing ? "Executando..." : pendingAction && actionConfig[pendingAction].confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}