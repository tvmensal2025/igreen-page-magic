import React, { useEffect, useMemo, useState, useCallback, Suspense } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import { ArrowLeft, Plus, AlertTriangle, ExternalLink, Loader2, Sparkles, Wand2, GitBranch, BookOpen, Play } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/ui/confirm-dialog";

import {
  DndContext, DragEndEvent, PointerSensor, useSensor, useSensors, closestCenter,
} from "@dnd-kit/core";
import {
  SortableContext, verticalListSortingStrategy, arrayMove,
} from "@dnd-kit/sortable";

import StepCard from "@/components/admin/flow-builder/StepCard";
import StepInspector from "@/components/admin/flow-builder/StepInspector";
import AiCopilotDrawer from "@/components/admin/flow-builder/AiCopilotDrawer";
import WhatsAppPreview from "@/components/admin/flow-builder/WhatsAppPreview";
import FlowTemplatesDialog from "@/components/admin/flow-builder/FlowTemplatesDialog";
import CreateFlowFromTemplateDialog from "@/components/admin/flow-builder/CreateFlowFromTemplateDialog";
import AiPreferencesCard from "@/components/admin/flow-builder/AiPreferencesCard";
import VariantDistributionBar from "@/components/admin/flow-builder/VariantDistributionBar";
import FlowSimulator from "@/components/admin/flow-builder/FlowSimulator";
import { useFlowValidation } from "@/components/admin/flow-builder/useFlowValidation";
import {
  Step, Variant, ALL_VARIANTS, VARIANT_LABEL,
  parseTransitions, parseCaptures, parseFallback,
} from "@/components/admin/flow-builder/flowTypes";
import ViewToggle, { type ViewMode } from "@/components/admin/flow-builder/ViewToggle";
import { useViewportWidth } from "@/hooks/useViewportWidth";

// task 10.2 — lazy-load do canvas para que o bundle do Modo_Diagrama (e suas
// dependências `@xyflow/react`, `dagre`, `html-to-image`) só seja baixado
// quando o Consultor de fato alterna para "Diagrama". Mantém o tempo de
// carregamento inicial do Modo_Lista inalterado.
const FlowDiagram = React.lazy(
  () => import("@/components/admin/flow-builder/FlowDiagram"),
);
const FlowDiagramV2 = React.lazy(
  () => import("@/components/admin/flow-builder/diagram-v2/FlowDiagramV2"),
);

function readUseV2(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const v = window.localStorage.getItem("flow-diagram-v2");
    return v === null ? true : v === "1";
  } catch {
    return true;
  }
}

/**
 * Lê o valor inicial de `viewMode` do `localStorage` aplicando os fallbacks
 * exigidos por R1.5 e R1.7:
 *
 *   - Valor "lista" ou "diagrama" → respeita.
 *   - Ausente, vazio ou inválido → fallback "lista" (R1.5).
 *   - Falha de leitura do `localStorage` (modo privado, sem permissão,
 *     etc.) → fallback silencioso "lista" (R1.7).
 *
 * O componente `<ViewToggle>` apenas dispara `onChange`; cabe ao
 * `FluxoBuilder` persistir antes do fim da transição (R1.4).
 */
function readInitialViewMode(): ViewMode {
  if (typeof window === "undefined") return "lista";
  try {
    const v = window.localStorage.getItem("flow-view-mode");
    return v === "diagrama" ? "diagrama" : "lista";
  } catch {
    // Falha silenciosa (R1.7) — `try` cobre QuotaExceededError, modo
    // privado e ambientes onde `localStorage` é bloqueado pelo browser.
    return "lista";
  }
}

/**
 * Normaliza uma string para uso como slug URL-safe seguindo o glossário
 * da feature `flow-diagram-view`:
 *
 *   1. Aplica normalização Unicode NFD para separar combining marks
 *      (acentos viram caracteres independentes).
 *   2. Remove os combining marks (`\u0300-\u036f`).
 *   3. Converte para minúsculas.
 *   4. Substitui qualquer caractere fora de `[a-z0-9]` por `-`.
 *   5. Colapsa hífens consecutivos e remove os das extremidades.
 *
 * Retorna string vazia quando a entrada resulta em zero caracteres
 * úteis — o caller (`consultantSlug`) usa esse sinal para cair no
 * próximo fallback (8 primeiros chars do id).
 */
function slugifyName(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Novo editor de fluxos — layout híbrido:
 * - Esquerda: lista de cards drag-and-drop (passos)
 * - Direita: preview WhatsApp ao vivo do passo selecionado
 * - Sheet lateral: inspector para editar o passo
 *
 * Schema do banco é IDÊNTICO ao FluxoCamila legado — backward-compat total.
 */
export default function FluxoBuilder() {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [userId, setUserId] = useState<string | null>(null);
  const [consultantName, setConsultantName] = useState<string>("");
  const [flowId, setFlowId] = useState<string | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [editingVariant, setEditingVariant] = useState<Variant>("A");
  const [existingVariants, setExistingVariants] = useState<Variant[]>(["A"]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inspectorId, setInspectorId] = useState<string | null>(null);
  const [showConnections, setShowConnections] = useState(true);
  const [mediaCounts, setMediaCounts] = useState<Record<string, { audio: number; image: number; video: number }>>({});
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [simulatorOpen, setSimulatorOpen] = useState(false);
  const [createFromTemplateOpen, setCreateFromTemplateOpen] = useState(false);

  // task 10.2 — `viewMode` controla a alternância Lista ↔ Diagrama (R1.1).
  // Valor inicial vem do `localStorage` (chave `flow-view-mode`) com
  // fallbacks de R1.5 e R1.7 aplicados em `readInitialViewMode()`.
  const [viewMode, setViewModeState] = useState<ViewMode>(readInitialViewMode);
  const [useV2, setUseV2State] = useState<boolean>(readUseV2);
  const setUseV2 = useCallback((next: boolean) => {
    setUseV2State(next);
    try {
      window.localStorage.setItem("flow-diagram-v2", next ? "1" : "0");
    } catch { /* noop */ }
  }, []);

  // task 12.1 — modo somente leitura do `Modo_Diagrama` derivado da viewport
  // atual (R15.2). `isNarrow` (<768px) força `readOnly={true}` no
  // `<FlowDiagram>`; `isMedium` (768-1023px) sinaliza ao `<ViewToggle>` para
  // exibir o tooltip "Melhor visualização em desktop" (R15.1). Quando a
  // largura cresce/encolhe entre faixas, `useViewportWidth` re-renderiza e o
  // `<FlowDiagram>` reflete o novo `readOnly` sem reload (R15.4).
  const { isNarrow, isMedium } = useViewportWidth();
  const diagramReadOnly = isNarrow;

  // R1.4 — persiste em `localStorage` antes do fim da transição. A
  // gravação acontece no mesmo turno do `setState` (sincronamente),
  // assegurando que um reload imediato após o toggle abra no modo certo
  // (R1.5). Falha de gravação é silenciosa (R1.7).
  const setViewMode = useCallback((next: ViewMode) => {
    setViewModeState(next);
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem("flow-view-mode", next);
      }
    } catch {
      // R1.7 — fallback silencioso. A preferência permanece em memória
      // para a sessão atual e a alternância visual ocorre normalmente.
    }
  }, []);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const reload = useCallback(async (uid: string, variant: Variant = "A") => {
    setLoading(true);
    // task 10.4 — em falha de reload de variante, preservamos o estado
    // anterior + `toast.error` (R11.3). Tomamos snapshot dos arrays atuais
    // ANTES de qualquer escrita e revertemos em caso de exceção.
    const prevSteps = steps;
    const prevConsultantName = consultantName;
    const prevExistingVariants = existingVariants;
    const prevFlowId = flowId;
    const prevMediaCounts = mediaCounts;
    try {
      const [{ data: cons }, { data: flows }, { data: allFlows }] = await Promise.all([
        supabase.from("consultants").select("conversational_flow_enabled, name").eq("id", uid).maybeSingle(),
        (supabase as any).from("bot_flows").select("id").eq("consultant_id", uid).eq("is_active", true).eq("variant", variant).order("created_at").limit(1),
        supabase.from("bot_flows").select("variant").eq("consultant_id", uid).eq("is_active", true),
      ]);
      
      setConsultantName((cons as any)?.name ?? "");
      const ex = new Set<Variant>(["A"]);
      for (const r of ((allFlows as any[]) || [])) {
        if (ALL_VARIANTS.includes(r.variant)) ex.add(r.variant);
      }
      setExistingVariants(ALL_VARIANTS.filter((v) => ex.has(v)));

      let fid = flows?.[0]?.id ?? null;
      if (!fid && variant === "A") {
        const { data } = await supabase.rpc("seed_default_camila_flow", { _consultant_id: uid });
        fid = (data as string) ?? null;
      }
      setFlowId(fid);

      if (fid) {
        // task 10.4 — `select *` já traz a coluna `layout` adicionada pela
        // migration `20260601000000_add_layout_to_bot_flow_steps.sql`.
        // Mapeamos para `layout: r.layout ?? null` para garantir tipagem
        // correta (`StepLayout | null`) em `Step.layout`.
        const { data: rows, error: rowsError } = await supabase
          .from("bot_flow_steps").select("*").eq("flow_id", fid).order("position");
        if (rowsError) throw rowsError;
        const parsed = (rows ?? []).map((r: any) => ({
          ...r,
          icon: r.icon ?? "msg",
          title: r.title ?? "Sem título",
          transitions: parseTransitions(r.transitions),
          captures: parseCaptures(r.captures),
          fallback: parseFallback(r.fallback, r.transitions),
          auto_detect_doc_type: r.auto_detect_doc_type !== false,
          // task 10.4 — coordenadas manuais do Modo_Diagrama. `null` indica
          // "não posicionado manualmente"; o `useDiagramLayout` aplica
          // dagre como fallback. Engine de runtime ignora.
          layout: r.layout ?? null,
        })) as Step[];
        setSteps(parsed);
        if (parsed.length && !selectedId) setSelectedId(parsed[0].id);
      } else {
        setSteps([]);
        setSelectedId(null);
      }

      // Contagem de mídias por slot
      const { data: medias } = await supabase
        .from("ai_media_library")
        .select("kind, slot_key, active, consultant_id, is_public")
        .or(`consultant_id.eq.${uid},is_public.eq.true`)
        .eq("active", true);
      const counts: Record<string, { audio: number; image: number; video: number }> = {};
      for (const m of (medias ?? []) as any[]) {
        const k = m.slot_key as string | null;
        if (!k) continue;
        if (!counts[k]) counts[k] = { audio: 0, image: 0, video: 0 };
        if (m.kind === "audio" || m.kind === "image" || m.kind === "video") {
          counts[k][m.kind as "audio" | "image" | "video"]++;
        }
      }
      setMediaCounts(counts);
    } catch (err) {
      // R11.3 — em falha de reload de variante, preserva estado anterior
      // e exibe `toast.error` identificando a operação. Restauramos todos
      // os arrays/IDs ao que estavam antes para evitar estado parcial
      // (alguns campos atualizados, outros não) que confundiria o
      // Modo_Diagrama e o Modo_Lista.
      console.error("[FluxoBuilder] reload failed", err);
      setSteps(prevSteps);
      setConsultantName(prevConsultantName);
      setExistingVariants(prevExistingVariants);
      setFlowId(prevFlowId);
      setMediaCounts(prevMediaCounts);
      toast.error("Não foi possível carregar a variante. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }, [selectedId, steps, consultantName, existingVariants, flowId, mediaCounts]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id;
      if (!uid) { navigate("/auth"); return; }
      if (!alive) return;
      setUserId(uid);
      await reload(uid, editingVariant);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (userId) reload(userId, editingVariant);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingVariant]);

  const selected = useMemo(() => steps.find((s) => s.id === selectedId) ?? null, [steps, selectedId]);
  const inspectorStep = useMemo(() => steps.find((s) => s.id === inspectorId) ?? null, [steps, inspectorId]);

  const validation = useFlowValidation(steps);
  const flowWarnings = validation.total;
  const flowErrors = validation.errors;
  const maxPosition = useMemo(
    () => steps.reduce((m, s) => Math.max(m, s.position), 0),
    [steps],
  );

  // task 10.3 — `consultantSlug` segue a ordem do glossário:
  //   (1) `consultants.slug` quando preenchido — não consultado aqui
  //       porque a tabela `consultants` no schema atual não expõe o campo
  //       `slug` (ver `src/integrations/supabase/types.ts`); fica como
  //       extensão futura quando a coluna for adicionada.
  //   (2) `consultants.name` aplicado a normalização Unicode NFD
  //       removendo acentos, minúsculas, qualquer caractere fora de
  //       `[a-z0-9]` substituído por `-`, hífens consecutivos colapsados
  //       e hífens nas extremidades removidos.
  //   (3) os 8 primeiros caracteres do `consultants.id` (UUID) quando
  //       (2) resulta em string vazia.
  //
  // O slug é consumido por `useDiagramExport` (task 9.3) para nomear os
  // arquivos exportados (PNG/SVG) e nada mais — não afeta o engine.
  const consultantSlug = useMemo(() => {
    const fromName = slugifyName(consultantName);
    if (fromName) return fromName;
    if (userId) return userId.slice(0, 8);
    return "consultor";
  }, [consultantName, userId]);

  async function autoFixAll() {
    if (!validation.autoFixablePatches.length) return;
    const ok = await confirm({
      title: "Auto-corrigir alertas?",
      description: `Vou remover ${validation.autoFixablePatches.reduce(
        (n, p) => n + (Array.isArray((p.patch as any).transitions) ? 1 : 0),
        0,
      )} regra(s) sem destino ou apontando para passos removidos.`,
      confirmText: "Corrigir",
    });
    if (!ok) return;
    for (const p of validation.autoFixablePatches) {
      await patchStep(p.stepId, p.patch);
    }
    toast.success("Alertas corrigidos");
  }


  async function patchStep(id: string, patch: Partial<Step>) {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    const { error } = await supabase.from("bot_flow_steps").update(patch as any).eq("id", id);
    if (error) toast.error("Erro ao salvar: " + error.message);
  }

  async function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = steps.findIndex((s) => s.id === active.id);
    const newIdx = steps.findIndex((s) => s.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const reordered = arrayMove(steps, oldIdx, newIdx).map((s, i) => ({ ...s, position: i + 1 }));
    setSteps(reordered);
    // Persiste cada nova posição
    await Promise.all(
      reordered.map((s) => supabase.from("bot_flow_steps").update({ position: s.position }).eq("id", s.id)),
    );
  }

  async function addStep(
    initialPosition?: { x: number; y: number },
  ): Promise<Step | null> {
    if (!flowId) return null;
    const maxPos = steps.reduce((m, s) => Math.max(m, s.position), 0);
    const newKey = `passo_${Date.now().toString(36)}`;
    // task 10.3 / 10.4 — quando o caller informa `initialPosition` (canvas),
    // inicializamos `layout = initialPosition` no insert para que o
    // `useDiagramLayout` use a coordenada manual em vez de cair no dagre
    // (R10.11). Quando ausente (chamada vinda do Modo_Lista), preservamos o
    // comportamento histórico de não persistir layout — o canvas rodará
    // dagre na próxima abertura.
    const insertPayload: Record<string, unknown> = {
      flow_id: flowId, position: maxPos + 1, step_type: "message",
      step_key: newKey, title: "Novo passo", summary: "", icon: "msg",
      message_text: "", slot_key: newKey, transitions: [], captures: [],
      fallback: { mode: "repeat" }, is_active: true,
    };
    if (initialPosition) {
      insertPayload.layout = {
        x: initialPosition.x,
        y: initialPosition.y,
      };
    }
    const { data, error } = await supabase
      .from("bot_flow_steps")
      .insert(insertPayload as any)
      .select()
      .maybeSingle();
    if (error || !data) {
      toast.error(error?.message ?? "Erro");
      return null;
    }
    const newStep: Step = {
      ...(data as any),
      icon: (data as any).icon ?? "msg",
      transitions: parseTransitions((data as any).transitions),
      captures: parseCaptures((data as any).captures),
      fallback: parseFallback((data as any).fallback, (data as any).transitions),
      layout: (data as any).layout ?? null,
    };
    setSteps((prev) => [...prev, newStep]);
    setSelectedId(newStep.id);
    setInspectorId(newStep.id);
    toast.success("Passo adicionado");
    return newStep;
  }

  async function duplicateStep(id: string) {
    const orig = steps.find((s) => s.id === id);
    if (!orig || !flowId) return;
    const maxPos = steps.reduce((m, s) => Math.max(m, s.position), 0);
    const { data, error } = await supabase.from("bot_flow_steps").insert({
      flow_id: flowId, position: maxPos + 1, step_type: orig.step_type,
      step_key: `${orig.step_key ?? "passo"}_copy_${Date.now().toString(36).slice(-4)}`,
      title: `${orig.title} (cópia)`, summary: orig.summary, icon: orig.icon,
      message_text: orig.message_text, slot_key: orig.slot_key,
      transitions: orig.transitions as any, captures: orig.captures as any,
      fallback: orig.fallback as any, is_active: orig.is_active,
    }).select().maybeSingle();
    if (error || !data) { toast.error(error?.message ?? "Erro"); return; }
    setSteps((prev) => [...prev, {
      ...(data as any),
      icon: (data as any).icon ?? "msg",
      transitions: parseTransitions((data as any).transitions),
      captures: parseCaptures((data as any).captures),
      fallback: parseFallback((data as any).fallback, (data as any).transitions),
    }]);
    toast.success("Passo duplicado");
  }

  async function deleteStep(id: string) {
    const ok = await confirm({
      title: "Remover este passo?",
      description: "As regras que apontavam para ele serão limpas.",
      confirmText: "Remover",
      tone: "danger",
    });
    if (!ok) return;
    const { error } = await supabase.from("bot_flow_steps").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    setSteps((prev) => prev.filter((s) => s.id !== id));
    if (selectedId === id) setSelectedId(null);
    if (inspectorId === id) setInspectorId(null);
    // Limpa transitions órfãs
    for (const s of steps) {
      if (s.id === id) continue;
      const filtered = s.transitions.filter((t) => t.goto_step_id !== id);
      if (filtered.length !== s.transitions.length) {
        await patchStep(s.id, { transitions: filtered });
      }
    }
    toast.success("Passo removido");
  }


  if (loading && !steps.length) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b bg-card/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/admin")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <h1 className="text-base font-semibold">Editor de Fluxo</h1>
            <p className="text-xs text-muted-foreground">
              Monte como o bot conversa com seus leads — arraste, edite, veja o preview ao vivo.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {flowWarnings > 0 && (
              <Badge
                variant={flowErrors > 0 ? "destructive" : "secondary"}
                className="gap-1"
              >
                <AlertTriangle className="h-3 w-3" />
                {flowWarnings} {flowWarnings === 1 ? "alerta" : "alertas"}
              </Badge>
            )}
            {validation.autoFixablePatches.length > 0 && (
              <Button variant="outline" size="sm" onClick={autoFixAll}>
                <Wand2 className="mr-1 h-3 w-3" />
                Auto-corrigir
              </Button>
            )}
            {/*
              task 10.2 — Toggle Lista/Diagrama no header (R1.1). A
              persistência em `localStorage` é responsabilidade do
              `setViewMode` (R1.4); o `<ViewToggle>` apenas dispara o
              `onChange`.
            */}
            <ViewToggle
              value={viewMode}
              onChange={setViewMode}
              diagramHint={isMedium}
            />
            <Button variant="outline" size="sm" onClick={() => navigate("/admin/conhecimento")}>
              <BookOpen className="mr-1 h-3 w-3" />
              Conhecimento
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSimulatorOpen(true)}
              disabled={steps.length === 0}
              title={steps.length === 0 ? "Adicione ao menos 1 passo para testar" : "Testar fluxo localmente"}
            >
              <Play className="mr-1 h-3 w-3" />
              🎬 Testar fluxo
            </Button>
            <Button variant="outline" size="sm" onClick={() => setTemplatesOpen(true)} disabled={!flowId}>
              <Sparkles className="mr-1 h-3 w-3" />
              Templates
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCopilotOpen(true)}
              disabled={!flowId || steps.length === 0}
              className="border-purple-500/40 text-purple-600 hover:bg-purple-500/10 hover:text-purple-700"
              title="Conversa com IA sobre este fluxo"
            >
              <Sparkles className="mr-1 h-3 w-3" />
              Copiloto IA
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={() => setCreateFromTemplateOpen(true)}
              disabled={!userId}
              title="Criar um fluxo novo do zero usando blocos prontos (OCR de conta, documento, IA de dúvidas)"
            >
              <Plus className="mr-1 h-3 w-3" />
              Novo fluxo
            </Button>
          </div>
        </div>

        {/* Distribuição entre variantes (ativar/pausar/criar) */}
        {userId && (
          <VariantDistributionBar
            consultantId={userId}
            existingVariants={existingVariants}
            editingVariant={editingVariant}
            onSelectVariant={setEditingVariant}
            onChanged={() => userId && reload(userId, editingVariant)}
          />
        )}
      </header>

      {/*
        task 10.2 — Render condicional Lista vs Diagrama (R1.2, R1.3, R1.5).
        Estratégia: a `<section>` do Modo_Lista permanece **montada** mesmo
        quando `viewMode === "diagrama"` (escondida via Tailwind `hidden`),
        para preservar a posição de rolagem da lista ao voltar para o
        Modo_Lista (R1.3). O Modo_Diagrama, em contraste, é totalmente
        montado/desmontado por toggle — `useViewportPersistence` (task 9.4)
        é responsável por restaurar zoom/pan via `localStorage`.
        `selectedId` e `inspectorId` (R1.6) vivem no `FluxoBuilder` e são
        naturalmente preservados.
      */}
      <main className="mx-auto grid max-w-7xl gap-4 px-4 py-6 lg:grid-cols-[1fr_400px]">
        {/* Coluna esquerda — Modo_Lista (mantida montada) */}
        <section
          className={viewMode === "diagrama" ? "hidden" : "space-y-3"}
          aria-hidden={viewMode === "diagrama"}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-muted-foreground">
              Editando variante <span className="font-semibold text-foreground">{editingVariant}</span> — {VARIANT_LABEL[editingVariant].replace(/^[A-E]\s*/, "")} · {steps.length} {steps.length === 1 ? "passo" : "passos"}
            </h2>
          </div>

          {steps.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-muted/20 p-10 text-center">
              <p className="text-sm text-muted-foreground">
                Nenhum passo ainda. Adicione o primeiro abaixo.
              </p>
            </div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={steps.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-2">
                  {steps.map((s) => (
                    <StepCard
                      key={s.id}
                      step={s}
                      steps={steps}
                      selected={selectedId === s.id}
                      mediaCount={s.slot_key ? mediaCounts[s.slot_key] : undefined}
                      showConnections={true}
                      onSelect={() => setSelectedId(s.id)}
                      onEdit={() => { setSelectedId(s.id); setInspectorId(s.id); }}
                      onDelete={() => deleteStep(s.id)}
                      onDuplicate={() => duplicateStep(s.id)}
                      onJumpTo={(targetId) => {
                        setSelectedId(targetId);
                        // Scroll suave até o card destino
                        setTimeout(() => {
                          document.getElementById(`step-card-${targetId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
                        }, 50);
                      }}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}

          <Button variant="outline" className="w-full" onClick={() => { void addStep(); }}>
            <Plus className="mr-1 h-4 w-4" />
            Adicionar passo
          </Button>
        </section>

        {/* Coluna esquerda — Modo_Diagrama (lazy-loaded, R1.2/R1.5) */}
        {viewMode === "diagrama" && userId && (
          <section
            // Altura calculada para preencher a viewport descontando o header
            // sticky (~160px) e padding inferior. O canvas precisa de altura
            // explícita porque `<ReactFlow>` dimensiona-se via 100% do
            // contêiner.
            className="h-[calc(100vh-200px)] min-h-[500px] overflow-hidden rounded-xl border bg-background"
            aria-label="Editor de fluxo em diagrama"
          >
            <Suspense
              fallback={
                <div
                  className="grid h-full w-full place-items-center"
                  role="status"
                  aria-live="polite"
                >
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
                    <span className="text-xs">Carregando diagrama…</span>
                  </div>
                </div>
              }
            >
              {useV2 ? (
                <div className="relative h-full w-full">
                  <button
                    type="button"
                    onClick={() => setUseV2(false)}
                    className="absolute right-3 top-3 z-10 rounded-md border bg-background/95 px-2 py-1 text-[10px] text-muted-foreground shadow hover:bg-muted"
                    title="Voltar para o diagrama clássico"
                  >
                    Diagrama v2 · clássico
                  </button>
                  <FlowDiagramV2
                    steps={steps}
                    selectedId={selectedId}
                    consultantId={userId}
                    consultantName={consultantName}
                    consultantSlug={consultantSlug}
                    flowId={flowId}
                    editingVariant={editingVariant}
                    mediaCounts={mediaCounts}
                    validation={validation}
                    readOnly={diagramReadOnly}
                    onSelectStep={setSelectedId}
                    onOpenInspector={(id) => {
                      setSelectedId(id);
                      setInspectorId(id);
                    }}
                    onPatchStep={patchStep}
                    onAddStep={addStep}
                    onDuplicateStep={duplicateStep}
                    onDeleteStep={deleteStep}
                    onAutoFixAll={autoFixAll}
                    onCreateFromTemplate={() => setCreateFromTemplateOpen(true)}
                    onReloadAfterAutoLayout={() =>
                      userId ? reload(userId, editingVariant) : Promise.resolve()
                    }
                  />
                </div>
              ) : (
                <div className="relative h-full w-full">
                  <button
                    type="button"
                    onClick={() => setUseV2(true)}
                    className="absolute right-3 top-3 z-10 rounded-md border bg-primary/90 px-2 py-1 text-[10px] text-primary-foreground shadow hover:bg-primary"
                    title="Experimentar novo diagrama"
                  >
                    ✨ Diagrama v2
                  </button>
                  <FlowDiagram
                    steps={steps}
                    selectedId={selectedId}
                    consultantId={userId}
                    consultantName={consultantName}
                    consultantSlug={consultantSlug}
                    flowId={flowId}
                    editingVariant={editingVariant}
                    mediaCounts={mediaCounts}
                    validation={validation}
                    readOnly={diagramReadOnly}
                    onSelectStep={setSelectedId}
                    onOpenInspector={(id) => {
                      setSelectedId(id);
                      setInspectorId(id);
                    }}
                    onPatchStep={patchStep}
                    onAddStep={addStep}
                    onDuplicateStep={duplicateStep}
                    onDeleteStep={deleteStep}
                    onAutoFixAll={autoFixAll}
                    onCreateFromTemplate={() => setCreateFromTemplateOpen(true)}
                    onReloadAfterAutoLayout={() =>
                      userId ? reload(userId, editingVariant) : Promise.resolve()
                    }
                  />
                </div>
              )}
            </Suspense>
          </section>
        )}

        {/* Coluna direita — preview WhatsApp + preferências de IA */}
        <aside className="hidden space-y-3 lg:block">
          <WhatsAppPreview step={selected} steps={steps} consultantName={consultantName} />
          {userId && <AiPreferencesCard consultantId={userId} />}
        </aside>
      </main>

      {/* Inspector */}
      {userId && (
        <StepInspector
          step={inspectorStep}
          steps={steps}
          consultantId={userId}
          variant={editingVariant}
          flowId={flowId}
          maxPosition={maxPosition}
          onClose={() => setInspectorId(null)}
          onPatch={(patch) => inspectorStep && patchStep(inspectorStep.id, patch)}
          onReload={() => userId && reload(userId, editingVariant)}
        />
      )}

      {/* Templates dialog */}
      {userId && (
        <FlowTemplatesDialog
          open={templatesOpen}
          onOpenChange={setTemplatesOpen}
          flowId={flowId}
          currentMaxPosition={maxPosition}
          onApplied={() => reload(userId, editingVariant)}
        />
      )}

      {/* Criar fluxo do zero a partir de blocos prontos */}
      {userId && (
        <CreateFlowFromTemplateDialog
          open={createFromTemplateOpen}
          onOpenChange={setCreateFromTemplateOpen}
          consultantId={userId}
          defaultVariant={editingVariant}
          onCreated={() => reload(userId, editingVariant)}
        />
      )}

      {/* Simulador de Fluxo (modal) */}
      <FlowSimulator
        open={simulatorOpen}
        onOpenChange={setSimulatorOpen}
        steps={steps}
        consultantId={userId}
        consultantName={consultantName}
      />
    </div>
  );
}
