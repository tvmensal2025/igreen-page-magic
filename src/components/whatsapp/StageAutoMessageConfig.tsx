import { useState, useRef, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  MessageSquare,
  Image as ImageIcon,
  Video,
  Mic,
  X,
  Check,
  Upload,
  Loader2,
  Plus,
  Trash2,
  Settings2,
  Sparkles,
  FileText,
  Mic2,
  ChevronDown,
} from "lucide-react";
import { uploadMedia, getAcceptString, formatFileSize } from "@/services/minioUpload";
import { useToast } from "@/hooks/use-toast";
import { REJECTION_REASONS } from "./DropConfirmDialog";
import { MediaLibraryPicker, type MediaKind } from "./MediaLibraryPicker";
import { TemplatePickerPopover, type PickedTemplate } from "./TemplatePickerPopover";

interface StageAutoMessageConfigProps {
  stageId: string;
  stageLabel: string;
  stageKey: string;
  consultantId: string;
  autoMessageText: string | null;
  autoMessageType: string;
  autoMessageMediaUrl: string | null;
  autoMessageImageUrl: string | null;
  onSave: (text: string | null, type: string, mediaUrl: string | null, imageUrl: string | null) => void;
}

interface AutoMessage {
  id?: string;
  position: number;
  message_type: string;
  message_text: string;
  media_url: string;
  image_url: string;
  delay_seconds: number;
  rejection_reason: string;
  deal_origin: string;
  voice_template_id?: string | null;
  voice_template_name?: string | null;
}

const DEAL_ORIGIN_OPTIONS = [
  { value: "all", label: "Todos" },
  { value: "aprovado", label: "Aprovados" },
  { value: "reprovado", label: "Reprovados" },
];

const MESSAGE_TYPES = [
  { key: "text", label: "Texto", icon: MessageSquare },
  { key: "image", label: "Imagem", icon: ImageIcon },
  { key: "video", label: "Vídeo", icon: Video },
  { key: "audio", label: "Áudio", icon: Mic },
];

function MessageItem({
  msg,
  index,
  total,
  onChange,
  onRemove,
  showRejectionReason,
  showDealOrigin,
  consultantId,
}: {
  msg: AutoMessage;
  index: number;
  total: number;
  onChange: (updated: AutoMessage) => void;
  onRemove: () => void;
  showRejectionReason: boolean;
  showDealOrigin: boolean;
  consultantId: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const TypeIcon = MESSAGE_TYPES.find((m) => m.key === msg.message_type)?.icon || MessageSquare;

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const result = await uploadMedia(file, undefined, { scope: "template", kind: file.type.startsWith("image/") ? "image" : "audio" });
      onChange({ ...msg, media_url: result.url, voice_template_id: null, voice_template_name: null });
      toast({ title: "Upload concluído", description: `${file.name} (${formatFileSize(file.size)})` });
    } catch {
      toast({ title: "Erro no upload", variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingImage(true);
    try {
      const result = await uploadMedia(file, undefined, { scope: "template", kind: "image" });
      onChange({ ...msg, image_url: result.url });
      toast({ title: "Imagem enviada" });
    } catch {
      toast({ title: "Erro no upload", variant: "destructive" });
    } finally {
      setUploadingImage(false);
      if (imgRef.current) imgRef.current.value = "";
    }
  };

  const isVoiceTemplate = !!msg.voice_template_id;

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm hover:shadow transition-shadow overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-muted/40 border-b border-border">
        <div className="h-8 w-8 rounded-lg bg-primary/15 flex items-center justify-center">
          <TypeIcon className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground">Mensagem {index + 1} <span className="text-muted-foreground font-normal">de {total}</span></p>
          <div className="flex items-center gap-1.5 mt-0.5">
            {isVoiceTemplate && (
              <Badge variant="outline" className="text-[9px] bg-primary/10 border-primary/30 text-primary">
                <Mic2 className="h-2.5 w-2.5 mr-0.5" /> Voz: {msg.voice_template_name}
              </Badge>
            )}
            {msg.rejection_reason && (
              <Badge variant="outline" className="text-[9px]">
                {REJECTION_REASONS.find((r) => r.value === msg.rejection_reason)?.label || msg.rejection_reason}
              </Badge>
            )}
            {msg.deal_origin && msg.deal_origin !== "all" && (
              <Badge variant="outline" className="text-[9px]">
                {DEAL_ORIGIN_OPTIONS.find((o) => o.value === msg.deal_origin)?.label}
              </Badge>
            )}
            {index > 0 && msg.delay_seconds > 0 && (
              <Badge variant="outline" className="text-[9px]">
                ⏱ {msg.delay_seconds}s após anterior
              </Badge>
            )}
          </div>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10" onClick={onRemove}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="p-4 space-y-4">
        {/* Type selector */}
        <div>
          <p className="text-[11px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">Tipo</p>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {MESSAGE_TYPES.map((mt) => {
              const Icon = mt.icon;
              const active = msg.message_type === mt.key;
              return (
                <Button
                  key={mt.key}
                  variant={active ? "default" : "outline"}
                  size="sm"
                  className={`h-9 text-xs gap-1.5 ${active ? "bg-primary text-primary-foreground" : ""}`}
                  onClick={() => onChange({ ...msg, message_type: mt.key, voice_template_id: null, voice_template_name: null })}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {mt.label}
                </Button>
              );
            })}
          </div>
        </div>

        {/* Content */}
        <div>
          <p className="text-[11px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">Conteúdo</p>

          {isVoiceTemplate ? (
            <div className="flex items-center gap-2 p-3 rounded-lg border border-primary/30 bg-primary/5">
              <Mic2 className="h-4 w-4 text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold">{msg.voice_template_name}</p>
                <p className="text-[10px] text-muted-foreground">Áudio será costurado com o nome do cliente interessado no envio</p>
              </div>
              <Button variant="ghost" size="sm" className="h-7 text-[10px]" onClick={() => onChange({ ...msg, voice_template_id: null, voice_template_name: null })}>
                Remover
              </Button>
            </div>
          ) : msg.message_type !== "text" ? (
            <div className="space-y-2">
              <input ref={fileRef} type="file" accept={getAcceptString(msg.message_type)} onChange={handleFileUpload} className="hidden" />
              <div className="flex gap-1.5">
                <Input
                  value={msg.media_url}
                  onChange={(e) => onChange({ ...msg, media_url: e.target.value })}
                  placeholder="URL da mídia"
                  className="h-9 text-xs flex-1"
                />
                <MediaLibraryPicker
                  kind={msg.message_type as MediaKind}
                  consultantId={consultantId}
                  onSelect={(url) => onChange({ ...msg, media_url: url })}
                  triggerLabel="Biblioteca"
                />
                <Button variant="outline" size="sm" className="h-9 text-xs gap-1" disabled={uploading} onClick={() => fileRef.current?.click()}>
                  {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                  {uploading ? "..." : "Upload"}
                </Button>
              </div>
              {msg.media_url && (msg.message_type === "image" || msg.message_type === "video") && (
                <div className="flex items-center gap-2 p-2 rounded-md bg-muted/40 border border-border/40">
                  {msg.message_type === "image" ? (
                    <img src={msg.media_url} alt="" className="h-14 w-14 rounded object-cover" />
                  ) : (
                    <video src={msg.media_url} className="h-14 w-14 rounded object-cover bg-black" muted preload="metadata" />
                  )}
                  <span className="text-xs text-muted-foreground flex-1 truncate">Mídia pronta para envio</span>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => onChange({ ...msg, media_url: "" })}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
              {msg.media_url && msg.message_type === "audio" && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 p-2 rounded-md bg-muted/40 border border-border/40">
                    <Mic className="h-4 w-4 text-primary shrink-0" />
                    <audio src={msg.media_url} controls className="h-8 flex-1" />
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => onChange({ ...msg, media_url: "" })}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  {msg.image_url ? (
                    <div className="flex items-center gap-2 p-2 rounded-md bg-muted/40 border border-border/40">
                      <img
                        src={msg.image_url}
                        alt="Imagem enviada antes do áudio"
                        className="h-16 w-16 rounded object-cover border border-border/40"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground">Imagem (antes do áudio)</p>
                        <p className="text-[10px] text-muted-foreground truncate">{msg.image_url}</p>
                      </div>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => onChange({ ...msg, image_url: "" })}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <p className="text-[10px] text-muted-foreground px-1">
                      Sem imagem anexada — use “opções avançadas” para adicionar (enviada antes do áudio).
                    </p>
                  )}
                </div>
              )}
            </div>
          ) : null}

          <Textarea
            value={msg.message_text}
            onChange={(e) => onChange({ ...msg, message_text: e.target.value })}
            placeholder={isVoiceTemplate ? "Legenda opcional para o áudio…" : "Texto da mensagem (use *negrito*, _itálico_, {{nome}}, {{telefone}})"}
            className="min-h-[80px] text-xs resize-none mt-2"
          />
        </div>

        {/* Advanced options */}
        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 text-[10px] gap-1 text-muted-foreground hover:text-foreground -mx-2">
              <Settings2 className="h-3 w-3" />
              {advancedOpen ? "Ocultar" : "Mostrar"} opções avançadas
              <ChevronDown className={`h-3 w-3 transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 pt-2">
            {/* Delay */}
            {index > 0 && (
              <div>
                <p className="text-[10px] text-muted-foreground mb-1">⏱ Delay após a mensagem anterior (segundos)</p>
                <Input
                  type="number"
                  min={0}
                  value={msg.delay_seconds}
                  onChange={(e) => onChange({ ...msg, delay_seconds: parseInt(e.target.value) || 0 })}
                  className="h-8 w-24 text-xs"
                />
              </div>
            )}

            {/* Optional image before message */}
            {msg.message_type !== "image" && !isVoiceTemplate && (
              <div>
                <p className="text-[10px] text-muted-foreground mb-1">📷 Imagem opcional (enviada antes da mensagem)</p>
                <input ref={imgRef} type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                <div className="flex gap-1.5">
                  <Input
                    value={msg.image_url}
                    onChange={(e) => onChange({ ...msg, image_url: e.target.value })}
                    placeholder="URL da imagem"
                    className="h-8 text-xs flex-1"
                  />
                  <MediaLibraryPicker kind="image" consultantId={consultantId} onSelect={(url) => onChange({ ...msg, image_url: url })} triggerLabel="Biblioteca" />
                  <Button variant="outline" size="sm" className="h-8 text-xs gap-1" disabled={uploadingImage} onClick={() => imgRef.current?.click()}>
                    {uploadingImage ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
                    Img
                  </Button>
                </div>
                {msg.image_url && (
                  <div className="flex items-center gap-1 mt-1">
                    <img src={msg.image_url} alt="" className="h-9 w-9 rounded object-cover border border-border/40" />
                    <Button variant="ghost" size="icon" className="h-5 w-5 text-destructive" onClick={() => onChange({ ...msg, image_url: "" })}>
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                )}
              </div>
            )}

            {showRejectionReason && (
              <div>
                <p className="text-[10px] text-muted-foreground mb-1">🏷 Motivo (só dispara para este motivo de reprovação)</p>
                <Select value={msg.rejection_reason || "all"} onValueChange={(v) => onChange({ ...msg, rejection_reason: v === "all" ? "" : v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-xs">Todos os motivos</SelectItem>
                    {REJECTION_REASONS.map((r) => (
                      <SelectItem key={r.value} value={r.value} className="text-xs">{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {showDealOrigin && (
              <div>
                <p className="text-[10px] text-muted-foreground mb-1">🔄 Origem (só dispara para clientes interessados desta origem)</p>
                <Select value={msg.deal_origin || "all"} onValueChange={(v) => onChange({ ...msg, deal_origin: v === "all" ? "" : v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DEAL_ORIGIN_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>
      </div>
    </div>
  );
}

export function StageAutoMessageConfig({
  stageId,
  stageLabel,
  stageKey,
  consultantId,
  autoMessageText,
  autoMessageType,
  autoMessageMediaUrl,
  autoMessageImageUrl,
  onSave,
}: StageAutoMessageConfigProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<AutoMessage[]>([]);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const fetchMessages = useCallback(async () => {
    const { data } = await supabase
      .from("stage_auto_messages")
      .select("*")
      .eq("stage_id", stageId)
      .eq("consultant_id", consultantId)
      .order("position", { ascending: true });

    if (data && data.length > 0) {
      // Load voice template names for any messages that have a voice_template_id
      const voiceIds = data.map((d: any) => d.voice_template_id).filter(Boolean);
      let voiceMap: Record<string, string> = {};
      if (voiceIds.length > 0) {
        const { data: vt } = await supabase
          .from("voice_templates")
          .select("id, name")
          .in("id", voiceIds);
        voiceMap = Object.fromEntries((vt || []).map((v: any) => [v.id, v.name]));
      }
      setMessages(
        data.map((d: any) => ({
          id: d.id,
          position: d.position,
          message_type: d.message_type || "text",
          message_text: d.message_text || "",
          media_url: d.media_url || "",
          image_url: d.image_url || "",
          delay_seconds: d.delay_seconds || 0,
          rejection_reason: d.rejection_reason || "",
          deal_origin: d.deal_origin || "",
          voice_template_id: d.voice_template_id || null,
          voice_template_name: d.voice_template_id ? voiceMap[d.voice_template_id] || null : null,
        }))
      );
    } else if (autoMessageText || autoMessageMediaUrl || autoMessageImageUrl) {
      setMessages([
        {
          position: 0,
          message_type: autoMessageType || "text",
          message_text: autoMessageText || "",
          media_url: autoMessageMediaUrl || "",
          image_url: autoMessageImageUrl || "",
          delay_seconds: 0,
          rejection_reason: "",
          deal_origin: "",
        },
      ]);
    } else {
      setMessages([]);
    }
  }, [stageId, consultantId, autoMessageText, autoMessageType, autoMessageMediaUrl, autoMessageImageUrl]);

  useEffect(() => {
    if (open) fetchMessages();
  }, [open, fetchMessages]);

  const addMessage = (preset?: PickedTemplate) => {
    setMessages((prev) => [
      ...prev,
      {
        position: prev.length,
        message_type: preset?.message_type || "text",
        message_text: preset?.message_text || "",
        media_url: preset?.media_url || "",
        image_url: preset?.image_url || "",
        delay_seconds: prev.length > 0 ? 5 : 0,
        rejection_reason: "",
        deal_origin: "",
        voice_template_id: preset?.voice_template_id || null,
        voice_template_name: preset?.voice_template_name || null,
      },
    ]);
  };

  const updateMessage = (index: number, updated: AutoMessage) => {
    setMessages((prev) => prev.map((m, i) => (i === index ? updated : m)));
  };

  const removeMessage = (index: number) => {
    setMessages((prev) => prev.filter((_, i) => i !== index).map((m, i) => ({ ...m, position: i })));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await supabase.from("stage_auto_messages").delete().eq("stage_id", stageId).eq("consultant_id", consultantId);

      if (messages.length > 0) {
        const inserts = messages.map((m, i) => ({
          stage_id: stageId,
          consultant_id: consultantId,
          position: i,
          message_type: m.message_type,
          message_text: m.message_text.trim() || null,
          media_url: m.media_url.trim() || null,
          image_url: m.image_url.trim() || null,
          delay_seconds: m.delay_seconds,
          rejection_reason: m.rejection_reason.trim() || null,
          deal_origin: m.deal_origin.trim() || null,
          voice_template_id: m.voice_template_id || null,
        }));
        const { error } = await supabase.from("stage_auto_messages").insert(inserts as any);
        if (error) throw error;
      }

      const first = messages[0];
      onSave(
        first?.message_text?.trim() || null,
        first?.message_type || "text",
        first?.media_url?.trim() || null,
        first?.image_url?.trim() || null
      );

      toast({ title: `${messages.length} mensagem(ns) salva(s)!` });
      setOpen(false);
    } catch (err: unknown) {
      toast({ title: "Erro ao salvar", description: err instanceof Error ? err.message : "Falha", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const hasAutoMessage = !!autoMessageText || messages.length > 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={`h-5 w-5 ${hasAutoMessage ? "text-primary" : "text-muted-foreground/50 hover:text-muted-foreground"}`}
          title={hasAutoMessage ? "Mensagens automáticas configuradas" : "Configurar mensagens automáticas"}
        >
          <MessageSquare className="h-3 w-3" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] p-0 gap-0 flex flex-col">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1">
              <DialogTitle className="text-base flex items-center gap-2">
                Mensagens Automáticas
                <Badge variant="secondary" className="text-[10px]">{stageLabel}</Badge>
              </DialogTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Configure mensagens enviadas em sequência quando um cliente interessado entrar nesta coluna.
              </p>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {(stageKey === "pv_retentativa" || stageKey === "retentativa") && (
            <div className="rounded-lg border border-orange-500/30 bg-orange-500/5 px-3 py-2 text-xs text-orange-700 dark:text-orange-300">
              <p className="font-semibold mb-0.5">Escolha automática no envio</p>
              <p className="text-[11px] opacity-90">
                WhatsApp com botões: botão <span className="font-medium">Quero tentar de novo</span>.
                {" "}WhatsApp sem botões: texto <span className="font-medium">*1.* Quero tentar de novo</span> — cliente digita 1.
              </p>
            </div>
          )}
          {messages.length === 0 ? (
            <div className="text-center py-10 px-4 rounded-xl border-2 border-dashed border-border bg-muted/20">
              <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
                <MessageSquare className="h-6 w-6 text-primary" />
              </div>
              <p className="text-sm font-semibold mb-1">Nenhuma mensagem configurada</p>
              <p className="text-xs text-muted-foreground mb-4 max-w-sm mx-auto">
                Adicione uma mensagem em branco ou escolha de um template salvo.
              </p>
              <div className="flex gap-2 justify-center flex-wrap">
                <Button size="sm" className="gap-1.5" onClick={() => addMessage()}>
                  <Plus className="h-4 w-4" /> Criar em branco
                </Button>
                <TemplatePickerPopover
                  consultantId={consultantId}
                  onPick={(tpl) => addMessage(tpl)}
                  trigger={
                    <Button variant="outline" size="sm" className="gap-1.5">
                      <FileText className="h-4 w-4" /> Usar template salvo
                    </Button>
                  }
                />
              </div>
            </div>
          ) : (
            messages.map((msg, i) => (
              <MessageItem
                key={i}
                msg={msg}
                index={i}
                total={messages.length}
                onChange={(updated) => updateMessage(i, updated)}
                onRemove={() => removeMessage(i)}
                showRejectionReason={stageKey === "reprovado"}
                showDealOrigin={["30_dias", "60_dias", "90_dias", "120_dias"].includes(stageKey)}
                consultantId={consultantId}
              />
            ))
          )}

          {messages.length > 0 && (
            <div className="grid grid-cols-2 gap-2 pt-1">
              <Button variant="outline" size="sm" className="h-10 gap-1.5 border-dashed" onClick={() => addMessage()}>
                <Plus className="h-4 w-4" /> Adicionar em branco
              </Button>
              <TemplatePickerPopover
                consultantId={consultantId}
                onPick={(tpl) => addMessage(tpl)}
                trigger={
                  <Button variant="outline" size="sm" className="h-10 gap-1.5 border-dashed">
                    <FileText className="h-4 w-4" /> Usar template salvo
                  </Button>
                }
              />
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-border bg-card/80 backdrop-blur flex items-center justify-between gap-2">
          <p className="text-[10px] text-muted-foreground">
            {messages.length} {messages.length === 1 ? "mensagem" : "mensagens"} configurada{messages.length === 1 ? "" : "s"}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button size="sm" className="gap-1.5" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Salvar mensagens
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
