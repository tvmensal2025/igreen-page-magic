import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import {
  Ban, CheckCircle2, ChevronRight, ExternalLink, Loader2, Maximize2, MessageSquare, Minimize2, Pause, Play, RefreshCw,
  Receipt, ShieldAlert, Snowflake, Trophy, UserX, Users, X, Zap, ZapOff,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { suppressContact } from "@/services/contactSuppression";
import {
  CADENCE_GROUP_BADGE,
  cadenceStageGroup,
  labelCadenceStage,
  labelPausedReason,
} from "@/lib/cadenceStageLabels";
import {
  CadenceContactHistoryDialog,
  type CadenceContactPreview,
} from "@/components/whatsapp/CadenceContactHistoryDialog";
import { billAttentionFromCustomer, type BillAttention } from "@/lib/customerBillAttention";
import { isCycleLeadEligible } from "@/lib/cycleEligibility";

const ONDA_CURTA = [
  "cadence_cold_1", "cadence_sms_1", "cadence_call_1", "cadence_cold_2",
  "cadence_sms_tema_2", "cadence_sms_2", "cadence_call_2", "cadence_cold_3",
  "cadence_sms_tema_7", "cadence_cold_4", "cadence_call_3",
] as const;

const GROUP_A_STAGES = new Set(["NEW", "GREETED", "AI_QUALIFYING"]);

type ClassifyAction = "pause" | "won" | "lost" | "not_lead";
type ListFilter = "leads" | "outros" | "todos";
const FAR_FUTURE_MS = 3650 * 24 * 3600_000;

type LeadRow = {
  id: string;
  customerId: string | null;
  consultantId: string | null;
  stage: string;
  name: string | null;
  phone: string;
  ddd: string;
  paused: boolean;
  pausedReason: string | null;
  blocked: boolean;
  billAttention: BillAttention;
  nextActionAt: string | null;
};

function previousStageFromPause(reason: string | null): string | null {
  const match = /^lead_responded:(.+)$/.exec(String(reason || ""));
  return match?.[1] ?? null;
}

function operationalGroup(row: Pick<LeadRow, "stage" | "pausedReason">): "A" | "B" | "C" | "fim" | null {
  if (row.stage === "PAUSED") {
    const previous = previousStageFromPause(row.pausedReason);
    if (previous) return operationalGroup({ stage: previous, pausedReason: null });
    return "A";
  }
  if (GROUP_A_STAGES.has(row.stage)) return "A";
  return cadenceStageGroup(row.stage);
}

function reasonLabel(reason: string | null): string | null {
  return labelPausedReason(reason)?.label ?? null;
}

function digitsOnly(phone: string) {
  return (phone || "").replace(/\D/g, "");
}

function extractDdd(digits: string) {
  if (digits.startsWith("55") && digits.length >= 4) return digits.slice(2, 4);
  if (digits.length >= 2) return digits.slice(0, 2);
  return "??";
}

function ContactRow({
  row,
  isLead,
  busy,
  onClassify,
  onOpen,
  onOpenChat,
}: {
  row: LeadRow;
  isLead: boolean;
  busy: boolean;
  onClassify: (id: string, action: ClassifyAction) => void;
  onOpen: (row: LeadRow) => void;
  onOpenChat: (phone: string) => void;
}) {
  const tag = reasonLabel(row.pausedReason);
  const pausedMeta = labelPausedReason(row.pausedReason);
  const stageShort = labelCadenceStage(row.stage, "short");
  const stageLong = labelCadenceStage(row.stage, "long");
  const group = operationalGroup(row);
  const groupLabel = group && group !== "fim" ? CADENCE_GROUP_BADGE[group] : null;
  const bill = row.billAttention.active;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(row)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(row); } }}
      className={cn(
        "group flex items-center gap-2 rounded-xl border px-3 py-2.5 transition-colors cursor-pointer",
        bill
          ? "border-amber-500/50 bg-amber-500/10 ring-1 ring-amber-500/30 hover:border-amber-500/70 hover:bg-amber-500/15"
          : isLead
            ? "border-primary/20 bg-primary/[0.06] hover:border-primary/35 hover:bg-primary/[0.09]"
            : "border-border/40 bg-card/60 hover:bg-muted/30",
        row.paused && !bill && "opacity-70",
      )}
    >
      <div
        className={cn(
          "w-9 h-9 rounded-lg flex items-center justify-center shrink-0 text-[11px] font-bold tabular-nums",
          isLead ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
        )}
      >
        {row.ddd}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-foreground truncate leading-tight">
          {row.name || "Sem nome"}
        </p>
        <p className="text-[11px] text-muted-foreground truncate">{row.phone || "—"}</p>
        <div className="flex flex-wrap gap-1 mt-1">
          {bill && (
            <Badge
              variant="outline"
              className={cn(
                "text-[9px] h-4 px-1.5 border-amber-500/50 text-amber-900 dark:text-amber-100 bg-amber-500/20",
                row.billAttention.priority === "high" && "animate-pulse",
              )}
              title={row.billAttention.detail || row.billAttention.label}
            >
              <Receipt className="w-2.5 h-2.5 mr-0.5 inline" />
              {row.billAttention.label}
            </Badge>
          )}
          <Badge
            variant="outline"
            className="text-[9px] h-4 px-1.5 max-w-[140px] truncate"
            title={[stageLong, groupLabel, row.stage !== stageShort ? `(${row.stage})` : ""].filter(Boolean).join(" · ")}
          >
            {stageShort}
          </Badge>
          {groupLabel && group !== "fim" && (
            <Badge variant="secondary" className="text-[9px] h-4 px-1.5">{groupLabel}</Badge>
          )}
          {row.paused && tag ? (
            <Badge
              variant="secondary"
              className="text-[9px] h-4 px-1.5"
              title={pausedMeta?.hint}
            >
              {tag}
            </Badge>
          ) : !row.paused && isLead ? (
            <Badge variant="default" className="text-[9px] h-4 px-1.5">Na fila</Badge>
          ) : !row.paused ? (
            <Badge variant="secondary" className="text-[9px] h-4 px-1.5">Fora do DDD</Badge>
          ) : null}
          {row.blocked && (
            <Badge variant="destructive" className="text-[9px] h-4 px-1.5" title="Lista de bloqueio — sem automações">
              Bloqueado
            </Badge>
          )}
        </div>
      </div>
      {row.phone && (
        <Button
          variant="outline"
          size="icon"
          className={cn(
            "h-8 w-8 shrink-0 rounded-lg",
            bill && "border-amber-500/40 text-amber-700 hover:bg-amber-500/15",
          )}
          disabled={busy}
          title="Abrir no chat interno"
          onClick={(e) => {
            e.stopPropagation();
            onOpenChat(row.phone);
          }}
        >
          <MessageSquare className="h-4 w-4" />
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 shrink-0 rounded-lg border-dashed opacity-80 group-hover:opacity-100 hover:border-destructive/50 hover:text-destructive"
            disabled={busy}
            title="Classificar"
            onClick={(e) => e.stopPropagation()}
          >
            <X className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel className="text-xs font-normal truncate">
            {row.name || row.phone}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {row.phone && (
            <DropdownMenuItem
              className="text-xs gap-2"
              onClick={(e) => {
                e.stopPropagation();
                onOpenChat(row.phone);
              }}
            >
              <MessageSquare className="h-3.5 w-3.5" /> Abrir no chat interno
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-xs gap-2" onClick={() => onClassify(row.id, "not_lead")}>
            <UserX className="h-3.5 w-3.5" /> Não é lead (bloqueia)
          </DropdownMenuItem>
          <DropdownMenuItem className="text-xs gap-2" onClick={() => onClassify(row.id, "pause")}>
            <Pause className="h-3.5 w-3.5" /> Pausar
          </DropdownMenuItem>
          <DropdownMenuItem className="text-xs gap-2" onClick={() => onClassify(row.id, "won")}>
            <Trophy className="h-3.5 w-3.5" /> Ganhou
          </DropdownMenuItem>
          <DropdownMenuItem className="text-xs gap-2" onClick={() => onClassify(row.id, "lost")}>
            <Ban className="h-3.5 w-3.5" /> Perdido (bloqueia)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function AgendamentosZeroLeadPanel({
  consultantId,
  onOpenChat,
}: {
  consultantId: string;
  onOpenChat?: (phone: string) => void;
}) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [leadDdd, setLeadDdd] = useState("34");
  const [rows, setRows] = useState<LeadRow[]>([]);
  const [engineOn, setEngineOn] = useState(false);
  const [ondaOn, setOndaOn] = useState(false);
  const [confirmPause, setConfirmPause] = useState(false);
  const [confirmRelease, setConfirmRelease] = useState(false);
  const [confirmLigar, setConfirmLigar] = useState(false);
  const [listFilter, setListFilter] = useState<ListFilter>("leads");
  const [showPaused, setShowPaused] = useState(true);
  const [historyContact, setHistoryContact] = useState<CadenceContactPreview | null>(null);
  const [listExpanded, setListExpanded] = useState(false);
  const [platformQueueCount, setPlatformQueueCount] = useState<number | null>(null);

  useEffect(() => {
    if (!listExpanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setListExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [listExpanded]);

  const openChatInternal = useCallback((phone: string) => {
    const clean = (phone || "").replace(/\D/g, "");
    if (!clean) return;
    if (onOpenChat) {
      onOpenChat(clean);
      return;
    }
    navigate(`/admin?tab=whatsapp&phone=${encodeURIComponent(clean)}`);
  }, [navigate, onOpenChat]);

  const load = useCallback(async () => {
    setLoading(true);
    const nowIso = new Date().toISOString();
    const [{ data: settings }, { data: toggles }, { data: states }, { count: queueCount }] = await Promise.all([
      supabase.from("app_settings").select("cadence_engine_enabled").eq("id", "global").maybeSingle(),
      supabase.from("automation_toggles").select("key, enabled").in("key", ["cadence_engine", ...ONDA_CURTA]),
      supabase
        .from("lead_cadence_state")
        .select("id, stage, next_action_at, paused_until, paused_reason, customer_id, consultant_id")
        .eq("consultant_id", consultantId)
        .not("stage", "eq", "WON")
        .not("next_action_at", "is", null)
        .order("next_action_at", { ascending: true })
        .limit(500),
      supabase
        .from("lead_cadence_state")
        .select("id", { count: "exact", head: true })
        .eq("consultant_id", consultantId)
        .not("stage", "eq", "WON")
        .or(`paused_until.is.null,paused_until.lte.${nowIso}`),
    ]);
    setPlatformQueueCount(queueCount ?? null);
    setEngineOn(!!settings?.cadence_engine_enabled);
    const tm = new Map((toggles || []).map((t) => [t.key, !!t.enabled]));
    setOndaOn(ONDA_CURTA.every((k) => tm.get(k)) && !!tm.get("cadence_engine") && !!settings?.cadence_engine_enabled);
    const list = states || [];
    const custIds = [...new Set(list.map((r) => r.customer_id).filter(Boolean))];
    const { data: custs } = custIds.length
      ? await supabase.from("customers").select(
          "id, name, phone_whatsapp, consultant_id, customer_origin, status, do_not_contact, portal_submitted_at, electricity_bill_photo_url, electricity_bill_value, bill_data_confirmed_at, last_inbound_media_kind, last_inbound_media_at, conversation_step",
        ).in("id", custIds)
      : { data: [] as {
          id: string;
          name: string | null;
          phone_whatsapp: string | null;
          consultant_id: string | null;
          customer_origin?: string | null;
          status?: string | null;
          do_not_contact: boolean;
          portal_submitted_at?: string | null;
          electricity_bill_photo_url?: string | null;
          electricity_bill_value?: number | null;
          bill_data_confirmed_at?: string | null;
          last_inbound_media_kind?: string | null;
          last_inbound_media_at?: string | null;
          conversation_step?: string | null;
        }[] };
    const cmap = new Map((custs || []).map((c) => [c.id, c]));
    const now = Date.now();
    setRows(
      list.flatMap((r) => {
        const c = cmap.get(r.customer_id);
        if (!c) return [];
        if (!isCycleLeadEligible({
          customer_origin: c.customer_origin,
          status: c.status,
          conversation_step: c.conversation_step,
          portal_submitted_at: c.portal_submitted_at,
          do_not_contact: c.do_not_contact,
          paused_reason: r.paused_reason,
          active_cadence: !!r.next_action_at,
        })) return [];
        const phone = c?.phone_whatsapp || "";
        const billAttention = billAttentionFromCustomer(c);
        return [{
          id: r.id,
          customerId: r.customer_id ?? null,
          consultantId: r.consultant_id ?? c?.consultant_id ?? null,
          stage: r.stage,
          name: c?.name ?? null,
          phone,
          ddd: extractDdd(digitsOnly(phone)),
          paused: !!(r.paused_until && new Date(r.paused_until).getTime() > now),
          pausedReason: r.paused_reason ?? null,
          blocked: !!c?.do_not_contact,
          billAttention,
          nextActionAt: r.next_action_at ?? null,
        }];
      }),
    );
    setLoading(false);
  }, [consultantId]);

  useEffect(() => { void load(); }, [load]);

  const byDdd = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.ddd, (m.get(r.ddd) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  useEffect(() => {
    if (!byDdd.length) return;
    if (byDdd.some(([ddd]) => ddd === leadDdd)) return;
    setLeadDdd(byDdd[0][0]);
  }, [byDdd, leadDdd]);

  const leads = useMemo(() => rows.filter((r) => r.ddd === leadDdd), [rows, leadDdd]);
  const naoLeads = useMemo(() => rows.filter((r) => r.ddd !== leadDdd), [rows, leadDdd]);
  const naoLeadsAtivos = useMemo(() => naoLeads.filter((r) => !r.paused), [naoLeads]);
  const leadsLivres = useMemo(() => leads.filter((r) => !r.paused), [leads]);
  const leadsPausados = useMemo(() => leads.filter((r) => r.paused), [leads]);
  const groupA = useMemo(() => rows.filter((r) => operationalGroup(r) === "A"), [rows]);
  const groupB = useMemo(() => rows.filter((r) => operationalGroup(r) === "B"), [rows]);
  const groupBWhatsapp = useMemo(() => groupB.filter((r) => r.stage.startsWith("COLD_")), [groupB]);
  const groupBSms = useMemo(() => groupB.filter((r) => r.stage.startsWith("SMS_")), [groupB]);
  const groupBCall = useMemo(() => groupB.filter((r) => r.stage.startsWith("CALL_")), [groupB]);

  const visibleRows = useMemo(() => {
    let list = rows;
    if (listFilter === "leads") list = leads;
    if (listFilter === "outros") list = naoLeads;
    if (!showPaused) list = list.filter((r) => !r.paused);
    return list.sort((a, b) => {
      const aBill = a.billAttention.active ? 0 : 1;
      const bBill = b.billAttention.active ? 0 : 1;
      if (aBill !== bBill) return aBill - bBill;
      const aLead = a.ddd === leadDdd ? 0 : 1;
      const bLead = b.ddd === leadDdd ? 0 : 1;
      if (aLead !== bLead) return aLead - bLead;
      return (a.name || a.phone).localeCompare(b.name || b.phone, "pt-BR");
    });
  }, [rows, leads, naoLeads, listFilter, showPaused, leadDdd]);

  const step1Ok = naoLeadsAtivos.length === 0 && leadsLivres.length > 0;
  const step2Ok = engineOn && ondaOn;
  const tudoOk = step1Ok && step2Ok;

  async function addToBlockList(row: LeadRow, notes: string): Promise<boolean> {
    const consultId = row.consultantId || consultantId;
    if (!consultId || (!row.customerId && !row.phone)) return false;
    const r = await suppressContact({
      consultantId: consultId,
      customerId: row.customerId,
      phone: row.phone,
      reason: "opt_out",
      channel: "grupo_b_central",
      notes,
    });
    if (!r.ok) {
      toast.error("Cadência atualizada, mas bloqueio falhou", { description: r.error });
      return false;
    }
    return true;
  }

  async function pauseNaoLeads() {
    if (!naoLeads.length) { toast.message("Não há contatos fora deste DDD"); setConfirmPause(false); return; }
    setBusy(true);
    const until = new Date(Date.now() + FAR_FUTURE_MS).toISOString();
    const ids = naoLeads.map((r) => r.id);
    for (let i = 0; i < ids.length; i += 80) {
      const { error } = await supabase.from("lead_cadence_state").update({
        paused_until: until, paused_reason: `not_lead_outside_ddd${leadDdd}`, next_action_at: until,
      }).in("id", ids.slice(i, i + 80));
      if (error) { toast.error(error.message); setBusy(false); setConfirmPause(false); return; }
    }
    let blocked = 0;
    for (const r of naoLeads) {
      if (await addToBlockList(r, `Quem esfriou: não é lead fora do DDD ${leadDdd}`)) blocked++;
    }
    toast.success(`${naoLeads.length} pausados · ${blocked} na lista de bloqueio`);
    setBusy(false); setConfirmPause(false); await load();
  }

  async function liberarLeads() {
    if (!leads.length) { toast.message(`Nenhum DDD ${leadDdd}`); setConfirmRelease(false); return; }
    setBusy(true);
    const now = new Date().toISOString();
    const ids = leads.map((r) => r.id);
    for (let i = 0; i < ids.length; i += 80) {
      const { error } = await supabase.from("lead_cadence_state").update({
        paused_until: null, paused_reason: null, next_action_at: now,
      }).in("id", ids.slice(i, i + 80));
      if (error) { toast.error(error.message); setBusy(false); setConfirmRelease(false); return; }
    }
    toast.success(`${leads.length} leads liberados`);
    setBusy(false); setConfirmRelease(false); await load();
  }

  async function ligarTudo() {
    setBusy(true);
    const now = new Date().toISOString();
    const { data: sRow, error: e1 } = await supabase.from("app_settings")
      .update({ cadence_engine_enabled: true }).eq("id", "global").select("id").maybeSingle();
    if (e1 || !sRow) { toast.error(e1?.message || "Sem permissão"); setBusy(false); setConfirmLigar(false); return; }
    for (const key of ["cadence_engine", ...ONDA_CURTA] as const) {
      const { data, error } = await supabase.from("automation_toggles")
        .update({ enabled: true, updated_at: now }).eq("key", key).select("key").maybeSingle();
      if (error || !data) { toast.error(error?.message || key); setBusy(false); setConfirmLigar(false); return; }
    }
    toast.success("Envio LIGADO (plataforma inteira)");
    setBusy(false); setConfirmLigar(false); await load();
  }

  async function desligar() {
    setBusy(true);
    const now = new Date().toISOString();
    await supabase.from("app_settings").update({ cadence_engine_enabled: false }).eq("id", "global");
    await supabase.from("automation_toggles").update({ enabled: false, updated_at: now }).eq("key", "cadence_engine");
    toast.success("Envio DESLIGADO");
    setBusy(false); await load();
  }

  function tryLigar() {
    if (naoLeadsAtivos.length > 0) {
      toast.error(
        `Antes de ligar: pause os ${naoLeadsAtivos.length} contato(s) fora do DDD ${leadDdd} (passo 1).`,
      );
      return;
    }
    setConfirmLigar(true);
  }

  async function classifyOne(id: string, action: ClassifyAction) {
    const row = rows.find((r) => r.id === id);
    setBusy(true);
    const until = new Date(Date.now() + FAR_FUTURE_MS).toISOString();
    const payload: Record<string, unknown> =
      action === "pause" ? { paused_until: until, paused_reason: "manual_admin_pause", next_action_at: until }
      : action === "won" ? { stage: "WON", paused_until: null, paused_reason: "manual_won", next_action_at: null }
      : action === "lost" ? { paused_until: until, paused_reason: "manual_already_closed", next_action_at: until }
      : { paused_until: until, paused_reason: `not_lead_outside_ddd${leadDdd}`, next_action_at: until };
    const { error } = await supabase.from("lead_cadence_state").update(payload as never).eq("id", id);
    if (error) {
      setBusy(false);
      toast.error(error.message);
      return;
    }
    if (row && (action === "not_lead" || action === "lost")) {
      await addToBlockList(
        row,
        action === "not_lead" ? "Quem esfriou: classificado como não é lead" : "Quem esfriou: classificado como perdido",
      );
    }
    setBusy(false);
    toast.success(
      action === "not_lead" || action === "lost"
        ? "Classificado e bloqueado — sem mensagens automáticas"
        : action === "won"
          ? "Marcado como ganhou — acompanhamento encerrado"
          : "Atualizado",
    );
    setHistoryContact(null);
    await load();
  }

  function openHistory(row: LeadRow) {
    setHistoryContact({
      cadenceStateId: row.id,
      customerId: row.customerId,
      name: row.name,
      phone: row.phone,
      ddd: row.ddd,
      stage: row.stage,
      paused: row.paused,
      pausedReason: row.pausedReason,
      isLead: row.ddd === leadDdd,
      billAttention: row.billAttention,
    });
  }

  async function rodarAgora() {
    setBusy(true);
    try {
      const { error } = await supabase.functions.invoke("cadence-tick-manual");
      if (error) throw error;
      toast.success("Fila processada");
      await load();
    } catch (e: unknown) {
      toast.error("Falha: " + (e instanceof Error ? e.message : String(e)));
    } finally { setBusy(false); }
  }

  const steps = [
    { n: 1, ok: step1Ok, label: "Separar leads" },
    { n: 2, ok: step2Ok, label: "Ligar envio" },
    { n: 3, ok: tudoOk, label: "Pronto" },
  ];

  return (
    <div className="flex flex-col gap-3 h-full min-h-0 overflow-hidden">
      {/* ── Barra de status (fixa no topo do painel) ── */}
      {!listExpanded && (
      <div
        className={cn(
          "shrink-0 rounded-2xl border px-4 py-3 flex flex-wrap items-center gap-3",
          tudoOk ? "border-primary/30 bg-gradient-to-r from-primary/10 to-transparent"
            : engineOn ? "border-warning/30 bg-warning/5"
            : "border-border/60 bg-card/50",
        )}
      >
        <div className={cn(
          "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
          tudoOk ? "bg-primary/20" : "bg-muted",
        )}>
          {tudoOk ? <Zap className="w-5 h-5 text-primary" /> : <ZapOff className="w-5 h-5 text-muted-foreground" />}
        </div>
        <div className="flex-1 min-w-[180px]">
          <p className="text-sm font-[Sora] font-bold leading-tight">
            {tudoOk ? "Pronto para enviar" : engineOn ? "Falta separar leads" : "Envio desligado"}
          </p>
          <p className="text-[11px] text-muted-foreground">
            DDD lead: <strong className="text-foreground">{leadDdd}</strong> · Aguardando B: <strong className="text-foreground">{groupA.length}</strong> · B: <strong className="text-foreground">{groupB.length}</strong>
          </p>
        </div>
        <div className="flex items-center gap-1">
          {steps.map((s, i) => (
            <div key={s.n} className="flex items-center gap-1">
              <div className={cn(
                "w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold border",
                s.ok ? "bg-primary text-primary-foreground border-primary" : "bg-muted/50 text-muted-foreground border-border",
              )}>
                {s.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : s.n}
              </div>
              <span className="text-[10px] text-muted-foreground hidden md:inline">{s.label}</span>
              {i < 2 && <ChevronRight className="w-3 h-3 text-muted-foreground/40 hidden md:block" />}
            </div>
          ))}
        </div>
        <Badge variant={tudoOk ? "default" : "secondary"} className="text-[10px]">
          {leads.length} lead(s) · {leadsLivres.length} liberado(s)
        </Badge>
        <Badge variant="outline" className="text-[10px]">
          WA {groupBWhatsapp.length} · SMS {groupBSms.length} · Call {groupBCall.length}
        </Badge>
        <Button variant="ghost" size="sm" className="h-8 text-xs gap-1" disabled={loading || busy} onClick={() => void load()}>
          <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
        </Button>
      </div>
      )}

      {/* ── Corpo: controles + lista com scroll ── */}
      <div className="flex flex-1 min-h-0 gap-3 flex-col lg:flex-row overflow-hidden">
        {/* Coluna esquerda — controles */}
        {!listExpanded && (
        <aside className="shrink-0 lg:w-[280px] flex flex-col gap-2 overflow-y-auto lg:overflow-visible lg:max-h-none max-h-[min(36vh,280px)]">
          <div className="rounded-2xl border border-border/60 bg-card/40 p-3 space-y-3">
            <div className="flex items-center gap-2">
              <Snowflake className="w-4 h-4 text-primary shrink-0" />
              <p className="text-xs font-bold">DDD dos leads</p>
            </div>
            <select
              className="w-full h-9 rounded-xl border bg-background px-3 text-sm font-semibold"
              value={leadDdd}
              onChange={(e) => setLeadDdd(e.target.value)}
            >
              {(byDdd.length ? byDdd : [["34", 0] as [string, number]]).map(([ddd, n]) => (
                <option key={ddd} value={ddd}>{ddd} — {n} contato(s)</option>
              ))}
            </select>
            <div className="flex flex-wrap gap-1">
              {byDdd.map(([ddd, n]) => (
                <button
                  key={ddd}
                  type="button"
                  onClick={() => setLeadDdd(ddd)}
                  className={cn(
                    "text-[10px] px-2 py-0.5 rounded-full border font-medium",
                    ddd === leadDdd ? "bg-primary/15 border-primary/40 text-primary" : "border-border/50 text-muted-foreground",
                  )}
                >
                  {ddd}·{n}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-1 text-center">
              <div className="rounded-lg bg-primary/10 px-1.5 py-1.5">
                <div className="text-base font-bold text-primary tabular-nums">{leads.length}</div>
                <div className="text-[8px] text-muted-foreground uppercase leading-tight">Total {leadDdd}</div>
              </div>
              <div className="rounded-lg bg-emerald-500/10 px-1.5 py-1.5">
                <div className="text-base font-bold text-emerald-600 tabular-nums">{leadsLivres.length}</div>
                <div className="text-[8px] text-muted-foreground uppercase leading-tight">Liberados</div>
              </div>
              <div className="rounded-lg bg-muted/50 px-1.5 py-1.5">
                <div className="text-base font-bold tabular-nums">{leadsPausados.length}</div>
                <div className="text-[8px] text-muted-foreground uppercase leading-tight">Pausados</div>
              </div>
            </div>
            {leads.length > 0 && leadsLivres.length === 0 && (
              <p className="text-[10px] text-warning bg-warning/10 border border-warning/20 rounded-lg px-2 py-1.5 leading-snug">
                Os {leads.length} leads DDD {leadDdd} estão <strong>pausados</strong> (zeramos o SLA antes).
                Clique <strong>Liberar DDD {leadDdd}</strong> para entrarem na fila.
              </p>
            )}
            <Button size="sm" variant="destructive" className="w-full rounded-xl text-xs h-8" disabled={busy || !naoLeads.length} onClick={() => setConfirmPause(true)}>
              <ShieldAlert className="w-3.5 h-3.5 mr-1" /> Pausar não-leads
            </Button>
            <Button size="sm" className="w-full rounded-xl text-xs h-8" disabled={busy || !leads.length} onClick={() => setConfirmRelease(true)}>
              <Users className="w-3.5 h-3.5 mr-1" /> Liberar DDD {leadDdd}
            </Button>
          </div>

          <div className="rounded-2xl border border-border/60 bg-card/40 p-3 space-y-2">
            <p className="text-xs font-bold">Envio automático</p>
            <p className="text-[10px] text-warning bg-warning/10 border border-warning/20 rounded-lg px-2 py-1.5 leading-snug">
              <strong>Global:</strong> ligar afeta a <strong>plataforma inteira</strong> (todos os consultores na fila de mensagens automáticas),
              não só os {leadsLivres.length} lead(s) DDD {leadDdd} desta tela.
              {platformQueueCount != null && (
                <> Hoje ~<strong>{platformQueueCount}</strong> contato(s) na fila ativa.</>
              )}
            </p>
            <div className="flex items-center justify-between rounded-lg border px-3 py-2">
              <span className="text-xs">{engineOn ? "Ligado" : "Desligado"}</span>
              <Switch checked={engineOn} disabled={busy} onCheckedChange={(v) => { if (v) tryLigar(); else void desligar(); }} />
            </div>
            <Button size="sm" className="w-full rounded-xl text-xs h-8 gap-1" disabled={busy || naoLeadsAtivos.length > 0} onClick={() => tryLigar()}>
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
              Ligar onda 10 dias
            </Button>
            <Button size="sm" variant="outline" className="w-full rounded-xl text-xs h-8 gap-1" disabled={busy || !engineOn} onClick={() => void rodarAgora()}>
              <Play className="w-3.5 h-3.5" /> Processar agora
            </Button>
            <div className="flex gap-1 pt-1">
              <Button asChild variant="ghost" size="sm" className="flex-1 text-[10px] h-7 px-1">
                <Link to="/admin?tab=voz&sub=textos&cadenceGroup=B">Textos</Link>
              </Button>
              <Button asChild variant="ghost" size="sm" className="flex-1 text-[10px] h-7 px-1">
                <Link to="/admin/motor">Técnico <ExternalLink className="w-2.5 h-2.5 ml-0.5" /></Link>
              </Button>
            </div>
          </div>
        </aside>
        )}

        {/* Coluna direita — lista rolável */}
        <section
          className={cn(
            "flex-1 min-h-[220px] min-w-0 flex flex-col rounded-2xl border overflow-hidden",
            listExpanded ? "border-primary/30 bg-card/50 shadow-sm" : "border-border/60 bg-card/30",
          )}
        >
          <div className="shrink-0 border-b border-border/40 bg-card/60 px-3 py-2.5 flex flex-wrap items-center gap-2">
            <p className="text-xs font-bold mr-1">
              Contatos
              <span className="text-muted-foreground font-normal">
                {" "}({visibleRows.length}
                {!showPaused && leadsPausados.length > 0 ? ` · ${leadsPausados.length} pausados ocultos` : ""})
              </span>
            </p>
            {(["todos", "leads", "outros"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setListFilter(f)}
                className={cn(
                  "text-[10px] px-2 py-1 rounded-lg border font-medium transition-colors",
                  listFilter === f ? "bg-primary text-primary-foreground border-primary" : "border-border/50 text-muted-foreground hover:text-foreground",
                )}
              >
                {f === "todos" ? "Todos" : f === "leads" ? `Lead ${leadDdd}` : "Não-lead"}
              </button>
            ))}
            <div className="flex items-center gap-1.5 ml-auto">
              <Button
                type="button"
                variant={listExpanded ? "default" : "outline"}
                size="sm"
                className="h-7 text-[10px] gap-1 px-2"
                onClick={() => setListExpanded((v) => !v)}
              >
                {listExpanded ? (
                  <><Minimize2 className="w-3 h-3" /> Recolher</>
                ) : (
                  <><Maximize2 className="w-3 h-3" /> Expandir</>
                )}
              </Button>
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <Switch checked={showPaused} onCheckedChange={setShowPaused} className="scale-75" />
                Pausados
                {leadsPausados.length > 0 && (
                  <Badge variant="secondary" className="text-[9px] h-4 px-1">{leadsPausados.length}</Badge>
                )}
              </div>
            </div>
          </div>

          <div className="flex-1 min-h-0 h-0 overflow-y-auto overscroll-contain">
            <div className="p-2 space-y-1.5">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
                <Loader2 className="w-6 h-6 animate-spin" />
                <span className="text-xs">Carregando…</span>
              </div>
            ) : visibleRows.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3 text-center px-4">
                <Users className="w-8 h-8 text-muted-foreground/30" />
                {leads.length > 0 && !showPaused && leadsPausados.length > 0 ? (
                  <>
                    <p className="text-xs text-foreground font-medium">
                      {leadsPausados.length} lead(s) DDD {leadDdd} estão pausados
                    </p>
                    <p className="text-[11px] text-muted-foreground max-w-xs">
                      Ative o filtro <strong>Pausados</strong> abaixo ou clique em Liberar DDD {leadDdd}.
                    </p>
                    <Button size="sm" variant="outline" className="text-xs rounded-xl" onClick={() => setShowPaused(true)}>
                      Mostrar pausados
                    </Button>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Nenhum contato neste filtro.
                  </p>
                )}
              </div>
            ) : (
              visibleRows.map((r) => (
                <ContactRow
                  key={r.id}
                  row={r}
                  isLead={r.ddd === leadDdd}
                  busy={busy}
                  onClassify={(id, a) => void classifyOne(id, a)}
                  onOpen={openHistory}
                  onOpenChat={openChatInternal}
                />
              ))
            )}
            </div>
          </div>

          <div className="shrink-0 border-t border-border/40 bg-muted/20 px-3 py-2 text-[10px] text-muted-foreground text-center">
            {listExpanded ? (
              <>Lista expandida · {visibleRows.length} contatos · <kbd className="px-1 rounded bg-muted text-[9px]">Esc</kbd> recolher · </>
            ) : visibleRows.length > 5 ? (
              <>↑↓ Role a lista · {visibleRows.length} contatos · </>
            ) : null}
            Toque no contato para ver o histórico · <strong className="text-foreground">✕</strong> para classificar rápido
          </div>
        </section>
      </div>

      {/* Diálogos */}
      <AlertDialog open={confirmPause} onOpenChange={(o) => !busy && setConfirmPause(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Pausar {naoLeads.length} não-leads?</AlertDialogTitle>
            <AlertDialogDescription>
              Pausam no motor e entram na <strong>lista de bloqueio</strong> (sem WhatsApp, SMS, ligação ou mensagens automáticas).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); void pauseNaoLeads(); }}>Pausar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={confirmRelease} onOpenChange={(o) => !busy && setConfirmRelease(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Liberar {leads.length} leads DDD {leadDdd}?</AlertDialogTitle>
            <AlertDialogDescription>Entram na fila. Envio só após ligar no passo 2.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); void liberarLeads(); }}>Liberar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={confirmLigar} onOpenChange={(o) => !busy && setConfirmLigar(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ligar envio automático na plataforma?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  <strong className="text-foreground">Atenção:</strong> isso é <strong className="text-foreground">global</strong> —
                  todos os consultores. O sistema processa a fila inteira (quem esfriou / quem sumiu),
                  não apenas os {leadsLivres.length} lead(s) DDD {leadDdd} liberados nesta tela.
                </p>
                {platformQueueCount != null && (
                  <p>
                    Hoje há aproximadamente <strong className="text-foreground">{platformQueueCount}</strong> contato(s)
                    na fila ativa (sem pausa) que podem receber WA, SMS ou ligação no próximo ciclo.
                  </p>
                )}
                <p>
                  Só confirme depois de pausar/bloquear não-leads (passo 1) e validar os textos da onda de 10 dias.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={busy} className="bg-destructive hover:bg-destructive/90" onClick={(e) => { e.preventDefault(); void ligarTudo(); }}>
              Ligar para toda a plataforma
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CadenceContactHistoryDialog
        contact={historyContact}
        busy={busy}
        onClose={() => setHistoryContact(null)}
        onClassify={(id, action) => void classifyOne(id, action)}
        onOpenChat={openChatInternal}
      />
    </div>
  );
}
