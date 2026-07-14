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
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [grupo, setGrupo] = useState<string>("all");
  const [cmt, setCmt] = useState<CmtRow[]>([]);
  const [cadence, setCadence] = useState<CadenceRow[]>([]);
  const [reactivation, setReactivation] = useState<ReactivationRow[]>([]);
  const [phrases, setPhrases] = useState<PhraseRow[]>([]);
  const [posVenda, setPosVenda] = useState<PosVendaRow[]>([]);
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
            Catálogo completo de mensagens de agendamento, atendimento, retenção, cadência,
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
              {TEXTOS_CATALOGO.length} itens no catálogo
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
          </TabsList>

          <TabsContent value="catalogo" className="flex-1 min-h-0 mt-0 data-[state=inactive]:hidden">
            <div className="flex h-full min-h-0">
              <aside className="w-[280px] shrink-0 border-r flex flex-col min-h-0">
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
                        <Link to="/admin/motor-cadencia">
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
                  selected.fonte === "kanban_pos_venda" ? (
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
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
