import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart3, CheckCheck, Loader2, MessageSquare, Phone, RefreshCw,
  Smartphone, Users, Eye, X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { toUserFacingError } from "@/lib/userFacingError";
import {
  isCrmCadastroEmAnalise,
  isNuncaMaisContatar,
} from "@/lib/crmVsLeadAnalysis";

export type CrmAnalyticsScope = "leads" | "clientes";

type CustomerLite = {
  id: string;
  name: string | null;
  phone_whatsapp: string | null;
  conversation_step: string | null;
  portal_submitted_at: string | null;
  do_not_contact: boolean | null;
  bot_paused_reason: string | null;
  customer_origin: string | null;
  pos_venda_stage: string | null;
  status: string | null;
};

type WaRow = {
  id: string;
  customer_id: string;
  message_direction: string;
  delivery_status: string | null;
  message_text: string | null;
  created_at: string;
};

type SmsRow = {
  id: string;
  phone: string;
  status: string;
  delivery_status: string | null;
  message: string;
  created_at: string;
};

type CallRow = {
  id: string;
  to_phone: string;
  status: string | null;
  velip_status: string | null;
  duration_sec: number | null;
  created_at: string;
};

type PersonHit = {
  key: string;
  name: string;
  phone: string;
  detail: string;
  at: string;
  customerId?: string;
};

type DrillKey =
  | "wa_enviados"
  | "wa_recebidos"
  | "wa_lidos"
  | "wa_entregues"
  | "sms"
  | "sms_entregues"
  | "sms_falhou"
  | "ligacoes"
  | "ligacoes_atendidas"
  | "ligacoes_nao"
  | "pessoas"
  | "bloqueados"
  | "em_analise";

const PERIODS = [
  { value: 7, label: "7 dias" },
  { value: 15, label: "15 dias" },
  { value: 30, label: "30 dias" },
  { value: 90, label: "90 dias" },
];

function fmtPhone(raw: string | null | undefined): string {
  const d = String(raw || "").replace(/\D/g, "");
  const local = d.startsWith("55") && d.length >= 12 ? d.slice(2) : d;
  if (local.length < 10) return raw || "—";
  return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
}

function phoneDigits(raw: string | null | undefined): string {
  return String(raw || "").replace(/\D/g, "");
}

function phoneVariants(raw: string | null | undefined): string[] {
  const d = phoneDigits(raw);
  if (!d) return [];
  const out = new Set<string>([d]);
  if (d.startsWith("55") && d.length >= 12) out.add(d.slice(2));
  else if (d.length >= 10 && d.length <= 11) out.add(`55${d}`);
  return [...out];
}

function waDeliveryLabel(st: string | null | undefined): string {
  const s = String(st || "").toLowerCase();
  if (s === "read" || s === "played") return "Leu / abriu";
  if (s === "delivered" || s === "delivery_ack") return "Entregue";
  if (s === "sent") return "Enviado";
  if (s === "queued") return "Na fila";
  if (s === "failed") return "Falhou";
  return st || "Sem status";
}

function isAnsweredCall(row: CallRow): boolean {
  const s = `${row.status || ""} ${row.velip_status || ""}`.toLowerCase();
  if (/(no.?answer|nao.?atend|busy|failed|cancel|undeliv|rejected)/.test(s)) return false;
  if ((row.duration_sec || 0) > 0) return true;
  return /(answer|atendid|completed|ok|success)/.test(s);
}

function scopeTitle(scope: CrmAnalyticsScope): string {
  return scope === "leads" ? "Clientes interessados" : "Clientes ativos";
}

type Props = {
  consultantId: string;
  scope: CrmAnalyticsScope;
  /** Se true, só renderiza o botão+dialog (padrão). */
  triggerClassName?: string;
};

/**
 * Análise real do CRM do consultor: WhatsApp (enviou/leu), SMS, ligações e pessoas.
 * Clique no card abre a lista de quem/o quê.
 */
export function CrmActivityAnalyticsButton({ consultantId, scope, triggerClassName }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={triggerClassName || "h-7 text-xs gap-1.5"}
        onClick={() => setOpen(true)}
        data-tour={`crm-analise-${scope}`}
      >
        <BarChart3 className="h-3.5 w-3.5" />
        Análise
      </Button>
      <CrmActivityAnalyticsDialog
        open={open}
        onOpenChange={setOpen}
        consultantId={consultantId}
        scope={scope}
      />
    </>
  );
}

export function CrmActivityAnalyticsDialog({
  open,
  onOpenChange,
  consultantId,
  scope,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  consultantId: string;
  scope: CrmAnalyticsScope;
}) {
  const { toast } = useToast();
  const [periodDays, setPeriodDays] = useState(30);
  const [loading, setLoading] = useState(false);
  const [customers, setCustomers] = useState<CustomerLite[]>([]);
  const [wa, setWa] = useState<WaRow[]>([]);
  const [sms, setSms] = useState<SmsRow[]>([]);
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [drill, setDrill] = useState<DrillKey | null>(null);

  const load = useCallback(async () => {
    if (!consultantId) return;
    setLoading(true);
    try {
      const since = new Date(Date.now() - periodDays * 86400000).toISOString();

      let allCust: CustomerLite[] = [];

      if (scope === "leads") {
        // Pessoas do quadro de interessados (crm_deals)
        const dealsRes = await supabase
          .from("crm_deals")
          .select("customer_id")
          .eq("consultant_id", consultantId)
          .not("customer_id", "is", null)
          .limit(2000);
        if (dealsRes.error) throw dealsRes.error;
        const dealCustomerIds = [
          ...new Set(
            ((dealsRes.data as { customer_id: string | null }[]) || [])
              .map((d) => d.customer_id)
              .filter((id): id is string => !!id),
          ),
        ];

        if (dealCustomerIds.length > 0) {
          const chunks: CustomerLite[] = [];
          for (let i = 0; i < dealCustomerIds.length; i += 100) {
            const slice = dealCustomerIds.slice(i, i + 100);
            const { data, error } = await supabase
              .from("customers")
              .select(
                "id, name, phone_whatsapp, conversation_step, portal_submitted_at, do_not_contact, bot_paused_reason, customer_origin, pos_venda_stage, status",
              )
              .in("id", slice);
            if (error) throw error;
            chunks.push(...((data as CustomerLite[]) || []));
          }
          allCust = chunks;
        }
      } else {
        const custRes = await supabase
          .from("customers")
          .select(
            "id, name, phone_whatsapp, conversation_step, portal_submitted_at, do_not_contact, bot_paused_reason, customer_origin, pos_venda_stage, status",
          )
          .eq("customer_origin", "igreen_sync")
          .or(`consultant_id.eq.${consultantId},assigned_consultant_id.eq.${consultantId}`)
          .order("portal_submitted_at", { ascending: false, nullsFirst: false })
          .limit(2500);
        if (custRes.error) throw custRes.error;
        allCust = (custRes.data as CustomerLite[]) || [];
      }

      setCustomers(allCust);

      const idSet = new Set(allCust.map((c) => c.id));
      const phoneToCust = new Map<string, CustomerLite>();
      for (const c of allCust) {
        for (const p of phoneVariants(c.phone_whatsapp)) phoneToCust.set(p, c);
      }

      // WhatsApp — por customer_id do escopo (lotes de 80)
      const ids = [...idSet];
      const waAcc: WaRow[] = [];
      for (let i = 0; i < ids.length; i += 80) {
        const chunk = ids.slice(i, i + 80);
        if (!chunk.length) break;
        const { data, error } = await supabase
          .from("conversations")
          .select("id, customer_id, message_direction, delivery_status, message_text, created_at")
          .in("customer_id", chunk)
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(800);
        if (error) throw error;
        waAcc.push(...(((data as WaRow[]) || [])));
        if (waAcc.length >= 2500) break;
      }
      setWa(waAcc.slice(0, 2500));

      const [smsRes, callRes] = await Promise.all([
        supabase
          .from("voice_sms_log")
          .select("id, phone, status, delivery_status, message, created_at")
          .eq("consultant_id", consultantId)
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(500),
        supabase
          .from("voice_call_logs")
          .select("id, to_phone, status, velip_status, duration_sec, created_at")
          .eq("consultant_id", consultantId)
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(500),
      ]);
      if (smsRes.error) throw smsRes.error;
      if (callRes.error) throw callRes.error;

      // Filtra SMS/ligações cujo telefone bate com alguém do escopo (ou fica tudo se escopo vazio)
      const smsAll = (smsRes.data as SmsRow[]) || [];
      const callAll = (callRes.data as CallRow[]) || [];
      const smsFiltered =
        idSet.size === 0
          ? []
          : smsAll.filter((s) => phoneVariants(s.phone).some((p) => phoneToCust.has(p)));
      const callFiltered =
        idSet.size === 0
          ? []
          : callAll.filter((c) => phoneVariants(c.to_phone).some((p) => phoneToCust.has(p)));

      // Se o filtro esvaziar demais (telefones divergentes), mostra o total do consultor no período
      setSms(smsFiltered.length > 0 || allCust.length === 0 ? smsFiltered : smsAll);
      setCalls(callFiltered.length > 0 || allCust.length === 0 ? callFiltered : callAll);
    } catch (e) {
      console.error("[CrmActivityAnalytics]", e);
      toast({
        title: "Não foi possível carregar a análise",
        description: toUserFacingError(e, "Tente atualizar em alguns segundos."),
        variant: "destructive",
        duration: 14000,
      });
    } finally {
      setLoading(false);
    }
  }, [consultantId, periodDays, scope, toast]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const byId = useMemo(() => {
    const m = new Map<string, CustomerLite>();
    customers.forEach((c) => m.set(c.id, c));
    return m;
  }, [customers]);

  const byPhone = useMemo(() => {
    const m = new Map<string, CustomerLite>();
    customers.forEach((c) => {
      for (const p of phoneVariants(c.phone_whatsapp)) m.set(p, c);
    });
    return m;
  }, [customers]);

  const metrics = useMemo(() => {
    const waOut = wa.filter((w) => w.message_direction === "outbound");
    const waIn = wa.filter((w) => w.message_direction === "inbound");
    const waRead = waOut.filter((w) => {
      const s = String(w.delivery_status || "").toLowerCase();
      return s === "read" || s === "played";
    });
    const waDelivered = waOut.filter((w) => {
      const s = String(w.delivery_status || "").toLowerCase();
      return s === "delivered" || s === "delivery_ack" || s === "read" || s === "played";
    });

    const smsOk = sms.filter(
      (s) => s.status === "delivered" || String(s.delivery_status || "").toUpperCase() === "DELIVRD",
    );
    const smsFail = sms.filter((s) => s.status === "failed");
    const callsOk = calls.filter(isAnsweredCall);
    const callsNo = calls.filter((c) => !isAnsweredCall(c));

    const bloqueados = customers.filter((c) =>
      isNuncaMaisContatar({ do_not_contact: c.do_not_contact, paused_reason: c.bot_paused_reason }),
    );
    const emAnalise = customers.filter((c) => isCrmCadastroEmAnalise(c));

    return {
      pessoas: customers.length,
      bloqueados: bloqueados.length,
      emAnalise: emAnalise.length,
      waOut: waOut.length,
      waIn: waIn.length,
      waRead: waRead.length,
      waDelivered: waDelivered.length,
      sms: sms.length,
      smsOk: smsOk.length,
      smsFail: smsFail.length,
      calls: calls.length,
      callsOk: callsOk.length,
      callsNo: callsNo.length,
      readRate: waOut.length > 0 ? ((waRead.length / waOut.length) * 100).toFixed(0) : "0",
    };
  }, [wa, sms, calls, customers]);

  const drillList: PersonHit[] = useMemo(() => {
    if (!drill) return [];

    const resolveCust = (customerId?: string, phone?: string | null) => {
      if (customerId && byId.has(customerId)) return byId.get(customerId)!;
      for (const p of phoneVariants(phone)) {
        if (byPhone.has(p)) return byPhone.get(p)!;
      }
      return null;
    };

    const fromWa = (rows: WaRow[], detailFn: (w: WaRow) => string): PersonHit[] =>
      rows.map((w) => {
        const c = resolveCust(w.customer_id);
        return {
          key: w.id,
          name: c?.name || "Contato",
          phone: fmtPhone(c?.phone_whatsapp),
          detail: detailFn(w),
          at: w.created_at,
          customerId: w.customer_id,
        };
      });

    const fromSms = (rows: SmsRow[], detailFn: (s: SmsRow) => string): PersonHit[] =>
      rows.map((s) => {
        const c = resolveCust(undefined, s.phone);
        return {
          key: s.id,
          name: c?.name || "Contato",
          phone: fmtPhone(s.phone),
          detail: detailFn(s),
          at: s.created_at,
          customerId: c?.id,
        };
      });

    const fromCalls = (rows: CallRow[], detailFn: (c: CallRow) => string): PersonHit[] =>
      rows.map((row) => {
        const c = resolveCust(undefined, row.to_phone);
        return {
          key: row.id,
          name: c?.name || "Contato",
          phone: fmtPhone(row.to_phone),
          detail: detailFn(row),
          at: row.created_at,
          customerId: c?.id,
        };
      });

    switch (drill) {
      case "wa_enviados":
        return fromWa(
          wa.filter((w) => w.message_direction === "outbound"),
          (w) => `WhatsApp enviado · ${waDeliveryLabel(w.delivery_status)}`,
        );
      case "wa_recebidos":
        return fromWa(
          wa.filter((w) => w.message_direction === "inbound"),
          (w) => (w.message_text || "Mensagem recebida").slice(0, 80),
        );
      case "wa_lidos":
        return fromWa(
          wa.filter((w) => {
            const s = String(w.delivery_status || "").toLowerCase();
            return w.message_direction === "outbound" && (s === "read" || s === "played");
          }),
          () => "Leu / abriu no WhatsApp",
        );
      case "wa_entregues":
        return fromWa(
          wa.filter((w) => {
            const s = String(w.delivery_status || "").toLowerCase();
            return (
              w.message_direction === "outbound" &&
              (s === "delivered" || s === "delivery_ack" || s === "read" || s === "played")
            );
          }),
          (w) => waDeliveryLabel(w.delivery_status),
        );
      case "sms":
        return fromSms(sms, (s) => (s.message || "SMS").slice(0, 80));
      case "sms_entregues":
        return fromSms(
          sms.filter(
            (s) => s.status === "delivered" || String(s.delivery_status || "").toUpperCase() === "DELIVRD",
          ),
          () => "SMS entregue",
        );
      case "sms_falhou":
        return fromSms(
          sms.filter((s) => s.status === "failed"),
          () => "SMS falhou",
        );
      case "ligacoes":
        return fromCalls(calls, (c) =>
          isAnsweredCall(c) ? `Atendida (${c.duration_sec || 0}s)` : "Não atendeu / falhou",
        );
      case "ligacoes_atendidas":
        return fromCalls(calls.filter(isAnsweredCall), (c) => `Atendida · ${c.duration_sec || 0}s`);
      case "ligacoes_nao":
        return fromCalls(calls.filter((c) => !isAnsweredCall(c)), () => "Não atendeu");
      case "pessoas":
        return customers.map((c) => ({
          key: c.id,
          name: c.name || "Sem nome",
          phone: fmtPhone(c.phone_whatsapp),
          detail: c.pos_venda_stage || c.conversation_step || c.status || "No CRM",
          at: "",
          customerId: c.id,
        }));
      case "bloqueados":
        return customers
          .filter((c) =>
            isNuncaMaisContatar({ do_not_contact: c.do_not_contact, paused_reason: c.bot_paused_reason }),
          )
          .map((c) => ({
          key: c.id,
          name: c.name || "Sem nome",
          phone: fmtPhone(c.phone_whatsapp),
          detail: "Bloqueado / nunca mais contatar",
          at: "",
          customerId: c.id,
        }));
      case "em_analise":
        return customers.filter(isCrmCadastroEmAnalise).map((c) => ({
          key: c.id,
          name: c.name || "Sem nome",
          phone: fmtPhone(c.phone_whatsapp),
          detail: "Cadastro em análise (iGreen)",
          at: "",
          customerId: c.id,
        }));
      default:
        return [];
    }
  }, [drill, wa, sms, calls, customers, byId, byPhone]);

  const drillTitle: Record<DrillKey, string> = {
    wa_enviados: "WhatsApp enviados",
    wa_recebidos: "WhatsApp recebidos",
    wa_lidos: "WhatsApp lidos / abertos",
    wa_entregues: "WhatsApp entregues",
    sms: "SMS enviados",
    sms_entregues: "SMS entregues",
    sms_falhou: "SMS que falharam",
    ligacoes: "Ligações",
    ligacoes_atendidas: "Ligações atendidas",
    ligacoes_nao: "Ligações sem atendimento",
    pessoas: `Pessoas em ${scopeTitle(scope)}`,
    bloqueados: "Bloqueados",
    em_analise: "Cadastro em análise",
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col gap-0 p-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border/50 shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="w-4 h-4 text-primary" />
            Análise — {scopeTitle(scope)}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Dados reais do período: WhatsApp (enviou / leu), SMS, ligações e quem está no quadro.
            Clique em um número para ver a lista.
          </DialogDescription>
          <div className="flex items-center gap-2 pt-2">
            <Select value={String(periodDays)} onValueChange={(v) => setPeriodDays(Number(v))}>
              <SelectTrigger className="h-8 w-[130px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERIODS.map((p) => (
                  <SelectItem key={p.value} value={String(p.value)} className="text-xs">
                    Últimos {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
          </div>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">
          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <section className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <MetricCard
                  icon={Users}
                  label="Pessoas no quadro"
                  value={metrics.pessoas}
                  onClick={() => setDrill("pessoas")}
                />
                <MetricCard
                  icon={Eye}
                  label="Cadastro em análise"
                  value={metrics.emAnalise}
                  onClick={() => setDrill("em_analise")}
                />
                <MetricCard
                  icon={Users}
                  label="Bloqueados"
                  value={metrics.bloqueados}
                  onClick={() => setDrill("bloqueados")}
                />
                <MetricCard
                  icon={CheckCheck}
                  label="% WA lidos"
                  value={`${metrics.readRate}%`}
                  onClick={() => setDrill("wa_lidos")}
                />
              </section>

              <section>
                <h4 className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5" /> WhatsApp
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <MetricCard label="Enviados" value={metrics.waOut} onClick={() => setDrill("wa_enviados")} />
                  <MetricCard label="Recebidos" value={metrics.waIn} onClick={() => setDrill("wa_recebidos")} />
                  <MetricCard label="Entregues" value={metrics.waDelivered} onClick={() => setDrill("wa_entregues")} />
                  <MetricCard label="Lidos / abertos" value={metrics.waRead} onClick={() => setDrill("wa_lidos")} highlight />
                </div>
              </section>

              <section>
                <h4 className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
                  <Smartphone className="w-3.5 h-3.5" /> SMS
                </h4>
                <div className="grid grid-cols-3 gap-2">
                  <MetricCard label="Enviados" value={metrics.sms} onClick={() => setDrill("sms")} />
                  <MetricCard label="Entregues" value={metrics.smsOk} onClick={() => setDrill("sms_entregues")} />
                  <MetricCard label="Falhou" value={metrics.smsFail} onClick={() => setDrill("sms_falhou")} />
                </div>
              </section>

              <section>
                <h4 className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5" /> Ligações
                </h4>
                <div className="grid grid-cols-3 gap-2">
                  <MetricCard label="Total" value={metrics.calls} onClick={() => setDrill("ligacoes")} />
                  <MetricCard label="Atendidas" value={metrics.callsOk} onClick={() => setDrill("ligacoes_atendidas")} />
                  <MetricCard label="Sem atendimento" value={metrics.callsNo} onClick={() => setDrill("ligacoes_nao")} />
                </div>
              </section>

              {drill && (
                <section className="rounded-xl border border-border bg-card/60 overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-border/50 bg-muted/30">
                    <div className="flex items-center gap-2 min-w-0">
                      <p className="text-sm font-semibold truncate">{drillTitle[drill]}</p>
                      <Badge variant="secondary" className="text-[10px] shrink-0">
                        {drillList.length}
                      </Badge>
                    </div>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDrill(null)} aria-label="Fechar lista">
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                  <div className="max-h-[280px] overflow-y-auto divide-y divide-border/40">
                    {drillList.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-8">Nada neste filtro no período.</p>
                    ) : (
                      drillList.slice(0, 200).map((row) => (
                        <div key={row.key} className="px-3 py-2.5 flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">{row.name}</p>
                            <p className="text-[11px] text-muted-foreground">{row.phone}</p>
                            <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{row.detail}</p>
                          </div>
                          {row.at ? (
                            <time className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
                              {new Date(row.at).toLocaleString("pt-BR", {
                                day: "2-digit",
                                month: "2-digit",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </time>
                          ) : null}
                        </div>
                      ))
                    )}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MetricCard({
  label,
  value,
  onClick,
  icon: Icon,
  highlight,
}: {
  label: string;
  value: number | string;
  onClick: () => void;
  icon?: React.ComponentType<{ className?: string }>;
  highlight?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border text-left p-3 transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
        highlight ? "border-primary/30 bg-primary/5" : "border-border bg-card"
      }`}
    >
      {Icon ? <Icon className="w-4 h-4 text-primary mb-1.5" /> : null}
      <p className="text-xl font-bold text-foreground tabular-nums">{value}</p>
      <p className="text-[10px] text-muted-foreground mt-0.5">{label}</p>
      <p className="text-[9px] text-primary/80 mt-1">Ver lista</p>
    </button>
  );
}
