import React, { useEffect, useMemo, useState, useCallback, Suspense } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import { Plus, Loader2, Play, LayoutTemplate, TrendingUp } from "lucide-react";

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
import AiPreferencesCard from "@/components/admin/flow-builder/AiPreferencesCard";
import VariantDistributionBar from "@/components/admin/flow-builder/VariantDistributionBar";
import FlowSimulator from "@/components/admin/flow-builder/FlowSimulator";
import TemplateGalleryDialog from "@/components/admin/flow-builder/TemplateGalleryDialog";
import { useFlowValidation } from "@/components/admin/flow-builder/useFlowValidation";
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
  
  const [inspectorId, setInspectorId] = useState<string | null>(null);
  const [inspectorTab, setInspectorTab] = useState<any>("conteudo");
  const [viewMode, setViewModeState] = useState<ViewMode>(() => {
    const v = typeof window !== "undefined" ? window.localStorage.getItem("flow-view-mode") : "lista";
    return (v === "diagrama" || v === "planilha" || v === "lista") ? v : "lista";
  });

  const [galleryOpen, setGalleryOpen] = useState(false);
  const [simulatorOpen, setSimulatorOpen] = useState(false);
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
      const mappedSteps = (flow.bot_flow_steps || []).map((s: any) => ({
        ...s,
        transitions: parseTransitions(s.transitions),
        captures: parseCaptures(s.captures),
        fallback: parseFallback(s.fallback, s.transitions)
      })).sort((a: any, b: any) => a.position - b.position);
      setSteps(mappedSteps);
    } else {
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

  const filteredSteps = useMemo(() => {
    return steps.filter(s => {
      if (typeFilter.size > 0 && !typeFilter.has(s.step_type)) return false;
      if (!listQuery) return true;
      const q = listQuery.toLowerCase();
      return s.title.toLowerCase().includes(q) || (s.message_text || "").toLowerCase().includes(q);
    });
  }, [steps, listQuery, typeFilter]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setSteps(items => {
      const oldIndex = items.findIndex(i => i.id === active.id);
      const newIndex = items.findIndex(i => i.id === over.id);
      return arrayMove(items, oldIndex, newIndex).map((s, i) => ({ ...s, position: i + 1 }));
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
                  <Badge variant="outline" className="text-[9px] py-0 h-4 border-border/40 font-medium">
                    {steps.length} passos
                  </Badge>
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
                  </div>
                </TooltipProvider>
              </div>
            </div>
          </header>

          <main className="mx-auto grid gap-6 px-4 py-6 max-w-7xl lg:grid-cols-[1fr_380px]">
            <div className="min-w-0">
              {viewMode === "lista" && (
                <div className="space-y-4">
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
                            onDelete={() => {}}
                            onDuplicate={() => {}}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>
                  <Button variant="outline" className="w-full border-dashed border-2 h-12 hover:border-primary/50 hover:bg-primary/5 transition-all text-muted-foreground hover:text-primary group">
                    <Plus className="mr-2 h-4 w-4 group-hover:scale-110 transition-transform" /> 
                    Adicionar passo ao fluxo
                  </Button>

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
                      flowId={null}
                      editingVariant={editingVariant}
                      mediaCounts={{}}
                      validation={validation}
                      readOnly={isNarrow}
                      onSelectStep={setInspectorId}
                      onOpenInspector={(id) => { setInspectorId(id); setInspectorTab("conteudo"); }}
                      onPatchStep={async () => {}}
                      onAddStep={async () => null}
                      onDuplicateStep={async () => {}}
                      onDeleteStep={async () => {}}
                      onAutoFixAll={async () => {}}
                    />
                  </Suspense>
                </div>
              )}
            </div>

            <aside className="space-y-4">
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
          initialTab={inspectorTab}
          onClose={() => setInspectorId(null)}
          onPatch={() => {}}
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
    </div>
  );
}
