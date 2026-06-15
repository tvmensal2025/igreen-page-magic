import React, { useEffect, useMemo, useState, useCallback, Suspense } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import { Plus, Loader2, Play, LayoutTemplate, TrendingUp, GraduationCap } from "lucide-react";

import {
  DndContext, DragEndEvent, PointerSensor, useSensor, useSensors, closestCenter,
} from "@dnd-kit/core";
import {
  SortableContext, verticalListSortingStrategy, arrayMove,
} from "@dnd-kit/sortable";

import StepTimelineItem from "@/components/admin/flow-builder/StepTimelineItem";
import FluxoBHeaderStats from "@/components/admin/flow-builder/FluxoBHeaderStats";
import StepInspector from "@/components/admin/flow-builder/StepInspector";
import StepListToolbar from "@/components/admin/flow-builder/StepListToolbar";
import WhatsAppPreview from "@/components/admin/flow-builder/WhatsAppPreview";
import AiPreferencesCard from "@/components/admin/flow-builder/AiPreferencesCard";
import VariantDistributionBar from "@/components/admin/flow-builder/VariantDistributionBar";
import FlowSimulator from "@/components/admin/flow-builder/FlowSimulator";
import StepCoachPanel from "@/components/admin/flow-builder/StepCoachPanel";
import FlowTourOverlay, { tourPendente } from "@/components/admin/flow-builder/FlowTourOverlay";
import FlowHealthDialog from "@/components/admin/flow-builder/FlowHealthDialog";
import TemplateGalleryDialog from "@/components/admin/flow-builder/TemplateGalleryDialog";
import GuidedStepDialog from "@/components/admin/flow-builder/GuidedStepDialog";
import { useFlowValidation } from "@/components/admin/flow-builder/useFlowValidation";
import { useFlowStepsCrud } from "@/components/admin/flow-builder/useFlowStepsCrud";
import {
  Step, Variant, VARIANT_LABEL,
  parseTransitions, parseCaptures, parseFallback,
} from "@/components/admin/flow-builder/flowTypes";
import ViewToggle, { type ViewMode } from "@/components/admin/flow-builder/ViewToggle";
import { useViewportWidth } from "@/hooks/useViewportWidth";
import { AppSidebar, type AdminTabId } from "@/components/layout/AppSidebar";
import { AppTopbar } from "@/components/layout/AppTopbar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const FlowDiagramV2 = React.lazy(() => import("@/components/admin/flow-builder/diagram-v2/FlowDiagramV2"));

export default function FluxoBuilder() {
  const navigate = useNavigate();
  
  const [userId, setUserId] = useState<string | null>(null);
  const [consultantName, setConsultantName] = useState("");
  const [consultantPhoto, setConsultantPhoto] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => 
    typeof window !== "undefined" && window.localStorage.getItem("pe:sidebar-collapsed") === "1"
  );
  
  const [steps, setSteps] = useState<Step[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingVariant, setEditingVariant] = useState<Variant>("A");
  const [existingVariants, setExistingVariants] = useState<Variant[]>(["A"]);
  const [flowNames, setFlowNames] = useState<Record<string, string>>({});
  // flow_id e sync_mode do fluxo PRÓPRIO do consultor na variante atual.
  // Capturados no loadData (antes eram lidos e descartados). syncMode decide
  // se a edição grava direto ('custom') ou exige "Personalizar" antes ('public').
  const [flowId, setFlowId] = useState<string | null>(null);
  const [syncMode, setSyncMode] = useState<"public" | "custom">("public");
  
  const [inspectorId, setInspectorId] = useState<string | null>(null);
  const [inspectorTab, setInspectorTab] = useState<any>("conteudo");
  const [viewMode, setViewModeState] = useState<ViewMode>(() => {
    const v = typeof window !== "undefined" ? window.localStorage.getItem("flow-view-mode") : "lista";
    return (v === "diagrama" || v === "planilha" || v === "lista") ? v : "lista";
  });

  const [galleryOpen, setGalleryOpen] = useState(false);
  const [simulatorOpen, setSimulatorOpen] = useState(false);
  const [healthOpen, setHealthOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [guidedOpen, setGuidedOpen] = useState(false);
  const [listQuery, setListQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set());

  const { isNarrow } = useViewportWidth();
  const validation = useFlowValidation(steps);

  const setViewMode = useCallback((next: ViewMode) => {
    setViewModeState(next);
    localStorage.setItem("flow-view-mode", next);
  }, []);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const toggleSidebarCollapsed = () => {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    localStorage.setItem("pe:sidebar-collapsed", next ? "1" : "0");
  };

  const loadData = useCallback(async (v: Variant) => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setUserId(user.id);

    const { data: consultant } = await supabase.from("consultants").select("*").eq("id", user.id).maybeSingle();
    if (consultant) {
      setConsultantName(consultant.name || "");
      setConsultantPhoto(consultant.photo_url || "");
    }

    const { data: flow } = await supabase.from("bot_flows")
      .select("*, bot_flow_steps(*)")
      .eq("consultant_id", user.id)
      .eq("variant", v)
      .eq("is_active", true)
      .maybeSingle();

    if (flow) {
      // Captura o flow_id próprio e o sync_mode (antes eram descartados). O
      // hook de persistência usa ambos: o flow_id como alvo das escritas e o
      // sync_mode para decidir se a edição é permitida ('custom') ou se o
      // consultor precisa "Personalizar" primeiro ('public' = herdado).
      setFlowId((flow as any).id ?? null);
      setSyncMode(String((flow as any).sync_mode ?? "public").toLowerCase() === "custom" ? "custom" : "public");
      const mappedSteps = (flow.bot_flow_steps || []).map((s: any) => ({
        ...s,
        transitions: parseTransitions(s.transitions),
        captures: parseCaptures(s.captures),
        fallback: parseFallback(s.fallback, s.transitions)
      })).sort((a: any, b: any) => a.position - b.position);
      setSteps(mappedSteps);
    } else {
      setFlowId(null);
      setSyncMode("public");
      setSteps([]);
    }
    
    const { data: allFlows } = await supabase.from("bot_flows")
      .select("variant, name")
      .eq("consultant_id", user.id)
      .eq("is_active", true);
    
    if (allFlows) {
      const variants = allFlows.map(f => f.variant as Variant);
      setExistingVariants(variants.length > 0 ? variants : ["A"]);
      const names: Record<string, string> = {};
      allFlows.forEach(f => { names[f.variant] = f.name || `Fluxo ${f.variant}`; });
      setFlowNames(names);
    }

    setLoading(false);
  }, []);

  useEffect(() => { loadData(editingVariant); }, [editingVariant, loadData]);

  // Auto-abre o tour na primeira vez que o consultor abre um fluxo vazio.
  useEffect(() => {
    if (!loading && steps.length === 0 && tourPendente()) {
      setTourOpen(true);
    }
  }, [loading, steps.length]);

  const filteredSteps = useMemo(() => {
    return steps.filter(s => {
      if (typeFilter.size > 0 && !typeFilter.has(s.step_type)) return false;
      if (!listQuery) return true;
      const q = listQuery.toLowerCase();
      return s.title.toLowerCase().includes(q) || (s.message_text || "").toLowerCase().includes(q);
    });
  }, [steps, listQuery, typeFilter]);

  // Persistência central dos passos (PR-1). Liga os handlers antes zerados ao
  // banco, com update otimista + revert. Em sync_mode='public' a edição fica
  // bloqueada até "Personalizar" (fork via RPC) — ver useFlowStepsCrud.
  const crud = useFlowStepsCrud({
    flowId,
    syncMode,
    consultantId: userId,
    variant: editingVariant,
    steps,
    setSteps,
    reload: () => loadData(editingVariant),
  });

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    // Reordena de forma otimista e persiste a nova position de cada passo
    // afetado. Só persiste quando o fluxo é editável (custom); em modo público
    // o crud.patchStep já avisa e ignora.
    setSteps(items => {
      const oldIndex = items.findIndex(i => i.id === active.id);
      const newIndex = items.findIndex(i => i.id === over.id);
      const reordered = arrayMove(items, oldIndex, newIndex).map((s, i) => ({ ...s, position: i + 1 }));
      // Persiste apenas os passos cuja position mudou (diff contra o anterior).
      if (!crud.readOnlyHerdado) {
        for (const s of reordered) {
          const before = items.find((x) => x.id === s.id);
          if (before && before.position !== s.position) {
            void crud.patchStep(s.id, { position: s.position });
          }
        }
      }
      return reordered;
    });
  };

  if (loading && !steps.length) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="painel-elite h-[100dvh] flex overflow-hidden">
      <AppSidebar
        activeTab={"whatsapp" as AdminTabId}
        onTabChange={(tab) => navigate(`/admin?tab=${tab}`)}
        consultantName={consultantName}
        consultantPhoto={consultantPhoto}
        open={sidebarOpen}
        onOpenChange={setSidebarOpen}
        collapsed={sidebarCollapsed}
        onCollapse={toggleSidebarCollapsed}
      />
      
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <AppTopbar
          title="Construtor de Fluxos"
          subtitle="Monte o atendimento do WhatsApp · preview ao vivo"
          onToggleSidebar={toggleSidebarCollapsed}
          sidebarCollapsed={sidebarCollapsed}
          onOpenSidebar={() => setSidebarOpen(true)}
        />
        
        <div className="flex-1 min-h-0 overflow-y-auto bg-background">
          <header className="sticky top-0 z-20 border-b bg-card/80 backdrop-blur-md">
            {userId && (
              <div className="pt-3 border-b border-border/10">
                <VariantDistributionBar
                  consultantId={userId}
                  existingVariants={existingVariants}
                  editingVariant={editingVariant}
                  onSelectVariant={setEditingVariant}
                  onChanged={() => loadData(editingVariant)}
                />
              </div>

            )}

            <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold truncate flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded bg-primary/10 text-[10px] font-black text-primary border border-primary/20">
                      {editingVariant}
                    </span>
                    <span>{flowNames[editingVariant] || VARIANT_LABEL[editingVariant]}</span>
                  </h2>
                  {editingVariant === "B" && userId ? (
                    <FluxoBHeaderStats
                      consultantId={userId}
                      onEditPersona={() => {
                        document.querySelector('[data-fluxo-b-editor]')?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }}
                    />
                  ) : (
                    <Badge variant="outline" className="text-[9px] py-0 h-4 border-border/40 font-medium">
                      {steps.length} passos
                    </Badge>
                  )}
                </div>
              </div>


              <div className="flex items-center gap-1">
                <ViewToggle value={viewMode} onChange={setViewMode} className="mr-2" />
                <TooltipProvider delayDuration={150}>
                  <div className="flex items-center gap-1">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setGalleryOpen(true)}>
                          <LayoutTemplate className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Galeria</TooltipContent>
                    </Tooltip>
                    
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setSimulatorOpen(true)} disabled={!steps.length}>
                          <Play className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Simular</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setTourOpen(true)}>
                          <GraduationCap className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Tour guiado</TooltipContent>
                    </Tooltip>
                  </div>
                </TooltipProvider>
              </div>
            </div>
          </header>

          <main className="mx-auto grid gap-6 px-4 py-6 max-w-7xl lg:grid-cols-[1fr_380px]">
            <div className="min-w-0">
              {viewMode === "lista" && (
                <div className="space-y-4">
                  {crud.readOnlyHerdado && (
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">Este é o modelo padrão do fluxo</p>
                        <p className="text-xs text-muted-foreground">
                          Para editar, criar ou remover passos, crie a sua versão personalizada. O atendimento continua funcionando normalmente enquanto isso.
                        </p>
                      </div>
                      <Button
                        size="sm"
                        className="shrink-0"
                        disabled={crud.saving}
                        onClick={() => void crud.personalizar()}
                      >
                        {crud.saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        Personalizar
                      </Button>
                    </div>
                  )}
                  <AiPreferencesCard consultantId={userId} />
                  <StepListToolbar
                    query={listQuery}
                    onQueryChange={setListQuery}
                    typeFilter={typeFilter}
                    onToggleType={(t) => {
                      const next = new Set(typeFilter);
                      if (next.has(t)) next.delete(t); else next.add(t);
                      setTypeFilter(next);
                    }}
                    onClear={() => { setListQuery(""); setTypeFilter(new Set()); }}
                    total={steps.length}
                    visible={filteredSteps.length}
                  />

                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                    <SortableContext items={filteredSteps.map(s => s.id)} strategy={verticalListSortingStrategy}>
                      <div className="space-y-1">
                        {filteredSteps.map((s, i) => (
                          <StepTimelineItem
                            key={s.id}
                            step={s}
                            steps={steps}
                            selected={inspectorId === s.id}
                            isStart={i === 0 && !listQuery && typeFilter.size === 0}
                            isLast={i === filteredSteps.length - 1}
                            onSelect={() => { setInspectorId(s.id); setInspectorTab("conteudo"); }}
                            onEdit={() => { setInspectorId(s.id); setInspectorTab("conteudo"); }}
                            onDelete={() => { void crud.deleteStep(s.id); if (inspectorId === s.id) setInspectorId(null); }}
                            onDuplicate={() => { void crud.duplicateStep(s.id); }}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button
                      variant="outline"
                      className="h-12 flex-1 border-dashed border-2 transition-all hover:border-primary/50 hover:bg-primary/5 text-muted-foreground hover:text-primary group"
                      disabled={crud.saving || crud.readOnlyHerdado}
                      onClick={() => { void crud.addStep(); }}
                    >
                      <Plus className="mr-2 h-4 w-4 group-hover:scale-110 transition-transform" />
                      Adicionar passo em branco
                    </Button>
                    <Button
                      className="h-12 flex-1"
                      disabled={crud.saving || crud.readOnlyHerdado}
                      onClick={() => setGuidedOpen(true)}
                    >
                      <GraduationCap className="mr-2 h-4 w-4" />
                      Montar com a Iris
                    </Button>
                  </div>

                </div>
              )}

              {viewMode === "diagrama" && (
                <div className="h-[70vh] rounded-xl border bg-card overflow-hidden">
                  <Suspense fallback={<div className="h-full flex items-center justify-center"><Loader2 className="animate-spin" /></div>}>
                    <FlowDiagramV2
                      steps={steps}
                      selectedId={inspectorId}
                      consultantId={userId || ""}
                      consultantName={consultantName}
                      consultantSlug={""}
                      flowId={flowId}
                      editingVariant={editingVariant}
                      mediaCounts={{}}
                      validation={validation}
                      readOnly={isNarrow || crud.readOnlyHerdado}
                      onSelectStep={setInspectorId}
                      onOpenInspector={(id) => { setInspectorId(id); setInspectorTab("conteudo"); }}
                      onPatchStep={(id, patch) => crud.patchStep(id, patch)}
                      onAddStep={async () => crud.addStep()}
                      onDuplicateStep={(id) => crud.duplicateStep(id)}
                      onDeleteStep={(id) => crud.deleteStep(id)}
                      onAutoFixAll={async () => {}}
                    />
                  </Suspense>
                </div>
              )}
            </div>

            <aside className="space-y-4">
              <StepCoachPanel
                step={steps.find(s => s.id === inspectorId) || null}
                steps={steps}
                validation={validation}
                consultantId={userId}
                variant={editingVariant}
                onJumpToStep={(id) => { setInspectorId(id); setInspectorTab("conteudo"); }}
                onOpenInspector={(id) => { setInspectorId(id); setInspectorTab("conteudo"); }}
                onSimulateFromHere={() => setSimulatorOpen(true)}
                onOpenHealth={() => setHealthOpen(true)}
              />
              <WhatsAppPreview 
                step={steps.find(s => s.id === inspectorId) || null} 
                steps={steps} 
                consultantName={consultantName} 
              />
            </aside>
          </main>
        </div>
      </div>

      {inspectorId && (
        <StepInspector
          step={steps.find(s => s.id === inspectorId) || null}
          steps={steps}
          consultantId={userId || ""}
          variant={editingVariant}
          flowId={flowId}
          maxPosition={steps.reduce((m, s) => Math.max(m, s.position), 0)}
          initialTab={inspectorTab}
          onClose={() => setInspectorId(null)}
          onPatch={(patch) => { if (inspectorId) void crud.patchStep(inspectorId, patch); }}
          onReload={() => loadData(editingVariant)}
        />
      )}

      <FlowSimulator 
        open={simulatorOpen} 
        onOpenChange={setSimulatorOpen} 
        steps={steps} 
        consultantId={userId}
        consultantName={consultantName} 
      />
      <TemplateGalleryDialog 
        open={galleryOpen} 
        onOpenChange={setGalleryOpen} 
        consultantId={userId}
        existingVariants={existingVariants}
      />
      <FlowHealthDialog
        open={healthOpen}
        onOpenChange={setHealthOpen}
        validation={validation}
        steps={steps}
        actionLabel="Fechar"
        onConfirm={() => setHealthOpen(false)}
        onJumpToStep={(id) => { setInspectorId(id); setInspectorTab("conteudo"); setHealthOpen(false); }}
      />
      <FlowTourOverlay open={tourOpen} onClose={() => setTourOpen(false)} />
      <GuidedStepDialog
        open={guidedOpen}
        onOpenChange={setGuidedOpen}
        onCreate={(seed) => crud.addStep(seed)}
        steps={steps}
        consultantName={consultantName}
        onDeleteStep={(id) => crud.deleteStep(id)}
        onRequestMedia={(created) => {
          // Caminho A: passo criado com slot_key → abre o inspetor já na aba
          // de Mídias para o consultor enviar o arquivo na sequência.
          setInspectorId(created.id);
          setInspectorTab("midias");
        }}
      />
    </div>
  );
}
