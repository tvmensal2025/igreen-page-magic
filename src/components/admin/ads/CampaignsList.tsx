import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Pause, Play, Square, Loader2, MapPin, TrendingUp, Users, MessageCircle, DollarSign, Heart, AlertTriangle, RefreshCw, Trash2, Facebook, CalendarClock, Image as ImageIcon, PlayCircle, Settings2, Users2, Brain } from "lucide-react";
import { EditCampaignDialog } from "./EditCampaignDialog";
import { CampaignRodizioLeadsDialog } from "./CampaignRodizioLeadsDialog";
import { CampaignBrainScaleDialog, isBrainScaleEligible } from "./CampaignBrainScaleDialog";

import { useToast } from "@/hooks/use-toast";
import { CampaignHealthCheck } from "./CampaignHealthCheck";
import { useUserRole } from "@/hooks/useUserRole";
import { startFacebookOAuth } from "@/services/facebookAds";
import { ExtendCampaignDialog } from "./ExtendCampaignDialog";
import { META_CAMPAIGN_PROOF_OR } from "@/lib/metaCampaignProof";
import { formatCampaignGeo } from "@/lib/campaignGeo";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Campaign {
  id: string; name: string; status: string; cities: any[];
  daily_budget_cents: number; fb_campaign_id: string | null;
  created_at: string; rejection_reason: string | null;
  ended_at: string | null; started_at: string | null;
  thumbnail_url: string | null; creative_format: string | null;
  age_min?: number | null; age_max?: number | null;
  age_min_preferred?: number | null;
  duration_days?: number | null;
  brain_scale_enabled?: boolean;
  brain_scale_step_pct?: number;
  brain_scale_max_budget_cents?: number;
  brain_scale_target_cpl_cents?: number;
}
interface Creative { kind: "video" | "image" | "none"; url: string | null }
interface Metric { campaign_id: string; impressions: number; clicks: number; spend_cents: number; meta_lead_actions: number; messaging_conversations_started: number; cost_per_lead_cents: number }
interface DaySlice { impressions: number; clicks: number; spend_cents: number; meta_lead_actions: number; messaging_conversations_started: number }

const EMPTY_DAY: DaySlice = { impressions: 0, clicks: 0, spend_cents: 0, meta_lead_actions: 0, messaging_conversations_started: 0 };

/** YYYY-MM-DD no fuso America/Sao_Paulo (evita “hoje” virar ontem perto da meia-noite UTC). */
function brDateOffset(daysAgo: number): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(new Date(Date.now() - daysAgo * 86400_000));
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const d = parts.find((p) => p.type === "day")!.value;
  return `${y}-${m}-${d}`;
}

function healthOf(m: { spend_cents: number; meta_lead_actions: number; messaging_conversations_started: number }): { level: "green" | "yellow" | "red" | "idle"; label: string } {
  const spend = m.spend_cents / 100;
  if (spend < 5) return { level: "idle", label: "Aquecendo" };
  // Leads e conversas da Meta podem representar a mesma pessoa.
  const actions = Math.max(m.meta_lead_actions, m.messaging_conversations_started);
  if (actions === 0 && spend >= 30) return { level: "red", label: "Sem clientes interessados — revisar" };
  if (actions === 0) return { level: "yellow", label: "Sem clientes interessados ainda" };
  const costPerResult = spend / actions;
  if (costPerResult <= 10) return { level: "green", label: `Custo/resultado R$${costPerResult.toFixed(2)}` };
  if (costPerResult <= 25) return { level: "yellow", label: `Custo/resultado R$${costPerResult.toFixed(2)}` };
  return { level: "red", label: `Custo/resultado R$${costPerResult.toFixed(2)} alto` };
}

const STATUS_COLOR: Record<string, string> = {
  active: "bg-primary/20 text-primary",
  paused: "bg-warning/20 text-warning",
  draft: "bg-info/20 text-info",
  pending_review: "bg-primary/20 text-primary",
  rejected: "bg-destructive/20 text-destructive",
  completed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
};
const STATUS_LABEL: Record<string, string> = {
  active: "Ativa", paused: "Pausada", draft: "Rascunho", pending_review: "Em revisão", rejected: "Rejeitada",
  completed: "Concluída",
};

function isManualStopReason(reason: string | null | undefined): boolean {
  if (!reason) return false;
  return reason.startsWith("MANUAL_STOP:") || /encerrad[ao] pelo consultor/i.test(reason);
}

// Mapeia mensagem crua do Meta pra explicação + sugestão amigável.
// kind="session" sinaliza pro UI esconder "Tentar reativar" e mostrar "Reconectar Facebook".
function explainRejection(raw: string | null | undefined): { title: string; suggestion: string; kind?: "session" | "other" } | null {
  if (!raw) return null;
  const r = raw.toLowerCase();
  if (
    r.includes("session_invalidated") ||
    r.includes("session has been invalidated") ||
    r.includes("session for security reasons") ||
    r.includes("subcode=460") || r.includes("subcode\":460") ||
    (r.includes("code=190")) || (r.includes("code\":190"))
  ) {
    return { kind: "session", title: "Conexão com Facebook expirou", suggestion: "O Facebook invalidou a sessão (provavelmente por troca de senha ou segurança). Clique em \"Reconectar Facebook\" abaixo e republique a campanha — \"Tentar reativar\" não resolve esse caso." };
  }
  if (r.includes("2446885") || r.includes("conta pessoal") || r.includes("whatsapp business")) {
    return { title: "Página sem WhatsApp Business", suggestion: "Vá no Meta Business Suite → Configurações → WhatsApp e vincule um número Business à Página. Depois reabra 'Selecionar assets' e republique." };
  }
  if (r.includes("token") && (r.includes("expired") || r.includes("expirou") || r.includes("invalid"))) {
    return { kind: "session", title: "Conexão com o Facebook expirou", suggestion: "Reconecte sua conta Facebook clicando no botão abaixo e republique a campanha." };
  }
  if (r.includes("ad_account") || r.includes("disabled") || r.includes("desativada")) {
    return { title: "Conta de anúncios desativada", suggestion: "Acesse business.facebook.com → Conta de Anúncios e resolva o aviso (geralmente cartão recusado ou política violada)." };
  }
  if (r.includes("payment") || r.includes("pagamento") || r.includes("funding")) {
    return { title: "Problema com forma de pagamento", suggestion: "Adicione/atualize o cartão no Meta Business Manager → Configurações → Pagamentos." };
  }
  if (r.includes("policy") || r.includes("política") || r.includes("rejected")) {
    return { title: "Anúncio rejeitado por política", suggestion: "Ajuste foto/texto — evite promessas exageradas, % específicos, depoimentos atribuídos. Republique." };
  }
  if (r.includes("rate") || r.includes("limit") || r.includes("17") || r.includes("4")) {
    return { title: "Limite de chamadas da Meta", suggestion: "Aguarde 5-10 min e clique em 'Tentar reativar'. Erro temporário." };
  }
  return { title: "Erro ao publicar no Meta", suggestion: raw };
}

export function CampaignsList({ consultantId, refreshKey }: { consultantId: string; refreshKey: number }) {
  const [items, setItems] = useState<Campaign[]>([]);
  const [metrics, setMetrics] = useState<Record<string, Metric>>({});
  const [todayByCamp, setTodayByCamp] = useState<Record<string, DaySlice>>({});
  const [yesterdayByCamp, setYesterdayByCamp] = useState<Record<string, DaySlice>>({});
  const [creatives, setCreatives] = useState<Record<string, Creative>>({});
  const [waLeads, setWaLeads] = useState<Record<string, number>>({});
  const [waNumber, setWaNumber] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reactivating, setReactivating] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Campaign | null>(null);
  const [confirmStop, setConfirmStop] = useState<Campaign | null>(null);
  const [extending, setExtending] = useState<Campaign | null>(null);
  const [editing, setEditing] = useState<Campaign | null>(null);
  const [brainScaleCampaign, setBrainScaleCampaign] = useState<Campaign | null>(null);
  const [rodizioCampaign, setRodizioCampaign] = useState<Campaign | null>(null);
  const [rodizioSet, setRodizioSet] = useState<Set<string>>(new Set());
  const [refreshTick, setRefreshTick] = useState(0);
  const [authUserId, setAuthUserId] = useState<string | null>(null);

  const { isSuperAdmin } = useUserRole(authUserId);
  const { toast } = useToast();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setAuthUserId(data.user?.id ?? null));
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [campsRes, settingsRes] = await Promise.all([
        supabase
          .from("facebook_campaigns")
          .select("id,name,status,cities,daily_budget_cents,fb_campaign_id,created_at,rejection_reason,ended_at,started_at,thumbnail_url,creative_format,age_min,age_max,age_min_preferred,duration_days,brain_scale_enabled,brain_scale_step_pct,brain_scale_max_budget_cents,brain_scale_target_cpl_cents")
          .eq("consultant_id", consultantId)
          .order("created_at", { ascending: false }),
        supabase
          .from("consultant_ad_settings")
          .select("whatsapp_destination_number")
          .eq("consultant_id", consultantId)
          .maybeSingle(),
      ]);
      const list = (campsRes.data || []) as Campaign[];
      setItems(list);
      setWaNumber((settingsRes.data as any)?.whatsapp_destination_number || null);

      if (list.length > 0) {
        // Janela dinâmica: começa no mais antigo entre (started_at | created_at) das campanhas
        // ou 30 dias atrás — o que for MAIS RECENTE. Assim campanha de 5d mostra 5d, não 30d.
        const cutoff30d = Date.now() - 30 * 86400_000;
        const earliestStart = list.reduce((min, c) => {
          const t = new Date(c.started_at || c.created_at).getTime();
          return isNaN(t) ? min : Math.min(min, t);
        }, Date.now());
        const sinceMs = Math.max(cutoff30d, earliestStart);
        const since = new Date(sinceMs).toISOString().slice(0, 10);
        const todayKey = brDateOffset(0);
        const yesterdayKey = brDateOffset(1);
        const { data: ms } = await supabase
          .from("facebook_metrics_daily")
          .select("campaign_id,date,impressions,clicks,spend_cents,meta_lead_actions,messaging_conversations_started")
          .in("campaign_id", list.map(c => c.id))
          .gte("date", since);
        const agg: Record<string, Metric> = {};
        const todayMap: Record<string, DaySlice> = {};
        const yestMap: Record<string, DaySlice> = {};
        (ms || []).forEach((m: any) => {
          const cur = agg[m.campaign_id] || { campaign_id: m.campaign_id, impressions: 0, clicks: 0, spend_cents: 0, meta_lead_actions: 0, messaging_conversations_started: 0, cost_per_lead_cents: 0 };
          cur.impressions += m.impressions || 0;
          cur.clicks += m.clicks || 0;
          cur.spend_cents += m.spend_cents || 0;
          cur.meta_lead_actions += m.meta_lead_actions || 0;
          cur.messaging_conversations_started += m.messaging_conversations_started || 0;
          agg[m.campaign_id] = cur;

          const slice: DaySlice = {
            impressions: Number(m.impressions || 0),
            clicks: Number(m.clicks || 0),
            spend_cents: Number(m.spend_cents || 0),
            meta_lead_actions: Number(m.meta_lead_actions || 0),
            messaging_conversations_started: Number(m.messaging_conversations_started || 0),
          };
          if (m.date === todayKey) todayMap[m.campaign_id] = slice;
          if (m.date === yesterdayKey) yestMap[m.campaign_id] = slice;
        });
        Object.values(agg).forEach(m => {
          // CTWA: custo operacional = gasto ÷ conversas. Lead form fica separado.
          const denom = m.messaging_conversations_started > 0
            ? m.messaging_conversations_started
            : m.meta_lead_actions;
          m.cost_per_lead_cents = denom > 0 ? Math.round(m.spend_cents / denom) : 0;
        });
        setMetrics(agg);
        setTodayByCamp(todayMap);
        setYesterdayByCamp(yestMap);

        // ─── Contatos atribuídos no CRM (só com prova Meta: AD ID ou ctwa_clid) ───
        // Nunca conta manual_backfill / fallback_pool / só source_campaign_id.
        const { data: waRows } = await (supabase as any)
          .from("customers")
          .select("source_campaign_id")
          .in("source_campaign_id", list.map(c => c.id))
          .or(META_CAMPAIGN_PROOF_OR)
          .gte("created_at", new Date(Date.now() - 30 * 86400_000).toISOString());
        const waCounts: Record<string, number> = {};
        (waRows || []).forEach((r: any) => {
          if (r.source_campaign_id) waCounts[r.source_campaign_id] = (waCounts[r.source_campaign_id] || 0) + 1;
        });
        setWaLeads(waCounts);

        // ─── Campanhas com rodízio configurado (inclusive quando pausadas) ───
        try {
          const { data: pools } = await (supabase as any)
            .from("rodizio_pools")
            .select("campaign_id")
            .in("campaign_id", list.map(c => c.id))
            .eq("is_enabled", true);
          const rSet = new Set<string>();
          (pools || []).forEach((p: any) => { if (p.campaign_id) rSet.add(p.campaign_id); });
          setRodizioSet(rSet);
        } catch { /* best-effort */ }


        // ─── Criativos por campanha (preview de mídia) ───
        // Prioridade: (1) capa real da Meta em facebook_campaigns.thumbnail_url,
        //             (2) ad_template_usages → ad_templates (wizard),
        //             (3) última imagem da biblioteca (fallback genérico).
        try {
          const cr: Record<string, Creative> = {};

          // 1) capa real vinda da Meta (fonte de verdade)
          list.forEach((c) => {
            if (c.thumbnail_url) {
              const kind = c.creative_format === "video" ? "video" : "image";
              cr[c.id] = { kind, url: c.thumbnail_url };
            }
          });

          // 2) usages do wizard — só pra campanhas que ainda não têm capa real
          const remaining = list.filter(c => !cr[c.id]).map(c => c.id);
          if (remaining.length > 0) {
            const { data: usages } = await (supabase as any)
              .from("ad_template_usages")
              .select("campaign_id, template_id")
              .in("campaign_id", remaining);
            const tplIds = Array.from(new Set(((usages as any[]) || []).map(u => u.template_id))).filter(Boolean);
            const tplById: Record<string, any> = {};
            if (tplIds.length > 0) {
              const { data: tpls } = await (supabase as any)
                .from("ad_templates")
                .select("id, photos, video_url, video_thumb_url, creative_mode")
                .in("id", tplIds);
              (tpls || []).forEach((t: any) => { tplById[t.id] = t; });
            }
            ((usages as any[]) || []).forEach((u) => {
              const t = tplById[u.template_id];
              if (!t) return;
              if (t.creative_mode === "video" || t.video_url) {
                cr[u.campaign_id] = { kind: "video", url: t.video_thumb_url || (Array.isArray(t.photos) && t.photos[0]?.url) || null };
              } else if (Array.isArray(t.photos) && t.photos[0]?.url) {
                cr[u.campaign_id] = { kind: "image", url: t.photos[0].url };
              }
            });
          }

          // 3) fallback genérico: última imagem da biblioteca (só se restou algo sem capa)
          const stillMissing = list.filter(c => !cr[c.id]).map(c => c.id);
          if (stillMissing.length > 0) {
            const { data: imgs } = await (supabase as any)
              .from("ad_image_library")
              .select("url")
              .eq("consultant_id", consultantId)
              .order("created_at", { ascending: false })
              .limit(1);
            const fallbackUrl = (imgs && imgs[0]?.url) || null;
            stillMissing.forEach((cid) => {
              cr[cid] = fallbackUrl ? { kind: "image", url: fallbackUrl } : { kind: "none", url: null };
            });
          }
          setCreatives(cr);
        } catch { /* preview é best-effort */ }
      }
      setLoading(false);
    })();
  }, [consultantId, refreshKey, refreshTick]);

  async function tryReactivate(c: Campaign) {
    if (!c.fb_campaign_id) return;
    setReactivating(c.id);
    try {
      const { data, error } = await supabase.functions.invoke("facebook-campaign-healthcheck", {
        body: { campaign_id: c.id },
      });
      if (error) throw error;
      if ((data as any)?.activated) {
        toast({ title: "Campanha reativada!", description: "Voltou a rodar." });
        setItems((prev) => prev.map((x) => x.id === c.id ? { ...x, status: "active", rejection_reason: null } : x));
      } else if ((data as any)?.pending_review) {
        toast({
          title: "Ativação enviada à Meta",
          description: (data as any)?.reason || "Anúncios em análise (IN_PROCESS). Em breve ficam ativos sozinhos.",
        });
        setItems((prev) => prev.map((x) => x.id === c.id ? { ...x, status: "pending_review", rejection_reason: null } : x));
      } else {
        toast({ title: "Ainda não foi possível reativar", description: (data as any)?.reason || "Veja o motivo no card.", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Falha ao tentar reativar", description: e?.message || "Erro desconhecido", variant: "destructive" });
    } finally { setReactivating(null); }
  }

  async function handleToggle(c: Campaign, forcedAction?: "pause" | "activate") {
    if (c.status === "completed") {
      toast({
        title: "Campanha encerrada",
        description: "Use Estender para voltar a rodar — Play não reativa.",
        variant: "destructive",
      });
      return;
    }
    // Pause também em Em revisão (pending_review). Play só em paused.
    const action: "pause" | "activate" = forcedAction
      ?? (c.status === "active" || c.status === "pending_review" ? "pause" : "activate");
    setToggling(c.id);
    try {
      const { data, error } = await supabase.functions.invoke("facebook-toggle-campaign", {
        body: { campaign_id: c.id, action },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const metaWarn = (data as any)?.meta_error;
      if (metaWarn || (data as any)?.ok === false) {
        // Backend agora NÃO altera o DB se a Meta falhar — mantém status local.
        toast({
          title: action === "pause" ? "Não pausou na Meta" : "Não ativou na Meta",
          description: metaWarn || (data as any)?.error || "Status local preservado.",
          variant: "destructive",
        });
        return;
      }
      const newStatus = (data as any)?.status || (action === "pause" ? "paused" : "active");
      setItems((prev) => prev.map((x) => x.id === c.id ? {
        ...x,
        status: newStatus,
        rejection_reason: action === "activate"
          ? null
          : (action === "pause"
            ? "MANUAL_PAUSE: Pausada pelo consultor — só reativa com clique"
            : x.rejection_reason),
      } : x));
      toast({
        title: action === "pause"
          ? "Campanha pausada"
          : newStatus === "active"
            ? "Campanha ativa"
            : newStatus === "rejected"
              ? "Meta sinalizou uma pendência"
              : "Ativação enviada à Meta",
        description: action === "pause"
          ? "Pausa sincronizada com a Meta. Use Play para voltar."
          : newStatus === "active"
            ? "A Meta confirmou a campanha como ativa."
            : "A campanha está em análise ou processamento. Atualize o status em alguns minutos.",
      });
    } catch (e: any) {
      toast({ title: "Falha ao alterar status", description: e?.message || "Erro", variant: "destructive" });
    } finally {
      setToggling(null);
    }
  }

  async function handleStop(c: Campaign) {
    setToggling(c.id);
    try {
      const { data, error } = await supabase.functions.invoke("facebook-toggle-campaign", {
        body: { campaign_id: c.id, action: "stop" },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const metaWarn = (data as any)?.meta_error;
      if (metaWarn || (data as any)?.ok === false) {
        toast({
          title: "Não cancelou na Meta",
          description: metaWarn || (data as any)?.error || "Status local preservado.",
          variant: "destructive",
        });
        return;
      }
      const endedAt = (data as any)?.ended_at || new Date().toISOString();
      setItems((prev) => prev.map((x) => x.id === c.id ? {
        ...x,
        status: "completed",
        rejection_reason: "MANUAL_STOP: Encerrada pelo consultor — só reativa com Estender",
        ended_at: x.ended_at && new Date(x.ended_at).getTime() <= Date.now() ? x.ended_at : endedAt,
      } : x));
      toast({
        title: "Anúncio cancelado",
        description: "Parceiros avisados. Leads seguem sendo trabalhados. Para voltar, use Estender.",
      });
    } catch (e: any) {
      toast({ title: "Falha ao cancelar anúncio", description: e?.message || "Erro", variant: "destructive" });
    } finally {
      setToggling(null);
      setConfirmStop(null);
    }
  }

  async function handleDelete(c: Campaign) {
    setDeleting(c.id);
    try {
      const { data, error } = await supabase.functions.invoke("facebook-delete-campaign", {
        body: { campaign_id: c.id },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      if ((data as any)?.meta_deleted === false) {
        toast({
          title: "Não excluiu na Meta",
          description: (data as any)?.meta_error || "Campanha mantida no sistema para não virar órfã.",
          variant: "destructive",
        });
        return;
      }
      setItems((prev) => prev.filter((x) => x.id !== c.id));
      toast({
        title: "Campanha apagada",
        description: "Removida do Meta e do sistema.",
      });
    } catch (e: any) {
      toast({ title: "Falha ao apagar", description: e?.message || "Erro desconhecido", variant: "destructive" });
    } finally {
      setDeleting(null);
      setConfirmDelete(null);
    }
  }

  if (loading) return <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  if (items.length === 0) return <div className="text-center py-10 text-muted-foreground text-sm">Nenhuma campanha ainda. Clique em "Nova campanha" pra começar.</div>;

  return (
    <div className="grid gap-3">
      {items.map(c => {
        const m = metrics[c.id] || { impressions: 0, clicks: 0, spend_cents: 0, meta_lead_actions: 0, messaging_conversations_started: 0, cost_per_lead_cents: 0 };
        const waCount = waLeads[c.id] || 0;
        const today = todayByCamp[c.id] || EMPTY_DAY;
        const yesterday = yesterdayByCamp[c.id] || EMPTY_DAY;
        const hasDayActivity = today.spend_cents > 0 || yesterday.spend_cents > 0
          || today.impressions > 0 || yesterday.impressions > 0;
        return (
          <Card key={c.id} className="p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <CreativeThumb creative={creatives[c.id]} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="font-bold text-foreground truncate">{c.name}</h4>
                  <Badge className={STATUS_COLOR[c.status] || "bg-secondary"}>{STATUS_LABEL[c.status] || c.status}</Badge>
                  {(() => {
                    const h = healthOf(m);
                    const cls = h.level === "green" ? "bg-primary/20 text-primary" : h.level === "yellow" ? "bg-warning/20 text-warning" : h.level === "red" ? "bg-destructive/20 text-destructive" : "bg-secondary text-muted-foreground";
                    const Icon = h.level === "red" ? AlertTriangle : Heart;
                    return <Badge className={`${cls} gap-1`}><Icon className="w-3 h-3" />{h.label}</Badge>;
                  })()}
                </div>
                <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5 flex-wrap">
                  {(() => {
                    const geo = formatCampaignGeo(c.cities);
                    return (
                      <>
                        <MapPin className="w-3 h-3 shrink-0" />
                        <span className="font-medium text-foreground/80">
                          {geo.mode === "radius" ? "Raio" : geo.mode === "city" ? "Cidade" : "Local"}:
                        </span>
                        <span>{geo.summary}</span>
                        {typeof c.age_min === "number" && typeof c.age_max === "number" && (
                          <span
                            className="rounded bg-secondary/70 px-1.5 py-0.5 text-[10px] text-foreground"
                            title="Hard Advantage+ na Meta (sempre 25–65 com público automático)"
                          >
                            Hard {c.age_min}–{c.age_max}
                          </span>
                        )}
                        {typeof c.age_min_preferred === "number" && (
                          <span
                            className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary"
                            title="Preferência enviada via age_range (sugestão Meta)"
                          >
                            Pref. {c.age_min_preferred}+
                          </span>
                        )}
                        <span className="rounded bg-secondary/70 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {c.duration_days && c.duration_days > 0 ? `${c.duration_days} dias` : "Contínuo"}
                        </span>
                      </>
                    );
                  })()}
                </div>
                {(() => {
                  const geo = formatCampaignGeo(c.cities);
                  if (geo.lines.length <= 1) return null;
                  return (
                    <div className="text-[10px] text-muted-foreground mt-0.5 pl-4">
                      {geo.lines.join(" · ")}
                    </div>
                  );
                })()}
                {(() => {
                  const startMs = new Date(c.started_at || c.created_at).getTime();
                  const days = Math.max(1, Math.floor((Date.now() - startMs) / 86400_000));
                  return (
                    <div className="mt-1.5 flex items-center gap-2 text-xs flex-wrap">
                      <span className="rounded-md bg-secondary/60 px-2 py-0.5 text-foreground font-medium" title="Orçamento diário atual, sincronizado da Meta">
                        R$ {(c.daily_budget_cents / 100).toFixed(2)}/dia
                      </span>
                      {c.brain_scale_enabled && (
                        <span
                          className="rounded-md bg-primary/15 px-2 py-0.5 text-primary font-medium"
                          title="Cérebro de orçamento ligado nesta campanha"
                        >
                          Cérebro +{c.brain_scale_step_pct ?? 15}%
                        </span>
                      )}
                      <span className="rounded-md bg-secondary/60 px-2 py-0.5 text-muted-foreground" title="Dias desde o início da campanha">
                        Rodando há {days} {days === 1 ? "dia" : "dias"}
                      </span>
                      {m.spend_cents > 0 && (
                        <span className="rounded-md bg-primary/10 text-primary px-2 py-0.5 font-semibold" title="Total gasto no período (soma real da Meta)">
                          Total gasto: R$ {(m.spend_cents / 100).toFixed(2)}
                        </span>
                      )}
                    </div>
                  );
                })()}
                {c.rejection_reason && !isManualStopReason(c.rejection_reason) && c.status !== "completed" && (() => {
                  const exp = explainRejection(c.rejection_reason);
                  const isSession = exp?.kind === "session";
                  return (
                    <div className="mt-2 rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-xs space-y-1.5">
                      <div className="font-bold text-destructive flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" />{exp?.title || "Erro"}</div>
                      <div className="text-muted-foreground">{exp?.suggestion}</div>
                      {isSession ? (
                        <Button
                          size="sm"
                          onClick={async () => {
                            try {
                              // Campanhas usam o token da PLATAFORMA. Super admin reconecta plataforma;
                              // consultor comum reconecta sua própria conta (fallback).
                              const res = await startFacebookOAuth(isSuperAdmin ? { scope: "platform", mode: "switch" } : { mode: "switch" });
                              window.location.href = res.url;
                            } catch (e: any) {
                              toast({ title: "Falha ao iniciar reconexão", description: e?.message || "Erro", variant: "destructive" });
                            }
                          }}
                          className="h-7 text-xs gap-1 bg-[#1877F2] hover:bg-[#1877F2]/90 text-white"
                        >
                          <Facebook className="w-3 h-3" />
                          {isSuperAdmin ? "Reconectar Facebook (Plataforma)" : "Reconectar Facebook"}
                        </Button>
                      ) : (c.status === "pending_review" || c.status === "paused") && (
                        <Button size="sm" variant="outline" onClick={() => tryReactivate(c)} disabled={reactivating === c.id} className="h-7 text-xs gap-1">
                          {reactivating === c.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                          Tentar reativar
                        </Button>
                      )}
                    </div>
                  );
                })()}
                {(c.status === "completed" || (!c.rejection_reason && c.ended_at && new Date(c.ended_at).getTime() < Date.now())) && c.fb_campaign_id && (
                  <div className="mt-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2.5 text-xs space-y-1.5">
                    <div className="font-bold text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5">
                      <CalendarClock className="w-3.5 h-3.5" />
                      {c.status === "completed"
                        ? "Campanha concluída"
                        : `Campanha encerrou em ${new Date(c.ended_at!).toLocaleDateString("pt-BR")}`}
                    </div>
                    <div className="text-muted-foreground">
                      Leads que chegaram seguem sendo trabalhados. Para voltar a anunciar, estenda o prazo.
                    </div>
                    <Button size="sm" onClick={() => setExtending(c)} className="h-7 text-xs gap-1">
                      <CalendarClock className="w-3 h-3" /> Estender campanha
                    </Button>
                  </div>
                )}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {/* Pause: Ativa ou Em revisão. Play: só Pausada. Encerrar: Ativa/Pausada/Em revisão/Rejeitada. */}
                {c.fb_campaign_id && (c.status === "active" || c.status === "pending_review") && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={() => void handleToggle(c, "pause")}
                    disabled={toggling === c.id}
                    aria-label="Pausar anúncio"
                    title="Pausar anúncio (pode voltar com Play)"
                  >
                    {toggling === c.id
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : <Pause className="w-4 h-4 text-warning" />}
                  </Button>
                )}
                {c.fb_campaign_id && c.status === "paused" && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={() => void handleToggle(c, "activate")}
                    disabled={toggling === c.id}
                    aria-label="Ativar anúncio"
                    title="Ativar anúncio (Play)"
                  >
                    {toggling === c.id
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : <Play className="w-4 h-4 text-primary" />}
                  </Button>
                )}
                {c.fb_campaign_id && (c.status === "active" || c.status === "paused" || c.status === "pending_review" || c.status === "rejected") && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={() => setConfirmStop(c)}
                    disabled={toggling === c.id}
                    aria-label="Cancelar anúncio"
                    title="Cancelar anúncio (encerra de vez — não apaga o histórico)"
                  >
                    <Square className="w-3.5 h-3.5 fill-current text-destructive" />
                  </Button>
                )}
                {c.fb_campaign_id && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={() => setExtending(c)}
                    aria-label="Estender prazo ou alterar orçamento"
                    title="Estender prazo / mudar orçamento"
                  >
                    <CalendarClock className="w-4 h-4 text-primary" />
                  </Button>
                )}
                {c.fb_campaign_id && isBrainScaleEligible(c) && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={() => setBrainScaleCampaign(c)}
                    aria-label="Cérebro de orçamento"
                    title={c.brain_scale_enabled ? `Cérebro ligado (+${c.brain_scale_step_pct ?? 15}%)` : "Ativar Cérebro de orçamento"}
                  >
                    <Brain className={`w-4 h-4 ${c.brain_scale_enabled ? "text-primary" : "text-muted-foreground"}`} />
                  </Button>
                )}
                {rodizioSet.has(c.id) && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={() => setRodizioCampaign(c)}
                    aria-label="Ver leads do rodízio"
                    title="Ver leads distribuídos pelo rodízio"
                  >
                    <Users2 className="w-4 h-4 text-primary" />
                  </Button>
                )}
                {c.fb_campaign_id && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={() => setEditing(c)}
                    aria-label="Editar rodízio e segmentação"
                    title="Editar rodízio / cidades / raio"
                  >
                    <Settings2 className="w-4 h-4 text-primary" />
                  </Button>
                )}

                {isSuperAdmin && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-destructive hover:bg-destructive/10"
                    onClick={() => setConfirmDelete(c)}
                    disabled={deleting === c.id}
                    aria-label="Excluir campanha"
                    title="Excluir campanha"
                  >
                    {deleting === c.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  </Button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 text-xs">
              <Stat icon={<TrendingUp className="w-3.5 h-3.5" />} label="Impressões" value={m.impressions.toLocaleString("pt-BR")} />
              <Stat icon={<Users className="w-3.5 h-3.5" />} label="Cliques" value={m.clicks.toLocaleString("pt-BR")} />
              <Stat icon={<MessageCircle className="w-3.5 h-3.5" />} label="Conversas" value={String(m.messaging_conversations_started)} />
              <Stat
                icon={<Users className="w-3.5 h-3.5" />}
                label="Leads reportados pela Meta"
                value={String(m.meta_lead_actions)}
                tooltip="Eventos de lead informados diretamente pela Meta. Não inclui automaticamente todas as conversas nem todos os contatos do CRM."
              />
              <Stat
                icon={<MessageCircle className="w-3.5 h-3.5 text-primary" />}
                label="Contatos atribuídos no CRM"
                value={String(waCount)}
                highlight={waCount > 0}
                tooltip="Contatos identificados no CRM e ligados a esta campanha por ID do anúncio ou identificador CTWA."
              />
              <Stat
                icon={<DollarSign className="w-3.5 h-3.5" />}
                label="Gasto"
                value={`R$ ${(m.spend_cents / 100).toFixed(2)}`}
                highlight
                tooltip="Total gasto no período (desde o início da campanha ou últimos 30 dias — o que for mais curto). Vem direto da Meta."
              />
              <Stat
                icon={<DollarSign className="w-3.5 h-3.5" />}
                label="Custo/conversa"
                value={
                  (m.messaging_conversations_started > 0 || m.meta_lead_actions > 0)
                    ? `R$ ${(m.cost_per_lead_cents / 100).toFixed(2)}`
                    : "—"
                }
                tooltip="Gasto ÷ conversas iniciadas na Meta (CTWA). Se não houver conversa, usa leads de formulário Meta."
              />
            </div>
            {hasDayActivity && (
              <div className="rounded-lg border border-border/60 bg-muted/20 overflow-x-auto max-w-full text-[11px]">
                <div className="grid grid-cols-[4.5rem_repeat(5,minmax(3.5rem,1fr))] gap-px bg-border/40 min-w-[28rem]">
                  <div className="bg-card px-2 py-1.5 font-medium text-muted-foreground" />
                  <div className="bg-card px-2 py-1.5 font-medium text-muted-foreground text-right">Gasto</div>
                  <div className="bg-card px-2 py-1.5 font-medium text-muted-foreground text-right">Impr.</div>
                  <div className="bg-card px-2 py-1.5 font-medium text-muted-foreground text-right">Cliques</div>
                  <div className="bg-card px-2 py-1.5 font-medium text-muted-foreground text-right">Conversas</div>
                  <div className="bg-card px-2 py-1.5 font-medium text-muted-foreground text-right">Leads Meta</div>
                  {([
                    ["Hoje", today],
                    ["Ontem", yesterday],
                  ] as const).map(([label, day]) => (
                    <div key={label} className="contents">
                      <div className="bg-card px-2 py-1.5 font-semibold text-foreground">{label}</div>
                      <div className={`bg-card px-2 py-1.5 text-right tabular-nums ${day.spend_cents > 0 ? "text-primary font-semibold" : "text-muted-foreground"}`}>
                        R$ {(day.spend_cents / 100).toFixed(2)}
                      </div>
                      <div className="bg-card px-2 py-1.5 text-right tabular-nums text-foreground">
                        {day.impressions.toLocaleString("pt-BR")}
                      </div>
                      <div className={`bg-card px-2 py-1.5 text-right tabular-nums ${day.clicks > 0 ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                        {day.clicks.toLocaleString("pt-BR")}
                      </div>
                      <div className="bg-card px-2 py-1.5 text-right tabular-nums text-foreground">
                        {day.messaging_conversations_started}
                      </div>
                      <div className="bg-card px-2 py-1.5 text-right tabular-nums text-foreground">
                        {day.meta_lead_actions}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="px-2 py-1 text-[10px] text-muted-foreground border-t border-border/40">
                  Acima: totais do período · Aqui: custo e engajamento de hoje e ontem (Meta)
                </div>
              </div>
            )}
            <CampaignHealthCheck campaignId={c.id} fbCampaignId={c.fb_campaign_id} whatsappNumber={waNumber} />
          </Card>
        );
      })}
      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar campanha?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete?.name}
              <br />
              Isso vai remover a campanha do Meta (Facebook Ads) e do sistema. Ação irreversível.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDelete && handleDelete(confirmDelete)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Apagar definitivamente
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!confirmStop} onOpenChange={(o) => !o && setConfirmStop(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar anúncio?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">{confirmStop?.name}</p>
                <p>
                  Encerra de vez (status Concluída): para de gastar na Meta, avisa os parceiros do rodízio (“Missão cumprida”) e mantém o histórico e os leads.
                </p>
                <p>
                  Isto <strong className="font-medium text-foreground">não é Excluir</strong> — não apaga a campanha do sistema. Para voltar a anunciar depois, use Estender (o Play não reativa).
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmStop && void handleStop(confirmStop)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Cancelar anúncio agora
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ExtendCampaignDialog
        open={!!extending}
        onOpenChange={(o) => !o && setExtending(null)}
        campaign={extending}
        onUpdated={(patch) => {
          setItems((prev) => prev.map((x) => x.id === patch.id ? {
            ...x,
            status: patch.status ?? x.status,
            daily_budget_cents: patch.daily_budget_cents ?? x.daily_budget_cents,
            ended_at: patch.ended_at ?? x.ended_at,
          } : x));
        }}
      />

      <CampaignBrainScaleDialog
        open={!!brainScaleCampaign}
        onOpenChange={(o) => { if (!o) setBrainScaleCampaign(null); }}
        campaign={brainScaleCampaign}
        onUpdated={(patch) => {
          setItems((prev) => prev.map((x) => x.id === patch.id ? { ...x, ...patch } : x));
        }}
      />

      <EditCampaignDialog
        open={!!editing}
        onClose={() => setEditing(null)}
        campaign={editing}
        onSaved={() => setRefreshTick((t) => t + 1)}
      />

      <CampaignRodizioLeadsDialog
        open={!!rodizioCampaign}
        onOpenChange={(o) => { if (!o) setRodizioCampaign(null); }}
        campaignId={rodizioCampaign?.id ?? null}
        campaignName={rodizioCampaign?.name ?? ""}
      />
    </div>
  );
}


function Stat({ icon, label, value, highlight, tooltip }: { icon: React.ReactNode; label: string; value: string; highlight?: boolean; tooltip?: string }) {
  return (
    <div className={`rounded-lg p-2 ${highlight ? "bg-primary/10 border border-primary/20" : "bg-secondary/40"}`} title={tooltip}>
      <div className="flex items-center gap-1 text-muted-foreground">{icon}{label}</div>
      <div className={`font-bold mt-0.5 ${highlight ? "text-primary" : "text-foreground"}`}>{value}</div>
    </div>
  );
}

function CreativeThumb({ creative }: { creative?: Creative }) {
  const c = creative || { kind: "none", url: null };
  if (c.kind === "none" || !c.url) {
    return (
      <div className="w-16 h-16 shrink-0 rounded-lg border border-dashed border-border bg-secondary/40 flex flex-col items-center justify-center text-[9px] text-muted-foreground gap-0.5">
        <ImageIcon className="w-4 h-4" />
        Sem mídia
      </div>
    );
  }
  return (
    <div className="relative w-16 h-16 shrink-0 rounded-lg overflow-hidden border border-border bg-black/40">
      <img src={c.url} alt="" className="w-full h-full object-cover" loading="lazy" />
      {c.kind === "video" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/35">
          <PlayCircle className="w-7 h-7 text-white drop-shadow" />
        </div>
      )}
    </div>
  );
}

export default CampaignsList;
