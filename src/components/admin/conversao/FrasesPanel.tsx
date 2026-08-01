import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import {
  Plus, Trash2, Loader2, MessageSquareText, ImagePlus, Film, FileText, X,
  ArrowUp, ArrowDown, Type, Sparkles,
} from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { STEP_LABELS, stepLabel as resolveStepLabel, loadFlowTitles } from "./stepLabels";

/**
 * Painel de FRASES de reaquecimento — visual profissional.
 * Cada etapa do funil tem uma SEQUÊNCIA de mensagens (na ordem), e cada
 * mensagem pode ser só texto OU texto + imagem/vídeo.
 */

interface Template {
  id: string;
  conversation_step: string;
  message_text: string;
  media_url: string | null;
  media_kind: "image" | "video" | "document" | null;
  send_order: number;
  is_active: boolean;
  auto_reactivate: boolean;
  created_at: string;
}

const STEP_LABELS_OPTIONS = STEP_LABELS;

interface Props {
  consultantId: string;
  availableSteps: string[];
}

export function FrasesPanel({ consultantId, availableSteps }: Props) {
  const confirm = useConfirm();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeStep, setActiveStep] = useState<string | null>(null);
  const [flowTitles, setFlowTitles] = useState<Map<string, string>>(new Map());

  // nome amigável da etapa, resolvendo UUID via títulos do construtor
  const stepLabel = (s: string) => resolveStepLabel(s, flowTitles);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [consultantId]);

  async function load() {
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("reactivation_templates")
      .select("*")
      .eq("consultant_id", consultantId)
      .order("conversation_step")
      .order("send_order");
    if (error) toast.error("Erro ao carregar frases: " + error.message);
    else {
      const rows = (data as Template[]) || [];
      setTemplates(rows);
      // seleciona a primeira etapa que tiver frases, senão null
      if (activeStep === null && rows.length) setActiveStep(rows[0].conversation_step);
      // resolve nomes de etapas que são nós do construtor (UUID/flow:UUID)
      const allSteps = Array.from(new Set([...rows.map((r) => r.conversation_step), ...availableSteps]));
      loadFlowTitles(allSteps).then(setFlowTitles);
    }
    setLoading(false);
  }

  // Agrupa por etapa
  const byStep = useMemo(() => {
    const m = new Map<string, Template[]>();
    for (const t of templates) {
      if (!m.has(t.conversation_step)) m.set(t.conversation_step, []);
      m.get(t.conversation_step)!.push(t);
    }
    return m;
  }, [templates]);

  const stepsWithFrases = Array.from(byStep.keys());
  const stepOptions: ComboboxOption[] = Array.from(new Set([...availableSteps, ...Object.keys(STEP_LABELS_OPTIONS)]))
    .map((s) => {
      const isCode = /^(flow:)?[0-9a-f]{8}-/i.test(s); // UUID/flow:UUID → não mostra código
      return { value: s, label: stepLabel(s), hint: isCode ? undefined : s };
    });

  async function addStep(step: string) {
    // cria uma primeira frase vazia na etapa
    const { error } = await (supabase as any).from("reactivation_templates").insert({
      consultant_id: consultantId, conversation_step: step, message_text: "", send_order: 0, is_active: true,
    });
    if (error) { toast.error("Erro: " + error.message); return; }
    setActiveStep(step);
    load();
  }

  if (loading) {
    return <div className="grid place-items-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  const currentList = activeStep ? (byStep.get(activeStep) ?? []) : [];

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      {/* Coluna esquerda: etapas */}
      <div className="space-y-2">
        <div className="rounded-lg border border-info/30 bg-info/5 p-3 text-[11px] text-muted-foreground">
          Cada etapa tem uma <strong className="text-foreground">sequência</strong> de mensagens. O sistema envia
          na ordem. Cada uma pode ter texto, imagem ou vídeo.
        </div>

        <div className="space-y-1">
          {stepsWithFrases.length === 0 && (
            <p className="px-1 py-3 text-center text-xs text-muted-foreground">Nenhuma etapa configurada ainda.</p>
          )}
          {stepsWithFrases.map((s) => {
            const list = byStep.get(s)!;
            const active = activeStep === s;
            const hasAuto = list.some((t) => t.auto_reactivate);
            return (
              <button
                key={s}
                onClick={() => setActiveStep(s)}
                className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-xs transition ${active ? "border-primary/40 bg-primary/10" : "border-border/40 bg-card hover:border-border"}`}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-foreground">{stepLabel(s)}</span>
                  <span className="text-[10px] text-muted-foreground">{list.length} mensagem(ns)</span>
                </span>
                <span className="flex items-center gap-1">
                  {hasAuto && <span className="h-1.5 w-1.5 rounded-full bg-primary" title="Tem envio automático" />}
                </span>
              </button>
            );
          })}
        </div>

        {/* Adicionar etapa */}
        <AddStepInline stepOptions={stepOptions} existing={stepsWithFrases} onAdd={addStep} />
      </div>

      {/* Coluna direita: sequência da etapa */}
      <div className="space-y-3">
        {!activeStep ? (
          <Card className="grid place-items-center p-16 text-center">
            <MessageSquareText className="mb-2 h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Escolha ou crie uma etapa à esquerda para montar as mensagens.</p>
          </Card>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-foreground">{stepLabel(activeStep)}</h3>
                <p className="text-[11px] text-muted-foreground">As mensagens são enviadas de cima para baixo.</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => addMessage(activeStep, currentList.length)}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Nova mensagem
              </Button>
            </div>

            {currentList.length === 0 ? (
              <Card className="p-8 text-center text-sm text-muted-foreground">
                Etapa sem mensagens. Clique em “Nova mensagem”.
              </Card>
            ) : (
              currentList.map((t, idx) => (
                <FraseCard
                  key={t.id}
                  template={t}
                  index={idx}
                  total={currentList.length}
                  consultantId={consultantId}
                  onChange={load}
                  onMove={(dir) => moveMessage(currentList, idx, dir)}
                  onRemove={() => removeMessage(t.id)}
                />
              ))
            )}
          </>
        )}
      </div>
    </div>
  );

  // ─── ações ──────────────────────────────────────────────────────────────
  async function addMessage(step: string, order: number) {
    const { error } = await (supabase as any).from("reactivation_templates").insert({
      consultant_id: consultantId, conversation_step: step, message_text: "", send_order: order, is_active: true,
    });
    if (error) toast.error("Erro: " + error.message);
    else load();
  }

  async function removeMessage(id: string) {
    const ok = await confirm({ title: "Remover esta mensagem?", confirmText: "Remover", tone: "danger" });
    if (!ok) return;
    const { error } = await (supabase as any).from("reactivation_templates").delete().eq("id", id);
    if (error) toast.error("Erro: " + error.message);
    else { toast.success("Mensagem removida"); load(); }
  }

  async function moveMessage(list: Template[], idx: number, dir: -1 | 1) {
    const target = idx + dir;
    if (target < 0 || target >= list.length) return;
    const a = list[idx], b = list[target];
    // troca send_order
    await Promise.all([
      (supabase as any).from("reactivation_templates").update({ send_order: b.send_order }).eq("id", a.id),
      (supabase as any).from("reactivation_templates").update({ send_order: a.send_order }).eq("id", b.id),
    ]);
    load();
  }
}

// ════════════════════════════════════════════════════════════════════════════

function AddStepInline({ stepOptions, existing, onAdd }: {
  stepOptions: ComboboxOption[]; existing: string[]; onAdd: (s: string) => void;
}) {
  const [step, setStep] = useState<string | null>(null);
  const options = stepOptions.filter((o) => !existing.includes(o.value));
  return (
    <Card className="space-y-2 p-3">
      <Label className="text-[11px] text-muted-foreground">Adicionar etapa</Label>
      <Combobox
        options={options}
        value={step}
        onChange={setStep}
        placeholder="Escolher etapa"
        searchPlaceholder="Buscar etapa…"
      />
      <Button size="sm" className="w-full" disabled={!step} onClick={() => { if (step) { onAdd(step); setStep(null); } }}>
        <Plus className="mr-1 h-3.5 w-3.5" /> Criar
      </Button>
    </Card>
  );
}

function FraseCard({ template, index, total, consultantId, onChange, onMove, onRemove }: {
  template: Template;
  index: number;
  total: number;
  consultantId: string;
  onChange: () => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const [text, setText] = useState(template.message_text);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function patch(p: Partial<Template>) {
    const { error } = await (supabase as any).from("reactivation_templates").update(p).eq("id", template.id);
    if (error) toast.error("Erro: " + error.message);
    else onChange();
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const isImage = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/");
    if (!isImage && !isVideo) { toast.error("Envie uma imagem ou um vídeo"); return; }
    if (file.size > 16 * 1024 * 1024) { toast.error("Arquivo muito grande (máx 16MB)"); return; }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() || (isImage ? "jpg" : "mp4");
      const path = `${consultantId}/reaquecimento/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("ai-agent-media").upload(path, file, {
        upsert: false, contentType: file.type,
      });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("ai-agent-media").getPublicUrl(path);
      await patch({ media_url: pub.publicUrl, media_kind: isImage ? "image" : "video" });
      toast.success("Mídia anexada");
    } catch (err: any) {
      toast.error("Falha no upload: " + err.message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const MediaIcon = template.media_kind === "video" ? Film : template.media_kind === "document" ? FileText : ImagePlus;

  return (
    <Card className="overflow-hidden">
      {/* header da mensagem */}
      <div className="flex items-center justify-between border-b border-border/40 bg-muted/30 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">
            {index + 1}
          </span>
          <span className="text-xs font-medium text-foreground">Mensagem {index + 1} de {total}</span>
          {template.media_kind && (
            <Badge variant="secondary" className="gap-1 text-[10px]">
              <MediaIcon className="h-3 w-3" /> {template.media_kind === "video" ? "vídeo" : "imagem"}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          <Button size="icon" variant="ghost" className="h-7 w-7" disabled={index === 0} onClick={() => onMove(-1)}>
            <ArrowUp className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" disabled={index === total - 1} onClick={() => onMove(1)}>
            <ArrowDown className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={onRemove}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="grid gap-3 p-3 md:grid-cols-[1fr_180px]">
        {/* texto */}
        <div className="space-y-1.5">
          <Label className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Type className="h-3 w-3" /> Texto {template.media_kind && "(legenda da mídia)"}
          </Label>
          <Textarea
            rows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => { if (text !== template.message_text) patch({ message_text: text }); }}
            placeholder="Oi {{nome}}! Vi que você parou na simulação. Posso te mostrar quanto dá pra economizar?"
          />
          <div className="flex flex-wrap gap-1">
            {["{{nome}}", "{{valor_conta}}", "{{representante}}"].map((v) => (
              <button
                key={v}
                onClick={() => setText((t) => t + " " + v)}
                className="rounded border border-border/40 bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:border-border"
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        {/* mídia */}
        <div className="space-y-1.5">
          <Label className="text-[11px] text-muted-foreground">Imagem / vídeo</Label>
          {template.media_url ? (
            <div className="group relative overflow-hidden rounded-lg border border-border/40">
              {template.media_kind === "video" ? (
                <video src={template.media_url} className="aspect-video w-full object-cover" muted />
              ) : (
                <img src={template.media_url} alt="" className="aspect-video w-full object-cover" />
              )}
              <button
                onClick={() => patch({ media_url: null, media_kind: null })}
                className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white opacity-0 transition group-hover:opacity-100"
                title="Remover mídia"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="flex aspect-video w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-border/50 text-muted-foreground transition hover:border-primary/40 hover:text-primary"
            >
              {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
              <span className="text-[10px]">{uploading ? "Enviando…" : "Anexar imagem/vídeo"}</span>
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/*,video/*" className="hidden" onChange={onPickFile} />
        </div>
      </div>

      {/* rodapé: switches */}
      <div className="flex flex-wrap items-center gap-4 border-t border-border/40 px-3 py-2 text-xs">
        <label className="flex items-center gap-2">
          <Switch checked={template.is_active} onCheckedChange={(v) => patch({ is_active: v })} />
          Ativa
        </label>
        <label className="flex items-center gap-2">
          <Switch checked={template.auto_reactivate} onCheckedChange={(v) => patch({ auto_reactivate: v })} />
          <Sparkles className="h-3 w-3 text-primary" /> Enviar automaticamente
        </label>
      </div>
    </Card>
  );
}
