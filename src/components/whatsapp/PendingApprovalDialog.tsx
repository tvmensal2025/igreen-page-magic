import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CheckCircle2, XCircle, AlertTriangle, Clock, Phone, PhoneOff, Settings2, Ban, HelpCircle, Info } from "lucide-react";

import { toast } from "sonner";
import { formatPhoneBR, initialsFrom, avatarTone, isPlaceholderPhone } from "@/lib/posVenda/format";
import PosVendaSetupWizard from "./PosVendaSetupWizard";

interface Pending {
  id: string;
  name: string | null;
  phone_whatsapp: string;
  electricity_bill_value: number | null;
  andamento_igreen: string | null;
  pos_venda_pending_stage: string;
  consultant_id: string;
  assigned_consultant_id: string | null;
}

interface Props {
  consultantId: string;
  onResolved?: () => void;
  /** Permite abrir o diálogo por um botão externo (ex.: "Validar clientes"). */
  openSignal?: number;
}

type ActionKind = "approve" | "review" | "snooze" | "invalidate";

export default function PendingApprovalDialog({ consultantId, onResolved, openSignal }: Props) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Pending[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirmInvalidate, setConfirmInvalidate] = useState<Pending | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [hasConfig, setHasConfig] = useState<boolean | null>(null);
  const [confirmBulk, setConfirmBulk] = useState(false);
  // Escopo: "mine" = meus clientes / "all" = toda a rede (validar de outros consultores)
  const [scope, setScope] = useState<"mine" | "all">("mine");

  async function load() {
    setLoading(true);
    const nowIso = new Date().toISOString();
    let query = supabase
      .from("customers")
      .select("id,name,phone_whatsapp,electricity_bill_value,andamento_igreen,pos_venda_pending_stage,consultant_id,assigned_consultant_id,pending_snoozed_until,pos_venda_invalid")
      .eq("customer_origin", "igreen_sync")
      .eq("pos_venda_invalid", false)
      .not("pos_venda_pending_stage", "is", null);
    // No escopo "meus", filtra pelos clientes do consultor; no escopo "all" traz toda a rede visível
    if (scope === "mine") {
      query = query.or(`consultant_id.eq.${consultantId},assigned_consultant_id.eq.${consultantId}`);
    }
    query = query.or(`pending_snoozed_until.is.null,pending_snoozed_until.lt.${nowIso}`);
    const { data, error } = await query;
    setLoading(false);
    if (error) { console.error(error); return; }
    const list = (data || []) as Pending[];
    setItems(list);
    if (list.length > 0) setOpen(true);
  }

  async function checkConfig() {
    const { count } = await supabase
      .from("consultant_pos_venda_media" as any)
      .select("id", { count: "exact", head: true })
      .eq("consultant_id", consultantId);
    setHasConfig((count || 0) > 0);
  }

  useEffect(() => { load(); checkConfig(); /* eslint-disable-next-line */ }, [consultantId, scope]);

  // Abertura manual via botão externo ("Validar clientes")
  useEffect(() => {
    if (openSignal) { setOpen(true); load(); }
    // eslint-disable-next-line
  }, [openSignal]);

  useEffect(() => {
    const ch = supabase
      .channel(`pending-${consultantId}`)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "customers",
        filter: `consultant_id=eq.${consultantId}`,
      }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line
  }, [consultantId]);

  const grouped = useMemo(() => {
    const g: Record<string, Pending[]> = { aprovado: [], reprovado: [], devolutiva: [] };
    for (const it of items) {
      const k = it.pos_venda_pending_stage || "aprovado";
      (g[k] ||= []).push(it);
    }
    return g;
  }, [items]);

  async function act(customerId: string, action: ActionKind) {
    const { data, error } = await supabase.rpc("confirm_pending_classification" as any, { _customer_id: customerId, _action: action });
    if (error) { toast.error(error.message); return; }
    const ok = (data as any)?.ok;
    if (!ok) { toast.error((data as any)?.error || "Erro"); return; }
    setItems((prev) => prev.filter((p) => p.id !== customerId));
    const msg = {
      approve: "Confirmado! Mensagem disparada.",
      snooze: "Adiado 24h",
      review: "Mantido em Espera",
      invalidate: "Cliente marcado como inválido",
    }[action];
    toast.success(msg);
    onResolved?.();
  }

  async function actBulk() {
    const ids = (grouped["aprovado"] || []).map((p) => p.id);
    for (const id of ids) {
      await supabase.rpc("confirm_pending_classification" as any, { _customer_id: id, _action: "approve" });
    }
    setItems((prev) => prev.filter((p) => !ids.includes(p.id)));
    toast.success(`${ids.length} confirmados`);
    setConfirmBulk(false);
    onResolved?.();
  }

  function handleBulkClick() {
    if (hasConfig === false) {
      setWizardOpen(true);
      return;
    }
    setConfirmBulk(true);
  }

  // Só esconde o diálogo automaticamente no carregamento inicial (sem itens e
  // ainda fechado). Se o usuário abriu e está navegando entre escopos, mantém
  // aberto para permitir validar clientes de outros consultores.
  if (items.length === 0 && !open) {
    return (
      <PosVendaSetupWizard
        consultantId={consultantId}
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onComplete={() => { setHasConfig(true); load(); }}
      />
    );
  }

  const sections: { key: string; label: string; icon: any; tone: string; accent: string }[] = [
    { key: "aprovado", label: "Aprovados", icon: CheckCircle2, tone: "text-primary", accent: "bg-primary/10 border-primary/20" },
    { key: "reprovado", label: "Reprovados", icon: XCircle, tone: "text-destructive", accent: "bg-destructive/10 border-destructive/20" },
    { key: "devolutiva", label: "Devolutiva", icon: AlertTriangle, tone: "text-warning", accent: "bg-warning/10 border-warning/20" },
  ];

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl h-[85vh] max-h-[85vh] flex flex-col gap-0 p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-4 border-b shrink-0 bg-muted/20">
            <div className="flex items-center justify-between">
              <DialogTitle className="text-xl font-bold flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-primary" />
                Confirmar novos clientes
              </DialogTitle>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                      <HelpCircle className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[300px]">
                    <p className="text-xs">
                      Revise os clientes sincronizados do iGreen. Ao confirmar, eles entram na autoprogressão e recebem as mensagens automáticas configuradas (30/60/90/120 dias).
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <DialogDescription className="text-sm mt-1">
              Clientes sincronizados que aguardam revisão para iniciar o fluxo pós-venda.
            </DialogDescription>


            {/* Escopo: meus clientes ou toda a rede (validar de outros consultores) */}
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              <div className="inline-flex rounded-lg border border-border p-0.5 bg-muted/40">
                <button
                  type="button"
                  onClick={() => setScope("mine")}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    scope === "mine" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Meus clientes
                </button>
                <button
                  type="button"
                  onClick={() => setScope("all")}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    scope === "all" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Toda a rede
                </button>
              </div>
              {hasConfig === false && (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-2"
                  onClick={() => setWizardOpen(true)}
                >
                  <Settings2 className="w-3.5 h-3.5" />
                  Configurar mensagens primeiro
                </Button>
              )}
            </div>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
            {loading ? (
              <div className="text-center py-12 text-sm text-muted-foreground">Carregando…</div>
            ) : items.length === 0 ? (
              <div className="text-center py-12 text-sm text-muted-foreground">
                {scope === "all"
                  ? "Nenhum cliente aguardando confirmação na rede."
                  : "Nenhum cliente aguardando sua confirmação."}
              </div>
            ) : (
            <div className="space-y-4">
              {sections.map((sec) => {
                const list = grouped[sec.key] || [];
                if (!list.length) return null;
                const Icon = sec.icon;
                return (
                  <div key={sec.key} className={`border rounded-xl overflow-hidden ${sec.accent}`}>
                    <div className="flex items-center justify-between px-3 py-2 bg-background/40">
                      <div className={`flex items-center gap-2 font-medium text-sm ${sec.tone}`}>
                        <Icon className="w-4 h-4" />
                        <span>{list.length} {sec.label}</span>
                      </div>
                      {sec.key === "aprovado" && (
                        <Button size="sm" variant="default" onClick={handleBulkClick}>
                          Confirmar todos ({list.length})
                        </Button>
                      )}
                    </div>
                    <div className="divide-y divide-border/30 bg-background/40">
                      {list.map((c) => {
                        const noPhone = isPlaceholderPhone(c.phone_whatsapp);
                        const tone = avatarTone(c.id);
                        return (
                          <div key={c.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/30 transition-colors">
                            <div className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold ${tone}`}>
                              {initialsFrom(c.name)}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium truncate text-foreground">{c.name || "Sem nome"}</p>
                              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                {noPhone ? (
                                  <Badge variant="outline" className="text-[10px] gap-1 border-warning/40 text-warning">
                                    <PhoneOff className="w-2.5 h-2.5" />
                                    Sem WhatsApp
                                  </Badge>
                                ) : (
                                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                                    <Phone className="w-3 h-3" />
                                    {formatPhoneBR(c.phone_whatsapp)}
                                  </span>
                                )}
                                {c.electricity_bill_value != null && (
                                  <span className="text-xs text-muted-foreground">
                                    R$ {Number(c.electricity_bill_value).toFixed(2)}
                                  </span>
                                )}
                                {c.andamento_igreen && (
                                  <Badge variant="outline" className="text-[10px] py-0">{c.andamento_igreen}</Badge>
                                )}
                              </div>
                            </div>
                            <div className="flex gap-1.5 shrink-0">
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button size="sm" variant="default" className="h-9 px-3 font-semibold shadow-sm hover:shadow-md transition-all" onClick={() => act(c.id, "approve")}>
                                      Validar
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Confirmar e iniciar fluxo</TooltipContent>
                                </Tooltip>

                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button size="sm" variant="outline" className="h-9 px-3 border-border/60" onClick={() => act(c.id, "review")}>
                                      Rever
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Manter em espera para revisão posterior</TooltipContent>
                                </Tooltip>

                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-9 w-9 text-destructive hover:text-destructive hover:bg-destructive/10 border border-transparent hover:border-destructive/20"
                                      onClick={() => setConfirmInvalidate(c)}
                                    >
                                      <Ban className="w-4 h-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Marcar como inválido (não aparecerá mais)</TooltipContent>
                                </Tooltip>

                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-9 w-9 text-muted-foreground border border-transparent hover:border-border"
                                      onClick={() => act(c.id, "snooze")}
                                    >
                                      <Clock className="w-4 h-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Adiar por 24 horas</TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </div>

                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirmação de invalidação */}
      <AlertDialog open={!!confirmInvalidate} onOpenChange={(v) => !v && setConfirmInvalidate(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Marcar como inválido?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{confirmInvalidate?.name || "Este cliente"}</strong> não voltará a aparecer
              nesta fila de confirmação. Use isso quando o cadastro estiver errado ou duplicado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive/100 hover:bg-destructive"
              onClick={() => {
                if (confirmInvalidate) act(confirmInvalidate.id, "invalidate");
                setConfirmInvalidate(null);
              }}
            >
              Marcar inválido
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmação bulk */}
      <AlertDialog open={confirmBulk} onOpenChange={setConfirmBulk}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar todos os aprovados?</AlertDialogTitle>
            <AlertDialogDescription>
              {(grouped["aprovado"] || []).length} clientes vão entrar na autoprogressão e
              receber a sequência configurada (mensagens de 30/60/90/120 dias).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={actBulk}>Confirmar todos</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <PosVendaSetupWizard
        consultantId={consultantId}
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onComplete={() => { setHasConfig(true); load(); }}
      />
    </>
  );
}
