import { useMemo, useState } from "react";
import { Plus, Trash2, ArrowUp, ArrowDown, Play, Loader2, User, Mic, KeyRound, Sparkles, Variable, Check, X, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/sonner";
import { VoiceClipRecorder } from "./VoiceClipRecorder";
import type { VoiceTemplate, VoiceNameClip } from "@/hooks/useVoiceTemplates";

interface Props {
  consultantId: string;
  template: VoiceTemplate;
  clips: VoiceNameClip[];
  onUpdate: (id: string, patch: any) => Promise<void>;
  onAddBlock: (templateId: string, kind: "fixed_audio" | "name_slot" | "variable_slot", audioUrl?: string | null, variableKey?: string | null) => Promise<void>;
  onUpdateBlockAudio: (blockId: string, templateId: string, audioUrl: string) => Promise<void>;
  onUpdateBlockVariableKey: (blockId: string, templateId: string, variableKey: string) => Promise<void>;
  onDeleteBlock: (blockId: string, templateId: string) => Promise<void>;
  onMoveBlock: (templateId: string, blockId: string, dir: -1 | 1) => Promise<void>;
  onRender: (templateId: string, name?: string, variables?: Record<string, string>) => Promise<{ url?: string; error?: string; missing_name?: string; missing_key?: string }>;
  onUpsertNameClip: (display: string, audioUrl: string) => Promise<void>;
}

function sanitizeKey(input: string): string {
  return (input || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
}

export function VoiceTemplateEditor({
  consultantId, template, clips, onUpdate,
  onAddBlock, onUpdateBlockAudio, onUpdateBlockVariableKey, onDeleteBlock, onMoveBlock, onRender, onUpsertNameClip,
}: Props) {
  const [name, setName] = useState(template.name);
  const [shortcut, setShortcut] = useState(template.shortcut || "");
  const [description, setDescription] = useState(template.description || "");
  const [previewName, setPreviewName] = useState(clips[0]?.name_display || "Ana");
  const [previewVars, setPreviewVars] = useState<Record<string, string>>({});
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [pendingRecord, setPendingRecord] = useState<{ name: string; key: string } | null>(null);
  const [editingKey, setEditingKey] = useState<{ blockId: string; value: string } | null>(null);
  const [newVarKey, setNewVarKey] = useState("");
  const [addingVar, setAddingVar] = useState(false);

  const blocks = useMemo(() => [...(template.blocks || [])].sort((a, b) => a.position - b.position), [template.blocks]);
  const hasNameSlot = blocks.some((b) => b.kind === "name_slot");
  const variableBlocks = blocks.filter((b) => b.kind === "variable_slot");

  async function saveMeta() {
    await onUpdate(template.id, {
      name: name.trim() || template.name,
      shortcut: shortcut.trim() || null,
      description: description.trim() || null,
    });
    toast.success("Template atualizado");
  }

  async function handleAddVariable() {
    const key = sanitizeKey(newVarKey);
    if (!key) { toast.error("Informe uma palavra-chave (ex: cidade)"); return; }
    if (variableBlocks.some((b) => b.variable_key === key)) {
      toast.error(`Já existe um slot {{${key}}} neste template`);
      return;
    }
    await onAddBlock(template.id, "variable_slot", null, key);
    setNewVarKey("");
    setAddingVar(false);
    toast.success(`Slot {{${key}}} adicionado`);
  }

  async function handleSaveKey() {
    if (!editingKey) return;
    const key = sanitizeKey(editingKey.value);
    if (!key) { toast.error("Palavra-chave inválida"); return; }
    await onUpdateBlockVariableKey(editingKey.blockId, template.id, key);
    setEditingKey(null);
    toast.success("Palavra-chave atualizada");
  }

  async function handlePreview() {
    setRendering(true);
    setPreviewUrl(null);
    try {
      // Validar valores das variáveis
      for (const b of variableBlocks) {
        const k = b.variable_key || "";
        if (!previewVars[k]?.trim()) {
          toast.error(`Preencha um valor exemplo para {{${k}}}`);
          setRendering(false);
          return;
        }
      }
      const res = await onRender(template.id, hasNameSlot ? previewName : undefined, previewVars);
      if (res.url) {
        setPreviewUrl(res.url);
      } else if (res.error === "name_not_recorded") {
        setPendingRecord({ name: res.missing_name || previewName, key: res.missing_key || "nome" });
        toast.warning(`Você ainda não gravou "${res.missing_name}". Grave agora aqui embaixo.`);
      } else {
        toast.error(res.error || "Falha ao costurar áudio");
      }
    } finally {
      setRendering(false);
    }
  }

  return (
    <div className="space-y-4 border border-border rounded-xl p-4 bg-card/50">
      {/* metadata */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Nome do template</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Boas-vindas personalizada" />
        </div>
        <div>
          <Label className="text-xs">Atalho rápido</Label>
          <Input value={shortcut} onChange={(e) => setShortcut(e.target.value)} placeholder="/voz-ola" />
        </div>
      </div>
      <div>
        <Label className="text-xs">Descrição (opcional)</Label>
        <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Quando usar este template" />
      </div>
      <div className="flex justify-end">
        <Button size="sm" variant="secondary" onClick={saveMeta}>Salvar dados</Button>
      </div>

      {/* timeline */}
      <div>
        <Label className="text-xs flex items-center gap-1">
          <Sparkles className="w-3.5 h-3.5 text-primary" /> Linha do tempo do áudio
        </Label>
        <p className="text-[11px] text-muted-foreground mb-2">
          Grave as partes fixas e insira slots de palavras-chave (nome, cidade, valor, etc).
          O sistema costura tudo em um único áudio na hora de enviar.
        </p>

        <div className="flex flex-wrap gap-2 items-stretch">
          {blocks.length === 0 && (
            <div className="text-xs text-muted-foreground p-3 border border-dashed border-border rounded w-full text-center">
              Nenhum bloco ainda. Adicione abaixo.
            </div>
          )}

          {blocks.map((b, idx) => (
            <div key={b.id} className="flex-1 min-w-[200px] max-w-[280px] border border-border rounded-lg p-2 bg-background/50 space-y-2">
              <div className="flex items-center justify-between">
                <Badge variant={b.kind === "fixed_audio" ? "secondary" : "default"} className="text-[10px]">
                  {b.kind === "name_slot" ? <><User className="w-3 h-3 mr-1" /> Nome do cliente interessado</>
                    : b.kind === "variable_slot" ? <><Variable className="w-3 h-3 mr-1" /> Palavra-chave</>
                    : <><Mic className="w-3 h-3 mr-1" /> Áudio fixo</>}
                </Badge>
                <div className="flex gap-0.5">
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => onMoveBlock(template.id, b.id, -1)} disabled={idx === 0}><ArrowUp className="w-3 h-3" /></Button>
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => onMoveBlock(template.id, b.id, 1)} disabled={idx === blocks.length - 1}><ArrowDown className="w-3 h-3" /></Button>
                  <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => onDeleteBlock(b.id, template.id)}><Trash2 className="w-3 h-3" /></Button>
                </div>
              </div>

              {b.kind === "fixed_audio" ? (
                <>
                  {b.audio_url ? (
                    <audio src={b.audio_url} controls className="w-full h-8" />
                  ) : (
                    <p className="text-[10px] text-warning">Sem áudio gravado</p>
                  )}
                  <VoiceClipRecorder
                    consultantId={consultantId}
                    slug={`voz-${template.id.slice(0,8)}-bloco-${b.position}`}
                    idleLabel={b.audio_url ? "Regravar" : "Gravar"}
                    onUploaded={(url) => onUpdateBlockAudio(b.id, template.id, url)}
                  />
                </>
              ) : b.kind === "name_slot" ? (
                <div className="text-[11px] text-muted-foreground flex flex-col gap-1">
                  <span className="flex items-center gap-1"><KeyRound className="w-3 h-3 text-primary" /> Palavra-chave: <code className="text-primary">{`{{nome}}`}</code></span>
                  <span>Substituído pelo nome gravado do cliente interessado.</span>
                </div>
              ) : (
                <div className="text-[11px] text-muted-foreground flex flex-col gap-1">
                  {editingKey?.blockId === b.id ? (
                    <div className="flex items-center gap-1">
                      <Input
                        autoFocus value={editingKey.value}
                        onChange={(e) => setEditingKey({ ...editingKey, value: e.target.value })}
                        onKeyDown={(e) => { if (e.key === "Enter") handleSaveKey(); if (e.key === "Escape") setEditingKey(null); }}
                        className="h-7 text-xs"
                        placeholder="cidade"
                      />
                      <Button size="icon" variant="ghost" className="h-6 w-6 text-primary" onClick={handleSaveKey}><Check className="w-3 h-3" /></Button>
                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setEditingKey(null)}><X className="w-3 h-3" /></Button>
                    </div>
                  ) : (
                    <span className="flex items-center gap-1">
                      <KeyRound className="w-3 h-3 text-primary" />
                      <code className="text-primary">{`{{${b.variable_key || "?"}}}`}</code>
                      <Button size="icon" variant="ghost" className="h-5 w-5 ml-auto" onClick={() => setEditingKey({ blockId: b.id, value: b.variable_key || "" })}>
                        <Pencil className="w-3 h-3" />
                      </Button>
                    </span>
                  )}
                  <span>Substituído pelo áudio do valor gravado na biblioteca.</span>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-2 mt-3 items-center">
          <Button size="sm" variant="outline" onClick={() => onAddBlock(template.id, "fixed_audio")}>
            <Plus className="w-3.5 h-3.5 mr-1" /> Áudio fixo
          </Button>
          <Button size="sm" variant="outline" onClick={() => onAddBlock(template.id, "name_slot")}>
            <Plus className="w-3.5 h-3.5 mr-1" /> Slot do nome
          </Button>
          {addingVar ? (
            <div className="flex items-center gap-1 border border-border rounded-md p-1 bg-background/50">
              <span className="text-[11px] text-muted-foreground pl-1">{"{{"}</span>
              <Input
                autoFocus value={newVarKey}
                onChange={(e) => setNewVarKey(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleAddVariable(); if (e.key === "Escape") { setAddingVar(false); setNewVarKey(""); } }}
                placeholder="cidade"
                className="h-7 text-xs w-28"
              />
              <span className="text-[11px] text-muted-foreground">{"}}"}</span>
              <Button size="icon" variant="ghost" className="h-6 w-6 text-primary" onClick={handleAddVariable}><Check className="w-3 h-3" /></Button>
              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => { setAddingVar(false); setNewVarKey(""); }}><X className="w-3 h-3" /></Button>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setAddingVar(true)}>
              <Plus className="w-3.5 h-3.5 mr-1" /> <Variable className="w-3.5 h-3.5 mr-1" /> Slot variável (livre)
            </Button>
          )}
        </div>
      </div>

      {/* preview */}
      <div className="border-t border-border pt-3 space-y-2">
        <Label className="text-xs flex items-center gap-1"><Play className="w-3.5 h-3.5" /> Pré-visualizar emendado</Label>
        <div className="flex flex-wrap gap-2">
          {hasNameSlot && (
            <Input
              value={previewName}
              onChange={(e) => setPreviewName(e.target.value)}
              placeholder="Nome do cliente interessado (ex: Ana)"
              className="flex-1 min-w-[160px]"
            />
          )}
          {variableBlocks.map((b) => {
            const k = b.variable_key || "";
            return (
              <Input
                key={b.id}
                value={previewVars[k] || ""}
                onChange={(e) => setPreviewVars({ ...previewVars, [k]: e.target.value })}
                placeholder={`Valor de {{${k}}}`}
                className="flex-1 min-w-[140px]"
              />
            );
          })}
          <Button size="sm" onClick={handlePreview} disabled={rendering || blocks.length === 0}>
            {rendering ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Play className="w-3.5 h-3.5 mr-1" />}
            Tocar emendado
          </Button>
        </div>
        {previewUrl && <audio src={previewUrl} controls className="w-full h-9" />}

        {pendingRecord && (
          <div className="border border-warning/40 rounded p-2 bg-warning/5 space-y-2">
            <p className="text-xs text-warning">
              Grave <strong>"{pendingRecord.name}"</strong> {pendingRecord.key !== "nome" && <>para <code>{`{{${pendingRecord.key}}}`}</code></>} agora:
            </p>
            <VoiceClipRecorder
              consultantId={consultantId}
              slug={`voz-${pendingRecord.key}-${pendingRecord.name.toLowerCase().replace(/\s+/g,"-")}`}
              idleLabel={`Gravar "${pendingRecord.name}"`}
              onUploaded={async (url) => {
                await onUpsertNameClip(pendingRecord.name, url);
                setPendingRecord(null);
                toast.success(`"${pendingRecord.name}" gravado. Toque em "Tocar emendado" de novo.`);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
