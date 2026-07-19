import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
  Loader2, ArrowLeft, Save, Zap, ZapOff, Clock, Activity, AlertTriangle,
  Play, Pause, RefreshCw, FileText, ChevronDown, ChevronRight, Info, Megaphone,
} from "lucide-react";
import { toast } from "sonner";
import {
  CADENCE_CALENDAR,
  CADENCE_GROUP_LABEL,
  CHANNEL_LABEL,
  EDITABLE_CALENDAR_STAGES,
  type CalendarStageKey,
  type CadenceChannelUi,
} from "@/lib/cadenceCalendarMap";
import { getTemplate } from "@/lib/multichannelCadenceTexts";
import { labelCadenceStage } from "@/lib/cadenceStageLabels";
import { CadenceMissingAlert } from "@/components/admin/CadenceMissingAlert";

/**
 * Painel Admin do Motor "Zero Lead Perdido" — calendário Dia 1→10
 * (igual Multicanal Grupo B). Textos editam no Multicanal; aqui: atraso/janela/clips.
 */

const STAGES = EDITABLE_CALENDAR_STAGES;
type StageKey = CalendarStageKey;

const VOICE_SOFIA = "EJV7H2baGt5ab95tOoSG";

interface VoiceClipOpt {
  id: string;
  name: string | null;
  velip_audio_id: string | null;
  is_call_body: boolean | null;
  voice_id: string | null;
}

interface StageRow {
  id?: string;
  stage: StageKey;
  enabled: boolean;
  delay_hours: number;
  message_text: string;
  media_url: string | null;
  media_type: string | null;
  velip_audio_id: string | null;
  voice_audio_clip_id: string | null;
  personalize_name: boolean;
  max_per_lead: number;
  window_start_hour: number | null;
  window_end_hour: number | null;
  window_days: number[] | null;
}

interface Window {
  weekday_start: number;
  weekday_end: number;
  saturday_start: number;
  saturday_end: number;
  sunday_enabled: boolean;
  tz: string;
}

const DEFAULT_WINDOW: Window = {
  weekday_start: 8, weekday_end: 20,
  saturday_start: 8, saturday_end: 14,
  sunday_enabled: false, tz: "America/Sao_Paulo",
};

function channelTone(ch: CadenceChannelUi): string {
  if (ch === "voice") return "bg-blue-500/10 text-blue-700 dark:text-blue-300";
  if (ch === "sms") return "bg-amber-500/10 text-amber-700 dark:text-amber-300";
  if (ch === "meta") return "bg-violet-500/10 text-violet-700 dark:text-violet-300";
  return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
}

export default function AdminMotorCadencia() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [window, setWindow] = useState<Window>(DEFAULT_WINDOW);
  const [stages, setStages] = useState<Record<string, StageRow>>({});
  const [stats, setStats] = useState<{ stage: string; count: number }[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [dueLeads, setDueLeads] = useState<any[]>([]);
  const [slaCount, setSlaCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [ticking, setTicking] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [metrics, setMetrics] = useState<Array<{ stage: string; channel: string; sent: number; failed: number; unique_leads: number; responded_leads: number }>>([]);
  const [clips, setClips] = useState<VoiceClipOpt[]>([]);
  const [techMode, setTechMode] = useState(false);
  const [openDays, setOpenDays] = useState<Record<string, boolean>>({
    d1: true, d2: true, d4: true, d6: true, d7: true, d10: true, c: false,
  });
  const [retargetAdsOff, setRetargetAdsOff] = useState(true);
  const [retargetSyncOff, setRetargetSyncOff] = useState(true);
  const [toggleMap, setToggleMap] = useState<Record<string, boolean>>({});
  /** Confirmação na UI (window.confirm falha em alguns browsers / webviews). */
  const [pendingToggle, setPendingToggle] = useState<null | { kind: "engine" } | { kind: "recall"; key: string }>(null);
  const [toggling, setToggling] = useState(false);

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15000);
    const t2 = setInterval(() => void loadDue(), 30000);
    return () => { clearInterval(t); clearInterval(t2); };
  }, []);

  async function load() {
    setLoading(true);
    const [
      { data: settings },
      { data: cfgs },
      { data: leadStats },
      { data: recentLogs },
      { data: clipRows },
      { data: toggles },
    ] = await Promise.all([
      supabase.from("app_settings").select("cadence_engine_enabled, cadence_window").eq("id", "global").maybeSingle(),
      supabase.from("cadence_stage_config").select("*").is("consultant_id", null).in("stage", STAGES as unknown as string[]),
      supabase.from("lead_cadence_state").select("stage").limit(5000),
      supabase.from("cadence_action_log").select("stage, channel, status, detail, created_at").order("created_at", { ascending: false }).limit(20),
      supabase
        .from("voice_audio_clips")
        .select("id, name, velip_audio_id, is_call_body, voice_id")
        .order("updated_at", { ascending: false })
        .limit(80),
      supabase
        .from("automation_toggles")
        .select("key, enabled")
        .in("key", [
          "cadence_retarget_ads_15d",
          "facebook_retarget_sync",
          "cadence_recall_60d",
          "cadence_recall_90d",
          "cadence_recall_5m",
          "cadence_recall_8m",
          "cadence_recall_12m",
          "cadence_recall_yearly",
        ]),
    ]);

    setEnabled(!!settings?.cadence_engine_enabled);
    setWindow({ ...DEFAULT_WINDOW, ...((settings?.cadence_window as any) || {}) });

    const tmap = new Map((toggles ?? []).map((t: { key: string; enabled: boolean }) => [t.key, !!t.enabled]));
    setRetargetAdsOff(tmap.get("cadence_retarget_ads_15d") !== true);
    setRetargetSyncOff(tmap.get("facebook_retarget_sync") !== true);
    const tm: Record<string, boolean> = {};
    for (const [k, v] of tmap) tm[k] = v;
    setToggleMap(tm);

    const list = ((clipRows as VoiceClipOpt[]) || []).slice().sort((a, b) => {
      const score = (c: VoiceClipOpt) =>
        (c.voice_id === VOICE_SOFIA ? 4 : 0) +
        (c.is_call_body ? 2 : 0) +
        (c.velip_audio_id ? 1 : 0);
      return score(b) - score(a);
    });
    setClips(list);

    const map = {} as Record<string, StageRow>;
    for (const s of STAGES) {
      const found = (cfgs || []).find((c: any) => c.stage === s);
      map[s] = found
        ? {
            ...found, stage: s,
            message_text: found.message_text || "",
            velip_audio_id: found.velip_audio_id ?? null,
            voice_audio_clip_id: (found as any).voice_audio_clip_id ?? null,
            personalize_name: !!(found as any).personalize_name,
            max_per_lead: (found as any).max_per_lead ?? 0,
            window_start_hour: (found as any).window_start_hour ?? null,
            window_end_hour: (found as any).window_end_hour ?? null,
            window_days: (found as any).window_days ?? null,
          }
        : {
            stage: s, enabled: true, delay_hours: 24, message_text: "",
            media_url: null, media_type: "text", velip_audio_id: null,
            voice_audio_clip_id: null, personalize_name: false,
            max_per_lead: 0, window_start_hour: null, window_end_hour: null, window_days: null,
          };
    }

    setStages(map);

    const grouped: Record<string, number> = {};
    for (const r of leadStats || []) grouped[r.stage] = (grouped[r.stage] || 0) + 1;
    setStats(Object.entries(grouped).map(([stage, count]) => ({ stage, count })).sort((a, b) => b.count - a.count));

    setLogs(recentLogs || []);
    await loadDue();
    await loadMetrics();
    setLoading(false);
  }

  async function loadMetrics() {
    const { data } = await (supabase as any)
      .from("cadence_metrics_daily")
      .select("stage, channel, sent, failed, unique_leads, responded_leads")
      .order("day", { ascending: false })
      .limit(200);
    const agg = new Map<string, any>();
    for (const r of (data || [])) {
      const k = `${r.stage}|${r.channel}`;
      const prev = agg.get(k) || { stage: r.stage, channel: r.channel, sent: 0, failed: 0, unique_leads: 0, responded_leads: 0 };
      prev.sent += r.sent || 0; prev.failed += r.failed || 0;
      prev.unique_leads += r.unique_leads || 0; prev.responded_leads += r.responded_leads || 0;
      agg.set(k, prev);
    }
    setMetrics(Array.from(agg.values()).sort((a, b) => b.sent - a.sent));
  }

  async function loadDue() {
    const soon = new Date(Date.now() + 60 * 60_000).toISOString();
    // Sem embed: lead_cadence_state não tem FK → PostgREST retorna 400 em customers:/consultants:
    const { data, error } = await supabase
      .from("lead_cadence_state")
      .select("id, stage, next_action_at, customer_id, consultant_id, paused_until")
      .lte("next_action_at", soon)
      .not("stage", "in", "(WON,PAUSED,RETARGET_META)")
      .order("next_action_at", { ascending: true })
      .limit(50);
    if (error) {
      console.warn("[motor] loadDue:", error.message);
      setDueLeads([]);
      setSlaCount(0);
      return;
    }
    const rows = data || [];
    const custIds = [...new Set(rows.map((r) => r.customer_id).filter(Boolean))];
    const consIds = [...new Set(rows.map((r) => r.consultant_id).filter(Boolean))] as string[];
    const [custRes, consRes] = await Promise.all([
      custIds.length
        ? supabase.from("customers").select("id, name, phone_whatsapp").in("id", custIds)
        : Promise.resolve({ data: [] as { id: string; name: string | null; phone_whatsapp: string | null }[] }),
      consIds.length
        ? supabase.from("consultants").select("id, name").in("id", consIds)
        : Promise.resolve({ data: [] as { id: string; name: string | null }[] }),
    ]);
    const custMap = new Map((custRes.data || []).map((c) => [c.id, c]));
    const consMap = new Map((consRes.data || []).map((c) => [c.id, c]));
    const list = rows.map((r) => ({
      ...r,
      customers: custMap.get(r.customer_id) || null,
      consultants: r.consultant_id ? consMap.get(r.consultant_id) || null : null,
    }));
    setDueLeads(list);
    const nowMs = Date.now();
    setSlaCount(list.filter((l) => l.next_action_at && new Date(l.next_action_at).getTime() < nowMs - 30 * 60_000).length);
  }

  async function forceNow(id: string) {
    const { error } = await supabase.from("lead_cadence_state").update({ next_action_at: new Date().toISOString(), paused_until: null, paused_reason: null }).eq("id", id);
    if (error) { toast.error("Falha ao forçar"); return; }
    toast.success("Próxima ação agendada agora");
    await loadDue();
  }

  async function pause24h(id: string) {
    const until = new Date(Date.now() + 24 * 3600_000).toISOString();
    const { error } = await supabase.from("lead_cadence_state").update({ paused_until: until, paused_reason: "manual_admin", next_action_at: until }).eq("id", id);
    if (error) { toast.error("Falha ao pausar"); return; }
    toast.success("Pausado por 24h");
    await loadDue();
  }

  async function runTickNow() {
    setTicking(true);
    try {
      const { error } = await supabase.functions.invoke("cadence-tick", { body: { manual: true } });
      if (error) throw error;
      toast.success("Tick executado");
      await loadDue();
    } catch (e: any) {
      toast.error("Falha no tick: " + (e?.message || e));
    } finally {
      setTicking(false);
    }
  }

  function requestToggleEngine(v: boolean) {
    if (v) {
      setPendingToggle({ kind: "engine" });
      return;
    }
    void applyEngineToggle(false);
  }

  function requestToggleRecall(key: string, v: boolean) {
    if (v) {
      setPendingToggle({ kind: "recall", key });
      return;
    }
    void applyRecallToggle(key, false);
  }

  async function applyEngineToggle(v: boolean) {
    setToggling(true);
    const prev = enabled;
    setEnabled(v);
    const now = new Date().toISOString();
    const { data: sRow, error: e1 } = await supabase
      .from("app_settings")
      .update({ cadence_engine_enabled: v })
      .eq("id", "global")
      .select("id")
      .maybeSingle();
    // Gate duplo: cadence-tick exige automation_toggles.cadence_engine E app_settings.
    const { data: tRow, error: e2 } = await supabase
      .from("automation_toggles")
      .update({ enabled: v, updated_at: now })
      .eq("key", "cadence_engine")
      .select("key")
      .maybeSingle();
    setToggling(false);
    setPendingToggle(null);
    if (e1 || e2 || !sRow || !tRow) {
      toast.error(
        e1?.message || e2?.message ||
          "Sem permissão para ligar o motor (precisa super_admin em app_settings).",
      );
      setEnabled(prev);
      return;
    }
    toast.success(v ? "Motor ligado (app_settings + automation_toggles)" : "Motor pausado");
  }

  async function applyRecallToggle(key: string, v: boolean) {
    setToggling(true);
    const { data, error } = await supabase
      .from("automation_toggles")
      .update({ enabled: v, updated_at: new Date().toISOString() })
      .eq("key", key)
      .select("key")
      .maybeSingle();
    setToggling(false);
    setPendingToggle(null);
    if (error || !data) {
      toast.error(error?.message || `Sem permissão para alterar ${key} (role admin).`);
      return;
    }
    setToggleMap((m) => ({ ...m, [key]: v }));
    toast.success(v ? `${key} ligado` : `${key} desligado`);
  }

  async function saveAll() {
    setSaving(true);
    try {
      const { error: e1 } = await supabase.from("app_settings").update({ cadence_window: window as any }).eq("id", "global");
      if (e1) throw e1;

      for (const s of STAGES) {
        const row = stages[s];
        if (!row) continue;
        const payload = {
          consultant_id: null,
          stage: s,
          enabled: row.enabled,
          delay_hours: row.delay_hours,
          message_text: row.message_text,
          media_url: row.media_url,
          media_type: row.media_type || "text",
          velip_audio_id: row.velip_audio_id,
          voice_audio_clip_id: row.voice_audio_clip_id,
          personalize_name: !!row.personalize_name,
          max_per_lead: row.max_per_lead || 0,
          window_start_hour: row.window_start_hour,
          window_end_hour: row.window_end_hour,
          window_days: row.window_days,
        } as any;

        if (row.id) {
          const { error } = await supabase.from("cadence_stage_config").update(payload).eq("id", row.id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from("cadence_stage_config").insert(payload);
          if (error) throw error;
        }
      }
      toast.success("Configuração salva");
      await load();
    } catch (e: any) {
      toast.error("Erro ao salvar: " + (e?.message || e));
    } finally {
      setSaving(false);
    }
  }

  const patchStage = (s: string, patch: Partial<StageRow>) => {
    const row = stages[s];
    if (!row) return;
    setStages({ ...stages, [s]: { ...row, ...patch } });
  };

  const previewBody = useMemo(() => {
    const m = new Map<string, string>();
    for (const day of CADENCE_CALENDAR) {
      for (const step of day.steps) {
        if (!step.templateKey) continue;
        const tpl = getTemplate(step.templateKey);
        if (tpl?.body) m.set(step.stage, tpl.body);
      }
    }
    return m;
  }, []);

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-card/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/admin")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-semibold flex items-center gap-2">
              {enabled ? <Zap className="h-4 w-4 text-green-500" /> : <ZapOff className="h-4 w-4 text-muted-foreground" />}
              Motor (tela técnica)
            </h1>
            <p className="text-xs text-muted-foreground truncate">
              Prefira a Central → aba{" "}
              <Link to="/admin?tab=agendamentos&hubTab=grupo-b" className="underline font-medium text-foreground">
                Leads frios
              </Link>{" "}
              (3 passos simples).
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Label className="text-xs">{enabled ? "Ligado" : "Desligado"}</Label>
            <Switch checked={enabled} onCheckedChange={requestToggleEngine} disabled={toggling} />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 pt-3">
        <CadenceMissingAlert />
      </div>

      <AlertDialog open={!!pendingToggle} onOpenChange={(o) => { if (!o && !toggling) setPendingToggle(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingToggle?.kind === "engine"
                ? "Ligar o motor de cadência?"
                : `Ligar ${pendingToggle?.kind === "recall" ? pendingToggle.key : ""}?`}
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              {pendingToggle?.kind === "engine" ? (
                <>
                  <span className="block">Isso pode disparar envios automáticos se os estágios/toggles estiverem ON.</span>
                  <span className="block">• Grupo B: onda fria (D+1→D10)</span>
                  <span className="block">• Grupo C: só com toggle de cada recall ON</span>
                  <span className="block font-medium text-foreground">Textos já estão no banco — não precisa ligar só para conferir texto.</span>
                </>
              ) : (
                <span className="block">
                  Leads neste marco podem receber WhatsApp/SMS/ligação automática.
                  Deixe OFF até validar.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={toggling}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={toggling}
              onClick={(e) => {
                e.preventDefault();
                if (pendingToggle?.kind === "engine") void applyEngineToggle(true);
                else if (pendingToggle?.kind === "recall") void applyRecallToggle(pendingToggle.key, true);
              }}
            >
              {toggling ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Confirmar e ligar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <main className="mx-auto max-w-6xl px-4 py-6 space-y-6">
        <Card className="p-4 border-primary/30 bg-primary/5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1 min-w-0">
              <div className="font-semibold text-sm">Quer ligar o sistema sem complicação?</div>
              <p className="text-xs text-muted-foreground">
                Use a aba <strong className="text-foreground">Leads frios</strong> na Central de Agendamentos — 3 passos em português claro.
              </p>
            </div>
            <Button asChild size="sm">
              <Link to="/admin?tab=agendamentos&hubTab=grupo-b">Abrir Grupo B</Link>
            </Button>
          </div>
        </Card>

        {/* Fonte dos textos */}
        <Card className="p-4 border-emerald-500/30 bg-emerald-500/5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1 min-w-0">
              <div className="font-semibold text-sm flex items-center gap-2">
                <FileText className="h-4 w-4 text-emerald-600" />
                Onde editar textos
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed max-w-xl">
                <strong className="text-foreground">Primeiros dias</strong> = mensagens do lead frio.
                <strong className="text-foreground"> Longo prazo</strong> = retornos depois de semanas/meses.
                Salve no Multicanal — o sistema usa esses textos.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm" className="bg-emerald-600 hover:bg-emerald-700">
                <Link to="/admin?tab=voz&sub=textos&cadenceGroup=B">
                  <FileText className="h-3.5 w-3.5 mr-1.5" />
                  Grupo B — Reaquecimento
                </Link>
              </Button>
              <Button asChild size="sm" variant="outline" className="border-violet-500/40">
                <Link to="/admin?tab=voz&sub=textos&cadenceGroup=C">
                  <FileText className="h-3.5 w-3.5 mr-1.5" />
                  Grupo C — Longo prazo
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link to="/admin/checklist">Checklist v5</Link>
              </Button>
            </div>
          </div>
        </Card>

        {/* Meta — sem criativo */}
        <Card className="p-4 border-violet-500/30">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-violet-500/15 flex items-center justify-center shrink-0">
              <Megaphone className="h-4 w-4 text-violet-600" />
            </div>
            <div className="space-y-2 min-w-0 flex-1">
              <div className="font-semibold text-sm">Grupo C — Meta / remarketing (sem imagem neste painel)</div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Depois do Dia 10 o lead vai para <strong className="text-foreground">Custom Audience</strong>
                (telefone/e-mail em hash). <strong className="text-foreground">Não envia WhatsApp</strong> e
                <strong className="text-foreground"> não escolhe criativo/imagem aqui</strong>.
                A imagem do anúncio fica no <strong className="text-foreground">Meta Ads Manager</strong> (ou campanhas do portal).
              </p>
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant={retargetAdsOff ? "secondary" : "destructive"}>
                  cadence_retarget_ads_15d: {retargetAdsOff ? "OFF (recomendado)" : "ON"}
                </Badge>
                <Badge variant={retargetSyncOff ? "secondary" : "destructive"}>
                  facebook_retarget_sync: {retargetSyncOff ? "OFF (recomendado)" : "ON"}
                </Badge>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Deixe Meta OFF até validar a onda curta (Dia 1→10) e ter Custom Audience ativa.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link to="/admin/meta-ads">Abrir Meta Ads</Link>
                </Button>
                <Button asChild variant="ghost" size="sm">
                  <Link to="/admin?tab=agendamentos">Central de Automações</Link>
                </Button>
              </div>
            </div>
          </div>
        </Card>

        {/* KPIs */}
        <Card className="p-4">
          <h2 className="text-sm font-semibold flex items-center gap-2 mb-3">
            <Activity className="h-4 w-4" /> Leads no motor
          </h2>
          <div className="flex flex-wrap gap-2">
            {stats.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhum lead no motor ainda.</p>
            ) : (
              stats.map((s) => (
                <Badge key={s.stage} variant="outline" className="gap-1" title={s.stage}>
                  <span className="font-semibold">{s.count}</span> {labelCadenceStage(s.stage)}
                </Badge>
              ))
            )}
          </div>
        </Card>

        {/* Command Center */}
        <Card className="p-4 border-l-4" style={{ borderLeftColor: slaCount > 0 ? "hsl(var(--destructive))" : "hsl(var(--primary))" }}>
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              {slaCount > 0 ? <AlertTriangle className="h-4 w-4 text-destructive" /> : <Activity className="h-4 w-4 text-primary" />}
              Central de comando — próximas ações
              {slaCount > 0 && <Badge variant="destructive" className="ml-1">{slaCount} SLA violado</Badge>}
            </h2>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => loadDue()}>
                <RefreshCw className="h-3 w-3 mr-1" /> Atualizar
              </Button>
              <Button size="sm" onClick={runTickNow} disabled={ticking}>
                {ticking ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Play className="h-3 w-3 mr-1" />}
                Executar tick agora
              </Button>
            </div>
          </div>
          {dueLeads.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhuma ação pendente na próxima 1h.</p>
          ) : (
            <div className="space-y-1 text-xs max-h-96 overflow-auto">
              {dueLeads.map((l: any) => {
                const nextMs = l.next_action_at ? new Date(l.next_action_at).getTime() : 0;
                const diffMin = Math.round((nextMs - now) / 60000);
                const overdue = diffMin < -30;
                const due = diffMin <= 0;
                return (
                  <div key={l.id} className={`flex items-center gap-2 border-b py-2 ${overdue ? "bg-destructive/5" : ""}`}>
                    <Badge variant={overdue ? "destructive" : due ? "default" : "outline"} className="min-w-20 justify-center">
                      {overdue ? `${Math.abs(diffMin)}m atrasado` : due ? "agora" : `em ${diffMin}m`}
                    </Badge>
                    <Badge variant="secondary" title={l.stage}>{labelCadenceStage(l.stage)}</Badge>
                    <span className="flex-1 truncate">
                      <b>{l.customers?.name || "sem nome"}</b>
                      <span className="text-muted-foreground"> · {l.customers?.phone_whatsapp || "-"}</span>
                      <span className="text-muted-foreground"> · {l.consultants?.name || "-"}</span>
                    </span>
                    <Button variant="ghost" size="sm" onClick={() => forceNow(l.id)} title="Forçar próxima ação agora">
                      <Play className="h-3 w-3" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => pause24h(l.id)} title="Pausar 24h">
                      <Pause className="h-3 w-3" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* Toggles Grupo C (recalls) */}
        <Card className="p-4 border-violet-500/20">
          <h2 className="text-sm font-semibold flex items-center gap-2 mb-2">
            <Megaphone className="h-4 w-4 text-violet-600" />
            Toggles Grupo C — recalls longos
          </h2>
          <p className="text-xs text-muted-foreground mb-4">
            Cada marco precisa do toggle ON <strong>e</strong> do estágio ativo no calendário acima.
            O recall <strong>anual</strong> usa <code className="text-[10px]">cadence_recall_yearly</code> (loop após 12m).
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                ["cadence_recall_60d", "~30d após Dia 10"],
                ["cadence_recall_90d", "~90 dias"],
                ["cadence_recall_5m", "~5 meses"],
                ["cadence_recall_8m", "~8 meses"],
                ["cadence_recall_12m", "~12 meses"],
                ["cadence_recall_yearly", "Loop anual (8760h)"],
              ] as const
            ).map(([key, hint]) => (
              <div
                key={key}
                className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 bg-card"
              >
                <div className="min-w-0">
                  <div className="text-xs font-medium font-mono">{key}</div>
                  <div className="text-[10px] text-muted-foreground">{hint}</div>
                </div>
                <Switch
                  checked={!!toggleMap[key]}
                  onCheckedChange={(v) => requestToggleRecall(key, v)}
                  disabled={toggling}
                />
              </div>
            ))}
          </div>
        </Card>

        {/* Janela útil */}
        <Card className="p-4">
          <h2 className="text-sm font-semibold flex items-center gap-2 mb-3">
            <Clock className="h-4 w-4" /> Janela de disparo (horário comercial)
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <Label className="text-xs">Seg-Sex início</Label>
              <Input type="number" min={0} max={23} value={window.weekday_start} onChange={(e) => setWindow({ ...window, weekday_start: +e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Seg-Sex fim</Label>
              <Input type="number" min={0} max={23} value={window.weekday_end} onChange={(e) => setWindow({ ...window, weekday_end: +e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Sábado início</Label>
              <Input type="number" min={0} max={23} value={window.saturday_start} onChange={(e) => setWindow({ ...window, saturday_start: +e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Sábado fim</Label>
              <Input type="number" min={0} max={23} value={window.saturday_end} onChange={(e) => setWindow({ ...window, saturday_end: +e.target.value })} />
            </div>
          </div>
          <div className="flex items-center gap-2 mt-3">
            <Switch checked={window.sunday_enabled} onCheckedChange={(v) => setWindow({ ...window, sunday_enabled: v })} />
            <Label className="text-xs">Disparar aos domingos</Label>
          </div>
        </Card>

        {/* Calendário Dia 1→10 */}
        <Card className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div>
              <h2 className="text-sm font-semibold">Calendário B + C</h2>
              <p className="text-xs text-muted-foreground mt-1 max-w-xl">
                <span className="text-emerald-700 dark:text-emerald-400 font-medium">Grupo B</span> = reaquecimento (10 dias).
                <span className="text-violet-700 dark:text-violet-400 font-medium"> Grupo C</span> = Meta + recalls.
                “Disparar após X horas” = espera antes deste toque.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={techMode} onCheckedChange={setTechMode} id="tech-mode" />
              <Label htmlFor="tech-mode" className="text-xs">Modo técnico (editar texto no banco)</Label>
            </div>
          </div>

          <div className="space-y-4">
            {CADENCE_CALENDAR.map((day) => {
              const open = openDays[day.id] !== false;
              return (
                <div key={day.id} className="rounded-xl border bg-card overflow-hidden">
                  <button
                    type="button"
                    className="w-full flex items-start gap-2 px-4 py-3 text-left hover:bg-muted/40 transition"
                    onClick={() => setOpenDays((o) => ({ ...o, [day.id]: !open }))}
                  >
                    {open ? <ChevronDown className="h-4 w-4 mt-0.5 shrink-0" /> : <ChevronRight className="h-4 w-4 mt-0.5 shrink-0" />}
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="font-semibold text-sm">{day.label}</div>
                        <Badge
                          variant={day.group === "B" ? "secondary" : "outline"}
                          className={day.group === "C" ? "border-violet-500/40 text-violet-700 dark:text-violet-300" : ""}
                        >
                          {day.group === "B" ? "Grupo B" : "Grupo C"}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">{day.subtitle}</div>
                    </div>
                    <Badge variant="secondary" className="ml-auto shrink-0">{day.steps.length}</Badge>
                  </button>

                  {open && (
                    <div className="border-t divide-y">
                      {day.steps.map((step) => {
                        const row = stages[step.stage];
                        const catalogBody = previewBody.get(step.stage);
                        const showPreview = step.textsFromMultichannel && !techMode;
                        const bodyShown = showPreview
                          ? (catalogBody || row?.message_text || "(sem texto no Multicanal)")
                          : (row?.message_text || "");

                        return (
                          <div key={step.stage} className="p-4 space-y-3">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div className="space-y-1.5 min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className={`text-xs px-2 py-0.5 rounded font-medium ${channelTone(step.channel)}`}>
                                    {CHANNEL_LABEL[step.channel]}
                                  </span>
                                  <span className="font-semibold text-sm">{step.title}</span>
                                  {step.onlyIfSilent && (
                                    <Badge variant="outline" className="text-[10px]">só se silêncio</Badge>
                                  )}
                                  {step.toggleKey && (
                                    <Badge
                                      variant={toggleMap[step.toggleKey] ? "destructive" : "secondary"}
                                      className="text-[10px]"
                                    >
                                      {step.toggleKey}: {toggleMap[step.toggleKey] ? "ON" : "OFF"}
                                    </Badge>
                                  )}
                                </div>
                                <div className="text-xs font-medium text-foreground/90">{step.when}</div>
                                <p className="text-xs text-muted-foreground">{step.hint}</p>
                                <div className="flex flex-wrap gap-1.5 pt-0.5">
                                  <Badge variant="outline" className="font-mono text-[10px]">{step.stage}</Badge>
                                  {step.templateKey && (
                                    <Badge variant="secondary" className="text-[10px]">
                                      Multicanal: {step.templateKey}
                                    </Badge>
                                  )}
                                </div>
                              </div>

                              {step.editableConfig && row && (
                                <div className="flex flex-col items-end gap-2 shrink-0">
                                  <div className="flex items-center gap-2">
                                    <Switch
                                      checked={row.enabled}
                                      onCheckedChange={(v) => patchStage(step.stage, { enabled: v })}
                                    />
                                    <Label className="text-xs">{row.enabled ? "Ativo" : "Pausado"}</Label>
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <Label className="text-[10px] text-muted-foreground">Após</Label>
                                    <Input
                                      type="number"
                                      min={0}
                                      max={8760}
                                      className="w-16 h-8"
                                      value={row.delay_hours}
                                      onChange={(e) => patchStage(step.stage, { delay_hours: +e.target.value })}
                                    />
                                    <span className="text-[10px] text-muted-foreground">h</span>
                                  </div>
                                </div>
                              )}
                            </div>

                            {(step.channel === "meta" || step.channel === "system") && (
                              <div className="flex gap-2 rounded-md border border-violet-500/20 bg-violet-500/5 px-3 py-2 text-xs text-muted-foreground">
                                <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-violet-600" />
                                {step.channel === "meta"
                                  ? "Sem campo de imagem. Público Meta ≠ anúncio. Criativo só no Ads Manager."
                                  : "Card informativo — não envia mensagem ao lead."}
                              </div>
                            )}

                            {step.textsFromMultichannel && !step.editableConfig && step.templateKey && (
                              <div className="space-y-1">
                                <Label className="text-[10px] text-muted-foreground">
                                  Guia Multicanal (Grupo C) — somente leitura
                                </Label>
                                <pre className="text-xs whitespace-pre-wrap rounded-md border bg-muted/30 p-3 max-h-40 overflow-auto font-sans">
                                  {catalogBody || "(ver Multicanal → Grupo C)"}
                                </pre>
                              </div>
                            )}

                            {step.editableConfig && row && (
                              <>
                                {showPreview ? (
                                  <div className="space-y-1">
                                    <Label className="text-[10px] text-muted-foreground">
                                      Prévia do texto (Multicanal) — somente leitura
                                    </Label>
                                    <pre className="text-xs whitespace-pre-wrap rounded-md border bg-muted/30 p-3 max-h-40 overflow-auto font-sans">
                                      {bodyShown}
                                    </pre>
                                  </div>
                                ) : (
                                  <Textarea
                                    rows={3}
                                    placeholder={
                                      step.channel === "voice"
                                        ? "Roteiro de referência…"
                                        : step.channel === "sms"
                                          ? "Texto do SMS (até 160 caracteres)…"
                                          : "Texto da mensagem…"
                                    }
                                    value={row.message_text}
                                    onChange={(e) => patchStage(step.stage, { message_text: e.target.value })}
                                  />
                                )}

                                {step.channel === "whatsapp" && (
                                  <div className="space-y-1">
                                    <Label className="text-[10px] text-muted-foreground">
                                      Mídia opcional só deste WhatsApp (não é criativo Meta)
                                    </Label>
                                    <div className="grid grid-cols-2 gap-2">
                                      <Input
                                        placeholder="URL áudio/imagem/vídeo (opcional)"
                                        value={row.media_url || ""}
                                        onChange={(e) => patchStage(step.stage, { media_url: e.target.value || null })}
                                      />
                                      <select
                                        className="h-10 rounded-md border bg-background px-3 text-sm"
                                        value={row.media_type || "text"}
                                        onChange={(e) => patchStage(step.stage, { media_type: e.target.value })}
                                      >
                                        <option value="text">Somente texto</option>
                                        <option value="audio">Áudio</option>
                                        <option value="image">Imagem</option>
                                        <option value="video">Vídeo</option>
                                      </select>
                                    </div>
                                  </div>
                                )}

                                {step.channel === "voice" && (
                                  <div className="space-y-2 rounded-md border border-border/60 bg-muted/20 p-2.5">
                                    <Label className="text-xs">Áudio Sofia (ElevenLabs → Velip)</Label>
                                    <select
                                      className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                                      value={row.voice_audio_clip_id || ""}
                                      onChange={(e) => {
                                        const id = e.target.value || null;
                                        const clip = clips.find((c) => c.id === id);
                                        patchStage(step.stage, {
                                          voice_audio_clip_id: id,
                                          velip_audio_id: clip?.velip_audio_id || row.velip_audio_id,
                                        });
                                      }}
                                    >
                                      <option value="">Selecione clip Sofia (Estúdio / Multicanal)</option>
                                      {clips.map((c) => (
                                        <option key={c.id} value={c.id}>
                                          {(c.name || c.id.slice(0, 8)) +
                                            (c.voice_id === VOICE_SOFIA ? " · Sofia" : "") +
                                            (c.is_call_body ? " · corpo" : "") +
                                            (c.velip_audio_id ? " · no Velip" : " · falta upload Velip")}
                                        </option>
                                      ))}
                                    </select>
                                    <div className="flex items-start gap-2">
                                      <Switch
                                        checked={!!row.personalize_name}
                                        onCheckedChange={(v) => patchStage(step.stage, { personalize_name: v })}
                                        id={`pers-${step.stage}`}
                                        className="mt-0.5"
                                      />
                                      <div>
                                        <Label htmlFor={`pers-${step.stage}`} className="text-xs">Personalizar com nome</Label>
                                        <p className="text-[11px] text-muted-foreground">
                                          Costura &quot;Olá, {"{Nome}"}.&quot; (cache ElevenLabs).
                                        </p>
                                      </div>
                                    </div>
                                    {techMode && (
                                      <Input
                                        className="h-8 text-xs"
                                        placeholder="velip_audio_id legado"
                                        value={row.velip_audio_id || ""}
                                        onChange={(e) => patchStage(step.stage, { velip_audio_id: e.target.value || null })}
                                      />
                                    )}
                                    {!row.voice_audio_clip_id && !row.velip_audio_id && (
                                      <p className="text-[11px] text-amber-700 dark:text-amber-300">
                                        Sem clip Sofia — a ligação não sai.
                                      </p>
                                    )}
                                  </div>
                                )}

                                {techMode && (
                                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2 border-t">
                                    <div>
                                      <Label className="text-[10px] text-muted-foreground">Máx. envios/lead (0 = ∞)</Label>
                                      <Input
                                        type="number"
                                        min={0}
                                        max={20}
                                        className="h-8"
                                        value={row.max_per_lead}
                                        onChange={(e) => patchStage(step.stage, { max_per_lead: +e.target.value })}
                                      />
                                    </div>
                                    <div>
                                      <Label className="text-[10px] text-muted-foreground">Janela início (h)</Label>
                                      <Input
                                        type="number"
                                        min={0}
                                        max={23}
                                        className="h-8"
                                        value={row.window_start_hour ?? ""}
                                        onChange={(e) =>
                                          patchStage(step.stage, {
                                            window_start_hour: e.target.value === "" ? null : +e.target.value,
                                          })
                                        }
                                      />
                                    </div>
                                    <div>
                                      <Label className="text-[10px] text-muted-foreground">Janela fim (h)</Label>
                                      <Input
                                        type="number"
                                        min={0}
                                        max={23}
                                        className="h-8"
                                        value={row.window_end_hour ?? ""}
                                        onChange={(e) =>
                                          patchStage(step.stage, {
                                            window_end_hour: e.target.value === "" ? null : +e.target.value,
                                          })
                                        }
                                      />
                                    </div>
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex flex-wrap justify-between gap-2">
            <p className="text-[11px] text-muted-foreground self-center">
              Recalls (~30d→yearly) ficam na Central de Automações (todos OFF por padrão).
            </p>
            <Button onClick={saveAll} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
              Salvar configurações
            </Button>
          </div>
        </Card>

        {/* Métricas 7 dias */}
        <Card className="p-4">
          <h2 className="text-sm font-semibold mb-3">Métricas dos últimos 7 dias</h2>
          {metrics.length === 0 ? (
            <p className="text-xs text-muted-foreground">Sem dados ainda.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr className="border-b">
                    <th className="text-left py-1">Estágio</th>
                    <th className="text-left">Canal</th>
                    <th className="text-right">Enviados</th>
                    <th className="text-right">Falhas</th>
                    <th className="text-right">Leads únicos</th>
                    <th className="text-right">Respondidos</th>
                    <th className="text-right">Taxa resp.</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.map((m, i) => {
                    const rate = m.unique_leads > 0 ? Math.round((m.responded_leads / m.unique_leads) * 100) : 0;
                    return (
                      <tr key={i} className="border-b">
                        <td className="py-1">
                          <Badge variant="outline" title={m.stage}>{labelCadenceStage(m.stage)}</Badge>
                        </td>
                        <td><Badge variant="secondary">{m.channel}</Badge></td>
                        <td className="text-right font-mono">{m.sent}</td>
                        <td className="text-right font-mono text-destructive">{m.failed}</td>
                        <td className="text-right font-mono">{m.unique_leads}</td>
                        <td className="text-right font-mono text-emerald-600">{m.responded_leads}</td>
                        <td className="text-right font-mono">{rate}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="text-sm font-semibold mb-3">Últimas 20 ações</h2>
          {logs.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhuma ação registrada ainda.</p>
          ) : (
            <div className="space-y-1 text-xs">
              {logs.map((l, i) => (
                <div key={i} className="flex items-center gap-2 border-b py-1">
                  <span className="text-muted-foreground">{new Date(l.created_at).toLocaleString("pt-BR")}</span>
                  <Badge variant="outline" title={l.stage}>{labelCadenceStage(l.stage)}</Badge>
                  <Badge variant="secondary">{l.channel}</Badge>
                  <Badge variant={l.status === "sent" ? "default" : l.status === "failed" ? "destructive" : "outline"}>
                    {l.status}
                  </Badge>
                  <span className="text-muted-foreground truncate">{JSON.stringify(l.detail)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </main>
    </div>
  );
}
