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
  CheckCircle2, XCircle, Calendar, RotateCcw, UserPlus, Phone, MoreHorizontal, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

type Stage = "em_analise" | "espera" | "aprovado" | "reprovado" | "d30" | "d60" | "d90" | "d120";

interface PosVendaCustomer {
  id: string;
  name: string | null;
  phone_whatsapp: string;
  electricity_bill_value: number | null;
  portal_submitted_at: string | null;
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

const STAGES: { key: Stage; label: string; color: string }[] = [
  { key: "em_analise", label: "Em análise", color: "bg-slate-500/10 text-slate-300 border-slate-500/20" },
  { key: "espera",    label: "Em Espera", color: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  { key: "aprovado",  label: "Aprovado",  color: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" },
  { key: "reprovado", label: "Reprovado", color: "bg-red-500/10 text-red-500 border-red-500/20" },
  { key: "d30",       label: "30 dias",   color: "bg-sky-500/10 text-sky-500 border-sky-500/20" },
  { key: "d60",       label: "60 dias",   color: "bg-violet-500/10 text-violet-500 border-violet-500/20" },
  { key: "d90",       label: "90 dias",   color: "bg-amber-500/10 text-amber-500 border-amber-500/20" },
  { key: "d120",      label: "120 dias",  color: "bg-rose-500/10 text-rose-500 border-rose-500/20" },
];

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
}

function computeStage(c: PosVendaCustomer): Stage {
  if (c.pos_venda_stage) return c.pos_venda_stage;
  if (/reprov|cancel/i.test(c.andamento_igreen || "") || ["rejected","cancelled","canceled"].includes(c.status)) return "reprovado";
  const d = daysSince(c.portal_submitted_at);
  if (d == null) return "em_analise";
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
  const [dragId, setDragId] = useState<string | null>(null);
  const [recomputing, setRecomputing] = useState(false);
  // "mine" = registered_by_igreen_id = meu | "assigned" | "all" | <igreen_id específico>
  const [ownerFilter, setOwnerFilter] = useState<string>("mine");

  async function load() {
    setLoading(true);
    let q = supabase
      .from("customers")
      .select("id,name,phone_whatsapp,electricity_bill_value,portal_submitted_at,andamento_igreen,status,consultant_id,assigned_consultant_id,pos_venda_stage,pos_venda_manual,pos_venda_reason,registered_by_igreen_id,registered_by_name")
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
    const out: Record<Stage, PosVendaCustomer[]> = { em_analise: [], espera: [], aprovado: [], reprovado: [], d30: [], d60: [], d90: [], d120: [] };
    for (const c of filtered) out[computeStage(c)].push(c);
    return out;
  }, [customers, search]);

  async function moveTo(c: PosVendaCustomer, target: Stage, opts: { reason?: string } = {}) {
    const isOwner = c.consultant_id === consultantId || c.assigned_consultant_id === consultantId;
    if (!isOwner) { toast.error("Você não pode mover este cliente"); return; }
    const patch: any = {
      pos_venda_stage: target,
      pos_venda_manual: true,
      pos_venda_reason: target === "reprovado" ? (opts.reason ?? c.pos_venda_reason ?? null) : null,
    };
    const { error } = await supabase.from("customers").update(patch).eq("id", c.id);
    if (error) { toast.error("Erro: " + error.message); return; }
    setCustomers((prev) => prev.map((x) => x.id === c.id ? { ...x, ...patch } : x));
    toast.success(`Movido para ${STAGES.find(s => s.key === target)?.label}`);
  }

  async function resetAuto(c: PosVendaCustomer) {
    const { error } = await supabase
      .from("customers")
      .update({ pos_venda_manual: false, pos_venda_stage: null, pos_venda_reason: null } as any)
      .eq("id", c.id);
    if (error) { toast.error("Erro: " + error.message); return; }
    toast.success("Voltou ao automático");
    load();
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
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <Input
          placeholder="Buscar por nome ou telefone..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm rounded-xl"
        />
        <Select value={ownerFilter} onValueChange={setOwnerFilter}>
          <SelectTrigger className="w-[280px] rounded-xl">
            <SelectValue placeholder="Filtrar por quem cadastrou" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="mine">Apenas cadastrados por mim {myIgreenId ? `(iGreen ${myIgreenId})` : ""}</SelectItem>
            <SelectItem value="assigned">Atribuídos a mim</SelectItem>
            <SelectItem value="all">Todos da minha rede</SelectItem>
            {registrants.filter(r => r.id !== myIgreenId).map((r) => (
              <SelectItem key={r.id} value={r.id}>
                Cadastrado por: {r.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={runRecompute} disabled={recomputing} className="gap-2 rounded-xl">
          <RefreshCw className={`w-4 h-4 ${recomputing ? "animate-spin" : ""}`} />
          Recalcular colunas (auto)
        </Button>
      </div>


      {loading ? (
        <div className="text-center py-12 text-sm text-muted-foreground">Carregando…</div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {STAGES.map((stage) => (
            <div
              key={stage.key}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (!dragId) return;
                const c = customers.find((x) => x.id === dragId);
                if (!c) return;
                if (stage.key === "reprovado") { setRejectDialog(c); setRejectReason(""); }
                else moveTo(c, stage.key);
                setDragId(null);
              }}
              className="bg-muted/30 rounded-xl border border-border/40 flex flex-col min-h-[300px]"
            >
              <div className="px-3 py-2.5 border-b border-border/30 flex items-center justify-between">
                <Badge variant="secondary" className={`text-[10px] font-medium ${stage.color} border`}>
                  {stage.label}
                </Badge>
                <span className="text-[11px] font-semibold text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-full">
                  {grouped[stage.key].length}
                </span>
              </div>
              <ScrollArea className="flex-1">
                <div className="p-2 space-y-1.5">
                  {grouped[stage.key].map((c) => {
                    const days = daysSince(c.portal_submitted_at);
                    const isOwner = c.consultant_id === consultantId;
                    return (
                      <div
                        key={c.id}
                        draggable={isOwner || c.assigned_consultant_id === consultantId}
                        onDragStart={() => setDragId(c.id)}
                        className="bg-background border border-border/40 rounded-lg p-2.5 space-y-1.5 cursor-grab active:cursor-grabbing hover:border-primary/30 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold truncate">{c.name || "Sem nome"}</p>
                            <p className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
                              <Phone className="w-2.5 h-2.5" />
                              {c.phone_whatsapp}
                            </p>
                          </div>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0">
                                <MoreHorizontal className="w-3 h-3" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => moveTo(c, "aprovado")}>
                                <CheckCircle2 className="w-3.5 h-3.5 mr-2" /> Marcar Aprovado
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => { setRejectDialog(c); setRejectReason(c.pos_venda_reason || ""); }}>
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
                        {c.electricity_bill_value != null && (
                          <p className="text-[10px] text-muted-foreground">
                            Conta: R$ {Number(c.electricity_bill_value).toFixed(2)}
                          </p>
                        )}
                        {c.portal_submitted_at && (
                          <p className="text-[10px] text-muted-foreground flex items-center gap-1">
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
                            <Badge variant="secondary" className="text-[9px] py-0 h-4 bg-amber-500/10 text-amber-600">manual</Badge>
                          )}
                          {c.assigned_consultant_id && c.assigned_consultant_id !== c.consultant_id && (
                            <Badge variant="secondary" className="text-[9px] py-0 h-4 bg-sky-500/10 text-sky-600">atribuído</Badge>
                          )}
                          {!isOwner && c.assigned_consultant_id === consultantId && (
                            <Badge variant="secondary" className="text-[9px] py-0 h-4 bg-violet-500/10 text-violet-600">recebido</Badge>
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Marcar como Reprovado</DialogTitle>
            <DialogDescription>Motivo (opcional) ficará registrado no histórico do cliente.</DialogDescription>
          </DialogHeader>
          <Input
            placeholder="Motivo da reprovação"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialog(null)}>Cancelar</Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (rejectDialog) await moveTo(rejectDialog, "reprovado", { reason: rejectReason || undefined });
                setRejectDialog(null); setRejectReason("");
              }}
            >
              Confirmar reprovação
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
