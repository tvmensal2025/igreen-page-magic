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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CheckCircle2, XCircle, AlertTriangle, Clock, Phone, PhoneOff, Settings2, Ban, HelpCircle, FileSignature, PauseCircle, ArrowLeft, Inbox } from "lucide-react";

import { toast } from "sonner";
import { formatPhoneBR, initialsFrom, avatarTone, isPlaceholderPhone } from "@/lib/posVenda/format";
import PosVendaSetupWizard from "./PosVendaSetupWizard";
import ApproveBillValueDialog, { needsBillValueForApproval } from "./ApproveBillValueDialog";

interface Pending {
  id: string;
  name: string | null;
  phone_whatsapp: string;
  electricity_bill_value: number | null;
  andamento_igreen: string | null;
  pos_venda_pending_stage: string;
  consultant_id: string;
  assigned_consultant_id: string | null;
  registered_by_igreen_id: string | null;
  registered_by_name: string | null;
}

interface Props {
  consultantId: string;
  onResolved?: () => void;
  /** Permite abrir o diálogo por um botão externo (ex.: "Validar clientes"). */
  openSignal?: number;
}

type ActionKind = "approve" | "review" | "snooze" | "invalidate" | "missing_signature" | "defer_devolutiva" | "reject_pending";

/** Estágio pendente usado para "estacionar" devolutivas fora da fila principal. */
const DEVOLUTIVA_ABERTA = "devolutiva_aberta";

export default function PendingApprovalDialog({ consultantId, onResolved, openSignal }: Props) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Pending[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirmInvalidate, setConfirmInvalidate] = useState<Pending | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [hasConfig, setHasConfig] = useState<boolean | null>(null);
  const [confirmBulk, setConfirmBulk] = useState(false);
  /** Cliente aguardando informe da fatura antes de aprovar. */
  const [billPrompt, setBillPrompt] = useState<Pending | null>(null);
  // Filtro por licenciado: "mine" (padrão, só meus), "all" (toda rede), ou igreen_id específico
  const [ownerFilter, setOwnerFilter] = useState<string>("mine");
  // Aba interna: "fila" = pendências normais / "devolutivas" = devolutivas em aberto (estacionadas)
  const [view, setView] = useState<"fila" | "devolutivas">("fila");
  // igreen_id do consultor logado (para filtrar por registrados por ele)
  const [myIgreenId, setMyIgreenId] = useState<string | null>(null);
  // Lista de licenciados da rede (para o seletor de filtro)
  const [registrants, setRegistrants] = useState<{ id: string; name: string }[]>([]);

  async function load() {
    setLoading(true);
    const nowIso = new Date().toISOString();
    let query = supabase
      .from("customers")
      .select("id,name,phone_whatsapp,electricity_bill_value,andamento_igreen,pos_venda_pending_stage,consultant_id,assigned_consultant_id,pending_snoozed_until,pos_venda_invalid,registered_by_igreen_id,registered_by_name")
      .eq("customer_origin", "igreen_sync")
      .eq("pos_venda_invalid", false)
      .not("pos_venda_pending_stage", "is", null)
      .or(`consultant_id.eq.${consultantId},assigned_consultant_id.eq.${consultantId}`);

    // Filtro por licenciado
    if (ownerFilter === "mine") {
      if (myIgreenId) {
        query = query.eq("registered_by_igreen_id", myIgreenId);
      }
      // se não tem myIgreenId ainda, mostra todos (até carregar)
    } else if (ownerFilter !== "all") {
      // igreen_id específico de outro licenciado
      query = query.eq("registered_by_igreen_id", ownerFilter);
    }

    query = query.or(`pending_snoozed_until.is.null,pending_snoozed_until.lt.${nowIso}`);
    const { data, error } = await query;
    setLoading(false);
    if (error) { console.error(error); return; }
    const list = (data || []) as Pending[];
    setItems(list);
    // Só abre sozinho se houver pendência na fila principal (devolutivas em
    // aberto ficam estacionadas e não forçam a abertura do modal).
    const temFilaPrincipal = list.some((p) => p.pos_venda_pending_stage !== DEVOLUTIVA_ABERTA);
    if (temFilaPrincipal) setOpen(true);
  }

  async function loadMyIgreenId() {
    const { data } = await supabase.from("consultants").select("igreen_id").eq("id", consultantId).maybeSingle();
    if (data?.igreen_id) setMyIgreenId(String(data.igreen_id));
  }

  async function loadRegistrants() {
    const { data } = await supabase
      .from("customers")
      .select("registered_by_igreen_id,registered_by_name")
      .eq("customer_origin", "igreen_sync")
      .or(`consultant_id.eq.${consultantId},assigned_consultant_id.eq.${consultantId}`)
      .not("registered_by_igreen_id", "is", null)
      .not("pos_venda_pending_stage", "is", null)
      .limit(2000);
    const map = new Map<string, string>();
    for (const r of (data as any) || []) {
      const id = String(r.registered_by_igreen_id);
      if (!map.has(id)) map.set(id, r.registered_by_name || `iGreen ${id}`);
    }
    setRegistrants(Array.from(map.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)));
  }

  async function checkConfig() {
    const { count } = await supabase
      .from("consultant_pos_venda_media" as any)
      .select("id", { count: "exact", head: true })
      .eq("consultant_id", consultantId);
    setHasConfig((count || 0) > 0);
  }

  useEffect(() => { load(); checkConfig(); /* eslint-disable-next-line */ }, [consultantId, ownerFilter, myIgreenId]);
  useEffect(() => { loadMyIgreenId(); loadRegistrants(); /* eslint-disable-next-line */ }, [consultantId]);

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

  // Itens da fila principal (exclui devolutivas em aberto, que ficam estacionadas)
  const filaItems = useMemo(
    () => items.filter((it) => it.pos_venda_pending_stage !== DEVOLUTIVA_ABERTA),
    [items],
  );
  // Devolutivas em aberto: lista separada, acessível pelo botão no topo
  const devolutivasAbertas = useMemo(
    () => items.filter((it) => it.pos_venda_pending_stage === DEVOLUTIVA_ABERTA),
    [items],
  );

  const grouped = useMemo(() => {
    const g: Record<string, Pending[]> = {
      aprovado: [],
      falta_assinatura: [],
      reprovado: [],
      devolutiva: [],
    };
    for (const it of filaItems) {
      const k = it.pos_venda_pending_stage || "aprovado";
      (g[k] ||= []).push(it);
    }
    return g;
  }, [filaItems]);

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
      missing_signature: "Marcado como falta assinatura — permanece em espera.",
      defer_devolutiva: "Devolutiva em aberto — guardado na lista para resolver depois.",
      reject_pending: "Reclassificado como reprovado.",
    }[action];
    toast.success(msg);
    onResolved?.();
  }

  async function actBulk() {
    const list = grouped["aprovado"] || [];
    const semFatura = list.filter((p) => needsBillValueForApproval(p.pos_venda_pending_stage, p.electricity_bill_value));
    if (semFatura.length > 0) {
      toast.error(
        `${semFatura.length} cliente(s) aprovado(s) sem valor da conta — valide individualmente e informe a fatura antes.`,
      );
      setConfirmBulk(false);
      return;
    }
    const ids = list.map((p) => p.id);
    for (const id of ids) {
      await supabase.rpc("confirm_pending_classification" as any, { _customer_id: id, _action: "approve" });
    }
    setItems((prev) => prev.filter((p) => !ids.includes(p.id)));
    toast.success(`${ids.length} confirmados`);
    setConfirmBulk(false);
    onResolved?.();
  }

  function handleApproveClick(c: Pending) {
    if (needsBillValueForApproval(c.pos_venda_pending_stage, c.electricity_bill_value)) {
      setBillPrompt(c);
      return;
    }
    void act(c.id, "approve");
  }

  function handleBulkClick() {
    if (hasConfig === false) {
      setWizardOpen(true);
      return;
    }
    const semFatura = (grouped["aprovado"] || []).filter((p) =>
      needsBillValueForApproval(p.pos_venda_pending_stage, p.electricity_bill_value),
    );
    if (semFatura.length > 0) {
      toast.error(
        `${semFatura.length} cliente(s) sem valor da conta. Valide um a um e informe a fatura.`,
      );
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

  const sections: { key: string; label: string; icon: typeof CheckCircle2; tone: string; accent: string }[] = [
    { key: "aprovado", label: "Aprovados", icon: CheckCircle2, tone: "text-primary", accent: "bg-primary/10 border-primary/20" },
    { key: "falta_assinatura", label: "Falta assinatura", icon: FileSignature, tone: "text-info", accent: "bg-info/10 border-info/20" },
    { key: "reprovado", label: "Reprovados", icon: XCircle, tone: "text-destructive", accent: "bg-destructive/10 border-destructive/20" },
    { key: "devolutiva", label: "Devolutiva", icon: AlertTriangle, tone: "text-warning", accent: "bg-warning/10 border-warning/20" },
  ];

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl h-[85vh] max-h-[85vh] flex flex-col gap-0 p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-4 pr-12 border-b shrink-0 bg-muted/20">
            <DialogTitle className="text-xl font-bold flex items-center gap-2 min-w-0">
              <CheckCircle2 className="w-5 h-5 text-primary shrink-0" />
              <span className="truncate">Confirmar novos clientes</span>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
                    aria-label="Ajuda sobre confirmação de clientes"
                  >
                    <HelpCircle className="w-4 h-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  side="bottom"
                  sideOffset={6}
                  collisionPadding={16}
                  className="w-[min(280px,calc(100vw-3rem))] p-3 z-[130] text-xs leading-relaxed"
                >
                  <p>
                    Revise os clientes sincronizados do iGreen. Use <strong>Falta assinatura</strong> quando o cliente ainda não assinou.
                    Ao confirmar aprovados, eles entram na autoprogressão (30/60/90/120 dias).
                  </p>
                </PopoverContent>
              </Popover>
            </DialogTitle>
            <DialogDescription className="text-sm mt-1">
              Clientes sincronizados que aguardam revisão para iniciar o fluxo pós-venda.
            </DialogDescription>


            {/* Filtro por licenciado */}
            <div className="flex flex-col gap-2 mt-3 sm:flex-row sm:flex-wrap sm:items-center">
              <div className="flex items-center gap-2 flex-wrap min-w-0">
              <div className="inline-flex rounded-lg border border-border p-0.5 bg-muted/40 shrink-0">
                <button
                  type="button"
                  onClick={() => setOwnerFilter("mine")}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    ownerFilter === "mine" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Meus clientes
                </button>
                <button
                  type="button"
                  onClick={() => setOwnerFilter("all")}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    ownerFilter === "all" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Toda a rede
                </button>
              </div>
              {registrants.length > 1 && ownerFilter !== "mine" && (
                <select
                  value={ownerFilter === "all" ? "all" : ownerFilter}
                  onChange={(e) => setOwnerFilter(e.target.value)}
                  className="h-8 px-2 text-xs rounded-md border border-border bg-background text-foreground"
                >
                  <option value="all">Todos os licenciados</option>
                  {registrants.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} {r.id === myIgreenId ? "(eu)" : ""}
                    </option>
                  ))}
                </select>
              )}
              {hasConfig === false && (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-2 shrink-0"
                  onClick={() => setWizardOpen(true)}
                >
                  <Settings2 className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">Configurar mensagens primeiro</span>
                </Button>
              )}
              </div>

              {/* Alterna entre a fila normal e as devolutivas estacionadas */}
              <div className="flex shrink-0 sm:ml-auto">
              {view === "fila" ? (
                devolutivasAbertas.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-2 border-warning/50 text-warning hover:bg-warning/10 w-full sm:w-auto"
                    onClick={() => setView("devolutivas")}
                  >
                    <Inbox className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">Devolutivas em aberto ({devolutivasAbertas.length})</span>
                  </Button>
                )
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-2 w-full sm:w-auto"
                  onClick={() => setView("fila")}
                >
                  <ArrowLeft className="w-3.5 h-3.5 shrink-0" />
                  Voltar para a fila
                </Button>
              )}
              </div>
            </div>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
            {loading ? (
              <div className="text-center py-12 text-sm text-muted-foreground">Carregando…</div>
            ) : view === "devolutivas" ? (
              /* ===== Lista de devolutivas em aberto (estacionadas) ===== */
              devolutivasAbertas.length === 0 ? (
                <div className="text-center py-12 text-sm text-muted-foreground">
                  Nenhuma devolutiva em aberto.
                </div>
              ) : (
                <div className="border rounded-xl overflow-hidden bg-warning/10 border-warning/20">
                  <div className="flex items-center gap-2 px-3 py-2 bg-background/40 font-medium text-sm text-warning min-w-0">
                    <PauseCircle className="w-4 h-4 shrink-0" />
                    <span className="min-w-0">{devolutivasAbertas.length} devolutiva(s) em aberto — resolva quando puder</span>
                  </div>
                  <div className="divide-y divide-border/30 bg-background/40">
                    {devolutivasAbertas.map((c) => {
                      const noPhone = isPlaceholderPhone(c.phone_whatsapp);
                      const tone = avatarTone(c.id);
                      return (
                        <div key={c.id} className="px-3 py-2.5 hover:bg-muted/30 transition-colors space-y-2">
                          <div className="flex items-start gap-3 min-w-0">
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
                                  <Phone className="w-3 h-3 shrink-0" />
                                  {formatPhoneBR(c.phone_whatsapp)}
                                </span>
                              )}
                              {c.andamento_igreen && (
                                <Badge variant="outline" className="text-[10px] py-0 max-w-full truncate">{c.andamento_igreen}</Badge>
                              )}
                            </div>
                          </div>
                          </div>
                          <div className="flex gap-1 flex-wrap pl-12 sm:pl-0">
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button size="sm" variant="default" className="h-8 px-2.5 text-xs font-semibold" onClick={() => handleApproveClick(c)}>
                                    Resolver e validar
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Devolutiva resolvida — aprovar e iniciar fluxo</TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button size="sm" variant="outline" className="h-8 px-2.5 text-xs border-border/60" onClick={() => act(c.id, "review")}>
                                    Rever
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Voltar para a fila de classificação</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )
            ) : filaItems.length === 0 ? (
              <div className="text-center py-12 text-sm text-muted-foreground">
                {ownerFilter === "all"
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
                    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-background/40">
                      <div className={`flex items-center gap-2 font-medium text-sm min-w-0 ${sec.tone}`}>
                        <Icon className="w-4 h-4 shrink-0" />
                        <span className="truncate">{list.length} {sec.label}</span>
                      </div>
                      {sec.key === "aprovado" && (
                        <Button size="sm" variant="default" className="shrink-0 w-full sm:w-auto" onClick={handleBulkClick}>
                          Confirmar todos ({list.length})
                        </Button>
                      )}
                      {sec.key === "falta_assinatura" && (
                        <span className="text-[10px] text-muted-foreground shrink-0">Aguardando assinatura no iGreen</span>
                      )}
                    </div>
                    <div className="divide-y divide-border/30 bg-background/40">
                      {list.map((c) => {
                        const noPhone = isPlaceholderPhone(c.phone_whatsapp);
                        const tone = avatarTone(c.id);
                        return (
                          <div key={c.id} className="px-3 py-2.5 hover:bg-muted/30 transition-colors space-y-2">
                            <div className="flex items-start gap-3 min-w-0">
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
                                    <Phone className="w-3 h-3 shrink-0" />
                                    {formatPhoneBR(c.phone_whatsapp)}
                                  </span>
                                )}
                                {c.electricity_bill_value != null && Number(c.electricity_bill_value) > 0 ? (
                                  <span className="text-xs text-muted-foreground">
                                    R$ {Number(c.electricity_bill_value).toFixed(2)}
                                  </span>
                                ) : sec.key === "aprovado" || sec.key === "falta_assinatura" ? (
                                  <Badge variant="outline" className="text-[10px] gap-1 border-warning/40 text-warning">
                                    <AlertTriangle className="w-2.5 h-2.5" />
                                    Informe a conta
                                  </Badge>
                                ) : null}
                                {c.andamento_igreen && (
                                  <Badge variant="outline" className="text-[10px] py-0 max-w-full truncate">{c.andamento_igreen}</Badge>
                                )}
                              </div>
                            </div>
                            </div>
                            <div className="flex gap-1 flex-wrap pl-12 sm:pl-0">
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button size="sm" variant="default" className="h-8 px-2.5 text-xs font-semibold shadow-sm hover:shadow-md transition-all" onClick={() => handleApproveClick(c)}>
                                      Validar
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    {sec.key === "falta_assinatura"
                                      ? "Cliente assinou — confirmar e iniciar fluxo"
                                      : sec.key === "aprovado"
                                        ? "Confirmar e iniciar fluxo"
                                        : "Confirmar classificação do sync"}
                                  </TooltipContent>
                                </Tooltip>

                                {(sec.key === "aprovado" || sec.key === "devolutiva") && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-8 px-2 text-xs border-info/50 text-info hover:bg-info/10"
                                        onClick={() => act(c.id, "missing_signature")}
                                      >
                                        <FileSignature className="w-3.5 h-3.5 mr-1 shrink-0" />
                                        Falta assinatura
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Mantém em espera até o cliente assinar no iGreen</TooltipContent>
                                  </Tooltip>
                                )}

                                {sec.key === "devolutiva" && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-8 px-2 text-xs border-warning/50 text-warning hover:bg-warning/10"
                                        onClick={() => act(c.id, "defer_devolutiva")}
                                      >
                                        <PauseCircle className="w-3.5 h-3.5 mr-1 shrink-0" />
                                        Devolutiva em aberto
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Guarda numa lista separada e some da fila até você resolver</TooltipContent>
                                  </Tooltip>
                                )}

                                {sec.key === "aprovado" && (
                                  <>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          className="h-8 px-2 text-xs border-warning/50 text-warning hover:bg-warning/10"
                                          onClick={() => act(c.id, "defer_devolutiva")}
                                        >
                                          <PauseCircle className="w-3.5 h-3.5 mr-1 shrink-0" />
                                          Devolutiva
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>Na verdade é devolutiva — guarda na lista separada</TooltipContent>
                                    </Tooltip>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          className="h-8 px-2 text-xs border-destructive/50 text-destructive hover:bg-destructive/10"
                                          onClick={() => act(c.id, "reject_pending")}
                                        >
                                          <XCircle className="w-3.5 h-3.5 mr-1 shrink-0" />
                                          Reprovado
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>Na verdade é reprovado — reclassificar</TooltipContent>
                                    </Tooltip>
                                  </>
                                )}

                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button size="sm" variant="outline" className="h-8 px-2.5 text-xs border-border/60" onClick={() => act(c.id, "review")}>
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
                                      className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10 border border-transparent hover:border-destructive/20"
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
                                      className="h-8 w-8 text-muted-foreground border border-transparent hover:border-border"
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

      <ApproveBillValueDialog
        customer={billPrompt}
        open={!!billPrompt}
        onOpenChange={(o) => { if (!o) setBillPrompt(null); }}
        onSaved={async (customerId, billValue) => {
          setItems((prev) =>
            prev.map((p) => (p.id === customerId ? { ...p, electricity_bill_value: billValue } : p)),
          );
          await act(customerId, "approve");
          setBillPrompt(null);
        }}
      />

      <PosVendaSetupWizard
        consultantId={consultantId}
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onComplete={() => { setHasConfig(true); load(); }}
      />
    </>
  );
}
