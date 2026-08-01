import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Loader2,
  Save,
  Search,
  ExternalLink,
  FileText,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import {
  CATEGORIA_LABEL,
  TEXTOS_CATALOGO,
  type TextoCatalogItem,
} from "@/lib/agendamentosTextosCatalog";

type CmtRow = {
  id: string;
  consultant_id: string | null;
  template_key: string;
  label: string;
  description: string | null;
  category: string;
  text_content: string;
  variables: string[] | null;
  is_active: boolean;
};

type CadenceRow = {
  id?: string;
  stage: string;
  message_text: string | null;
  enabled: boolean;
  delay_hours: number | null;
  consultant_id: string | null;
};

type ReactivationRow = {
  id: string;
  conversation_step: string;
  message_text: string;
  send_order: number;
  auto_reactivate: boolean | null;
};

type PhraseRow = {
  id: string;
  shortcut: string | null;
  category: string | null;
  conversation_step: string | null;
  message_text: string;
  consultant_id: string | null;
  next_action?: string;
  conversion_chance?: number;
};

type PosVendaRow = {
  id: string;
  label: string;
  stage_key: string | null;
  auto_message_text: string | null;
};

type FlowStepRow = {
  id: string;
  flow_id: string;
  step_key: string | null;
  title: string | null;
  message_text: string | null;
  position: number;
};

type FlowRow = { id: string; name: string; variant: string | null };

type FlowQaRow = {
  id: string;
  flow_id: string;
  intent_name: string;
  text_response: string;
  position: number;
};

type VoiceCampRow = {
  id: string;
  name: string;
  tts_text: string | null;
  sms_on_no_answer_text: string | null;
};

type ChatTemplateRow = {
  id: string;
  name: string;
  content: string;
  shortcut: string | null;
  consultant_id: string | null;
};

type BulkCampRow = {
  id: string;
  name: string;
  message_text: string | null;
  status: string;
};

type SchedMsgRow = {
  id: string;
  message_text: string;
  scheduled_at: string;
  status: string;
  remote_jid: string;
};

type StageAutoRow = {
  id: string;
  stage_id: string;
  stage_label?: string;
  stage_key?: string;
  position: number;
  message_type: string;
  message_text: string | null;
  delay_seconds: number;
};

type AiKnowRow = {
  id: string;
  title: string;
  content: string;
  is_active: boolean;
  is_critical: boolean;
  persona: string | null;
  consultant_id: string | null;
};

type AiAgentRow = {
  consultant_id: string;
  persona_name: string | null;
  tone: string | null;
  system_prompt: string | null;
  step_prompts: Record<string, string> | null;
  enabled: boolean;
};

type RodizioRow = {
  id: string;
  slug: string;
  label: string;
  message: string | null;
  is_active: boolean;
};

type PosVendaDefaultRow = {
  stage: string;
  message_type: string;
  message_text: string | null;
  is_active: boolean;
};

type HolidayRow = {
  id: string;
  date: string;
  label: string;
  consultant_id: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  consultantId: string;
};

const GRUPO_ORDER = [
  "atendimento",
  "saudacao",
  "ia",
  "cadencia",
  "reaquecimento",
  "conversao",
  "pos-venda",
  "parceiros",
  "voz",
  "fluxos",
  "manual",
  "chat",
];

export function AgendamentosTextosDialog({ open, onOpenChange, consultantId }: Props) {
  const confirm = useConfirm();
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [grupo, setGrupo] = useState<string>("all");
  const [cmt, setCmt] = useState<CmtRow[]>([]);
  const [cadence, setCadence] = useState<CadenceRow[]>([]);
  const [reactivation, setReactivation] = useState<ReactivationRow[]>([]);
  const [phrases, setPhrases] = useState<PhraseRow[]>([]);
  const [posVenda, setPosVenda] = useState<PosVendaRow[]>([]);
  const [flows, setFlows] = useState<FlowRow[]>([]);
  const [flowSteps, setFlowSteps] = useState<FlowStepRow[]>([]);
  const [flowQa, setFlowQa] = useState<FlowQaRow[]>([]);
  const [voiceCamps, setVoiceCamps] = useState<VoiceCampRow[]>([]);
  const [chatTpl, setChatTpl] = useState<ChatTemplateRow[]>([]);
  const [bulkCamps, setBulkCamps] = useState<BulkCampRow[]>([]);
  const [schedMsgs, setSchedMsgs] = useState<SchedMsgRow[]>([]);
  const [stageAuto, setStageAuto] = useState<StageAutoRow[]>([]);
  const [aiKnow, setAiKnow] = useState<AiKnowRow[]>([]);
  const [aiAgent, setAiAgent] = useState<AiAgentRow | null>(null);
  const [rodizio, setRodizio] = useState<RodizioRow[]>([]);
  const [posVendaGlobal, setPosVendaGlobal] = useState<PosVendaDefaultRow[]>([]);
  const [holidays, setHolidays] = useState<HolidayRow[]>([]);
  const [newHolidayDate, setNewHolidayDate] = useState("");
  const [newHolidayLabel, setNewHolidayLabel] = useState("");
  const [flowFilter, setFlowFilter] = useState<string>("all");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(TEXTOS_CATALOGO[0]?.id ?? null);

  const load = useCallback(async () => {
    if (!consultantId) return;
    setLoading(true);
    const [cmtRes, cadRes, reaRes, phrRes, kanRes] = await Promise.all([
      supabase
        .from("consultant_message_templates")
        .select("id, consultant_id, template_key, label, description, category, text_content, variables, is_active")
        .or(`consultant_id.eq.${consultantId},consultant_id.is.null`),
      supabase
        .from("cadence_stage_config")
        .select("id, stage, message_text, enabled, delay_hours, consultant_id")
        .or(`consultant_id.eq.${consultantId},consultant_id.is.null`),
      supabase
        .from("reactivation_templates")
        .select("id, conversation_step, message_text, send_order, auto_reactivate")
        .eq("consultant_id", consultantId)
        .order("conversation_step")
        .order("send_order"),
      supabase
        .from("conversion_phrase_catalog")
        .select("id, shortcut, category, conversation_step, message_text, consultant_id, next_action, conversion_chance")
        .or(`consultant_id.eq.${consultantId},consultant_id.is.null`)
        .limit(200),
      supabase
        .from("kanban_stages")
        .select("id, label, stage_key, auto_message_text")
        .eq("consultant_id", consultantId)
        .eq("stage_scope", "pos_venda"),
    ]);

    if (cmtRes.error) toast.error(cmtRes.error.message);
    if (cadRes.error) toast.error(cadRes.error.message);

    // Preferência: override do consultor > global
    const byKey = new Map<string, CmtRow>();
    for (const r of (cmtRes.data || []) as CmtRow[]) {
      const cur = byKey.get(r.template_key);
      if (!cur || (r.consultant_id === consultantId && cur.consultant_id == null)) {
        byKey.set(r.template_key, r);
      }
    }
    setCmt(Array.from(byKey.values()));

    const cadByStage = new Map<string, CadenceRow>();
    for (const r of (cadRes.data || []) as CadenceRow[]) {
      const cur = cadByStage.get(r.stage);
      if (!cur || (r.consultant_id === consultantId && cur.consultant_id == null)) {
        cadByStage.set(r.stage, r);
      }
    }
    setCadence(Array.from(cadByStage.values()));
    setReactivation((reaRes.data || []) as ReactivationRow[]);
    setPhrases((phrRes.data || []) as PhraseRow[]);
    setPosVenda((kanRes.data || []) as PosVendaRow[]);

    // ── Novas fontes: fluxos, FAQ, voz, chat rápido, campanhas ──
    const flowsRes = await supabase
      .from("bot_flows")
      .select("id, name, variant, consultant_id, is_public")
      .or(`consultant_id.eq.${consultantId},is_public.eq.true`);
    const flowIds = ((flowsRes.data || []) as Array<{ id: string }>).map((f) => f.id);
    setFlows(((flowsRes.data || []) as FlowRow[]).map((f) => ({ id: f.id, name: f.name, variant: f.variant })));

    const [stepsRes, qaRes, voiceRes, chatRes, bulkRes, schedRes] = await Promise.all([
      flowIds.length
        ? supabase
            .from("bot_flow_steps")
            .select("id, flow_id, step_key, title, message_text, position")
            .in("flow_id", flowIds)
            .not("message_text", "is", null)
            .order("flow_id")
            .order("position")
        : Promise.resolve({ data: [], error: null } as any),
      flowIds.length
        ? supabase
            .from("bot_flow_qa")
            .select("id, flow_id, intent_name, text_response, position")
            .in("flow_id", flowIds)
            .order("flow_id")
            .order("position")
        : Promise.resolve({ data: [], error: null } as any),
      supabase
        .from("voice_campaigns")
        .select("id, name, tts_text, sms_on_no_answer_text")
        .eq("consultant_id", consultantId)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("message_templates")
        .select("id, name, content, shortcut, consultant_id")
        .or(`consultant_id.eq.${consultantId},is_public.eq.true`)
        .order("name")
        .limit(200),
      supabase
        .from("bulk_campaigns")
        .select("id, name, message_text, status")
        .eq("consultant_id", consultantId)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("scheduled_messages")
        .select("id, message_text, scheduled_at, status, remote_jid")
        .eq("consultant_id", consultantId)
        .in("status", ["pending", "scheduled", "queued"])
        .order("scheduled_at", { ascending: true })
        .limit(100),
    ]);

    setFlowSteps((stepsRes.data || []) as FlowStepRow[]);
    setFlowQa((qaRes.data || []) as FlowQaRow[]);
    setVoiceCamps((voiceRes.data || []) as VoiceCampRow[]);
    setChatTpl((chatRes.data || []) as ChatTemplateRow[]);
    setBulkCamps((bulkRes.data || []) as BulkCampRow[]);
    setSchedMsgs((schedRes.data || []) as SchedMsgRow[]);

    // ── Fontes adicionais: CRM, IA (RAG + agente), Rodízio, Pós-venda global, Calendário ──
    const [stageAutoRes, aiKnowRes, aiAgentRes, rodizioRes, posGlobalRes, holidaysRes] = await Promise.all([
      (supabase as any)
        .from("stage_auto_messages")
        .select("id, stage_id, position, message_type, message_text, delay_seconds, kanban_stages!inner(label, stage_key, consultant_id)")
        .eq("kanban_stages.consultant_id", consultantId)
        .order("position")
        .limit(300),
      supabase
        .from("ai_knowledge_sections")
        .select("id, title, content, is_active, is_critical, persona, consultant_id")
        .or(`consultant_id.eq.${consultantId},consultant_id.is.null`)
        .order("position")
        .limit(200),
      supabase
        .from("ai_agent_config")
        .select("consultant_id, persona_name, tone, system_prompt, step_prompts, enabled")
        .eq("consultant_id", consultantId)
        .maybeSingle(),
      supabase
        .from("rodizio_pools")
        .select("id, slug, label, message, is_active")
        .eq("consultant_id", consultantId)
        .order("label"),
      supabase
        .from("pos_venda_default_media")
        .select("stage, message_type, message_text, is_active")
        .order("stage"),
      supabase
        .from("holidays")
        .select("id, date, label, consultant_id")
        .or(`consultant_id.eq.${consultantId},consultant_id.is.null`)
        .order("date", { ascending: true })
        .limit(200),
    ]);

    setStageAuto(
      ((stageAutoRes.data || []) as any[]).map((r) => ({
        id: r.id,
        stage_id: r.stage_id,
        stage_label: r.kanban_stages?.label,
        stage_key: r.kanban_stages?.stage_key,
        position: r.position,
        message_type: r.message_type,
        message_text: r.message_text,
        delay_seconds: r.delay_seconds,
      })),
    );
    setAiKnow((aiKnowRes.data || []) as AiKnowRow[]);
    // Fonte da verdade do nome da IA é `consultants.assistant_name` (é o que o
    // runtime lê em ai-agent-router / render-vars). `ai_agent_config.persona_name`
    // é só espelho legado — exibimos sempre o valor real do consultor.
    const { data: consRow } = await supabase
      .from("consultants")
      .select("assistant_name")
      .eq("id", consultantId)
      .maybeSingle();
    const realAssistantName = ((consRow as { assistant_name?: string | null } | null)?.assistant_name || "").trim();
    const agentRow = (aiAgentRes.data as AiAgentRow) || null;
    setAiAgent(
      agentRow
        ? { ...agentRow, persona_name: realAssistantName || agentRow.persona_name }
        : realAssistantName
          ? ({ consultant_id: consultantId, persona_name: realAssistantName, tone: null, system_prompt: null, step_prompts: null, enabled: null } as unknown as AiAgentRow)
          : null,
    );
    setRodizio((rodizioRes.data || []) as RodizioRow[]);
    setPosVendaGlobal((posGlobalRes.data || []) as PosVendaDefaultRow[]);
    setHolidays((holidaysRes.data || []) as HolidayRow[]);

    setDrafts({});
    setLoading(false);
  }, [consultantId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const filteredCatalog = useMemo(() => {
    const term = q.trim().toLowerCase();
    return TEXTOS_CATALOGO.filter((t) => {
      if (grupo !== "all" && t.grupo !== grupo) return false;
      if (!term) return true;
      const blob = `${t.nome} ${t.oQueFaz} ${t.templateKey ?? ""} ${t.cadenceStage ?? ""}`.toLowerCase();
      return blob.includes(term);
    });
  }, [q, grupo]);

  const selected = TEXTOS_CATALOGO.find((t) => t.id === selectedId) ?? null;

  function textForCatalogItem(item: TextoCatalogItem): string {
    if (item.templateKey) {
      const row = cmt.find((r) => r.template_key === item.templateKey);
      return drafts[`cmt:${item.templateKey}`] ?? row?.text_content ?? "";
    }
    if (item.cadenceStage) {
      const row = cadence.find((r) => r.stage === item.cadenceStage);
      return drafts[`cad:${item.cadenceStage}`] ?? row?.message_text ?? "";
    }
    return "";
  }

  function setTextForCatalogItem(item: TextoCatalogItem, value: string) {
    if (item.templateKey) {
      setDrafts((d) => ({ ...d, [`cmt:${item.templateKey}`]: value }));
      return;
    }
    if (item.cadenceStage) {
      setDrafts((d) => ({ ...d, [`cad:${item.cadenceStage}`]: value }));
    }
  }

  function isDirty(item: TextoCatalogItem): boolean {
    if (item.templateKey) return drafts[`cmt:${item.templateKey}`] !== undefined;
    if (item.cadenceStage) return drafts[`cad:${item.cadenceStage}`] !== undefined;
    return false;
  }

  async function saveCatalogItem(item: TextoCatalogItem) {
    const text = textForCatalogItem(item);
    setSaving(item.id);
    try {
      if (item.templateKey) {
        const base = cmt.find((r) => r.template_key === item.templateKey);
        const { error } = await supabase.from("consultant_message_templates").upsert(
          {
            consultant_id: consultantId,
            template_key: item.templateKey,
            label: base?.label ?? item.nome,
            description: base?.description ?? item.oQueFaz,
            category: base?.category ?? item.grupo,
            text_content: text,
            variables: base?.variables ?? [],
            is_active: true,
          },
          { onConflict: "consultant_id,template_key" },
        );
        if (error) throw error;
        setDrafts((d) => {
          const n = { ...d };
          delete n[`cmt:${item.templateKey}`];
          return n;
        });
        toast.success(`Salvo: ${item.nome}`);
        await load();
        return;
      }
      if (item.cadenceStage) {
        const existing = cadence.find((r) => r.stage === item.cadenceStage);
        if (existing?.id && existing.consultant_id === consultantId) {
          const { error } = await supabase
            .from("cadence_stage_config")
            .update({ message_text: text })
            .eq("id", existing.id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from("cadence_stage_config").upsert(
            {
              consultant_id: consultantId,
              stage: item.cadenceStage,
              message_text: text,
              enabled: existing?.enabled ?? true,
              delay_hours: existing?.delay_hours ?? 24,
            },
            { onConflict: "consultant_id,stage" },
          );
          if (error) throw error;
        }
        setDrafts((d) => {
          const n = { ...d };
          delete n[`cad:${item.cadenceStage}`];
          return n;
        });
        toast.success(`Cadência ${item.cadenceStage} salva`);
        await load();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(null);
    }
  }

  async function saveReactivation(row: ReactivationRow) {
    const key = `rea:${row.id}`;
    const text = drafts[key] ?? row.message_text;
    setSaving(key);
    const { error } = await supabase
      .from("reactivation_templates")
      .update({ message_text: text })
      .eq("id", row.id);
    setSaving(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    setDrafts((d) => {
      const n = { ...d };
      delete n[key];
      return n;
    });
    toast.success("Reaquecimento atualizado");
    await load();
  }

  async function savePhrase(row: PhraseRow) {
    const key = `phr:${row.id}`;
    const text = drafts[key] ?? row.message_text;
    setSaving(key);
    if (!row.consultant_id) {
      const { error } = await supabase.from("conversion_phrase_catalog").insert({
        consultant_id: consultantId,
        shortcut: row.shortcut || `custom_${Date.now()}`,
        category: row.category || "followup",
        conversation_step: row.conversation_step,
        message_text: text,
        next_action: row.next_action || "wait",
        conversion_chance: row.conversion_chance ?? 50,
      });
      setSaving(null);
      if (error) {
        toast.error(error.message);
        return;
      }
    } else {
      const { error } = await supabase
        .from("conversion_phrase_catalog")
        .update({ message_text: text })
        .eq("id", row.id);
      setSaving(null);
      if (error) {
        toast.error(error.message);
        return;
      }
    }
    setDrafts((d) => {
      const n = { ...d };
      delete n[key];
      return n;
    });
    toast.success("Frase salva");
    await load();
  }

  async function savePosVenda(row: PosVendaRow) {
    const key = `pv:${row.id}`;
    const text = drafts[key] ?? row.auto_message_text ?? "";
    setSaving(key);
    const { error } = await supabase
      .from("kanban_stages")
      .update({ auto_message_text: text })
      .eq("id", row.id);
    setSaving(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    setDrafts((d) => {
      const n = { ...d };
      delete n[key];
      return n;
    });
    toast.success("Pós-venda atualizado");
    await load();
  }

  // ── Savers das novas fontes ──
  async function saveSimple(
    table:
      | "bot_flow_steps"
      | "bot_flow_qa"
      | "voice_campaigns"
      | "message_templates"
      | "bulk_campaigns"
      | "scheduled_messages"
      | "stage_auto_messages"
      | "ai_knowledge_sections"
      | "rodizio_pools",
    id: string,
    field: string,
    key: string,
    fallback: string | null,
    label: string,
  ) {
    const text = drafts[key] ?? fallback ?? "";
    setSaving(key);
    const { error } = await (supabase as any).from(table).update({ [field]: text }).eq("id", id);
    setSaving(null);
    if (error) { toast.error(error.message); return; }
    setDrafts((d) => { const n = { ...d }; delete n[key]; return n; });
    toast.success(`${label} salvo`);
    await load();
  }

  async function savePosGlobal(row: PosVendaDefaultRow) {
    const key = `pvg:${row.stage}`;
    const text = drafts[key] ?? row.message_text ?? "";
    setSaving(key);
    const { error } = await (supabase as any)
      .from("pos_venda_default_media")
      .update({ message_text: text })
      .eq("stage", row.stage);
    setSaving(null);
    if (error) { toast.error(error.message); return; }
    setDrafts((d) => { const n = { ...d }; delete n[key]; return n; });
    toast.success("Legenda salva");
    await load();
  }

  async function saveAiAgent(field: "system_prompt" | "persona_name" | "tone") {
    const key = `agent:${field}`;
    const text = drafts[key];
    if (text === undefined) return;
    setSaving(key);

    // O nome da IA é lido em produção de `consultants.assistant_name`.
    // Sem gravar lá, salvar aqui não mudava nada no bot (e ainda pulava o
    // trigger de nomes reservados). Grava primeiro na fonte da verdade.
    if (field === "persona_name") {
      const nome = text.trim();
      if (!nome) { setSaving(null); toast.error("Informe o nome da IA"); return; }
      const { error: consErr } = await supabase
        .from("consultants")
        .update({ assistant_name: nome })
        .eq("id", consultantId);
      if (consErr) {
        setSaving(null);
        toast.error(
          /reserv/i.test(consErr.message)
            ? `O nome "${nome}" é reservado/já pertence a outro consultor. Escolha outro.`
            : consErr.message,
        );
        return;
      }
    }

    const { error } = await (supabase as any)
      .from("ai_agent_config")
      .upsert(
        { consultant_id: consultantId, [field]: field === "persona_name" ? text.trim() : text },
        { onConflict: "consultant_id" },
      );
    setSaving(null);
    if (error) { toast.error(error.message); return; }
    setDrafts((d) => { const n = { ...d }; delete n[key]; return n; });
    toast.success("Agente IA atualizado");
    await load();
  }


  async function addHoliday() {
    if (!newHolidayDate || !newHolidayLabel) {
      toast.error("Preencha data e nome");
      return;
    }
    setSaving("new-holiday");
    const { error } = await supabase.from("holidays").insert({
      date: newHolidayDate,
      label: newHolidayLabel,
      consultant_id: consultantId,
    });
    setSaving(null);
    if (error) { toast.error(error.message); return; }
    setNewHolidayDate(""); setNewHolidayLabel("");
    toast.success("Feriado adicionado");
    await load();
  }

  async function removeHoliday(id: string) {
    const ok = await confirm({
      title: "Remover este feriado?",
      confirmText: "Remover",
      cancelText: "Cancelar",
      tone: "danger",
    });
    if (!ok) return;
    const { error } = await supabase.from("holidays").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Feriado removido");
    await load();
  }

  const grupos = useMemo(() => {
    const s = new Set(TEXTOS_CATALOGO.map((t) => t.grupo));
    return GRUPO_ORDER.filter((g) => s.has(g));
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-[96vw] h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <FileText className="h-5 w-5 text-primary" />
            Todos os textos ajustáveis
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            Catálogo completo de mensagens de agendamento, atendimento, retenção, mensagens automáticas,
            reaquecimento, pós-venda e links para fluxos/voz. Salvar aqui grava o seu override —
            o envio automático só acontece se o toggle correspondente estiver ligado.
          </DialogDescription>
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                className="pl-8 h-9 rounded-xl text-sm"
                placeholder="Buscar texto…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <Badge variant="outline" className="text-[10px]">
              {TEXTOS_CATALOGO.length} fixos + {flowSteps.length + flowQa.length + voiceCamps.length + chatTpl.length + bulkCamps.length + schedMsgs.length + reactivation.length + phrases.length + posVenda.length} dinâmicos
            </Badge>
            {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
        </DialogHeader>

        <Tabs defaultValue="catalogo" className="flex-1 flex flex-col min-h-0">
          <TabsList className="mx-4 mt-3 w-auto justify-start flex-wrap h-auto gap-1 bg-transparent p-0">
            <TabsTrigger value="catalogo" className="rounded-xl text-xs">Catálogo</TabsTrigger>
            <TabsTrigger value="reaquecimento" className="rounded-xl text-xs">
              Reaquecimento ({reactivation.length})
            </TabsTrigger>
            <TabsTrigger value="frases" className="rounded-xl text-xs">
              Frases ({phrases.length})
            </TabsTrigger>
            <TabsTrigger value="posvenda" className="rounded-xl text-xs">
              Pós-venda ({posVenda.length})
            </TabsTrigger>
            <TabsTrigger value="fluxos" className="rounded-xl text-xs">
              Fluxos ({flowSteps.length})
            </TabsTrigger>
            <TabsTrigger value="faq" className="rounded-xl text-xs">
              FAQ ({flowQa.length})
            </TabsTrigger>
            <TabsTrigger value="voz" className="rounded-xl text-xs">
              Voz ({voiceCamps.length})
            </TabsTrigger>
            <TabsTrigger value="chat" className="rounded-xl text-xs">
              Chat ({chatTpl.length})
            </TabsTrigger>
            <TabsTrigger value="campanhas" className="rounded-xl text-xs">
              Campanhas ({bulkCamps.length + schedMsgs.length})
            </TabsTrigger>
            <TabsTrigger value="crm" className="rounded-xl text-xs">CRM ({stageAuto.length})</TabsTrigger>
            <TabsTrigger value="ia-rag" className="rounded-xl text-xs">IA Conhecimento ({aiKnow.length})</TabsTrigger>
            <TabsTrigger value="ia-agente" className="rounded-xl text-xs">IA Personalidade</TabsTrigger>
            <TabsTrigger value="rodizio" className="rounded-xl text-xs">Rodízio ({rodizio.length})</TabsTrigger>
            <TabsTrigger value="posvenda-global" className="rounded-xl text-xs">Pós-venda global ({posVendaGlobal.length})</TabsTrigger>
            <TabsTrigger value="calendario" className="rounded-xl text-xs">Calendário ({holidays.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="catalogo" className="flex-1 min-h-0 mt-0 data-[state=inactive]:hidden">
            <div className="flex h-full min-h-0 flex-col md:flex-row">
              <aside className="w-full md:w-[280px] shrink-0 border-b md:border-b-0 md:border-r flex flex-col min-h-0 max-h-[40vh] md:max-h-none">
                <div className="p-2 flex flex-wrap gap-1 border-b">
                  <Button
                    type="button"
                    size="sm"
                    variant={grupo === "all" ? "default" : "ghost"}
                    className="h-7 text-[10px] rounded-lg"
                    onClick={() => setGrupo("all")}
                  >
                    Todos
                  </Button>
                  {grupos.map((g) => (
                    <Button
                      key={g}
                      type="button"
                      size="sm"
                      variant={grupo === g ? "default" : "ghost"}
                      className="h-7 text-[10px] rounded-lg"
                      onClick={() => setGrupo(g)}
                    >
                      {CATEGORIA_LABEL[g]?.split(" ")[0] ?? g}
                    </Button>
                  ))}
                </div>
                <ScrollArea className="flex-1">
                  <div className="p-2 space-y-1">
                    {filteredCatalog.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setSelectedId(item.id)}
                        className={cn(
                          "w-full text-left rounded-xl px-2.5 py-2 text-xs transition-colors border",
                          selectedId === item.id
                            ? "border-primary/40 bg-primary/10"
                            : "border-transparent hover:bg-muted/60",
                        )}
                      >
                        <div className="flex items-start justify-between gap-1">
                          <span className="font-medium leading-snug">{item.nome}</span>
                          {item.prioridade === "alta" && (
                            <AlertTriangle className="h-3 w-3 text-amber-600 shrink-0 mt-0.5" />
                          )}
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">
                          {CATEGORIA_LABEL[item.grupo] ?? item.grupo}
                        </p>
                        {isDirty(item) && (
                          <Badge className="mt-1 text-[9px] h-4" variant="secondary">
                            não salvo
                          </Badge>
                        )}
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              </aside>

              <div className="flex-1 min-w-0 flex flex-col p-4 gap-3 overflow-auto">
                {!selected ? (
                  <p className="text-sm text-muted-foreground">Selecione um texto à esquerda.</p>
                ) : selected.fonte === "externo" ? (
                  <div className="space-y-3">
                    <h3 className="font-semibold text-base">{selected.nome}</h3>
                    <p className="text-sm text-muted-foreground">{selected.oQueFaz}</p>
                    <div className="rounded-xl border bg-muted/30 p-3 text-sm">
                      {selected.externoHint}
                    </div>
                    {selected.id === "ext_motor_cadencia" && (
                      <Button asChild variant="outline" className="rounded-xl w-fit">
                        <Link to="/admin/motor">
                          <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                          Abrir Motor de Cadência
                        </Link>
                      </Button>
                    )}
                    {selected.toggle && (
                      <p className="text-[11px] text-muted-foreground">
                        Toggle relacionado: <code>{selected.toggle}</code>
                      </p>
                    )}
                  </div>
                ) : selected.fonte === "reactivation_templates" ||
                  selected.fonte === "conversion_phrase_catalog" ||
                  selected.fonte === "kanban_pos_venda" ||
                  selected.fonte === "bot_flow_steps" ||
                  selected.fonte === "bot_flow_qa" ||
                  selected.fonte === "voice_campaigns" ||
                  selected.fonte === "message_templates" ||
                  selected.fonte === "bulk_campaigns" ||
                  selected.fonte === "scheduled_messages" ? (
                  <div className="space-y-2">
                    <h3 className="font-semibold">{selected.nome}</h3>
                    <p className="text-sm text-muted-foreground">{selected.oQueFaz}</p>
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      Use a aba correspondente acima para editar a lista completa.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3 flex flex-col flex-1 min-h-0">
                    <div>
                      <h3 className="font-semibold text-base">{selected.nome}</h3>
                      <p className="text-sm text-muted-foreground mt-1">{selected.oQueFaz}</p>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        <Badge variant="outline" className="text-[10px]">
                          {CATEGORIA_LABEL[selected.grupo]}
                        </Badge>
                        {selected.toggle && (
                          <Badge variant="secondary" className="text-[10px]">
                            toggle: {selected.toggle}
                          </Badge>
                        )}
                        {selected.templateKey && (
                          <Badge variant="outline" className="text-[10px] font-mono">
                            {selected.templateKey}
                          </Badge>
                        )}
                        {selected.cadenceStage && (
                          <Badge variant="outline" className="text-[10px] font-mono">
                            {selected.cadenceStage}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <Textarea
                      className="min-h-[220px] flex-1 font-mono text-sm rounded-xl"
                      value={textForCatalogItem(selected)}
                      onChange={(e) => setTextForCatalogItem(selected, e.target.value)}
                      placeholder="Texto da mensagem…"
                    />
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        className="rounded-xl"
                        disabled={saving === selected.id || !isDirty(selected)}
                        onClick={() => void saveCatalogItem(selected)}
                      >
                        {saving === selected.id ? (
                          <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                        ) : (
                          <Save className="h-3.5 w-3.5 mr-1.5" />
                        )}
                        Salvar meu texto
                      </Button>
                      <p className="text-[11px] text-muted-foreground">
                        Variáveis: use {"{{nome}}"}, {"{{consultor}}"}, {"{{protocolo}}"} etc.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="reaquecimento" className="flex-1 min-h-0 mt-0 overflow-auto p-4 space-y-3">
            {reactivation.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhum template de reaquecimento ainda. Crie em Conversão / Reaquecimento.
              </p>
            ) : (
              reactivation.map((row) => {
                const key = `rea:${row.id}`;
                const dirty = drafts[key] !== undefined;
                return (
                  <div key={row.id} className="rounded-xl border p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">{row.conversation_step}</p>
                        <p className="text-[10px] text-muted-foreground">
                          ordem {row.send_order}
                          {row.auto_reactivate ? " · auto" : ""}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        className="rounded-xl"
                        disabled={!dirty || saving === key}
                        onClick={() => void saveReactivation(row)}
                      >
                        <Save className="h-3.5 w-3.5 mr-1" /> Salvar
                      </Button>
                    </div>
                    <Textarea
                      className="min-h-[100px] text-sm rounded-xl"
                      value={drafts[key] ?? row.message_text}
                      onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                    />
                  </div>
                );
              })
            )}
          </TabsContent>

          <TabsContent value="frases" className="flex-1 min-h-0 mt-0 overflow-auto p-4 space-y-3">
            {phrases.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma frase no catálogo.</p>
            ) : (
              phrases.map((row) => {
                const key = `phr:${row.id}`;
                const dirty = drafts[key] !== undefined;
                return (
                  <div key={row.id} className="rounded-xl border p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">
                          {row.shortcut || row.conversation_step || row.category || "frase"}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {[row.category, row.conversation_step].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        className="rounded-xl"
                        disabled={!dirty || saving === key}
                        onClick={() => void savePhrase(row)}
                      >
                        <Save className="h-3.5 w-3.5 mr-1" /> Salvar
                      </Button>
                    </div>
                    <Textarea
                      className="min-h-[80px] text-sm rounded-xl"
                      value={drafts[key] ?? row.message_text}
                      onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                    />
                  </div>
                );
              })
            )}
          </TabsContent>

          <TabsContent value="posvenda" className="flex-1 min-h-0 mt-0 overflow-auto p-4 space-y-3">
            {posVenda.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhuma coluna pós-venda configurada para este consultor.
              </p>
            ) : (
              posVenda.map((row) => {
                const key = `pv:${row.id}`;
                const dirty = drafts[key] !== undefined;
                return (
                  <div key={row.id} className="rounded-xl border p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">{row.label}</p>
                        <p className="text-[10px] text-muted-foreground font-mono">
                          {row.stage_key}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        className="rounded-xl"
                        disabled={!dirty || saving === key}
                        onClick={() => void savePosVenda(row)}
                      >
                        <Save className="h-3.5 w-3.5 mr-1" /> Salvar
                      </Button>
                    </div>
                    <Textarea
                      className="min-h-[100px] text-sm rounded-xl"
                      value={drafts[key] ?? row.auto_message_text ?? ""}
                      onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                    />
                  </div>
                );
              })
            )}
          </TabsContent>

          {/* ── Fluxos ── */}
          <TabsContent value="fluxos" className="flex-1 min-h-0 mt-0 overflow-auto p-4 space-y-3">
            <div className="flex flex-wrap gap-1">
              <Button size="sm" variant={flowFilter === "all" ? "default" : "ghost"} className="h-7 text-[10px] rounded-lg" onClick={() => setFlowFilter("all")}>Todos</Button>
              {flows.map((f) => (
                <Button key={f.id} size="sm" variant={flowFilter === f.id ? "default" : "ghost"} className="h-7 text-[10px] rounded-lg" onClick={() => setFlowFilter(f.id)}>
                  {f.name} {f.variant ? `· ${f.variant}` : ""}
                </Button>
              ))}
            </div>
            {flowSteps.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum passo com texto encontrado.</p>
            ) : (
              flowSteps
                .filter((s) => flowFilter === "all" || s.flow_id === flowFilter)
                .filter((s) => !q.trim() || (s.title || "").toLowerCase().includes(q.toLowerCase()) || (s.step_key || "").toLowerCase().includes(q.toLowerCase()) || (s.message_text || "").toLowerCase().includes(q.toLowerCase()))
                .map((row) => {
                  const key = `step:${row.id}`;
                  const dirty = drafts[key] !== undefined;
                  const flow = flows.find((f) => f.id === row.flow_id);
                  return (
                    <div key={row.id} className="rounded-xl border p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium">{row.title || row.step_key || "passo"}</p>
                          <p className="text-[10px] text-muted-foreground font-mono">
                            {flow?.name ?? "?"} · {row.step_key} · pos {row.position}
                          </p>
                        </div>
                        <Button size="sm" className="rounded-xl" disabled={!dirty || saving === key}
                          onClick={() => void saveSimple("bot_flow_steps", row.id, "message_text", key, row.message_text, "Passo")}>
                          <Save className="h-3.5 w-3.5 mr-1" /> Salvar
                        </Button>
                      </div>
                      <Textarea className="min-h-[100px] text-sm rounded-xl"
                        value={drafts[key] ?? row.message_text ?? ""}
                        onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                      />
                    </div>
                  );
                })
            )}
          </TabsContent>

          {/* ── FAQ ── */}
          <TabsContent value="faq" className="flex-1 min-h-0 mt-0 overflow-auto p-4 space-y-3">
            <div className="flex flex-wrap gap-1">
              <Button size="sm" variant={flowFilter === "all" ? "default" : "ghost"} className="h-7 text-[10px] rounded-lg" onClick={() => setFlowFilter("all")}>Todos</Button>
              {flows.map((f) => (
                <Button key={f.id} size="sm" variant={flowFilter === f.id ? "default" : "ghost"} className="h-7 text-[10px] rounded-lg" onClick={() => setFlowFilter(f.id)}>
                  {f.name}
                </Button>
              ))}
            </div>
            {flowQa.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma pergunta no FAQ.</p>
            ) : (
              flowQa
                .filter((qa) => flowFilter === "all" || qa.flow_id === flowFilter)
                .filter((qa) => !q.trim() || qa.intent_name.toLowerCase().includes(q.toLowerCase()) || (qa.text_response || "").toLowerCase().includes(q.toLowerCase()))
                .map((row) => {
                  const key = `qa:${row.id}`;
                  const dirty = drafts[key] !== undefined;
                  const flow = flows.find((f) => f.id === row.flow_id);
                  return (
                    <div key={row.id} className="rounded-xl border p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium">{row.intent_name}</p>
                          <p className="text-[10px] text-muted-foreground font-mono">{flow?.name ?? "?"} · pos {row.position}</p>
                        </div>
                        <Button size="sm" className="rounded-xl" disabled={!dirty || saving === key}
                          onClick={() => void saveSimple("bot_flow_qa", row.id, "text_response", key, row.text_response, "FAQ")}>
                          <Save className="h-3.5 w-3.5 mr-1" /> Salvar
                        </Button>
                      </div>
                      <Textarea className="min-h-[80px] text-sm rounded-xl"
                        value={drafts[key] ?? row.text_response ?? ""}
                        onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                      />
                    </div>
                  );
                })
            )}
          </TabsContent>

          {/* ── Voz ── */}
          <TabsContent value="voz" className="flex-1 min-h-0 mt-0 overflow-auto p-4 space-y-3">
            {voiceCamps.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma campanha de voz.</p>
            ) : voiceCamps.map((row) => {
              const keyT = `vtts:${row.id}`;
              const keyS = `vsms:${row.id}`;
              return (
                <div key={row.id} className="rounded-xl border p-3 space-y-3">
                  <p className="text-sm font-medium">{row.name}</p>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] text-muted-foreground">TTS (texto da ligação)</p>
                      <Button size="sm" className="rounded-xl" disabled={drafts[keyT] === undefined || saving === keyT}
                        onClick={() => void saveSimple("voice_campaigns", row.id, "tts_text", keyT, row.tts_text, "TTS")}>
                        <Save className="h-3.5 w-3.5 mr-1" /> Salvar
                      </Button>
                    </div>
                    <Textarea className="min-h-[70px] text-sm rounded-xl"
                      value={drafts[keyT] ?? row.tts_text ?? ""}
                      onChange={(e) => setDrafts((d) => ({ ...d, [keyT]: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] text-muted-foreground">SMS pós-NA (se não atender)</p>
                      <Button size="sm" className="rounded-xl" disabled={drafts[keyS] === undefined || saving === keyS}
                        onClick={() => void saveSimple("voice_campaigns", row.id, "sms_on_no_answer_text", keyS, row.sms_on_no_answer_text, "SMS")}>
                        <Save className="h-3.5 w-3.5 mr-1" /> Salvar
                      </Button>
                    </div>
                    <Textarea className="min-h-[60px] text-sm rounded-xl"
                      value={drafts[keyS] ?? row.sms_on_no_answer_text ?? ""}
                      onChange={(e) => setDrafts((d) => ({ ...d, [keyS]: e.target.value }))}
                    />
                  </div>
                </div>
              );
            })}
          </TabsContent>

          {/* ── Chat rápido ── */}
          <TabsContent value="chat" className="flex-1 min-h-0 mt-0 overflow-auto p-4 space-y-3">
            {chatTpl.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum template rápido.</p>
            ) : chatTpl
                .filter((t) => !q.trim() || t.name.toLowerCase().includes(q.toLowerCase()) || (t.content || "").toLowerCase().includes(q.toLowerCase()))
                .map((row) => {
              const key = `mt:${row.id}`;
              const dirty = drafts[key] !== undefined;
              const readOnly = row.consultant_id !== consultantId;
              return (
                <div key={row.id} className="rounded-xl border p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">{row.name}{row.shortcut ? ` · /${row.shortcut}` : ""}</p>
                      {readOnly && <p className="text-[10px] text-amber-600">Template público — salve para criar sua cópia (em breve).</p>}
                    </div>
                    <Button size="sm" className="rounded-xl" disabled={!dirty || saving === key || readOnly}
                      onClick={() => void saveSimple("message_templates", row.id, "content", key, row.content, "Template")}>
                      <Save className="h-3.5 w-3.5 mr-1" /> Salvar
                    </Button>
                  </div>
                  <Textarea className="min-h-[80px] text-sm rounded-xl"
                    readOnly={readOnly}
                    value={drafts[key] ?? row.content ?? ""}
                    onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                  />
                </div>
              );
            })}
          </TabsContent>

          {/* ── Campanhas / Agenda ── */}
          <TabsContent value="campanhas" className="flex-1 min-h-0 mt-0 overflow-auto p-4 space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase text-muted-foreground mb-2">Disparo PRO ({bulkCamps.length})</p>
              {bulkCamps.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nenhuma campanha em massa.</p>
              ) : bulkCamps.map((row) => {
                const key = `bulk:${row.id}`;
                const dirty = drafts[key] !== undefined;
                return (
                  <div key={row.id} className="rounded-xl border p-3 space-y-2 mb-2">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">{row.name}</p>
                        <p className="text-[10px] text-muted-foreground">status: {row.status}</p>
                      </div>
                      <Button size="sm" className="rounded-xl" disabled={!dirty || saving === key}
                        onClick={() => void saveSimple("bulk_campaigns", row.id, "message_text", key, row.message_text, "Campanha")}>
                        <Save className="h-3.5 w-3.5 mr-1" /> Salvar
                      </Button>
                    </div>
                    <Textarea className="min-h-[80px] text-sm rounded-xl"
                      value={drafts[key] ?? row.message_text ?? ""}
                      onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                    />
                  </div>
                );
              })}
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-muted-foreground mb-2">Agenda ({schedMsgs.length})</p>
              {schedMsgs.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nenhuma mensagem agendada.</p>
              ) : schedMsgs.map((row) => {
                const key = `sch:${row.id}`;
                const dirty = drafts[key] !== undefined;
                return (
                  <div key={row.id} className="rounded-xl border p-3 space-y-2 mb-2">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">{row.remote_jid}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {new Date(row.scheduled_at).toLocaleString("pt-BR")} · {row.status}
                        </p>
                      </div>
                      <Button size="sm" className="rounded-xl" disabled={!dirty || saving === key}
                        onClick={() => void saveSimple("scheduled_messages", row.id, "message_text", key, row.message_text, "Agenda")}>
                        <Save className="h-3.5 w-3.5 mr-1" /> Salvar
                      </Button>
                    </div>
                    <Textarea className="min-h-[70px] text-sm rounded-xl"
                      value={drafts[key] ?? row.message_text ?? ""}
                      onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                    />
                  </div>
                );
              })}
            </div>
          </TabsContent>

          <TabsContent value="crm" className="flex-1 min-h-0 mt-0 overflow-auto p-4 space-y-3">
            <p className="text-xs text-muted-foreground">Mensagens automáticas disparadas quando um card entra numa coluna do CRM.</p>
            {stageAuto.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma mensagem automática configurada. Configure em CRM &gt; coluna.</p>}
            {stageAuto.map((r) => {
              const key = `sam:${r.id}`;
              const val = drafts[key] ?? r.message_text ?? "";
              const dirty = drafts[key] !== undefined;
              return (
                <div key={r.id} className="border rounded-xl p-3 space-y-2">
                  <div className="flex items-center gap-2 text-xs">
                    <Badge variant="outline">{r.stage_label || r.stage_key}</Badge>
                    <span className="text-muted-foreground">#{r.position} · {r.message_type} · +{r.delay_seconds}s</span>
                    {dirty && <Badge variant="secondary" className="ml-auto">não salvo</Badge>}
                  </div>
                  <Textarea rows={3} value={val} onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))} />
                  <div className="flex justify-end">
                    <Button size="sm" disabled={!dirty || saving === key} onClick={() => saveSimple("stage_auto_messages", r.id, "message_text", key, r.message_text, "Mensagem CRM")}>
                      {saving === key ? "Salvando…" : "Salvar"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </TabsContent>

          <TabsContent value="ia-rag" className="flex-1 min-h-0 mt-0 overflow-auto p-4 space-y-3">
            <p className="text-xs text-muted-foreground">Seções que a IA vendedora consulta (RAG). Edite o conteúdo — títulos são fixos.</p>
            {aiKnow.map((r) => {
              const key = `rag:${r.id}`;
              const val = drafts[key] ?? r.content ?? "";
              const dirty = drafts[key] !== undefined;
              return (
                <div key={r.id} className="border rounded-xl p-3 space-y-2">
                  <div className="flex items-center gap-2 text-xs">
                    <Badge variant="outline">{r.title}</Badge>
                    {r.is_critical && <Badge variant="destructive">crítico</Badge>}
                    {!r.is_active && <Badge variant="secondary">inativo</Badge>}
                    {!r.consultant_id && <Badge variant="secondary">global</Badge>}
                    {dirty && <Badge variant="secondary" className="ml-auto">não salvo</Badge>}
                  </div>
                  <Textarea rows={5} value={val} onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))} />
                  <div className="flex justify-end">
                    <Button size="sm" disabled={!dirty || saving === key} onClick={() => saveSimple("ai_knowledge_sections", r.id, "content", key, r.content, "Conhecimento IA")}>
                      {saving === key ? "Salvando…" : "Salvar"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </TabsContent>

          <TabsContent value="ia-agente" className="flex-1 min-h-0 mt-0 overflow-auto p-4 space-y-4">
            <p className="text-xs text-muted-foreground">Personalidade, tom e prompt-mestre do agente IA.</p>
            {(["persona_name", "tone", "system_prompt"] as const).map((field) => {
              const key = `agent:${field}`;
              const current = (aiAgent as any)?.[field] ?? "";
              const val = drafts[key] ?? current;
              const dirty = drafts[key] !== undefined;
              const labels: Record<string, string> = { persona_name: "Nome da persona", tone: "Tom (formal, próximo, direto…)", system_prompt: "System prompt (instruções gerais)" };
              return (
                <div key={field} className="border rounded-xl p-3 space-y-2">
                  <div className="flex items-center gap-2 text-xs">
                    <Badge variant="outline">{labels[field]}</Badge>
                    {dirty && <Badge variant="secondary" className="ml-auto">não salvo</Badge>}
                  </div>
                  <Textarea rows={field === "system_prompt" ? 10 : 2} value={val} onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))} />
                  <div className="flex justify-end">
                    <Button size="sm" disabled={!dirty || saving === key} onClick={() => saveAiAgent(field)}>
                      {saving === key ? "Salvando…" : "Salvar"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </TabsContent>

          <TabsContent value="rodizio" className="flex-1 min-h-0 mt-0 overflow-auto p-4 space-y-3">
            <p className="text-xs text-muted-foreground">Mensagem enviada aos parceiros quando um lead entra no rodízio.</p>
            {rodizio.map((r) => {
              const key = `rod:${r.id}`;
              const val = drafts[key] ?? r.message ?? "";
              const dirty = drafts[key] !== undefined;
              return (
                <div key={r.id} className="border rounded-xl p-3 space-y-2">
                  <div className="flex items-center gap-2 text-xs">
                    <Badge variant="outline">{r.label}</Badge>
                    <span className="text-muted-foreground">{r.slug}</span>
                    {!r.is_active && <Badge variant="secondary">pausado</Badge>}
                    {dirty && <Badge variant="secondary" className="ml-auto">não salvo</Badge>}
                  </div>
                  <Textarea rows={4} value={val} onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))} placeholder="Use {nome}, {telefone}, {campanha}, {posicao}…" />
                  <div className="flex justify-end">
                    <Button size="sm" disabled={!dirty || saving === key} onClick={() => saveSimple("rodizio_pools", r.id, "message", key, r.message, "Aviso ao parceiro")}>
                      {saving === key ? "Salvando…" : "Salvar"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </TabsContent>

          <TabsContent value="posvenda-global" className="flex-1 min-h-0 mt-0 overflow-auto p-4 space-y-3">
            <p className="text-xs text-muted-foreground">Legendas padrão das mídias de pós-venda (usadas quando não há override do consultor).</p>
            {posVendaGlobal.map((r) => {
              const key = `pvg:${r.stage}`;
              const val = drafts[key] ?? r.message_text ?? "";
              const dirty = drafts[key] !== undefined;
              return (
                <div key={r.stage} className="border rounded-xl p-3 space-y-2">
                  <div className="flex items-center gap-2 text-xs">
                    <Badge variant="outline">{r.stage}</Badge>
                    <span className="text-muted-foreground">{r.message_type}</span>
                    {!r.is_active && <Badge variant="secondary">inativo</Badge>}
                    {dirty && <Badge variant="secondary" className="ml-auto">não salvo</Badge>}
                  </div>
                  <Textarea rows={3} value={val} onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))} />
                  <div className="flex justify-end">
                    <Button size="sm" disabled={!dirty || saving === key} onClick={() => savePosGlobal(r)}>
                      {saving === key ? "Salvando…" : "Salvar"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </TabsContent>

          <TabsContent value="calendario" className="flex-1 min-h-0 mt-0 overflow-auto p-4 space-y-3">
            <p className="text-xs text-muted-foreground">Feriados que as mensagens automáticas devem respeitar (não envia mensagens nestes dias).</p>
            <div className="border rounded-xl p-3 space-y-2 bg-muted/30">
              <div className="text-xs font-semibold">Adicionar feriado</div>
              <div className="flex gap-2 flex-wrap">
                <input type="date" className="border rounded-md px-2 py-1 text-sm bg-background" value={newHolidayDate} onChange={(e) => setNewHolidayDate(e.target.value)} />
                <input type="text" placeholder="Nome do feriado" className="border rounded-md px-2 py-1 text-sm bg-background flex-1 min-w-[180px]" value={newHolidayLabel} onChange={(e) => setNewHolidayLabel(e.target.value)} />
                <Button size="sm" disabled={saving === "new-holiday"} onClick={addHoliday}>Adicionar</Button>
              </div>
            </div>
            {holidays.map((h) => (
              <div key={h.id} className="border rounded-xl p-3 flex items-center gap-3">
                <Badge variant="outline">{h.date}</Badge>
                <span className="text-sm flex-1">{h.label}</span>
                {!h.consultant_id && <Badge variant="secondary">global</Badge>}
                {h.consultant_id && (
                  <Button size="sm" variant="ghost" onClick={() => removeHoliday(h.id)}>Remover</Button>
                )}
              </div>
            ))}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
