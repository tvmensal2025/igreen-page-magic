import { useState } from "react";
import { Upload, Trash2, Sparkles, Film } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { supabase } from "@/integrations/supabase/client";
import { AudioRecorderInline } from "./AudioRecorderInline";

export type SlotRow = {
  slot_key: string;
  label: string;
  description: string | null;
  trigger_hint: string | null;
  fallback_text: string | null;
  position: number;
  is_testing?: boolean;
  video_url?: string | null;
  video_label?: string | null;
};

export type SlotMedia = {
  id: string;
  url: string | null;
  is_public: boolean;
  is_draft: boolean;
  active: boolean;
  sent_count: number;
  reply_count: number;
};

type Props = {
  userId: string;
  slot: SlotRow;
  defaultMedia: SlotMedia | null;
  personalMedia: SlotMedia | null;
  onChange: () => void;
};

export function SlotCard({ userId, slot, defaultMedia, personalMedia, onChange }: Props) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const hasPersonal = !!(personalMedia && personalMedia.url && !personalMedia.is_draft);
  // Princípio único: usa o áudio personalizado se existir, senão o padrão.
  const activeMedia = hasPersonal ? personalMedia : defaultMedia;
  const variantLabel = hasPersonal ? "Meu áudio" : "Padrão (Camila)";

  async function uploadAudioBlob(blob: Blob) {
    const path = `${userId}/slots/${slot.slot_key}.ogg`;
    const { error: upErr } = await supabase.storage
      .from("ai-agent-media")
      .upload(path, blob, { upsert: true, contentType: "audio/ogg" });
    if (upErr) throw upErr;
    const { data } = supabase.storage.from("ai-agent-media").getPublicUrl(path);
    // cache-bust: força navegador/CDN a buscar a nova versão depois de regravar
    const url = `${data.publicUrl}?v=${Date.now()}`;
    return { url, path };
  }

  async function handleRecorded(blob: Blob, durationSec: number) {
    try {
      const { url, path } = await uploadAudioBlob(blob);
      const payload = {
        consultant_id: userId,
        kind: "audio",
        slot_key: slot.slot_key,
        label: slot.label,
        url,
        storage_path: path,
        duration_sec: durationSec,
        active: true,
        is_draft: false,
        is_public: false,
      };
      if (personalMedia) {
        const { error } = await supabase
          .from("ai_media_library")
          .update(payload)
          .eq("id", personalMedia.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("ai_media_library").insert(payload);
        if (error) throw error;
      }
      toast({ title: "🎙️ Áudio salvo e ativado!" });
      onChange();
    } catch (e: any) {
      toast({ title: "Erro ao salvar", description: e.message, variant: "destructive" });
    }
  }

  async function handleFileUpload(file: File) {
    if (!file.type.startsWith("audio/")) {
      toast({ title: "Envie um arquivo de áudio", variant: "destructive" });
      return;
    }
    await handleRecorded(file, 0);
  }

  async function removePersonal() {
    if (!personalMedia) return;
    const ok = await confirm({ title: "Remover seu áudio e voltar ao padrão da Camila?", confirmText: "Remover", tone: "danger" });
    if (!ok) return;
    const { error } = await supabase.from("ai_media_library").delete().eq("id", personalMedia.id);
    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Voltou para o áudio padrão" });
    onChange();
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-heading font-semibold text-foreground flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            {slot.label}
          </h3>
          {slot.description && (
            <p className="text-xs text-muted-foreground mt-0.5">{slot.description}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <Badge variant={hasPersonal ? "default" : "secondary"}>{variantLabel}</Badge>
          {slot.is_testing && (
            <Badge variant="outline" className="border-amber-500/60 text-amber-500 text-[10px]">
              🧪 Em teste — não envia
            </Badge>
          )}
        </div>
      </div>

      {activeMedia?.url ? (
        <audio src={activeMedia.url} controls className="w-full h-9" />
      ) : (
        <div className="text-xs text-muted-foreground italic p-2 rounded-md bg-muted/30">
          Sem áudio — a IA enviará: <span className="text-foreground">"{slot.fallback_text}"</span>
        </div>
      )}

      {slot.video_url && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-2 space-y-1">
          <div className="flex items-center gap-2 text-xs text-primary font-medium">
            <Film className="w-3.5 h-3.5" />
            Vídeo enviado logo após este áudio
            {slot.video_label && <span className="text-muted-foreground font-normal">— {slot.video_label}</span>}
          </div>
          <video src={slot.video_url} controls className="w-full max-h-48 rounded-md" />
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
        <AudioRecorderInline onRecorded={handleRecorded} />
        <label className="inline-flex items-center gap-2 text-sm px-3 py-1.5 rounded-md border border-border bg-background hover:bg-muted cursor-pointer">
          <Upload className="w-4 h-4" />
          Enviar arquivo
          <input
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0])}
          />
        </label>
        {personalMedia && (
          <Button size="sm" variant="ghost" onClick={removePersonal} className="text-destructive">
            <Trash2 className="w-4 h-4 mr-1" /> Voltar ao padrão
          </Button>
        )}
      </div>

      {slot.trigger_hint && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer hover:text-foreground">Quando a IA usa este áudio?</summary>
          <p className="mt-1 pl-4 italic">{slot.trigger_hint}</p>
        </details>
      )}
    </div>
  );
}
