import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { HelpHint } from "@/components/ui/help-hint";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { GripVertical, Plus, Pencil, Trash2, Settings2, Check, X, Zap, Search } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { StageAutoMessageConfig } from "./StageAutoMessageConfig";
import { AddLeadDialog } from "./AddLeadDialog";
import { DropConfirmDialog } from "./DropConfirmDialog";
import { KanbanColumn } from "./KanbanColumn";
import { DragResizer } from "@/components/layout/DragResizer";
import { useKanbanStages, COLOR_OPTIONS } from "@/hooks/useKanbanStages";
import { useKanbanDeals } from "@/hooks/useKanbanDeals";
import { useFlowSteps } from "@/hooks/useFlowSteps";
import { sendWhatsAppMessage, resolveRecipient } from "@/services/messageSender";
import type { MediaCategory } from "@/services/messageSender";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Tables } from "@/integrations/supabase/types";

type KanbanStageRow = Tables<"kanban_stages">;
type CrmDealRow = Tables<"crm_deals">;

interface KanbanBoardProps {
  consultantId: string;
  instanceName?: string | null;
}

export function KanbanBoard({ consultantId, instanceName }: KanbanBoardProps) {
  const { stages, fetchStages, addStage, updateStage, deleteStage, saveAutoMessage, toggleAutoMessage, reorderStages } = useKanbanStages(consultantId);
  const [showTests, setShowTests] = useState(false);
  const { deals, fetchDeals, resolveNames, moveDeal, editDeal, deleteDeal, reclassifyAsReal } = useKanbanDeals(consultantId, { includeTests: showTests });
  const { customStepMap, stepOptions } = useFlowSteps(consultantId);

  const [stepFilter, setStepFilter] = useState<string>("all");
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [editingStage, setEditingStage] = useState<KanbanStageRow | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [newColor, setNewColor] = useState(COLOR_OPTIONS[0].value);
  const [addingNew, setAddingNew] = useState(false);
  const [draggedStageId, setDraggedStageId] = useState<string | null>(null);
  const [dragOverStageId, setDragOverStageId] = useState<string | null>(null);
  const [pendingDrop, setPendingDrop] = useState<{ dealId: string; stageKey: string; stageId: string; stageLabel: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [editingDeal, setEditingDeal] = useState<CrmDealRow | null>(null);
  const [editForm, setEditForm] = useState({ phone: "", notes: "" });
  const [deletingDealId, setDeletingDealId] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => { fetchStages(); fetchDeals().then(() => resolveNames(deals)); }, [fetchStages, fetchDeals]);
  useEffect(() => { resolveNames(deals); }, [deals.length]);

  // Send auto-messages when deal moves to a stage
  const sendAutoMessages = async (stage: KanbanStageRow, deal: CrmDealRow, rejectionReason?: string) => {
    if (!stage.auto_message_enabled) { toast({ title: "⚠️ Msg automática desativada para esta coluna", description: stage.label }); return; }
    if (!instanceName) { toast({ title: "⚠️ WhatsApp não conectado", variant: "destructive" }); return; }
    if (!deal.remote_jid) { toast({ title: "⚠️ Lead sem número de WhatsApp", variant: "destructive" }); return; }

    let customerName = "";
    if (deal.customer_id) {
      const { data: customer } = await supabase.from("customers").select("name").eq("id", deal.customer_id).single();
      customerName = customer?.name || "";
    }
    if (!customerName && deal.remote_jid) {
      const phone = deal.remote_jid.split("@")[0];
      const { data: customer } = await supabase.from("customers").select("name").eq("phone_whatsapp", phone).limit(1).maybeSingle();
      customerName = customer?.name || "";
    }

    const { data: autoMsgs } = await supabase.from("stage_auto_messages").select("*").eq("stage_id", stage.id).eq("consultant_id", consultantId).order("position", { ascending: true });
    const phone = resolveRecipient(deal.remote_jid);
    const displayName = customerName || phone;

    const filteredMsgs = autoMsgs && autoMsgs.length > 0
      ? autoMsgs.filter((m: any) => {
          const reasonMatch = !m.rejection_reason || m.rejection_reason === rejectionReason;
          const originMatch = !m.deal_origin || m.deal_origin === (deal as any).deal_origin;
          return reasonMatch && originMatch;
        })
      : [];

    const messagesToSend = filteredMsgs.length > 0
      ? filteredMsgs
      : (stage.auto_message_text || stage.auto_message_media_url || (stage as any).auto_message_image_url)
        ? [{ message_type: stage.auto_message_type || "text", message_text: stage.auto_message_text, media_url: stage.auto_message_media_url, image_url: (stage as any).auto_message_image_url, delay_seconds: 0 }]
        : [];

    if (messagesToSend.length === 0) { toast({ title: "⚠️ Nenhuma mensagem configurada", description: `Coluna "${stage.label}"` }); return; }

    try {
      let sentCount = 0, failedCount = 0;
      for (let i = 0; i < messagesToSend.length; i++) {
        const msg = messagesToSend[i];
        if (i > 0 && msg.delay_seconds > 0) await new Promise((r) => setTimeout(r, msg.delay_seconds * 1000));
        const messageText = (msg.message_text || "").replace(/\{\{nome\}\}/g, displayName).replace(/\{\{telefone\}\}/g, phone);
        const mediaCategory: MediaCategory = (msg.message_type as MediaCategory) || "text";

        if (msg.image_url && mediaCategory !== "image") {
          const imgResult = await sendWhatsAppMessage({ instanceName, phone, mediaCategory: "image", mediaUrl: msg.image_url });
          if (imgResult.status === "failed") failedCount++;
          await new Promise((r) => setTimeout(r, 1500));
        }

        let result;
        if (mediaCategory === "audio" && msg.media_url) {
          result = await sendWhatsAppMessage({ instanceName, phone, mediaCategory: "audio", mediaUrl: msg.media_url });
          if (messageText) { await new Promise((r) => setTimeout(r, 1500)); const tr = await sendWhatsAppMessage({ instanceName, phone, mediaCategory: "text", text: messageText }); if (tr.status === "sent") sentCount++; else failedCount++; }
        } else if ((mediaCategory === "image" || mediaCategory === "video") && msg.media_url) {
          result = await sendWhatsAppMessage({ instanceName, phone, mediaCategory, mediaUrl: msg.media_url, text: messageText });
        } else if (messageText) {
          result = await sendWhatsAppMessage({ instanceName, phone, mediaCategory: "text", text: messageText });
        }
        if (result?.status === "sent") sentCount++; else if (result) failedCount++;
      }

      if (sentCount > 0) {
        const previewText = (messagesToSend[0]?.message_text || "").replace(/\{\{nome\}\}/g, displayName).replace(/\{\{telefone\}\}/g, phone);
        await supabase.from("crm_auto_message_log").insert({ deal_id: deal.id, consultant_id: consultantId, stage_key: stage.stage_key, remote_jid: deal.remote_jid, customer_name: customerName || null, message_preview: previewText ? previewText.slice(0, 200) : null, status: failedCount > 0 ? "partial" : "sent" });
      }
      if (failedCount > 0) toast({ title: `⚠️ ${sentCount} enviada(s), ${failedCount} falha(s)`, variant: "destructive" });
      else toast({ title: `✅ ${sentCount} msg(s) automática(s) enviada(s) (${stage.label})` });
    } catch (err) {
      toast({ title: "❌ Erro ao enviar msg automática", description: err instanceof Error ? err.message : "Falha desconhecida", variant: "destructive" });
    }
  };

  const handleDrop = (stageKey: string) => {
    if (!draggedId) return;
    const deal = deals.find((d) => d.id === draggedId);
    if (!deal || deal.stage === stageKey) { setDraggedId(null); return; }
    const targetStage = stages.find((s) => s.stage_key === stageKey);
    if (!targetStage) { setDraggedId(null); return; }
    setPendingDrop({ dealId: draggedId, stageKey, stageId: targetStage.id, stageLabel: targetStage.label });
    setDraggedId(null);
  };

  const confirmDrop = async (sendMessages: boolean, rejectionReason?: string) => {
    if (!pendingDrop) return;
    const updatedDeal = await moveDeal(pendingDrop.dealId, pendingDrop.stageKey, rejectionReason);
    setPendingDrop(null);
    if (updatedDeal && sendMessages) {
      const targetStage = stages.find((s) => s.stage_key === pendingDrop.stageKey);
      if (targetStage) sendAutoMessages(targetStage, updatedDeal, rejectionReason);
    }
  };

  const openEditDeal = (deal: CrmDealRow) => {
    setEditForm({ phone: deal.remote_jid?.split("@")[0] || "", notes: deal.notes || "" });
    setEditingDeal(deal);
  };

  const handleAddStage = () => {
    addStage(newLabel, newColor);
    setNewLabel("");
    setNewColor(COLOR_OPTIONS[0].value);
    setAddingNew(false);
  };

  return (
    <div className="h-full min-h-0 flex flex-col gap-2">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">CRM Kanban</h3>
          <HelpHint
            title="CRM Kanban"
            summary="Arraste leads entre estágios para acompanhar o funil"
            details="Cada coluna representa uma etapa padronizada do funil (Novo lead → Aguardando conta → Cadastro enviado → etc). A auto-progressão move o lead automaticamente quando o bot detecta evento-chave (ex: OCR da conta concluído). Você pode arrastar manualmente também."
            example="Lead respondeu mas parou no 'Aguardando conta' por 3 dias? Mova manualmente para 'Sem resposta' e dispare uma mensagem de retomada."
          />
          <Badge variant="secondary" className="text-[9px] gap-1"><Zap className="h-2.5 w-2.5" />Auto-progressão ativa</Badge>
          <HelpHint
            title="Auto-progressão"
            summary="O bot move o lead de coluna conforme detecta eventos"
            details="Quando ativo, eventos como 'OCR da conta lido', 'documento aprovado' ou 'cadastro finalizado' movem o lead para o próximo estágio sem intervenção. Desative apenas se quiser controle 100% manual."
          />
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input placeholder="Buscar lead..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="h-7 text-xs pl-8 w-[180px]" />
          </div>
          <Select value={stepFilter} onValueChange={setStepFilter}>
            <SelectTrigger className="h-7 text-xs w-[200px]"><SelectValue placeholder="Parou no passo" /></SelectTrigger>
            <SelectContent className="max-h-[320px]">
              <SelectItem value="all" className="text-xs">Todos os passos</SelectItem>
              <SelectItem value="none" className="text-xs">Sem interação</SelectItem>
              {stepOptions.map((o) => (
                <SelectItem key={o.key} value={o.key} className="text-xs">{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer select-none" title="Mostrar leads marcados como teste/sandbox (cards cinza)">
            <Switch checked={showTests} onCheckedChange={setShowTests} className="h-4 w-7 data-[state=checked]:bg-primary" />
            Mostrar testes
          </label>
          <AddLeadDialog consultantId={consultantId} stages={stages.map((s) => ({ stage_key: s.stage_key, label: s.label, color: s.color }))} onLeadAdded={fetchDeals} />
          <Dialog open={showSettings} onOpenChange={setShowSettings}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5"><Settings2 className="h-3.5 w-3.5" />Configurar Colunas</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle className="text-sm">Configurar Colunas do Kanban</DialogTitle></DialogHeader>
              <p className="text-[11px] text-muted-foreground -mt-1">Leads aprovados progridem automaticamente para 30 → 60 → 90 → 120 DIAS.</p>
              <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                {stages.map((stage) => (
                  <div
                    key={stage.id}
                    draggable={!editingStage}
                    onDragStart={() => setDraggedStageId(stage.id)}
                    onDragOver={(e) => { e.preventDefault(); if (draggedStageId && draggedStageId !== stage.id) setDragOverStageId(stage.id); }}
                    onDrop={() => { if (draggedStageId) reorderStages(draggedStageId, stage.id); setDraggedStageId(null); setDragOverStageId(null); }}
                    onDragEnd={() => { setDraggedStageId(null); setDragOverStageId(null); }}
                    className={`flex items-center gap-2 p-2.5 rounded-lg bg-secondary/50 transition-all ${draggedStageId === stage.id ? "opacity-50 scale-95" : ""} ${dragOverStageId === stage.id ? "border-2 border-primary/40 border-dashed" : ""} ${!editingStage ? "cursor-grab active:cursor-grabbing" : ""}`}
                  >
                    {!editingStage && <GripVertical className="h-4 w-4 text-muted-foreground/50 shrink-0" />}
                    {editingStage?.id === stage.id ? (
                      <>
                        <Input value={editingStage.label} onChange={(e) => setEditingStage({ ...editingStage, label: e.target.value })} className="h-7 text-xs flex-1" />
                        <select value={editingStage.color} onChange={(e) => setEditingStage({ ...editingStage, color: e.target.value })} className="h-7 text-xs bg-background border border-border rounded px-1">
                          {COLOR_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                        </select>
                        <Button size="icon" variant="ghost" className="h-6 w-6 text-primary" onClick={() => { updateStage(editingStage); setEditingStage(null); }}><Check className="h-3.5 w-3.5" /></Button>
                        <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground" onClick={() => setEditingStage(null)}><X className="h-3.5 w-3.5" /></Button>
                      </>
                    ) : (
                      <>
                        <Badge variant="secondary" className={`text-[10px] ${stage.color}`}>{stage.label}</Badge>
                        <Switch checked={stage.auto_message_enabled} onCheckedChange={(checked) => toggleAutoMessage(stage.id, checked)} className="h-4 w-7 data-[state=checked]:bg-primary" />
                        <StageAutoMessageConfig stageId={stage.id} stageLabel={stage.label} stageKey={stage.stage_key} consultantId={consultantId} autoMessageText={stage.auto_message_text} autoMessageType={stage.auto_message_type || "text"} autoMessageMediaUrl={stage.auto_message_media_url} autoMessageImageUrl={(stage as any).auto_message_image_url} onSave={(text, type, mediaUrl, imageUrl) => saveAutoMessage(stage.id, text, type, mediaUrl, imageUrl)} />
                        <span className="flex-1" />
                        <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-primary" onClick={() => setEditingStage({ ...stage })}><Pencil className="h-3 w-3" /></Button>
                        <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => deleteStage(stage.id, deals.filter((d) => d.stage === stage.stage_key).length)}><Trash2 className="h-3 w-3" /></Button>
                      </>
                    )}
                  </div>
                ))}
                {addingNew ? (
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-secondary/50 border border-dashed border-primary/30">
                    <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Nome da coluna" className="h-7 text-xs flex-1" autoFocus onKeyDown={(e) => e.key === "Enter" && handleAddStage()} />
                    <select value={newColor} onChange={(e) => setNewColor(e.target.value)} className="h-7 text-xs bg-background border border-border rounded px-1">
                      {COLOR_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                    <Button size="icon" variant="ghost" className="h-6 w-6 text-primary" onClick={handleAddStage}><Check className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground" onClick={() => { setAddingNew(false); setNewLabel(""); }}><X className="h-3.5 w-3.5" /></Button>
                  </div>
                ) : (
                  <Button variant="outline" size="sm" className="w-full h-8 text-xs gap-1.5 border-dashed" onClick={() => setAddingNew(true)}>
                    <Plus className="h-3.5 w-3.5" />Adicionar Coluna
                  </Button>
                )}
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Kanban columns */}
      <div className="flex-1 min-h-0 flex gap-2 overflow-x-auto pb-2 items-stretch" data-resize-scope style={{ "--kanban-col-w": "248px" } as React.CSSProperties}>
        <DragResizer storageKey="kanban-col" cssVar="kanban-col-w" defaultPx={248} minPx={200} maxPx={480} />
        {stages.map((s) => (
          <KanbanColumn key={s.id} stage={s} deals={deals} searchQuery={searchQuery} stepFilter={stepFilter} customStepMap={customStepMap} onDrop={handleDrop} onDragStart={setDraggedId} onEditDeal={openEditDeal} onDeleteDeal={setDeletingDealId} onReclassify={reclassifyAsReal} />
        ))}
      </div>

      {/* Drop confirmation */}
      {pendingDrop && (
        <DropConfirmDialog
          open={!!pendingDrop}
          onClose={() => setPendingDrop(null)}
          onConfirm={confirmDrop}
          stageLabel={pendingDrop.stageLabel}
          stageKey={pendingDrop.stageKey}
          stageId={pendingDrop.stageId}
          consultantId={consultantId}
          dealName={deals.find((d) => d.id === pendingDrop.dealId)?.remote_jid?.split("@")[0] || "Lead"}
          dealOrigin={(deals.find((d) => d.id === pendingDrop.dealId) as any)?.deal_origin}
        />
      )}

      {/* Edit deal dialog */}
      <Dialog open={!!editingDeal} onOpenChange={(o) => !o && setEditingDeal(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="text-sm flex items-center gap-2"><Pencil className="h-4 w-4" /> Editar Deal</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-foreground">Telefone</label>
              <Input value={editForm.phone} onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))} placeholder="5511999999999" className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-foreground">Observações</label>
              <Textarea value={editForm.notes} onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Notas sobre o lead..." className="text-xs min-h-[80px] resize-none" />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setEditingDeal(null)}>Cancelar</Button>
              <Button size="sm" className="h-8 text-xs" onClick={() => { if (editingDeal) { editDeal(editingDeal.id, editForm.phone, editForm.notes, editingDeal.remote_jid); setEditingDeal(null); } }}>Salvar</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete deal confirmation */}
      <Dialog open={!!deletingDealId} onOpenChange={(o) => !o && setDeletingDealId(null)}>
        <DialogContent className="max-w-xs">
          <DialogHeader><DialogTitle className="text-sm flex items-center gap-2 text-destructive"><Trash2 className="h-4 w-4" /> Excluir Deal</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">Tem certeza que deseja excluir este deal? Essa ação não pode ser desfeita.</p>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setDeletingDealId(null)}>Cancelar</Button>
            <Button variant="destructive" size="sm" className="h-8 text-xs" onClick={() => { if (deletingDealId) { deleteDeal(deletingDealId); setDeletingDealId(null); } }}>Excluir</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
