import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  CheckCircle2, XCircle, Calendar, RotateCcw, UserPlus, Phone, MoreHorizontal, RefreshCw, Eye, ClipboardCheck, Users,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import PendingApprovalDialog from "./PendingApprovalDialog";
import CustomerQuickViewDialog from "./CustomerQuickViewDialog";
import PosVendaAutoConfigDialog from "./PosVendaAutoConfigDialog";
import ApproveBillValueDialog, { needsBillValueForApproval } from "./ApproveBillValueDialog";

type Stage = "espera" | "aprovado" | "reprovado" | "d30" | "d60" | "d90" | "d120";

interface PosVendaCustomer {
  id: string;
  name: string | null;
  phone_whatsapp: string;
  electricity_bill_value: number | null;
  portal_submitted_at: string | null;
  pos_venda_approved_at: string | null;
  andamento_igreen: string | null;
  status: string;
  consultant_id: string;
  assigned_consultant_id: string | null;
  pos_venda_stage: Stage | null;
  pos_venda_manual: boolean;
  pos_venda_reason: string | null;
  pos_venda_pending_stage: string | null;
  pending_snoozed_until: string | null;
}

const STAGES: { key: Stage; label: string; badge: string; bar: string; dot: string }[] = [
  { key: "espera",     label: "Aguardando Classificação", badge: "bg-warning/15 text-warning border-warning/40",   bar: "bg-warning/100",   dot: "bg-warning" },
  { key: "aprovado",   label: "Aprovado",   badge: "bg-primary/20 text-primary border-primary/50", bar: "bg-primary/100", dot: "bg-primary" },
  { key: "reprovado",  label: "Reprovado",  badge: "bg-destructive/20 text-destructive border-destructive/50",      bar: "bg-destructive/100",    dot: "bg-destructive" },
  { key: "d30",        label: "30 dias",    badge: "bg-primary/15 text-primary border-primary/40",      bar: "bg-primary/100",    dot: "bg-primary" },
  { key: "d60",        label: "60 dias",    badge: "bg-primary/15 text-primary border-primary/40",      bar: "bg-primary/100",    dot: "bg-primary" },
  { key: "d90",        label: "90 dias",    badge: "bg-info/15 text-info border-info/40",      bar: "bg-info/100",    dot: "bg-info" },
  { key: "d120",       label: "120 dias",   badge: "bg-info/15 text-info border-info/40", bar: "bg-info/100",  dot: "bg-info" },
];

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
}

function computeStage(c: PosVendaCustomer): Stage {
  if (c.pos_venda_stage && c.pos_venda_stage !== ("em_analise" as Stage)) return c.pos_venda_stage;
  if (/reprov|cancel/i.test(c.andamento_igreen || "") || ["rejected","cancelled","canceled"].includes(c.status)) return "reprovado";
  // Esteira temporal: aprovação canônica, fallback portal_submitted_at (backfill).
  const d = daysSince(c.pos_venda_approved_at || c.portal_submitted_at);
  if (d == null) return "espera";
  if (d >= 120) return "d120";
  if (d >= 90)  return "d90";
  if (d >= 60)  return "d60";
  if (d >= 30)  return "d30";
  return "aprovado";
}

export default function PosVendaKanban({ consultantId }: { consultantId: string }) {
  const [customers, setCustomers] = useState<PosVendaCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [consultants, setConsultants] = useState<{ id: string; full_name: string | null; slug: string | null }[]>([]);
  const [registrants, setRegistrants] = useState<{ id: string; name: string }[]>([]); // registered_by_igreen_id
  const [myIgreenId, setMyIgreenId] = useState<string | null>(null);
  const [assignDialog, setAssignDialog] = useState<PosVendaCustomer | null>(null);
  const [assignTo, setAssignTo] = useState<string>("");
  const [rejectDialog, setRejectDialog] = useState<PosVendaCustomer | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  // Agendamento de lembrete automático ao reprovar (reaproveita scheduled_messages).
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [reminderDays, setReminderDays] = useState<string>("30");
  const [reminderCustomDays, setReminderCustomDays] = useState<string>("");
  const [reminderText, setReminderText] = useState("");
  const [savingReject, setSavingReject] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [recomputing, setRecomputing] = useState(false);
  const [viewCustomerId, setViewCustomerId] = useState<string | null>(null);
  // Sinal para abrir o diálogo de validação de clientes manualmente
  const [validateSignal, setValidateSignal] = useState(0);
  /** Aprovação pendente de valor da conta (move manual para aprovado). */
  const [billPrompt, setBillPrompt] = useState<PosVendaCustomer | null>(null);
  // "mine" = registered_by_igreen_id = meu | "assigned" | "all" | <igreen_id específico>
  const [ownerFilter, setOwnerFilter] = useState<string>("mine");

  async function load() {
    setLoading(true);
    let q = supabase
      .from("customers")
      .select("id,name,phone_whatsapp,electricity_bill_value,portal_submitted_at,pos_venda_approved_at,andamento_igreen,status,consultant_id,assigned_consultant_id,pos_venda_stage,pos_venda_manual,pos_venda_reason,pos_venda_pending_stage,pending_snoozed_until,registered_by_igreen_id,registered_by_name")
      .eq("customer_origin", "igreen_sync")
      .or(`consultant_id.eq.${consultantId},assigned_consultant_id.eq.${consultantId}`);

    if (ownerFilter === "mine") {
      if (myIgreenId) q = q.eq("registered_by_igreen_id", myIgreenId);
      else { setCustomers([]); setLoading(false); return; }
    } else if (ownerFilter === "assigned") {
      q = q.eq("assigned_consultant_id", consultantId);
    } else if (ownerFilter !== "all") {
      // specific registered_by_igreen_id
      q = q.eq("registered_by_igreen_id", ownerFilter);
    }

    const { data, error } = await q.order("portal_submitted_at", { ascending: false, nullsFirst: false });
    if (error) {
      toast.error("Erro ao carregar: " + error.message);
    } else {
      setCustomers((data as any) || []);
    }
    setLoading(false);
  }

  async function loadConsultants() {
    const { data } = await supabase.from("consultants").select("id,name,igreen_id").order("name");
    setConsultants(((data as any) || []).map((c: any) => ({ id: c.id, full_name: c.name, slug: null })));
    const me = (data as any)?.find((c: any) => c.id === consultantId);
    if (me?.igreen_id) setMyIgreenId(String(me.igreen_id));
  }

  async function loadRegistrants() {
    // distinct registered_by entre clientes da rede do consultor
    const { data } = await supabase
      .from("customers")
      .select("registered_by_igreen_id,registered_by_name")
      .eq("customer_origin", "igreen_sync")
      .or(`consultant_id.eq.${consultantId},assigned_consultant_id.eq.${consultantId}`)
      .not("registered_by_igreen_id", "is", null)
      .limit(2000);
    const map = new Map<string, string>();
    for (const r of (data as any) || []) {
      const id = String(r.registered_by_igreen_id);
      if (!map.has(id)) map.set(id, r.registered_by_name || `iGreen ${id}`);
    }
    setRegistrants(Array.from(map.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)));
  }

  useEffect(() => { load(); }, [consultantId, ownerFilter, myIgreenId]);
  useEffect(() => { loadConsultants(); loadRegistrants(); }, [consultantId]);



  const grouped = useMemo(() => {
    const filtered = customers.filter((c) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (c.name || "").toLowerCase().includes(q) || (c.phone_whatsapp || "").includes(q);
    });
    const out: Record<Stage, PosVendaCustomer[]> = { espera: [], aprovado: [], reprovado: [], d30: [], d60: [], d90: [], d120: [] };
    for (const c of filtered) out[computeStage(c)].push(c);
    return out;
  }, [customers, search]);

  async function moveTo(c: PosVendaCustomer, target: Stage, opts: { reason?: string } = {}) {
    const isOwner = c.consultant_id === consultantId || c.assigned_consultant_id === consultantId;
    if (!isOwner) { toast.error("Você não pode mover este cliente"); return; }
    if (
      target === "aprovado" &&
      needsBillValueForApproval("aprovado", c.electricity_bill_value)
    ) {
      setBillPrompt(c);
      return;
    }
    await applyMoveTo(c, target, opts);
  }

  async function applyMoveTo(c: PosVendaCustomer, target: Stage, opts: { reason?: string } = {}) {
    const patch: any = {
      pos_venda_stage: target,
      pos_venda_manual: true,
      pos_venda_reason: target === "reprovado" ? (opts.reason ?? c.pos_venda_reason ?? null) : null,
    };
    // Carimba a data de aprovação ao entrar em "aprovado" (marco da esteira
    // 30/60/90/120). Em "reprovado" / "espera" o marco é zerado.
    if (target === "aprovado") {
      patch.pos_venda_approved_at = c.pos_venda_approved_at ?? new Date().toISOString();
    } else if (target === "reprovado" || target === "espera") {
      patch.pos_venda_approved_at = null;
    }
    const { error } = await supabase.from("customers").update(patch).eq("id", c.id);
    if (error) { toast.error("Erro: " + error.message); return; }
    setCustomers((prev) => prev.map((x) => x.id === c.id ? { ...x, ...patch } : x));
    toast.success(`Movido para ${STAGES.find(s => s.key === target)?.label}`);
  }

  async function resetAuto(c: PosVendaCustomer) {
    const { error } = await supabase
      .from("customers")
      .update({ pos_venda_manual: false, pos_venda_stage: null, pos_venda_reason: null, pos_venda_approved_at: null } as any)
      .eq("id", c.id);
    if (error) { toast.error("Erro: " + error.message); return; }
    toast.success("Voltou ao automático");
    load();
  }

  /**
   * Abre o dialog de reprovação com estado limpo (motivo pré-preenchido com o
   * existente, agendador zerado).
   */
  function openRejectDialog(c: PosVendaCustomer) {
    setRejectDialog(c);
    setRejectReason(c.pos_venda_reason || "");
    setReminderEnabled(false);
    setReminderDays("30");
    setReminderCustomDays("");
    setReminderText("");
  }

  /**
   * Confirma a reprovação e, opcionalmente, agenda um lembrete automático.
   * O lembrete reaproveita a infra existente (`scheduled_messages` +
   * cron `send-scheduled-messages`), que já trata quiet-hours, anti-ban e retry.
   */
  async function confirmReject(c: PosVendaCustomer) {
    setSavingReject(true);
    try {
      await moveTo(c, "reprovado", { reason: rejectReason || undefined });

      if (reminderEnabled) {
        const days = reminderDays === "custom"
          ? parseInt(reminderCustomDays, 10)
          : parseInt(reminderDays, 10);

        if (!Number.isFinite(days) || days < 1 || days > 365) {
          toast.error("Defina um prazo válido (1 a 365 dias) para o lembrete.");
          setSavingReject(false);
          return;
        }
        const text = reminderText.trim();
        if (!text) {
          toast.error("Escreva a mensagem do lembrete.");
          setSavingReject(false);
          return;
        }

        const phone = (c.phone_whatsapp || "").replace(/\D/g, "");
        if (!phone) {
          toast.error("Cliente sem telefone válido para agendar lembrete.");
          setSavingReject(false);
          return;
        }

        // Instância WhatsApp do consultor dono (necessária p/ scheduled_messages).
        const ownerId = c.assigned_consultant_id || c.consultant_id;
        const { data: inst } = await supabase
          .from("whatsapp_instances")
          .select("instance_name")
          .eq("consultant_id", ownerId)
          .maybeSingle();

        if (!inst?.instance_name) {
          toast.warning("Reprovado, mas não há instância WhatsApp do consultor para agendar o lembrete.");
        } else {
          const when = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
          const { error: schedErr } = await supabase.from("scheduled_messages").insert({
            consultant_id: ownerId,
            instance_name: inst.instance_name,
            remote_jid: `${phone}@s.whatsapp.net`,
            message_text: text,
            scheduled_at: when.toISOString(),
            source_step_id: null,
          } as any);
          if (schedErr) {
            toast.error("Reprovado, mas falhou ao agendar lembrete: " + schedErr.message);
          } else {
            toast.success(`Lembrete agendado para daqui a ${days} dias.`);
          }
        }
      }

      setRejectDialog(null);
      setRejectReason("");
      setReminderEnabled(false);
      setReminderDays("30");
      setReminderCustomDays("");
      setReminderText("");
    } finally {
      setSavingReject(false);
    }
  }

  async function assignConsultant() {
    if (!assignDialog) return;
    const target = assignTo || null;
    const { error } = await supabase
      .from("customers")
      .update({ assigned_consultant_id: target } as any)
      .eq("id", assignDialog.id);
    if (error) { toast.error("Erro: " + error.message); return; }
    toast.success(target ? "Consultor atribuído" : "Atribuição removida");
    setAssignDialog(null); setAssignTo("");
    load();
  }

  async function runRecompute() {
    setRecomputing(true);
    const { data, error } = await supabase.functions.invoke("pos-venda-bucket-cron");
    setRecomputing(false);
    if (error) toast.error("Erro: " + error.message);
    else { toast.success(`Recalculado: ${(data as any)?.updated ?? 0} clientes`); load(); }
  }

  return (
    <div className="space-y-4">
      <PendingApprovalDialog consultantId={consultantId} onResolved={load} openSignal={validateSignal} />
      <CustomerQuickViewDialog customerId={viewCustomerId} onClose={() => setViewCustomerId(null)} />
      <ApproveBillValueDialog
        customer={billPrompt}
        open={!!billPrompt}
        onOpenChange={(o) => { if (!o) setBillPrompt(null); }}
        onSaved={async (customerId, billValue) => {
          const c = customers.find((x) => x.id === customerId) ?? billPrompt;
          if (!c) return;
          const updated = { ...c, electricity_bill_value: billValue };
          setCustomers((prev) => prev.map((x) => (x.id === customerId ? updated : x)));
          setBillPrompt(null);
          await applyMoveTo(updated, "aprovado");
        }}
      />

      <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Input
            placeholder="Buscar por nome ou telefone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="rounded-xl"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select value={ownerFilter} onValueChange={setOwnerFilter}>
            <SelectTrigger className="w-full sm:w-[260px] rounded-xl gap-2">
              <Users className="w-4 h-4 text-muted-foreground shrink-0" />
              <SelectValue placeholder="Filtrar por quem cadastrou" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mine">Cadastrados por mim {myIgreenId ? `(iGreen ${myIgreenId})` : ""}</SelectItem>
              <SelectItem value="assigned">Atribuídos a mim</SelectItem>
              <SelectItem value="all">Toda a minha rede</SelectItem>
              {registrants.filter(r => r.id !== myIgreenId).map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  Cadastrado por: {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button size="sm" onClick={() => setValidateSignal((n) => n + 1)} className="gap-2 rounded-xl bg-primary hover:bg-primary/90 text-white shadow-sm transition-all hover:scale-[1.02] active:scale-[0.98]">
            <CheckCircle2 className="w-4 h-4" />
            Validar novos clientes
          </Button>
          <PosVendaAutoConfigDialog consultantId={consultantId} />
          <Button variant="outline" size="sm" onClick={runRecompute} disabled={recomputing} className="gap-2 rounded-xl border-border/60">
            <RefreshCw className={`w-4 h-4 ${recomputing ? "animate-spin" : ""}`} />
            Recalcular tudo
          </Button>

        </div>
      </div>


      {loading ? (
        <div className="text-center py-12 text-sm text-muted-foreground">Carregando…</div>
      ) : (
        <div className="grid min-w-0 max-w-full grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3 overflow-hidden">
          {STAGES.map((stage) => (
            <div
              key={stage.key}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (!dragId) return;
                const c = customers.find((x) => x.id === dragId);
                if (!c) return;
                if (stage.key === "reprovado") { openRejectDialog(c); }
                else moveTo(c, stage.key);
                setDragId(null);
              }}
              className="bg-card/40 rounded-xl border border-border/50 flex flex-col min-h-[300px] min-w-0 overflow-hidden shadow-sm"
            >
              <div className={`h-1 w-full ${stage.bar}`} />
              <div className="px-3 py-2.5 border-b border-border/40 flex min-w-0 items-center justify-between gap-2 overflow-hidden">
                <Badge variant="secondary" className={`text-[10px] font-semibold ${stage.badge} border min-w-0 max-w-full truncate`}>
                  {stage.label}
                </Badge>
                <span className="text-[12px] font-bold text-foreground bg-muted/60 px-2 py-0.5 rounded-full min-w-[24px] text-center">
                  {grouped[stage.key].length}
                </span>
              </div>
              <ScrollArea className="kanban-safe-scroll flex-1 min-w-0 max-w-full overflow-hidden">
                <div className="p-2 space-y-1.5 min-w-0 max-w-full overflow-hidden">
                  {grouped[stage.key].map((c) => {
                    const days = daysSince(c.portal_submitted_at);
                    const isOwner = c.consultant_id === consultantId;
                    return (
                      <div
                        key={c.id}
                        draggable={isOwner || c.assigned_consultant_id === consultantId}
                        onDragStart={() => setDragId(c.id)}
                        className="relative bg-background border border-border/50 rounded-lg p-2.5 pl-3 space-y-1.5 cursor-grab active:cursor-grabbing hover:border-primary/40 hover:shadow-md transition-all min-w-0 max-w-full overflow-hidden"
                      >
                        <span className={`absolute left-0 top-2 bottom-2 w-[3px] rounded-r ${stage.dot}`} />
                        <div className="flex items-start justify-between gap-1">
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold truncate text-foreground">{c.name || "Sem nome"}</p>
                            <p className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5 truncate">
                              <Phone className="w-2.5 h-2.5 shrink-0" />
                              <span className="truncate">{c.phone_whatsapp}</span>
                            </p>
                          </div>
                          <div className="flex items-center gap-0.5 shrink-0">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-muted-foreground hover:text-primary"
                              title="Ver detalhes do cliente"
                              onClick={(e) => { e.stopPropagation(); setViewCustomerId(c.id); }}
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </Button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-6 w-6">
                                  <MoreHorizontal className="w-3 h-3" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => moveTo(c, "aprovado")}>
                                  <CheckCircle2 className="w-3.5 h-3.5 mr-2" /> Marcar Aprovado
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => { openRejectDialog(c); }}>
                                  <XCircle className="w-3.5 h-3.5 mr-2" /> Marcar Reprovado
                                </DropdownMenuItem>
                                {c.pos_venda_manual && (
                                  <DropdownMenuItem onClick={() => resetAuto(c)}>
                                    <RotateCcw className="w-3.5 h-3.5 mr-2" /> Voltar ao automático
                                  </DropdownMenuItem>
                                )}
                                {isOwner && (
                                  <DropdownMenuItem onClick={() => { setAssignDialog(c); setAssignTo(c.assigned_consultant_id || ""); }}>
                                    <UserPlus className="w-3.5 h-3.5 mr-2" /> Atribuir consultor
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>
                        {c.electricity_bill_value != null && (
                          <p className="text-[10px] text-muted-foreground">
                            Conta: R$ {Number(c.electricity_bill_value).toFixed(2)}
                          </p>
                        )}
                        {c.portal_submitted_at && (
                          <p className="text-[10px] text-muted-foreground flex items-center gap-1 min-w-0 max-w-full overflow-hidden">
                            <Calendar className="w-2.5 h-2.5" />
                            {days != null ? `há ${days}d` : "-"} · {format(new Date(c.portal_submitted_at), "dd/MM/yy", { locale: ptBR })}
                          </p>
                        )}
                        {c.andamento_igreen && (
                          <Badge variant="outline" className="text-[9px] py-0 h-4 truncate max-w-full">
                            {c.andamento_igreen}
                          </Badge>
                        )}
                        <div className="flex items-center gap-1 flex-wrap">
                          {c.pos_venda_manual && (
                            <Badge variant="secondary" className="text-[9px] py-0 h-4 bg-warning/10 text-warning">manual</Badge>
                          )}
                          {c.assigned_consultant_id && c.assigned_consultant_id !== c.consultant_id && (
                            <Badge variant="secondary" className="text-[9px] py-0 h-4 bg-info/10 text-info">atribuído</Badge>
                          )}
                          {!isOwner && c.assigned_consultant_id === consultantId && (
                            <Badge variant="secondary" className="text-[9px] py-0 h-4 bg-primary/10 text-primary">recebido</Badge>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {grouped[stage.key].length === 0 && (
                    <p className="text-center text-[11px] text-muted-foreground/50 py-6">Vazio</p>
                  )}
                </div>
              </ScrollArea>
            </div>
          ))}
        </div>
      )}

      {/* Atribuir consultor */}
      <Dialog open={!!assignDialog} onOpenChange={(o) => !o && setAssignDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Atribuir a outro consultor</DialogTitle>
            <DialogDescription>
              Você continua sendo o dono original. O consultor escolhido também verá este cliente no Kanban Pós-Venda dele.
            </DialogDescription>
          </DialogHeader>
          <Select value={assignTo} onValueChange={setAssignTo}>
            <SelectTrigger><SelectValue placeholder="Escolha um consultor" /></SelectTrigger>
            <SelectContent>
              {consultants.filter(c => c.id !== consultantId).map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.full_name || c.slug || c.id.slice(0,8)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setAssignTo(""); assignConsultant(); }}>
              Remover atribuição
            </Button>
            <Button onClick={assignConsultant} disabled={!assignTo}>Atribuir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reprovar */}
      <Dialog open={!!rejectDialog} onOpenChange={(o) => !o && setRejectDialog(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Marcar como Reprovado</DialogTitle>
            <DialogDescription>Motivo (opcional) ficará registrado no histórico do cliente.</DialogDescription>
          </DialogHeader>
          <Input
            placeholder="Motivo da reprovação"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
          />

          {/* Agendamento de lembrete automático */}
          <div className="rounded-lg border border-border/60 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">Agendar lembrete automático</div>
                <div className="text-xs text-muted-foreground">Envia uma mensagem ao cliente após o prazo escolhido.</div>
              </div>
              <Switch checked={reminderEnabled} onCheckedChange={setReminderEnabled} />
            </div>

            {reminderEnabled && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Enviar em</label>
                  <Select value={reminderDays} onValueChange={setReminderDays}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="30">30 dias</SelectItem>
                      <SelectItem value="60">60 dias</SelectItem>
                      <SelectItem value="90">90 dias</SelectItem>
                      <SelectItem value="custom">Outro prazo…</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {reminderDays === "custom" && (
                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground">Quantos dias (1 a 365)</label>
                    <Input
                      type="number"
                      min={1}
                      max={365}
                      placeholder="Ex: 45"
                      value={reminderCustomDays}
                      onChange={(e) => setReminderCustomDays(e.target.value)}
                      className="h-9"
                    />
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Mensagem do lembrete</label>
                  <textarea
                    placeholder="Olá! Passando para retomar seu cadastro na iGreen…"
                    value={reminderText}
                    onChange={(e) => setReminderText(e.target.value)}
                    rows={3}
                    className="w-full text-sm rounded-md border border-border/60 bg-secondary/30 p-2 resize-none"
                  />
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialog(null)} disabled={savingReject}>Cancelar</Button>
            <Button
              variant="destructive"
              disabled={savingReject}
              onClick={() => { if (rejectDialog) void confirmReject(rejectDialog); }}
            >
              {savingReject ? "Salvando…" : "Confirmar reprovação"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
