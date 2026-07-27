/**
 * Painel Venda da Plataforma — Mensagens + CRM + Histórico (SuperAdmin).
 * Isolado do Kanban de leads / cadência / Cérebro.
 *
 * Fluxo de envio: campanha → dia → canais → todos/selecionados → simular | enviar.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  Loader2,
  Megaphone,
  MessageSquare,
  Phone,
  Play,
  RefreshCw,
  Smartphone,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Kanban,
  History,
  Send,
  Users,
  CheckSquare,
  Square,
  Eye,
  Pencil,
  UserPlus,
} from "lucide-react";
import {
  DEFAULT_PLATFORM_SALES_SCRIPTS,
  PLATFORM_SALES_CRM_STAGES,
  composePlatformSalesMessage,
  type PlatformSalesCrmStage,
  type PlatformSalesScriptSettings,
} from "@/lib/platformSalesScripts";
import {
  PLATFORM_SALES_DEMO_MENU,
  PS_DEMO_CTA_LABEL,
  buildPlatformSalesDemoMenuPreview,
  composePlatformSalesDemoPreview,
  type PlatformSalesDemoStage,
} from "@/lib/platformSalesDemoCatalog";
import { cn } from "@/lib/utils";

/** E.164 BR (55…) para alvos da venda da plataforma. */
function normalizePlatformSalesPhone(raw: string): string | null {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (!d.startsWith("55") || d.length < 12 || d.length > 13) return null;
  return d;
}

type Campaign = {
  id: string;
  name: string;
  status: string;
  dry_run: boolean;
  channels: string[];
  total: number;
  sent: number;
};

type Target = {
  id: string;
  phone: string;
  name: string | null;
  name_source: string;
  status: string;
  crm_stage: PlatformSalesCrmStage;
  crm_notes: string | null;
  d0_sent_at: string | null;
  d1_sent_at: string | null;
};

type LogRow = {
  id: string;
  target_id: string;
  day_key: string;
  channel: string;
  dry_run: boolean;
  status: string;
  rendered_text: string | null;
  error: string | null;
  provider_id?: string | null;
  created_at: string;
};

const db = supabase as any;

type ChannelKey = "whatsapp" | "sms" | "call";

const CHANNEL_META: Record<ChannelKey, { label: string; short: string; icon: typeof MessageSquare }> = {
  whatsapp: { label: "WhatsApp", short: "WA", icon: MessageSquare },
  sms: { label: "SMS", short: "SMS", icon: Smartphone },
  call: { label: "Ligação", short: "Call", icon: Phone },
};

const STATUS_LABEL: Record<string, string> = {
  queued: "na fila",
  sending: "enviando",
  sent: "enviado",
  failed: "falhou",
  skipped: "pulado",
  d1_queued: "fila D+1",
  done: "concluído",
};

function WaBubble({ text }: { text: string }) {
  return (
    <div className="rounded-2xl bg-emerald-100/90 dark:bg-emerald-950/50 border border-emerald-600/25 dark:border-emerald-500/30 px-3.5 py-3 shadow-sm max-w-lg">
      <pre className="text-[13px] whitespace-pre-wrap font-sans text-foreground leading-relaxed m-0">
        {text}
      </pre>
    </div>
  );
}

export function VendaPlataformaPanel({ userId: _userId }: { userId: string }) {
  const { toast } = useToast();
  const [scripts, setScripts] = useState<PlatformSalesScriptSettings>(DEFAULT_PLATFORM_SALES_SCRIPTS);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [targets, setTargets] = useState<Target[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dayView, setDayView] = useState<"d0" | "d1">("d0");
  const [previewChannel, setPreviewChannel] = useState<ChannelKey>("whatsapp");
  const [mainTab, setMainTab] = useState("preview");
  const [edgeOk, setEdgeOk] = useState<boolean | null>(null);
  const [notesDraft, setNotesDraft] = useState<Record<string, string>>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [previewFocusId, setPreviewFocusId] = useState<string | null>(null);
  const [confirmLiveOpen, setConfirmLiveOpen] = useState(false);
  const [demoMedia, setDemoMedia] = useState<Partial<Record<PlatformSalesDemoStage, string>>>({});
  const [demoStageOpen, setDemoStageOpen] = useState<number | null>(null);
  const [showDemoMenu, setShowDemoMenu] = useState(false);
  const [groupContactCount, setGroupContactCount] = useState(0);
  const [groupName, setGroupName] = useState("Igreen Liderança");
  const [importBusy, setImportBusy] = useState(false);
  const [listFilter, setListFilter] = useState("");
  const [phoneEdit, setPhoneEdit] = useState<{
    targetId: string;
    name: string;
    oldPhone: string;
    draft: string;
  } | null>(null);

  const loadTargets = useCallback(async (campaignId: string, mode: "reset" | "preserve" = "reset") => {
    const { data: t } = await db
      .from("platform_sales_targets")
      .select("id, phone, name, name_source, status, crm_stage, crm_notes, d0_sent_at, d1_sent_at")
      .eq("campaign_id", campaignId)
      .order("name", { ascending: true, nullsFirst: false })
      .limit(2000);
    const list = ((t as Target[]) || []).map((row) => ({
      ...row,
      crm_stage: (row.crm_stage || "novo") as PlatformSalesCrmStage,
    }));
    setTargets(list);
    setSelectedIds((prev) => {
      if (mode === "preserve") {
        const keep = new Set(list.filter((r) => prev.has(r.id)).map((r) => r.id));
        return keep;
      }
      // Campanha nova: começa vazio — usuário marca quem quer
      return new Set();
    });
    setNotesDraft((prev) => {
      const next = { ...prev };
      for (const row of list) {
        if (next[row.id] === undefined) next[row.id] = row.crm_notes || "";
      }
      return next;
    });
    if (list[0]) setPreviewFocusId((prev) => prev || list[0].id);
  }, []);

  const loadLogs = useCallback(async (campaignId: string) => {
    const { data } = await db
      .from("platform_sales_dispatch_log")
      .select("id, target_id, day_key, channel, dry_run, status, rendered_text, error, provider_id, created_at")
      .eq("campaign_id", campaignId)
      .order("created_at", { ascending: false })
      .limit(200);
    setLogs((data as LogRow[]) || []);
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: s }, { data: cams }] = await Promise.all([
        db.from("platform_sales_script_settings").select("*").eq("id", "global").maybeSingle(),
        db.from("platform_sales_campaigns").select("*").order("created_at", { ascending: false }).limit(20),
      ]);
      if (s) {
        setScripts({
          bloco_nome_com: s.bloco_nome_com,
          bloco_nome_sem: s.bloco_nome_sem,
          saudacao_manha: s.saudacao_manha,
          saudacao_tarde: s.saudacao_tarde,
          saudacao_noite: s.saudacao_noite,
          corpo_wa_d0: s.corpo_wa_d0,
          corpo_wa_d1: s.corpo_wa_d1,
          corpo_sms_d0: s.corpo_sms_d0,
          corpo_sms_d1: s.corpo_sms_d1,
          corpo_call_d0: s.corpo_call_d0,
          corpo_call_d1: s.corpo_call_d1,
        });
      }
      const list = (cams as Campaign[]) || [];
      setCampaigns(list);
      const nextId = (() => {
        if (selectedId && list.some((c) => c.id === selectedId)) return selectedId;
        const pilot = list.find((c) => /piloto\s*4/i.test(c.name));
        return pilot?.id || list[0]?.id || null;
      })();
      setSelectedId(nextId);
      if (nextId) await Promise.all([loadTargets(nextId), loadLogs(nextId)]);
    } catch (e) {
      toast({
        title: "Erro ao carregar",
        description: e instanceof Error ? e.message : "Falha",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast, selectedId, loadTargets, loadLogs]);

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- first mount
  }, []);

  useEffect(() => {
    void (async () => {
      const stages = PLATFORM_SALES_DEMO_MENU.map((m) => m.stage);
      const [{ data }, { count }, { data: gRow }] = await Promise.all([
        db.from("pos_venda_default_media").select("stage, message_text").in("stage", stages),
        db
          .from("platform_sales_contacts")
          .select("id", { count: "exact", head: true })
          .eq("active", true)
          .eq("kind", "consultor_igreen"),
        db
          .from("platform_sales_contacts")
          .select("wa_group_name")
          .eq("active", true)
          .not("wa_group_name", "is", null)
          .limit(1)
          .maybeSingle(),
      ]);
      const map: Partial<Record<PlatformSalesDemoStage, string>> = {};
      for (const row of (data || []) as Array<{ stage: string; message_text: string }>) {
        map[row.stage as PlatformSalesDemoStage] = row.message_text || "";
      }
      setDemoMedia(map);
      setGroupContactCount(count || 0);
      if (gRow?.wa_group_name) setGroupName(String(gRow.wa_group_name));
    })();
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    void Promise.all([loadTargets(selectedId), loadLogs(selectedId)]);
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = useMemo(
    () => campaigns.find((c) => c.id === selectedId) || null,
    [campaigns, selectedId],
  );

  const channels = useMemo(() => {
    const raw = (selected?.channels || ["whatsapp", "sms", "call"]) as ChannelKey[];
    return raw.filter((c): c is ChannelKey => c in CHANNEL_META);
  }, [selected]);

  const queuedForDay = useMemo(() => {
    const want = dayView === "d0" ? "queued" : "d1_queued";
    return targets.filter((t) => t.status === want);
  }, [targets, dayView]);

  const selectedTargets = useMemo(
    () => targets.filter((t) => selectedIds.has(t.id)),
    [targets, selectedIds],
  );

  const liveTargets = useMemo(() => {
    const want = dayView === "d0" ? "queued" : "d1_queued";
    return selectedTargets.filter((t) => t.status === want);
  }, [selectedTargets, dayView]);

  const filteredTargets = useMemo(() => {
    const q = listFilter.trim().toLowerCase();
    if (!q) return targets;
    return targets.filter(
      (t) =>
        (t.name || "").toLowerCase().includes(q) ||
        t.phone.includes(q.replace(/\D/g, "")) ||
        t.phone.includes(q),
    );
  }, [targets, listFilter]);

  const importGroupToCampaign = async () => {
    if (!selectedId) {
      toast({ title: "Escolha a campanha", variant: "destructive" });
      return;
    }
    setImportBusy(true);
    try {
      const pageSize = 1000;
      const { data: contacts, error } = await db
        .from("platform_sales_contacts")
        .select("phone, name, pushname, name_source")
        .eq("active", true)
        .eq("kind", "consultor_igreen")
        .order("phone", { ascending: true })
        .limit(pageSize);
      if (error) throw error;
      const rows = ((contacts || []) as Array<{
        phone: string;
        name: string | null;
        pushname: string | null;
        name_source: string | null;
      }>).map((c) => {
        // Nome só se fonte confiável (manual). Pushname do Zap → sem prenome.
        const trusted =
          c.name_source === "manual" ||
          c.name_source === "self_introduced" ||
          c.name_source === "user_confirmed";
        const display = trusted ? (c.name || "").trim() || null : null;
        return {
          campaign_id: selectedId,
          phone: c.phone,
          name: display,
          name_source: display ? (c.name_source || "manual") : "unknown",
          status: "queued",
          crm_stage: "novo",
        };
      });

      let inserted = 0;
      for (let i = 0; i < rows.length; i += 100) {
        const chunk = rows.slice(i, i + 100);
        const { error: upErr, count } = await db
          .from("platform_sales_targets")
          .upsert(chunk, {
            onConflict: "campaign_id,phone",
            ignoreDuplicates: true,
            count: "exact",
          });
        if (upErr) throw upErr;
        inserted += count ?? chunk.length;
      }

      const { count: totalNow } = await db
        .from("platform_sales_targets")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", selectedId);
      await db
        .from("platform_sales_campaigns")
        .update({ total: totalNow || rows.length })
        .eq("id", selectedId);

      await loadTargets(selectedId, "preserve");
      toast({
        title: "Grupo carregado na campanha",
        description: `${rows.length} do «${groupName}» processados · total na campanha: ${totalNow ?? "—"}${inserted ? ` · novos ~${inserted}` : ""}.`,
      });
    } catch (e) {
      toast({
        title: "Falha ao carregar grupo",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setImportBusy(false);
    }
  };

  const heroPreview = useMemo(() => {
    const focused =
      (previewFocusId && targets.find((t) => t.id === previewFocusId)) ||
      selectedTargets[0] ||
      targets[0];
    if (!focused) return null;
    const channel = channels.includes(previewChannel) ? previewChannel : "whatsapp";
    return {
      target: focused,
      channel,
      text: composePlatformSalesMessage({
        scripts,
        name: focused.name,
        day: dayView,
        channel,
      }),
    };
  }, [previewFocusId, selectedTargets, targets, scripts, dayView, previewChannel, channels]);

  const crmByStage = useMemo(() => {
    const map: Record<string, Target[]> = {};
    for (const s of PLATFORM_SALES_CRM_STAGES) map[s.id] = [];
    for (const t of targets) {
      const stage = t.crm_stage || "novo";
      if (!map[stage]) map[stage] = [];
      map[stage].push(t);
    }
    return map;
  }, [targets]);

  const nameById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const t of targets) m[t.id] = t.name || t.phone;
    return m;
  }, [targets]);

  const phoneById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const t of targets) m[t.id] = t.phone;
    return m;
  }, [targets]);

  const historyCards = useMemo(() => {
    type ChanStat = {
      status: string;
      at: string;
      dry: boolean;
      isCta: boolean;
      error: string | null;
      text: string | null;
      provider_id?: string | null;
    };
    const byTarget = new Map<
      string,
      { whatsapp?: ChanStat; sms?: ChanStat; call?: ChanStat; cta?: ChanStat; latest: string }
    >();
    for (const log of logs) {
      const isCta = String(log.rendered_text || "").startsWith("[BOTÕES DEMO]");
      const row: ChanStat = {
        status: log.status,
        at: log.created_at,
        dry: log.dry_run,
        isCta,
        error: log.error,
        text: log.rendered_text,
        provider_id: log.provider_id,
      };
      const cur = byTarget.get(log.target_id) || { latest: log.created_at };
      if (!cur.latest || log.created_at > cur.latest) cur.latest = log.created_at;
      if (isCta) {
        if (!cur.cta) cur.cta = row;
      } else if (log.channel === "whatsapp" && !cur.whatsapp) cur.whatsapp = row;
      else if (log.channel === "sms" && !cur.sms) cur.sms = row;
      else if (log.channel === "call" && !cur.call) cur.call = row;
      byTarget.set(log.target_id, cur);
    }
    return [...byTarget.entries()]
      .map(([targetId, stats]) => ({
        targetId,
        name: nameById[targetId] || "—",
        phone: phoneById[targetId] || "",
        ...stats,
      }))
      .sort((a, b) => b.latest.localeCompare(a.latest));
  }, [logs, nameById, phoneById]);

  const resendToTarget = async (
    targetId: string,
    opts: { channels?: ChannelKey[]; ctaOnly?: boolean; day?: "d0" | "d1" },
  ) => {
    if (!selectedId) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("platform-sales-dispatch", {
        body: opts.ctaOnly
          ? {
              action: "cta_only",
              campaign_id: selectedId,
              day: opts.day || dayView,
              target_ids: [targetId],
              dry_run: false,
            }
          : {
              action: "dispatch",
              campaign_id: selectedId,
              day: opts.day || dayView,
              dry_run: false,
              force: true,
              limit: 1,
              target_ids: [targetId],
              channels: opts.channels || ["whatsapp"],
            },
      });
      if (error) throw new Error(error.message || "Falha no reenvio");
      if (data?.error) throw new Error(data.error);
      setEdgeOk(true);
      toast({
        title: opts.ctaOnly ? "Botões reenviados" : "Reenvio disparado",
        description: nameById[targetId] || targetId,
      });
      await Promise.all([loadTargets(selectedId, "preserve"), loadLogs(selectedId)]);
    } catch (e) {
      setEdgeOk(false);
      toast({
        title: "Reenvio falhou",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const savePhoneChange = async () => {
    if (!phoneEdit || !selectedId) return;
    const next = normalizePlatformSalesPhone(phoneEdit.draft);
    if (!next) {
      toast({
        title: "Número inválido",
        description: "Use DDD + celular (ex.: 11999998888 ou 5511999998888).",
        variant: "destructive",
      });
      return;
    }
    if (next === phoneEdit.oldPhone) {
      setPhoneEdit(null);
      return;
    }
    setBusy(true);
    try {
      const { error } = await db
        .from("platform_sales_targets")
        .update({ phone: next, updated_at: new Date().toISOString() })
        .eq("id", phoneEdit.targetId);
      if (error) {
        if (/unique|duplicate/i.test(error.message)) {
          throw new Error("Este número já está em outro destinatário desta campanha.");
        }
        throw new Error(error.message);
      }
      // Espelha na lista mestre de contatos (se o antigo existir).
      await db
        .from("platform_sales_contacts")
        .update({ phone: next, updated_at: new Date().toISOString() })
        .eq("phone", phoneEdit.oldPhone);
      setTargets((prev) =>
        prev.map((t) => (t.id === phoneEdit.targetId ? { ...t, phone: next } : t)),
      );
      toast({
        title: "Número atualizado",
        description: `${phoneEdit.name || "Consultor"}: ${phoneEdit.oldPhone} → ${next}`,
      });
      setPhoneEdit(null);
      await loadLogs(selectedId);
    } catch (e) {
      toast({
        title: "Não foi possível trocar o número",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else {
        next.add(id);
        setPreviewFocusId(id);
      }
      return next;
    });
  };

  const setOneChecked = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(id);
        setPreviewFocusId(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  };

  const selectAll = () => setSelectedIds(new Set(targets.map((t) => t.id)));
  const selectNone = () => setSelectedIds(new Set());
  const selectQueued = () => setSelectedIds(new Set(queuedForDay.map((t) => t.id)));

  const setCrmStage = async (targetId: string, stage: PlatformSalesCrmStage) => {
    const { error } = await db
      .from("platform_sales_targets")
      .update({ crm_stage: stage, crm_updated_at: new Date().toISOString() })
      .eq("id", targetId);
    if (error) {
      toast({ title: "Falha ao mover", description: error.message, variant: "destructive" });
      return;
    }
    setTargets((prev) => prev.map((t) => (t.id === targetId ? { ...t, crm_stage: stage } : t)));
  };

  const saveNotes = async (targetId: string) => {
    const notes = notesDraft[targetId] ?? "";
    const { error } = await db
      .from("platform_sales_targets")
      .update({ crm_notes: notes || null, crm_updated_at: new Date().toISOString() })
      .eq("id", targetId);
    if (error) {
      toast({ title: "Falha ao salvar nota", description: error.message, variant: "destructive" });
      return;
    }
    setTargets((prev) => prev.map((t) => (t.id === targetId ? { ...t, crm_notes: notes || null } : t)));
    toast({ title: "Nota salva" });
  };

  const runDispatch = async (forceDry: boolean) => {
    if (!selectedId) return;
    const ids = [...selectedIds];
    if (ids.length === 0) {
      toast({ title: "Ninguém selecionado", description: "Marque ao menos um consultor.", variant: "destructive" });
      return;
    }
    if (!forceDry && liveTargets.length === 0) {
      toast({
        title: "Fila vazia para envio real",
        description: dayView === "d0"
          ? "Ninguém selecionado está com status «na fila» (D0)."
          : "Ninguém selecionado está na fila D+1.",
        variant: "destructive",
      });
      return;
    }
    setBusy(true);
    try {
      const BATCH = 50;
      let processed = 0;
      for (let i = 0; i < ids.length; i += BATCH) {
        const batch = ids.slice(i, i + BATCH);
        const { data, error } = await supabase.functions.invoke("platform-sales-dispatch", {
          body: {
            action: "dispatch",
            campaign_id: selectedId,
            day: dayView,
            dry_run: forceDry,
            limit: BATCH,
            target_ids: batch,
          },
        });
        if (error) {
          setEdgeOk(false);
          throw new Error(
            error.message?.includes("404") || String(error).includes("404")
              ? "Edge platform-sales-dispatch ainda não está no ar (404)."
              : error.message || "Falha no invoke",
          );
        }
        if (data?.error) throw new Error(data.error);
        processed += Number(data?.processed || 0);
      }
      setEdgeOk(true);
      if (!forceDry) {
        await db
          .from("platform_sales_targets")
          .update({ crm_stage: "contatado", crm_updated_at: new Date().toISOString() })
          .eq("campaign_id", selectedId)
          .eq("crm_stage", "novo")
          .in("id", ids);
      }
      toast({
        title: forceDry ? "Simulação gravada (não enviou)" : "Envio real disparado",
        description: `${dayView === "d0" ? "Dia 0" : "Dia +1"} · ${processed} pessoas · veja Histórico`,
      });
      if (!forceDry) setConfirmLiveOpen(false);
      await Promise.all([
        loadTargets(selectedId, "preserve"),
        loadLogs(selectedId),
      ]);
      const { data: cams } = await db
        .from("platform_sales_campaigns")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);
      if (cams) setCampaigns(cams as Campaign[]);
    } catch (e) {
      toast({
        title: "Não enviou",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };


  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-7 h-7 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-5xl mx-auto pb-16">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-emerald-600/15 flex items-center justify-center">
            <Megaphone className="w-5 h-5 text-emerald-700 dark:text-emerald-400" />
          </div>
          <div>
            <h2 className="text-xl font-heading font-bold tracking-tight">Venda da plataforma</h2>
            <p className="text-xs text-muted-foreground">SuperAdmin · isolado do CRM de leads</p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void loadAll()} className="gap-1.5">
          <RefreshCw className="w-3.5 h-3.5" /> Atualizar
        </Button>
      </header>

      {edgeOk === false && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm flex gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-muted-foreground text-xs">
            Edge de envio com problema. Prévia e CRM seguem ok; LIVE pode falhar até o deploy.
          </p>
        </div>
      )}

      <section className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-border/60 bg-muted/30 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">Disparo</p>
            <p className="text-[11px] text-muted-foreground">Campanha · dia · quem recebe · simular ou enviar</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy || !selectedId || selectedIds.size === 0}
              onClick={() => void runDispatch(true)}
              className="gap-1.5"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              Simular
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={busy || !selectedId || liveTargets.length === 0}
              onClick={() => setConfirmLiveOpen(true)}
              className="gap-1.5 bg-emerald-700 hover:bg-emerald-800 text-white"
            >
              <Send className="w-3.5 h-3.5" />
              Enviar ({liveTargets.length})
            </Button>
          </div>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Campanha</Label>
              <Select value={selectedId || undefined} onValueChange={(v) => setSelectedId(v)}>
                <SelectTrigger className="h-10">
                  <SelectValue placeholder="Escolha a campanha" />
                </SelectTrigger>
                <SelectContent>
                  {campaigns.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Dia</Label>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ["d0", "Dia 0"],
                    ["d1", "Dia +1"],
                  ] as const
                ).map(([id, title]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setDayView(id)}
                    className={cn(
                      "h-10 rounded-lg border text-sm font-semibold transition-colors",
                      dayView === id
                        ? "border-emerald-600 bg-emerald-600/15 text-emerald-900 dark:text-emerald-200"
                        : "border-border hover:bg-muted/50",
                    )}
                  >
                    {title}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label className="text-xs text-muted-foreground">
                Destinatários · marcados {selectedIds.size}/{targets.length} · fila LIVE {liveTargets.length}
              </Label>
              <div className="flex flex-wrap gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="h-7 text-xs gap-1"
                  disabled={importBusy || !selectedId || groupContactCount === 0}
                  onClick={() => void importGroupToCampaign()}
                >
                  {importBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserPlus className="w-3 h-3" />}
                  Carregar grupo ({groupContactCount})
                </Button>
                <Button type="button" size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={selectAll}>
                  <CheckSquare className="w-3 h-3" /> Todos
                </Button>
                <Button type="button" size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={selectQueued}>
                  <Users className="w-3 h-3" /> Fila ({queuedForDay.length})
                </Button>
                <Button type="button" size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={selectNone}>
                  <Square className="w-3 h-3" /> Limpar
                </Button>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Grupo WhatsApp <strong className="text-foreground">{groupName}</strong> · {groupContactCount} consultores salvos.
              O botão coloca todos na campanha (sem enviar). Depois você marca quem recebe.
            </p>
            {targets.length > 8 && (
              <Input
                value={listFilter}
                onChange={(e) => setListFilter(e.target.value)}
                placeholder="Filtrar por nome ou telefone…"
                className="h-9 text-sm"
              />
            )}

            <div className="rounded-xl border border-border bg-muted/20 max-h-64 overflow-y-auto divide-y divide-border">
              {filteredTargets.length === 0 ? (
                <p className="px-3 py-6 text-xs text-muted-foreground text-center">
                  {targets.length === 0
                    ? "Nenhum consultor nesta campanha. Clique em Carregar grupo."
                    : "Nenhum resultado no filtro."}
                </p>
              ) : (
                filteredTargets.map((t) => {
                  const checked = selectedIds.has(t.id);
                  const inQueue =
                    (dayView === "d0" && t.status === "queued") ||
                    (dayView === "d1" && t.status === "d1_queued");
                  const focused = previewFocusId === t.id;
                  return (
                    <div
                      key={t.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        toggleOne(t.id);
                        setPreviewFocusId(t.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toggleOne(t.id);
                          setPreviewFocusId(t.id);
                        }
                      }}
                      className={cn(
                        "flex items-center gap-2.5 px-3 py-2 cursor-pointer transition-colors select-none",
                        checked
                          ? "bg-emerald-500/12 border-l-2 border-l-emerald-600"
                          : "hover:bg-muted/50 border-l-2 border-l-transparent",
                        focused && "ring-1 ring-inset ring-emerald-600/30",
                      )}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) => {
                          setOneChecked(t.id, v === true);
                          setPreviewFocusId(t.id);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`Selecionar ${t.name || t.phone}`}
                        className="border-foreground/40 data-[state=checked]:bg-emerald-600 data-[state=checked]:border-emerald-600"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold truncate">{t.name || "Sem nome"}</p>
                        <p className="text-[10px] font-mono text-muted-foreground truncate">{t.phone}</p>
                      </div>
                      <Badge
                        variant="secondary"
                        className={cn(
                          "text-[9px] shrink-0",
                          inQueue && "bg-emerald-700 text-white hover:bg-emerald-700",
                        )}
                      >
                        {inQueue ? "na fila" : STATUS_LABEL[t.status] || t.status}
                      </Badge>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </section>

      <Tabs value={mainTab} onValueChange={setMainTab} className="space-y-3">
        <TabsList className="grid w-full max-w-md grid-cols-3 h-10">
          <TabsTrigger value="preview" className="gap-1.5 text-xs sm:text-sm">
            <Eye className="w-3.5 h-3.5" /> Prévia
          </TabsTrigger>
          <TabsTrigger value="crm" className="gap-1.5 text-xs sm:text-sm">
            <Kanban className="w-3.5 h-3.5" /> CRM
          </TabsTrigger>
          <TabsTrigger value="historico" className="gap-1.5 text-xs sm:text-sm">
            <History className="w-3.5 h-3.5" /> Histórico
          </TabsTrigger>
        </TabsList>

        <TabsContent value="preview" className="mt-0 space-y-3">
          <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-border/60 flex flex-wrap items-center justify-between gap-2 bg-muted/20">
              <div>
                <p className="text-sm font-semibold">Mensagem que sai no Zap</p>
                <p className="text-[11px] text-muted-foreground">
                  Exemplo: {heroPreview?.target.name || heroPreview?.target.phone || "—"} · {dayView === "d0" ? "Dia 0" : "Dia +1"}
                </p>
              </div>
              <div className="flex flex-wrap gap-1">
                {channels.map((ch) => {
                  const meta = CHANNEL_META[ch];
                  const Icon = meta.icon;
                  return (
                    <Button
                      key={ch}
                      type="button"
                      size="sm"
                      variant={previewChannel === ch ? "default" : "outline"}
                      className={cn("h-7 text-[11px] gap-1", previewChannel === ch && "bg-emerald-700 hover:bg-emerald-800")}
                      onClick={() => setPreviewChannel(ch)}
                    >
                      <Icon className="w-3 h-3" /> {meta.short}
                    </Button>
                  );
                })}
              </div>
            </div>

            <div className="p-4 space-y-3">
              {heroPreview ? (
                previewChannel === "whatsapp" ? (
                  <WaBubble text={heroPreview.text} />
                ) : (
                  <pre className="text-[13px] whitespace-pre-wrap font-sans text-foreground leading-relaxed rounded-xl border border-border bg-muted/30 p-3 m-0 max-h-80 overflow-auto">
                    {heroPreview.text}
                  </pre>
                )
              ) : (
                <p className="text-sm text-muted-foreground py-8 text-center">Selecione um consultor acima para ver a prévia.</p>
              )}

              {dayView === "d0" && previewChannel === "whatsapp" && (
                <div className="rounded-xl border border-emerald-700/25 bg-emerald-500/5 px-3 py-3 space-y-2">
                  <p className="text-xs font-semibold text-foreground">{PS_DEMO_CTA_LABEL}</p>
                  <p className="text-[11px] text-muted-foreground">
                    No LIVE: 2 botões (Sim / Agora não). Depois digita 1–8 → *imagem + áudio* (igual pós-venda).
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge className="text-[10px] bg-emerald-700 text-white hover:bg-emerald-700">1 · Sim, quero ouvir</Badge>
                    <Badge variant="secondary" className="text-[10px]">2 · Agora não</Badge>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs w-full sm:w-auto"
                    onClick={() => setShowDemoMenu((v) => !v)}
                  >
                    {showDemoMenu ? "Ocultar menu 1–8" : "Ver mensagens ao cliente (1–8)"}
                  </Button>
                  {showDemoMenu && (
                    <div className="rounded-lg border border-border bg-card p-2.5 space-y-1">
                      {PLATFORM_SALES_DEMO_MENU.map((m) => {
                        const open = demoStageOpen === m.n;
                        const raw = demoMedia[m.stage] || "";
                        const preview = raw ? composePlatformSalesDemoPreview(raw) : "Carregando…";
                        return (
                          <div key={m.n} className="border-b border-border/40 last:border-0">
                            <button
                              type="button"
                              className="w-full flex items-center justify-between gap-2 text-left py-1.5"
                              onClick={() => setDemoStageOpen(open ? null : m.n)}
                            >
                              <span className="text-xs font-semibold">
                                {m.n}. {m.label}
                              </span>
                              {open ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
                            </button>
                            {open && (
                              <div className="mb-2 space-y-1">
                                <p className="text-[10px] text-muted-foreground px-0.5">
                                  No Zap: imagem + áudio TTS (sem texto). Roteiro falado:
                                </p>
                                <pre className="text-[11px] whitespace-pre-wrap font-sans text-foreground leading-relaxed bg-muted rounded-md p-2 max-h-40 overflow-auto m-0">
                                  {preview}
                                </pre>
                              </div>
                            )}
                          </div>
                        );
                      })}
                      <details className="pt-1 text-[10px] text-muted-foreground">
                        <summary className="cursor-pointer">Texto do menu no Zap</summary>
                        <pre className="mt-1 whitespace-pre-wrap font-sans bg-muted rounded-md p-2 m-0 text-foreground/90">
                          {buildPlatformSalesDemoMenuPreview()}
                        </pre>
                      </details>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="crm" className="mt-0 space-y-3">
          <p className="text-xs text-muted-foreground">Acompanhe cada consultor depois do contato.</p>
          <div className="grid gap-3 lg:grid-cols-3 xl:grid-cols-4">
            {PLATFORM_SALES_CRM_STAGES.map((stage) => (
              <div key={stage.id} className="rounded-xl border border-border bg-card min-h-[120px] flex flex-col">
                <div className="px-3 py-2 border-b border-border/50 flex items-center justify-between bg-muted/20">
                  <span className="text-xs font-semibold">{stage.label}</span>
                  <Badge variant="secondary" className="text-[10px]">
                    {(crmByStage[stage.id] || []).length}
                  </Badge>
                </div>
                <div className="p-2 space-y-2 flex-1">
                  {(crmByStage[stage.id] || []).map((t) => (
                    <div key={t.id} className="rounded-lg border border-border bg-muted/20 p-2.5 space-y-2">
                      <div>
                        <p className="text-sm font-medium truncate">{t.name || "Sem nome"}</p>
                        <p className="text-[10px] font-mono text-muted-foreground">{t.phone}</p>
                      </div>
                      <select
                        className="w-full text-[11px] rounded-md border border-border bg-card px-2 py-1.5"
                        value={t.crm_stage}
                        onChange={(e) => void setCrmStage(t.id, e.target.value as PlatformSalesCrmStage)}
                      >
                        {PLATFORM_SALES_CRM_STAGES.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                      <Textarea
                        value={notesDraft[t.id] ?? ""}
                        onChange={(e) => setNotesDraft((p) => ({ ...p, [t.id]: e.target.value }))}
                        placeholder="Nota"
                        className="min-h-[52px] text-xs"
                      />
                      <Button size="sm" variant="outline" className="h-7 text-[11px] w-full" onClick={() => void saveNotes(t.id)}>
                        Salvar nota
                      </Button>
                    </div>
                  ))}
                  {(crmByStage[stage.id] || []).length === 0 && (
                    <p className="text-[11px] text-muted-foreground px-1 py-4 text-center">vazio</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="historico" className="mt-0 space-y-3">
          <div className="rounded-xl border border-border bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground space-y-1">
            <p>
              <strong className="text-foreground">Como ler:</strong> WhatsApp = mensagem entregue à API ·
              SMS = aceito pela operadora (não é confirmação no aparelho) ·
              Ligação = <em>disparada</em> (não sabemos se atendeu) ·
              Botões = CTA do demo pós-venda.
            </p>
          </div>
          {historyCards.length === 0 && (
            <div className="rounded-2xl border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
              Ainda sem histórico. Clique em <strong className="text-foreground">Simular</strong> ou envie LIVE.
            </div>
          )}
          {historyCards.map((card) => {
            const chip = (
              label: string,
              stat: { status: string; dry: boolean; error: string | null } | undefined,
              hint: string,
            ) => {
              if (!stat) {
                return (
                  <div className="rounded-lg border border-dashed border-border px-2.5 py-2 text-[11px] text-muted-foreground">
                    <p className="font-semibold text-foreground/70">{label}</p>
                    <p>não enviado</p>
                  </div>
                );
              }
              const ok = stat.status === "ok";
              return (
                <div
                  className={cn(
                    "rounded-lg border px-2.5 py-2 text-[11px]",
                    ok
                      ? "border-emerald-600/30 bg-emerald-500/10"
                      : "border-destructive/40 bg-destructive/10",
                  )}
                >
                  <p className="font-semibold text-foreground">{label}</p>
                  <p className={ok ? "text-emerald-800 dark:text-emerald-300" : "text-destructive"}>
                    {stat.dry ? "simulação" : ok ? hint : `falhou${stat.error ? `: ${stat.error}` : ""}`}
                  </p>
                </div>
              );
            };
            return (
              <div key={card.targetId} className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-border/50 flex flex-wrap items-center justify-between gap-2 bg-muted/20">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{card.name}</p>
                    <p className="text-[10px] font-mono text-muted-foreground truncate">{card.phone}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 text-[11px] gap-1"
                      disabled={busy}
                      onClick={() =>
                        setPhoneEdit({
                          targetId: card.targetId,
                          name: card.name,
                          oldPhone: card.phone,
                          draft: card.phone,
                        })
                      }
                    >
                      <Pencil className="w-3 h-3" />
                      Trocar número
                    </Button>
                    <p className="text-[10px] text-muted-foreground hidden sm:block">
                      {new Date(card.latest).toLocaleString("pt-BR")}
                    </p>
                  </div>
                </div>
                <div className="p-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {chip("WhatsApp", card.whatsapp, "enviado")}
                  {chip("SMS", card.sms, "aceito (operadora)")}
                  {chip("Ligação", card.call, "disparada (não confirma atendimento)")}
                  {chip("Botões demo", card.cta, "enviados")}
                </div>
                <div className="px-3 pb-3 flex flex-wrap gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px]"
                    disabled={busy}
                    onClick={() => void resendToTarget(card.targetId, { channels: ["whatsapp"], day: "d0" })}
                  >
                    Reenviar WA
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px]"
                    disabled={busy}
                    onClick={() => void resendToTarget(card.targetId, { channels: ["sms"], day: "d0" })}
                  >
                    Reenviar SMS
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px]"
                    disabled={busy}
                    onClick={() => void resendToTarget(card.targetId, { channels: ["call"], day: "d0" })}
                  >
                    Religar
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="h-7 text-[11px]"
                    disabled={busy}
                    onClick={() => void resendToTarget(card.targetId, { ctaOnly: true, day: "d0" })}
                  >
                    Reenviar botões
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="h-7 text-[11px] bg-emerald-700 hover:bg-emerald-800 text-white"
                    disabled={busy}
                    onClick={() =>
                      void resendToTarget(card.targetId, {
                        channels: ["whatsapp", "sms", "call"],
                        day: "d0",
                      })
                    }
                  >
                    Reenviar tudo
                  </Button>
                </div>
                {(card.whatsapp?.text || card.sms?.text || card.call?.text || card.cta?.text) && (
                  <details className="border-t border-border/40">
                    <summary className="cursor-pointer px-4 py-2 text-[11px] text-muted-foreground">
                      Ver textos enviados
                    </summary>
                    <div className="px-4 pb-3 space-y-2">
                      {card.whatsapp?.text && (
                        <pre className="text-[11px] whitespace-pre-wrap font-sans bg-muted/40 rounded-md p-2 m-0 max-h-40 overflow-auto">
                          {card.whatsapp.text}
                        </pre>
                      )}
                      {card.cta?.text && (
                        <pre className="text-[11px] whitespace-pre-wrap font-sans bg-emerald-500/10 rounded-md p-2 m-0 max-h-32 overflow-auto">
                          {card.cta.text}
                        </pre>
                      )}
                    </div>
                  </details>
                )}
              </div>
            );
          })}
        </TabsContent>
      </Tabs>

      <AlertDialog open={confirmLiveOpen} onOpenChange={setConfirmLiveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Enviar de verdade?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  Campanha: <strong className="text-foreground">{selected?.name}</strong>
                </p>
                <p>
                  Dia: <strong className="text-foreground">{dayView === "d0" ? "0" : "+1"}</strong>
                  {" · "}
                  Canais: <strong className="text-foreground">{channels.map((c) => CHANNEL_META[c].label).join(", ")}</strong>
                </p>
                <p>
                  Destinatários na fila: <strong className="text-foreground">{liveTargets.length}</strong>
                </p>
                <p className="text-amber-700 dark:text-amber-400 text-xs">
                  Isso manda WhatsApp / SMS / ligação reais. Não dá para desfazer.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void runDispatch(false);
              }}
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Confirmar envio"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!phoneEdit}
        onOpenChange={(open) => {
          if (!open) setPhoneEdit(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Trocar número</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm text-muted-foreground">
                <p>
                  Consultor:{" "}
                  <strong className="text-foreground">{phoneEdit?.name || "—"}</strong>
                </p>
                <p>
                  Atual:{" "}
                  <span className="font-mono text-foreground">{phoneEdit?.oldPhone}</span>
                </p>
                <div className="space-y-1.5 text-left">
                  <Label htmlFor="ps-phone-edit" className="text-foreground">
                    Novo número (com DDD)
                  </Label>
                  <Input
                    id="ps-phone-edit"
                    inputMode="tel"
                    placeholder="11999998888"
                    value={phoneEdit?.draft || ""}
                    onChange={(e) =>
                      setPhoneEdit((prev) => (prev ? { ...prev, draft: e.target.value } : prev))
                    }
                    className="font-mono"
                  />
                  <p className="text-[11px]">
                    Depois de salvar, use Religar / Reenviar no card com o número novo.
                  </p>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void savePhoneChange();
              }}
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Salvar número"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default VendaPlataformaPanel;
