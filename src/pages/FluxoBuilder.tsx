import React, { useEffect, useMemo, useState, useCallback, Suspense } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import { ArrowLeft, Plus, AlertTriangle, ExternalLink, Loader2, Sparkles, Wand2, GitBranch, BookOpen, Play, Lock, Unlock } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Switch } from "@/components/ui/switch";

import {
  DndContext, DragEndEvent, PointerSensor, useSensor, useSensors, closestCenter,
} from "@dnd-kit/core";
import {
  SortableContext, verticalListSortingStrategy, arrayMove,
} from "@dnd-kit/sortable";

import StepTimelineItem from "@/components/admin/flow-builder/StepTimelineItem";
import StepInspector from "@/components/admin/flow-builder/StepInspector";
import StepListToolbar from "@/components/admin/flow-builder/StepListToolbar";
import WhatsAppPreview from "@/components/admin/flow-builder/WhatsAppPreview";
import FlowTemplatesDialog from "@/components/admin/flow-builder/FlowTemplatesDialog";
import CreateFlowFromTemplateDialog from "@/components/admin/flow-builder/CreateFlowFromTemplateDialog";
import AiPreferencesCard from "@/components/admin/flow-builder/AiPreferencesCard";
import VariantDistributionBar from "@/components/admin/flow-builder/VariantDistributionBar";
import FluxoBEditor from "@/components/admin/flow-builder/FluxoBEditor";
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
const FlowSpreadsheet = React.lazy(
  () => import("@/components/admin/flow-builder/FlowSpreadsheet"),
);
import FlowReviewPanel, { type ReviewResult } from "@/components/admin/flow-builder/FlowReviewPanel";

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
    if (v === "diagrama" || v === "planilha" || v === "lista") return v;
    return "lista";
  } catch {
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
  // Modo de sincronia com o template público (super-admin).
  //  - 'public': estrutura travada — usuário só edita mídias. Render dos
  //    steps vem do flow `is_public=true` da mesma variante. Toda mudança
  //    do super-admin chega automaticamente.
  //  - 'custom': fork — usuário edita livremente seus próprios steps.
  //  - null: ainda carregando OU consultor é super-admin (público é dele).
  const [syncMode, setSyncMode] = useState<"public" | "custom" | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [togglingSync, setTogglingSync] = useState(false);
  // Flow real de onde os steps mostrados vêm. Quando syncMode='public', é o id do
  // template público; caso contrário, é o flow do próprio consultor. Usado para
  // abrir a subscription realtime em bot_flow_steps no flow certo.
  const [stepsSourceFlowId, setStepsSourceFlowId] = useState<string | null>(null);

  const isReadOnly = syncMode === "public";
  
  const [editingVariant, setEditingVariant] = useState<Variant>("A");
  const [existingVariants, setExistingVariants] = useState<Variant[]>(["A"]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inspectorId, setInspectorId] = useState<string | null>(null);
  // Aba inicial do inspetor ao abrir. O link "editar" das Saídas (Lista) abre
  // direto em "regras"; demais aberturas usam "conteudo".
  const [inspectorTab, setInspectorTab] = useState<"conteudo" | "regras" | "midias" | "avancado">("conteudo");
  const [pulseStepId, setPulseStepId] = useState<string | null>(null);
  const [mediaCounts, setMediaCounts] = useState<Record<string, { audio: number; image: number; video: number }>>({});
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [simulatorOpen, setSimulatorOpen] = useState(false);
  const [createFromTemplateOpen, setCreateFromTemplateOpen] = useState(false);

  // Revisão IA da planilha (GPT-5.5)
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewResult, setReviewResult] = useState<ReviewResult | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [suggestingStepId, setSuggestingStepId] = useState<string | null>(null);

  const runReview = useCallback(async (mode: "global" | "step", stepId?: string) => {
    if (!flowId) return;
    setReviewError(null);
    setReviewResult(null);
    setReviewOpen(true);
    if (mode === "global") setReviewLoading(true);
    else setSuggestingStepId(stepId ?? null);
    try {
      const { data, error } = await supabase.functions.invoke("flow-spreadsheet-review", {
        body: { mode, flowId, stepId },
      });
      if (error) throw new Error(error.message ?? "Erro na revisão IA");
      if ((data as any)?.error) throw new Error((data as any).error);
      setReviewResult({
        summary: (data as any).summary ?? "",
        issues: (data as any).issues ?? [],
      });
    } catch (e: any) {
      setReviewError(e?.message ?? "Erro desconhecido");
    } finally {
      setReviewLoading(false);
      setSuggestingStepId(null);
    }
  }, [flowId]);




  // PR4 — busca/filtro da lista de steps
  const [listQuery, setListQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set());
  const toggleTypeFilter = useCallback((t: string) => {
    setTypeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }, []);

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

  // PR5 — esconde o painel direito (WhatsApp preview) para dar largura
  // total ao canvas no modo diagrama. Persistido em localStorage.
  const [panelHidden, setPanelHiddenState] = useState<boolean>(() => {
    try { return window.localStorage.getItem("flow-panel-hidden") === "1"; } catch { return false; }
  });
  const togglePanelHidden = useCallback(() => {
    setPanelHiddenState((prev) => {
      const next = !prev;
      try { window.localStorage.setItem("flow-panel-hidden", next ? "1" : "0"); } catch { /* noop */ }
      return next;
    });
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
      const [{ data: cons }, { data: flows }, { data: allFlows }, { data: superAdminRes }] = await Promise.all([
        supabase.from("consultants").select("conversational_flow_enabled, name").eq("id", uid).maybeSingle(),
        (supabase as any).from("bot_flows").select("id, sync_mode").eq("consultant_id", uid).eq("is_active", true).eq("variant", variant).order("created_at").limit(1),
        supabase.from("bot_flows").select("variant").eq("consultant_id", uid).eq("is_active", true),
        supabase.rpc("is_super_admin", { _user_id: uid }),
      ]);

      setConsultantName((cons as any)?.name ?? "");
      setIsSuperAdmin(Boolean(superAdminRes));

      const ex = new Set<Variant>();
      for (const r of ((allFlows as any[]) || [])) {
        if (ALL_VARIANTS.includes(r.variant)) ex.add(r.variant);
      }

      let seededD = false;
      if (ex.size === 0) {
        const { data: seededId } = await supabase.rpc("seed_default_camila_flow", { _consultant_id: uid });
        if (seededId) {
          ex.add("D");
          seededD = true;
        }
      }
      setExistingVariants(ALL_VARIANTS.filter((v) => ex.has(v)));

      let fid: string | null = flows?.[0]?.id ?? null;
      let mode: "public" | "custom" = (flows?.[0]?.sync_mode === "custom" ? "custom" : "public");
      if (!fid && seededD && variant === "D") {
        const { data: dFlow } = await (supabase as any)
          .from("bot_flows").select("id, sync_mode")
          .eq("consultant_id", uid).eq("is_active", true).eq("variant", "D")
          .order("created_at").limit(1).maybeSingle();
        fid = (dFlow as any)?.id ?? null;
        mode = (dFlow as any)?.sync_mode === "custom" ? "custom" : "public";
      }
      setFlowId(fid);

      // Super-admin edita o template público — não faz sentido aplicar o modo
      // "seguir público" para ele próprio. Forçamos custom na UI.
      const effectiveMode: "public" | "custom" = Boolean(superAdminRes) ? "custom" : mode;
      setSyncMode(fid ? effectiveMode : null);

      // Resolve de onde vêm os steps renderizados.
      let stepsSourceFlowId: string | null = fid;
      if (fid && effectiveMode === "public") {
        const { data: pub } = await (supabase as any)
          .from("bot_flows").select("id")
          .eq("is_public", true).eq("is_active", true).eq("variant", variant)
          .limit(1).maybeSingle();
        if ((pub as any)?.id) stepsSourceFlowId = (pub as any).id as string;
      }
      

      if (stepsSourceFlowId) {
        const { data: rows, error: rowsError } = await supabase
          .from("bot_flow_steps").select("*").eq("flow_id", stepsSourceFlowId).order("position");
        if (rowsError) throw rowsError;
        const parsed = (rows ?? []).map((r: any) => ({
          ...r,
          icon: r.icon ?? "msg",
          title: r.title ?? "Sem título",
          transitions: parseTransitions(r.transitions),
          captures: parseCaptures(r.captures),
          fallback: parseFallback(r.fallback, r.transitions),
          auto_detect_doc_type: r.auto_detect_doc_type !== false,
          layout: r.layout ?? null,
        })) as Step[];
        setSteps(parsed);
        setStepsSourceFlowId(stepsSourceFlowId);
        if (parsed.length && !selectedId) setSelectedId(parsed[0].id);
      } else {
        setSteps([]);
        setStepsSourceFlowId(null);
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
      toast.error("Não foi possível carregar o fluxo. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }, [selectedId, steps, consultantName, existingVariants, flowId, mediaCounts]);

  // Alterna o modo de sincronia com o template público.
  // - 'custom' → 'public': apenas atualiza a coluna. Edições do consultor
  //   ficam preservadas em `bot_flow_steps` (apenas ignoradas pelo runtime).
  // - 'public' → 'custom': RPC `fork_flow_from_public` clona os steps
  //   atuais do público para o flow do consultor, remapeando UUIDs.
  const handleToggleSync = useCallback(async (nextChecked: boolean) => {
    if (!userId || !flowId || togglingSync) return;
    const nextMode: "public" | "custom" = nextChecked ? "public" : "custom";
    if (nextMode === syncMode) return;
    if (nextMode === "public") {
      const ok = await confirm({
        title: "Seguir o modelo público?",
        description: "Suas edições nos passos serão ignoradas (não apagadas). As mídias que você subiu continuam funcionando. Toda mudança do super-admin passa a aparecer aqui automaticamente.",
        confirmText: "Sim, seguir o público",
      });
      if (!ok) return;
      setTogglingSync(true);
      try {
        const { error } = await (supabase as any)
          .from("bot_flows")
          .update({ sync_mode: "public" })
          .eq("id", flowId);
        if (error) throw error;
        toast.success("Agora você segue o modelo público.");
        await reload(userId, editingVariant);
      } catch (err: any) {
        toast.error(err?.message ?? "Não foi possível ativar o modo público");
      } finally {
        setTogglingSync(false);
      }
    } else {
      const ok = await confirm({
        title: "Personalizar seu fluxo?",
        description: "Vamos copiar o modelo público para o seu fluxo. A partir daí, mudanças do super-admin não chegam mais automaticamente — você fica responsável pela sua versão.",
        confirmText: "Sim, personalizar",
      });
      if (!ok) return;
      setTogglingSync(true);
      try {
        const { error } = await supabase.rpc("fork_flow_from_public", {
          _consultant_id: userId,
          _variant: editingVariant,
        } as any);
        if (error) throw error;
        toast.success("Fluxo personalizado criado a partir do público.");
        await reload(userId, editingVariant);
      } catch (err: any) {
        toast.error(err?.message ?? "Não foi possível personalizar o fluxo");
      } finally {
        setTogglingSync(false);
      }
    }
  }, [userId, flowId, syncMode, editingVariant, togglingSync, confirm, reload]);

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

  // Se a variante atual não existe entre as carregadas (ex.: consultor
  // nasceu em D e A não foi criada), seleciona automaticamente a primeira
  // variante existente em vez de manter "A fantasma". Isso impede que o
  // builder peça um flow_id que não existe.
  useEffect(() => {
    if (!existingVariants.length) return;
    if (!existingVariants.includes(editingVariant)) {
      setEditingVariant(existingVariants[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingVariants]);

  // Realtime: quando o super-admin altera o template público, consultores em
  // modo público veem a mudança aparecer sem precisar recarregar. Também
  // mantém o próprio super-admin sincronizado entre abas. Refaz o SELECT dos
  // steps com debounce ao receber qualquer INSERT/UPDATE/DELETE no flow atual.
  useEffect(() => {
    if (!stepsSourceFlowId || !userId) return;
    let debounceId: ReturnType<typeof setTimeout> | null = null;
    const refetch = async () => {
      const { data: rows } = await supabase
        .from("bot_flow_steps").select("*").eq("flow_id", stepsSourceFlowId).order("position");
      const parsed = (rows ?? []).map((r: any) => ({
        ...r,
        icon: r.icon ?? "msg",
        title: r.title ?? "Sem título",
        transitions: parseTransitions(r.transitions),
        captures: parseCaptures(r.captures),
        fallback: parseFallback(r.fallback, r.transitions),
        auto_detect_doc_type: r.auto_detect_doc_type !== false,
        layout: r.layout ?? null,
      })) as Step[];
      setSteps(parsed);
    };
    const channel = supabase
      .channel(`flow-steps-${stepsSourceFlowId}`)
      .on(
        "postgres_changes" as any,
        { event: "*", schema: "public", table: "bot_flow_steps", filter: `flow_id=eq.${stepsSourceFlowId}` },
        () => {
          if (debounceId) clearTimeout(debounceId);
          debounceId = setTimeout(() => { void refetch(); }, 400);
        },
      )
      .subscribe();
    return () => {
      if (debounceId) clearTimeout(debounceId);
      void supabase.removeChannel(channel);
    };
  }, [stepsSourceFlowId, userId]);




  const selected = useMemo(() => steps.find((s) => s.id === selectedId) ?? null, [steps, selectedId]);
  const inspectorStep = useMemo(() => steps.find((s) => s.id === inspectorId) ?? null, [steps, inspectorId]);

  // PR4 — filtragem + agrupamento da lista
  const filteredSteps = useMemo(() => {
    const q = listQuery.trim().toLowerCase();
    return steps.filter((s) => {
      if (typeFilter.size > 0 && !typeFilter.has(s.step_type)) return false;
      if (!q) return true;
      const haystack = [
        s.title, s.message_text, s.step_key, s.summary,
        ...(s.transitions ?? []).flatMap((t) => [t.trigger_intent, ...(t.trigger_phrases || [])]),
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }, [steps, listQuery, typeFilter]);

  // Lista em ORDEM DE CONVERSA — os passos filtrados ordenados por `position`
  // (a sequência real percorrida pelo lead). Substitui o agrupamento por
  // tipo, que embaralhava a ordem e escondia o roteiro da conversa.
  const orderedSteps = useMemo(
    () => [...filteredSteps].sort((a, b) => a.position - b.position),
    [filteredSteps],
  );

  // Passo inicial = menor `position` entre os ativos (destacado como "Início").
  const startStepId = useMemo(() => {
    const active = steps.filter((s) => s.is_active);
    if (!active.length) return null;
    return active.reduce((a, b) => (a.position <= b.position ? a : b)).id;
  }, [steps]);

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
    if (isReadOnly) {
      toast.error("Modo \"Seguir modelo público\" ativo. Desligue para personalizar.", {
        action: { label: "Personalizar agora", onClick: () => void handleToggleSync(false) },
      });
      return;
    }
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    const { error } = await supabase.from("bot_flow_steps").update(patch as any).eq("id", id);
    if (error) toast.error("Erro ao salvar: " + error.message);
  }

  async function handleDragEnd(e: DragEndEvent) {
    if (isReadOnly) return;
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
    if (isReadOnly) {
      toast.error("Modo \"Seguir modelo público\" ativo. Desligue para adicionar passos.", {
        action: { label: "Personalizar agora", onClick: () => void handleToggleSync(false) },
      });
      return null;
    }
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
    if (isReadOnly) {
      toast.error("Modo \"Seguir modelo público\" ativo. Desligue para duplicar passos.", {
        action: { label: "Personalizar agora", onClick: () => void handleToggleSync(false) },
      });
      return;
    }
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
    if (isReadOnly) {
      toast.error("Modo \"Seguir modelo público\" ativo. Desligue para remover passos.");
      return;
    }
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

        {/* Modo "Seguir modelo público" — toggle exclusivo do consultor.
            Quando ligado: estrutura é a do template do super-admin (sempre
            atualizada). O usuário continua dono das próprias mídias. */}
        {userId && !isSuperAdmin && syncMode !== null && (
          <div
            className={`border-t px-4 py-3 ${
              isReadOnly
                ? "bg-amber-50 dark:bg-amber-950/30"
                : "bg-muted/30"
            }`}
          >
            <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                {isReadOnly ? (
                  <Lock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                ) : (
                  <Unlock className="h-4 w-4 text-muted-foreground" />
                )}
                <span className="text-sm font-medium">
                  Seguir modelo público do super-admin
                </span>
                <Badge variant={isReadOnly ? "secondary" : "outline"} className="text-[10px]">
                  {isReadOnly ? "Sincronizado" : "Personalizado"}
                </Badge>
              </div>
              <Switch
                checked={isReadOnly}
                disabled={togglingSync || !flowId}
                onCheckedChange={(v) => { void handleToggleSync(v); }}
                aria-label="Seguir modelo público"
              />
              <p className="flex-1 text-xs text-muted-foreground min-w-[240px]">
                {isReadOnly
                  ? "Estrutura travada ao modelo público. Você só pode trocar as mídias dos passos — mudanças do super-admin aparecem aqui automaticamente. No Evolution, os botões viram lista numerada (1️⃣ 2️⃣ 3️⃣) automaticamente."
                  : "Você está editando a sua própria versão do fluxo. Mudanças do super-admin não chegam mais automaticamente."}
              </p>
            </div>
          </div>
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
      {editingVariant === "B" && userId ? (
        <main className="mx-auto w-full max-w-7xl px-4 py-6">
          <FluxoBEditor consultantId={userId} />
        </main>
      ) : (
      <main className={`mx-auto grid gap-4 px-4 py-6 ${
        viewMode === "planilha" || (viewMode === "diagrama" && panelHidden)
          ? "max-w-none lg:grid-cols-1"
          : "max-w-7xl lg:grid-cols-[1fr_400px]"
      }`}>
        {/* Coluna esquerda — Modo_Lista (mantida montada) */}
        <section
          className={viewMode === "lista" ? "space-y-3" : "hidden"}
          aria-hidden={viewMode !== "lista"}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-muted-foreground">
              Editando <span className="font-semibold text-foreground">Fluxo {editingVariant}</span> — {VARIANT_LABEL[editingVariant].replace(/^Fluxo\s+[A-E]\s*/, "")} · {steps.length} {steps.length === 1 ? "passo" : "passos"}
            </h2>
          </div>

          {steps.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-muted/20 p-10 text-center">
              <p className="text-sm text-muted-foreground">
                Nenhum passo ainda. Adicione o primeiro abaixo.
              </p>
            </div>
          ) : (
            <>
              <StepListToolbar
                query={listQuery}
                onQueryChange={setListQuery}
                typeFilter={typeFilter}
                onToggleType={toggleTypeFilter}
                onClear={() => { setListQuery(""); setTypeFilter(new Set()); }}
                total={steps.length}
                visible={filteredSteps.length}
              />

              {filteredSteps.length === 0 ? (
                <div className="rounded-lg border border-dashed bg-muted/10 p-6 text-center text-xs text-muted-foreground">
                  Nenhum passo corresponde à busca.
                </div>
              ) : (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={orderedSteps.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                    {/*
                      Lista em ORDEM DE CONVERSA — os passos seguem a mesma
                      ordem (por `position`) em que o lead os percorre, então
                      a lista pode ser lida de cima para baixo como o roteiro
                      real do bot. Cada passo mostra suas saídas inline via
                      `StepTimelineItem`. (Substitui o agrupamento por tipo,
                      que misturava a ordem e dificultava o entendimento.)
                    */}
                    <div>
                      {orderedSteps.map((s, i) => (
                        <StepTimelineItem
                          key={s.id}
                          step={s}
                          steps={steps}
                          selected={selectedId === s.id}
                          isStart={s.id === startStepId}
                          isLast={i === orderedSteps.length - 1}
                          pulse={pulseStepId === s.id}
                          mediaCount={s.slot_key ? mediaCounts[s.slot_key] : undefined}
                          onSelect={() => setSelectedId(s.id)}
                          onEdit={() => { setSelectedId(s.id); setInspectorTab("conteudo"); setInspectorId(s.id); }}
                          onEditExits={() => { setSelectedId(s.id); setInspectorTab("regras"); setInspectorId(s.id); }}
                          onDelete={() => deleteStep(s.id)}
                          onDuplicate={() => duplicateStep(s.id)}
                          onJumpTo={(targetId) => {
                            setSelectedId(targetId);
                            setPulseStepId(targetId);
                            setTimeout(() => {
                              document.getElementById(`step-card-${targetId}`)
                                ?.scrollIntoView({ behavior: "smooth", block: "center" });
                            }, 50);
                            setTimeout(() => setPulseStepId((cur) => (cur === targetId ? null : cur)), 1100);
                          }}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              )}

            </>
          )}

          {!isReadOnly && (
            <Button variant="outline" className="w-full" onClick={() => { void addStep(); }}>
              <Plus className="mr-1 h-4 w-4" />
              Adicionar passo
            </Button>
          )}
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
                    panelHidden={panelHidden}
                    onTogglePanel={togglePanelHidden}
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

        {/* Modo_Planilha — tabela densa só-leitura com revisão IA GPT-5.5 */}
        {viewMode === "planilha" && (
          <section className="w-full" aria-label="Editor de fluxo em planilha">
            <Suspense fallback={
              <div className="grid h-64 place-items-center text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            }>
              <FlowSpreadsheet
                steps={steps}
                flowId={flowId}
                variant={editingVariant}
                mediaCounts={mediaCounts}
                onOpenStep={(id) => { setSelectedId(id); setInspectorId(id); }}
                onReviewAll={() => runReview("global")}
                onSuggestForStep={(id) => runReview("step", id)}
                reviewing={reviewLoading}
                suggestingStepId={suggestingStepId}
              />
            </Suspense>
          </section>
        )}

        {/* Coluna direita — preview WhatsApp + preferências de IA */}
        {!(viewMode === "diagrama" && panelHidden) && viewMode !== "planilha" && (
          <aside className="hidden space-y-3 lg:block">
            <WhatsAppPreview step={selected} steps={steps} consultantName={consultantName} />
            {userId && <AiPreferencesCard consultantId={userId} />}
          </aside>
        )}
      </main>
      )}

      {/* Painel lateral de revisão IA */}
      <FlowReviewPanel
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        result={reviewResult}
        loading={reviewLoading}
        error={reviewError}
        steps={steps}
        flowId={flowId}
        consultantId={userId}
        onApplied={() => userId && reload(userId, editingVariant)}
        onJumpToStep={(id) => { setSelectedId(id); setInspectorId(id); }}
      />

      {/* Inspector */}
      {userId && (
        <StepInspector
          step={inspectorStep}
          steps={steps}
          consultantId={userId}
          variant={editingVariant}
          flowId={flowId}
          maxPosition={maxPosition}
          initialTab={inspectorTab}
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
