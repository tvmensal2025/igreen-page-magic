import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  User, Phone, Mail, MapPin, Zap, FileText, Calendar, Hash, Link as LinkIcon,
  Loader2, Clock, CheckCircle2, XCircle, MessageSquare, Image as ImageIcon,
  Headphones, Video, AlertTriangle, Send,
} from "lucide-react";
import { format, addDays } from "date-fns";
import { ptBR } from "date-fns/locale";

interface CustomerQuickViewDialogProps {
  customerId?: string | null;
  dealId?: string | null;
  customerName?: string | null;
  phone?: string | null;
  onClose: () => void;
}

const PV_ORDER = ["pv_espera", "pv_aprovado", "pv_d30", "pv_d60", "pv_d90", "pv_d120"];
const PV_LABEL: Record<string, string> = {
  pv_espera: "Aguardando classificação",
  pv_aprovado: "Aprovado",
  pv_reprovado: "Reprovado",
  pv_d30: "30 dias",
  pv_d60: "60 dias",
  pv_d90: "90 dias",
  pv_d120: "120 dias",
};
const PV_DAYS: Record<string, number> = { pv_d30: 30, pv_d60: 60, pv_d90: 90, pv_d120: 120 };

function fmt(iso?: string | null, withTime = false) {
  if (!iso) return null;
  try {
    return format(new Date(iso), withTime ? "dd/MM/yyyy 'às' HH:mm" : "dd/MM/yyyy", { locale: ptBR });
  } catch { return null; }
}

function relDays(iso?: string | null) {
  if (!iso) return null;
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (d === 0) return "hoje";
  if (d > 0) return `há ${d} dia${d > 1 ? "s" : ""}`;
  return `em ${-d} dia${-d > 1 ? "s" : ""}`;
}

function Row({ icon: Icon, label, value }: { icon: any; label: string; value: any }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-border/30 last:border-0">
      <Icon className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="text-xs text-foreground break-words">{value}</p>
      </div>
    </div>
  );
}

function TimelineItem({
  color, icon: Icon, title, date, sub, future,
}: { color: string; icon: any; title: string; date?: string | null; sub?: string | null; future?: boolean }) {
  return (
    <div className="flex gap-3 relative">
      <div className="flex flex-col items-center">
        <div className={`w-7 h-7 rounded-full flex items-center justify-center border-2 ${future ? "bg-muted/40 border-border" : color}`}>
          <Icon className={`h-3.5 w-3.5 ${future ? "text-muted-foreground" : "text-primary-foreground"}`} />
        </div>
        <div className="w-px flex-1 bg-border/40 mt-1" />
      </div>
      <div className="flex-1 pb-3 min-w-0">
        <p className={`text-xs font-semibold ${future ? "text-muted-foreground" : "text-foreground"}`}>{title}</p>
        {date && <p className="text-[10px] text-muted-foreground">{date}</p>}
        {sub && <p className="text-[10px] text-muted-foreground/80 italic">{sub}</p>}
      </div>
    </div>
  );
}

function MessagePreview({
  type, text, mediaUrl, imageUrl, displayName,
}: { type: string; text?: string | null; mediaUrl?: string | null; imageUrl?: string | null; displayName: string }) {
  const rendered = (text || "").replace(/\{\{nome\}\}/g, displayName).replace(/\{\{telefone\}\}/g, "");
  return (
    <div className="rounded-lg p-3 space-y-2 border border-border/60 bg-card/60">
      {imageUrl && (
        <div className="rounded-md overflow-hidden bg-black/40 max-h-48">
          <img src={imageUrl} alt="" className="w-full object-contain max-h-48" loading="lazy" />
        </div>
      )}
      {type === "image" && mediaUrl && !imageUrl && (
        <div className="rounded-md overflow-hidden bg-black/40 max-h-48">
          <img src={mediaUrl} alt="" className="w-full object-contain max-h-48" loading="lazy" />
        </div>
      )}
      {type === "audio" && mediaUrl && (
        <div className="bg-emerald-950/40 rounded-md p-2 flex items-center gap-2">
          <Headphones className="h-4 w-4 text-emerald-400 shrink-0" />
          <audio controls src={mediaUrl} className="w-full h-8" preload="metadata" />
        </div>
      )}
      {type === "video" && mediaUrl && (
        <video controls src={mediaUrl} className="w-full max-h-48 rounded-md bg-black" preload="metadata" />
      )}
      {rendered && (
        <div className="bg-[#005c4b] text-white text-xs rounded-lg rounded-tr-none px-3 py-2 ml-auto max-w-[90%] whitespace-pre-wrap break-words shadow">
          {rendered}
        </div>
      )}
      {!rendered && !mediaUrl && !imageUrl && (
        <p className="text-[10px] text-muted-foreground italic">Nenhum conteúdo configurado.</p>
      )}
    </div>
  );
}

function StageBlock({
  title, badge, stage, displayName, scheduledAt,
}: { title: string; badge?: React.ReactNode; stage: any | null; displayName: string; scheduledAt?: string | null }) {
  if (!stage) {
    return (
      <div className="rounded-lg border border-dashed border-border/60 p-3 bg-muted/20">
        <p className="text-xs font-semibold text-foreground mb-1">{title}</p>
        <p className="text-[11px] text-muted-foreground">Nenhuma etapa correspondente encontrada.</p>
      </div>
    );
  }
  const enabled = stage.auto_message_enabled;
  const type = stage.auto_message_type || "text";
  const typeIcon = type === "audio" ? Headphones : type === "image" ? ImageIcon : type === "video" ? Video : MessageSquare;
  const TypeIcon = typeIcon;
  return (
    <div className="rounded-lg border border-border/60 p-3 bg-card/40 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-xs font-semibold text-foreground flex-1">{title}</p>
        {badge}
        <Badge variant="outline" className="text-[9px] gap-1">
          <TypeIcon className="h-2.5 w-2.5" /> {type}
        </Badge>
      </div>
      {scheduledAt && (
        <p className="text-[10px] text-muted-foreground flex items-center gap-1">
          <Clock className="h-3 w-3" /> Envio previsto: <span className="font-medium text-foreground">{scheduledAt}</span>
        </p>
      )}
      {!enabled && (
        <div className="flex items-center gap-1.5 text-[10px] text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1">
          <AlertTriangle className="h-3 w-3" /> Autoprogressão desativada para esta etapa
        </div>
      )}
      <MessagePreview
        type={type}
        text={stage.auto_message_text}
        mediaUrl={stage.auto_message_media_url}
        imageUrl={stage.auto_message_image_url}
        displayName={displayName}
      />
    </div>
  );
}

export default function CustomerQuickViewDialog({ customerId, dealId, customerName, phone, onClose }: CustomerQuickViewDialogProps) {
  const [loading, setLoading] = useState(false);
  const [customer, setCustomer] = useState<any | null>(null);
  const [deal, setDeal] = useState<any | null>(null);
  const [stages, setStages] = useState<any[]>([]);
  const [sentLogs, setSentLogs] = useState<any[]>([]);

  const open = !!customerId || !!dealId;

  useEffect(() => {
    if (!open) { setCustomer(null); setDeal(null); setStages([]); setSentLogs([]); return; }
    setLoading(true);
    (async () => {
      let cust: any = null;
      let dl: any = null;

      if (customerId) {
        const { data } = await supabase.from("customers").select("*").eq("id", customerId).maybeSingle();
        cust = data;
      }
      if (dealId) {
        const { data } = await supabase.from("crm_deals").select("*").eq("id", dealId).maybeSingle();
        dl = data;
        if (!cust && dl?.customer_id) {
          const { data: c2 } = await supabase.from("customers").select("*").eq("id", dl.customer_id).maybeSingle();
          cust = c2;
        }
      }
      setCustomer(cust);
      setDeal(dl);

      const consultantId = cust?.consultant_id || cust?.assigned_consultant_id || dl?.consultant_id;
      if (consultantId) {
        const { data: st } = await supabase
          .from("kanban_stages")
          .select("id,stage_key,label,color,stage_scope,auto_message_enabled,auto_message_text,auto_message_type,auto_message_media_url,auto_message_image_url")
          .eq("consultant_id", consultantId);
        setStages(st || []);
      }

      if (cust?.id) {
        const { data: logs } = await supabase
          .from("customer_auto_message_log")
          .select("stage_key,created_at,message_preview,status")
          .eq("customer_id", cust.id)
          .order("created_at", { ascending: false })
          .limit(20);
        setSentLogs((logs || []).map((l: any) => ({ ...l, sent_at: l.created_at })));
      } else if (dl?.id) {
        const { data: logs } = await supabase
          .from("crm_auto_message_log")
          .select("stage_key,sent_at,message_preview,status")
          .eq("deal_id", dl.id)
          .order("sent_at", { ascending: false })
          .limit(20);
        setSentLogs(logs || []);
      }

      setLoading(false);
    })();
  }, [customerId, dealId, open]);

  const display = customer || { name: customerName, phone_whatsapp: phone };
  const displayName = display?.name || customerName || "Cliente";

  // compute current + next pos-venda stage
  const { currentPvKey, nextPvKey, nextDate } = useMemo(() => {
    if (!customer) return { currentPvKey: null, nextPvKey: null, nextDate: null };
    const stg = customer.pos_venda_stage;
    // Marco da esteira 30/60/90/120 = data de aprovação (fallback histórico: envio ao portal).
    const baseDate = customer.pos_venda_approved_at || customer.portal_submitted_at;
    let cur: string | null = null;
    if (stg === "reprovado") cur = "pv_reprovado";
    else if (stg) cur = `pv_${stg}`;

    if (cur === "pv_reprovado") return { currentPvKey: cur, nextPvKey: null, nextDate: null };

    const order = ["pv_espera", "pv_aprovado", "pv_d30", "pv_d60", "pv_d90", "pv_d120"];
    const idx = cur ? order.indexOf(cur) : 0;
    const next = idx >= 0 && idx < order.length - 1 ? order[idx + 1] : null;
    let when: string | null = null;
    if (next && PV_DAYS[next] && baseDate) {
      when = fmt(addDays(new Date(baseDate), PV_DAYS[next]).toISOString(), true);
    } else if (next === "pv_aprovado") {
      when = "Ao aprovar a venda";
    }
    return { currentPvKey: cur, nextPvKey: next, nextDate: when };
  }, [customer]);

  const stageByKey = useMemo(() => {
    const m = new Map<string, any>();
    for (const s of stages) m.set(s.stage_key, s);
    return m;
  }, [stages]);

  const currentStage = currentPvKey ? stageByKey.get(currentPvKey) : null;
  const nextStage = nextPvKey ? stageByKey.get(nextPvKey) : null;

  // current deal stage (for leads)
  const dealStage = deal?.stage ? stages.find((s) => s.stage_key === deal.stage && s.stage_scope !== "pos_venda") : null;

  const lastSentByStage = useMemo(() => {
    const m = new Map<string, any>();
    for (const l of sentLogs) if (!m.has(l.stage_key)) m.set(l.stage_key, l);
    return m;
  }, [sentLogs]);

  // Build timeline events
  const timeline = useMemo(() => {
    const out: { color: string; icon: any; title: string; date?: string | null; sub?: string | null; future?: boolean; ts: number }[] = [];
    const push = (e: any) => out.push(e);
    if (customer?.data_cadastro || customer?.created_at) {
      const iso = customer.data_cadastro || customer.created_at;
      push({ color: "bg-sky-500 border-sky-500", icon: UserPlus, title: "Cadastrado", date: fmt(iso, true), ts: new Date(iso).getTime() });
    }
    if (deal?.created_at && !customer) {
      push({ color: "bg-sky-500 border-sky-500", icon: UserPlus, title: "Lead criado", date: fmt(deal.created_at, true), ts: new Date(deal.created_at).getTime() });
    }
    if (customer?.portal_submitted_at) {
      push({ color: "bg-amber-500 border-amber-500", icon: Clock, title: "Entrou em análise (portal)", date: fmt(customer.portal_submitted_at, true), ts: new Date(customer.portal_submitted_at).getTime() });
    }
    if (customer?.data_ativo) {
      push({ color: "bg-emerald-500 border-emerald-500", icon: CheckCircle2, title: "Aprovado", date: fmt(customer.data_ativo, true), ts: new Date(customer.data_ativo).getTime() });
    }
    if (deal?.approved_at && !customer?.data_ativo) {
      push({ color: "bg-emerald-500 border-emerald-500", icon: CheckCircle2, title: "Lead aprovado", date: fmt(deal.approved_at, true), ts: new Date(deal.approved_at).getTime() });
    }
    if (deal?.rejected_at || customer?.pos_venda_stage === "reprovado") {
      const iso = deal?.rejected_at || customer?.updated_at;
      push({ color: "bg-rose-500 border-rose-500", icon: XCircle, title: "Reprovado", date: fmt(iso, true), sub: deal?.rejection_reason || customer?.pos_venda_reason, ts: new Date(iso || Date.now()).getTime() });
    }
    // sent auto messages
    for (const l of sentLogs) {
      push({
        color: "bg-violet-500 border-violet-500",
        icon: Send,
        title: `Mensagem automática enviada (${PV_LABEL[l.stage_key] || l.stage_key})`,
        date: fmt(l.sent_at, true),
        sub: l.message_preview ? `"${l.message_preview.slice(0, 80)}"` : null,
        ts: new Date(l.sent_at).getTime(),
      });
    }
    // future milestones for pos-venda (marco = aprovação; fallback histórico: portal)
    const pvBaseDate = customer?.pos_venda_approved_at || customer?.portal_submitted_at;
    if (pvBaseDate && customer?.pos_venda_stage !== "reprovado") {
      for (const k of ["pv_d30", "pv_d60", "pv_d90", "pv_d120"]) {
        const days = PV_DAYS[k];
        const when = addDays(new Date(pvBaseDate), days);
        const isFuture = when.getTime() > Date.now();
        const cur = currentPvKey === k;
        if (cur) continue;
        push({
          color: isFuture ? "bg-muted/40 border-border" : "bg-cyan-500 border-cyan-500",
          icon: Calendar,
          title: `${PV_LABEL[k]} ${isFuture ? "(previsto)" : ""}`,
          date: `${fmt(when.toISOString())} · ${relDays(when.toISOString())}`,
          future: isFuture,
          ts: when.getTime(),
        });
      }
    }
    return out.sort((a, b) => a.ts - b.ts);
  }, [customer, deal, sentLogs, currentPvKey]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[95vw] sm:max-w-2xl max-h-[92vh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader className="space-y-1">
          <DialogTitle className="text-sm sm:text-base font-bold flex items-center gap-2">
            <User className="h-4 w-4 text-primary" />
            <span className="truncate">{displayName}</span>
          </DialogTitle>
          <DialogDescription className="text-[11px]">
            {display?.phone_whatsapp || phone || ""}
          </DialogDescription>
          <div className="flex gap-1.5 flex-wrap pt-1">
            {customer?.status && <Badge variant="secondary" className="text-[10px]">Status: {customer.status}</Badge>}
            {customer?.customer_origin && <Badge variant="outline" className="text-[10px]">{customer.customer_origin}</Badge>}
            {currentPvKey && <Badge className="text-[10px] bg-primary/15 text-primary border-primary/40 border">{PV_LABEL[currentPvKey]}</Badge>}
            {dealStage && <Badge className="text-[10px] bg-primary/15 text-primary border-primary/40 border">{dealStage.label}</Badge>}
          </div>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Tabs defaultValue="next" className="mt-2">
            <TabsList className="grid grid-cols-3 w-full h-9">
              <TabsTrigger value="next" className="text-[11px] sm:text-xs">Próxima msg</TabsTrigger>
              <TabsTrigger value="timeline" className="text-[11px] sm:text-xs">Linha do tempo</TabsTrigger>
              <TabsTrigger value="data" className="text-[11px] sm:text-xs">Dados</TabsTrigger>
            </TabsList>

            <TabsContent value="next" className="space-y-3 mt-3">
              {currentStage && (
                <StageBlock
                  title={`Etapa atual: ${currentStage.label}`}
                  badge={currentPvKey && lastSentByStage.has(currentPvKey)
                    ? <Badge variant="outline" className="text-[9px] bg-emerald-500/10 text-emerald-400 border-emerald-500/30">enviada {fmt(lastSentByStage.get(currentPvKey).sent_at)}</Badge>
                    : <Badge variant="outline" className="text-[9px]">pendente</Badge>}
                  stage={currentStage}
                  displayName={displayName}
                />
              )}
              {nextStage ? (
                <StageBlock
                  title={`Próxima etapa: ${nextStage.label}`}
                  badge={<Badge variant="outline" className="text-[9px] bg-cyan-500/10 text-cyan-300 border-cyan-500/30">a enviar</Badge>}
                  stage={nextStage}
                  displayName={displayName}
                  scheduledAt={nextDate}
                />
              ) : !currentStage ? (
                <div className="text-[11px] text-muted-foreground italic p-4 text-center border border-dashed border-border rounded-lg">
                  Sem etapa de pós-venda definida ainda.
                </div>
              ) : null}

              {dealStage && (
                <StageBlock
                  title={`Etapa atual do lead: ${dealStage.label}`}
                  stage={dealStage}
                  displayName={displayName}
                />
              )}
            </TabsContent>

            <TabsContent value="timeline" className="mt-3">
              {timeline.length === 0 ? (
                <p className="text-[11px] text-muted-foreground italic text-center py-6">Sem eventos registrados.</p>
              ) : (
                <div className="space-y-0">
                  {timeline.map((e, i) => (
                    <TimelineItem key={i} {...e} />
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="data" className="mt-3 space-y-1">
              <Row icon={Phone} label="WhatsApp" value={display?.phone_whatsapp} />
              <Row icon={Mail} label="Email" value={customer?.email} />
              <Row icon={Hash} label="CPF" value={customer?.cpf} />
              <Row icon={Hash} label="Código iGreen" value={customer?.igreen_code} />
              <Row icon={MapPin} label="Cidade/UF" value={customer?.address_city ? `${customer.address_city}${customer.address_state ? "/" + customer.address_state : ""}` : null} />
              <Row icon={Zap} label="Conta de luz" value={customer?.electricity_bill_value ? `R$ ${Number(customer.electricity_bill_value).toFixed(2)}` : null} />
              <Row icon={Zap} label="Distribuidora" value={customer?.distribuidora} />
              <Row icon={Hash} label="Nº Instalação" value={customer?.numero_instalacao} />
              <Row icon={FileText} label="Andamento iGreen" value={customer?.andamento_igreen} />
              <Row icon={FileText} label="Devolutiva" value={customer?.devolutiva} />
              <Row icon={FileText} label="Observação" value={customer?.observacao} />
              <Row icon={FileText} label="Motivo (pós-venda)" value={customer?.pos_venda_reason} />
              <Row icon={User} label="Cadastrado por" value={customer?.registered_by_name} />
              <Row icon={Calendar} label="Data cadastro" value={fmt(customer?.data_cadastro)} />
              <Row icon={Calendar} label="Data ativação" value={fmt(customer?.data_ativo)} />
              <Row icon={Calendar} label="Portal enviado em" value={fmt(customer?.portal_submitted_at, true)} />
              <Row icon={LinkIcon} label="Link assinatura" value={customer?.link_assinatura} />
              <Row icon={FileText} label="Etapa do bot" value={customer?.conversation_step || deal?.stage} />
              <Row icon={FileText} label="Observações do lead" value={deal?.notes} />
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}

function UserPlus(props: any) {
  return <User {...props} />;
}
