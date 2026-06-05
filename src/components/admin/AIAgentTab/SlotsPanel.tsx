import { useEffect, useState } from "react";
import { Loader2, Settings, X, Save, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { usePrompt } from "@/components/ui/prompt-dialog";
import { Button } from "@/components/ui/button";
import { SlotCard, type SlotRow, type SlotMedia } from "./SlotCard";
import { AudioRecorderInline } from "./AudioRecorderInline";

type Props = { userId: string };

type MediaIndexEntry = { default: SlotMedia | null; personal: SlotMedia | null };
type VideoOption = { id: string; label: string; url: string | null; is_public: boolean; consultant_id: string | null };

export function SlotsPanel({ userId }: Props) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [loading, setLoading] = useState(true);
  const [slots, setSlots] = useState<SlotRow[]>([]);
  const [mediaIndex, setMediaIndex] = useState<Record<string, MediaIndexEntry>>({});
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);

  async function load() {
    setLoading(true);
    const [{ data: slotData }, { data: mediaData }, { data: roleData }] = await Promise.all([
      supabase.from("ai_agent_slots").select("*").eq("active", true).order("position"),
      supabase
        .from("ai_media_library")
        .select("id, slot_key, url, is_public, is_draft, active, sent_count, reply_count, consultant_id")
        .not("slot_key", "is", null),
      supabase.from("user_roles").select("role").eq("user_id", userId),
    ]);
    const idx: Record<string, MediaIndexEntry> = {};
    (slotData || []).forEach((s: any) => (idx[s.slot_key] = { default: null, personal: null }));
    (mediaData || []).forEach((m: any) => {
      if (!m.slot_key || !idx[m.slot_key]) return;
      const entry: SlotMedia = {
        id: m.id, url: m.url, is_public: m.is_public,
        is_draft: m.is_draft, active: m.active,
        sent_count: m.sent_count || 0, reply_count: m.reply_count || 0,
      };
      if (m.is_public) idx[m.slot_key].default = entry;
      else if (m.consultant_id === userId) idx[m.slot_key].personal = entry;
    });
    setSlots((slotData || []) as SlotRow[]);
    setMediaIndex(idx);
    setIsSuperAdmin((roleData || []).some((r: any) => r.role === "super_admin"));
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  const personalCount = Object.values(mediaIndex).filter((e) => e.personal && !e.personal.is_draft).length;
  const total = slots.length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 p-3 rounded-lg bg-muted/30 border border-border">
        <div className="text-sm">
          <span className="text-foreground font-medium">{total - personalCount} de {total}</span>
          <span className="text-muted-foreground"> no padrão · </span>
          <span className="text-primary font-medium">{personalCount} personalizado{personalCount !== 1 ? "s" : ""}</span>
        </div>
        {isSuperAdmin && (
          <Button size="sm" variant="outline" onClick={() => setAdminOpen(true)}>
            <Settings className="w-4 h-4 mr-1" /> Editar slots padrão
          </Button>
        )}
      </div>

      <div className="space-y-3">
        {slots.map((s) => (
          <SlotCard
            key={s.slot_key}
            userId={userId}
            slot={s}
            defaultMedia={mediaIndex[s.slot_key]?.default || null}
            personalMedia={mediaIndex[s.slot_key]?.personal || null}
            onChange={load}
          />
        ))}
      </div>

      {adminOpen && isSuperAdmin && (
        <SuperAdminSlotsModal onClose={() => { setAdminOpen(false); load(); }} />
      )}
    </div>
  );
}

// =====================  Super Admin Modal  =====================

function SuperAdminSlotsModal({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const [slots, setSlots] = useState<any[]>([]);
  const [defaultMedia, setDefaultMedia] = useState<Record<string, { url: string | null; id: string | null }>>({});
  const [availableVideos, setAvailableVideos] = useState<VideoOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const [{ data: s }, { data: m }, { data: videos }] = await Promise.all([
      supabase.from("ai_agent_slots").select("*").order("position"),
      supabase.from("ai_media_library").select("id, slot_key, url").eq("is_public", true).not("slot_key", "is", null),
      supabase
        .from("ai_media_library")
        .select("id, label, url, is_public, consultant_id")
        .eq("kind", "video")
        .eq("active", true)
        .not("url", "is", null)
        .order("priority", { ascending: false })
        .order("created_at", { ascending: false }),
    ]);
    const map: Record<string, { url: string | null; id: string | null }> = {};
    (m || []).forEach((x: any) => (map[x.slot_key] = { url: x.url, id: x.id }));
    setSlots(s || []);
    setDefaultMedia(map);
    setAvailableVideos(((videos || []) as VideoOption[]).filter((video) => !!video.url));
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function saveSlot(slot: any) {
    setSaving(slot.slot_key);
    const { error } = await supabase
      .from("ai_agent_slots")
      .update({
        label: slot.label,
        description: slot.description,
        trigger_hint: slot.trigger_hint,
        fallback_text: slot.fallback_text,
        min_interval_minutes: slot.min_interval_minutes,
        position: slot.position,
        active: slot.active,
        video_url: slot.video_url || null,
        video_storage_path: slot.video_storage_path || null,
        video_label: slot.video_label || null,
        version: (slot.version || 1) + 1,
      })
      .eq("slot_key", slot.slot_key);
    setSaving(null);
    if (error) toast({ title: "Erro", description: error.message, variant: "destructive" });
    else toast({ title: "✓ Slot atualizado" });
  }

  async function uploadSlotVideo(slotKey: string, file: File) {
    if (!file.type.startsWith("video/")) {
      toast({ title: "Envie um arquivo de vídeo", variant: "destructive" });
      return;
    }
    const ext = file.name.split(".").pop() || "mp4";
    const path = `public/slots/${slotKey}-video.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("ai-agent-media")
      .upload(path, file, { upsert: true, contentType: file.type });
    if (upErr) {
      toast({ title: "Erro upload vídeo", description: upErr.message, variant: "destructive" });
      return;
    }
    const { data } = supabase.storage.from("ai-agent-media").getPublicUrl(path);
    setSlots((p) => p.map((x) => x.slot_key === slotKey
      ? { ...x, video_url: data.publicUrl, video_storage_path: path }
      : x));
    toast({ title: "Vídeo carregado — clique Salvar para confirmar" });
  }

  async function removeSlotVideo(slotKey: string) {
    setSlots((p) => p.map((x) => x.slot_key === slotKey
      ? { ...x, video_url: null, video_storage_path: null, video_label: null }
      : x));
    toast({ title: "Vídeo removido — clique Salvar para confirmar" });
  }

  function selectExistingVideo(slotKey: string, videoId: string) {
    const video = availableVideos.find((item) => item.id === videoId);
    if (!video?.url) return;
    setSlots((p) => p.map((x) => x.slot_key === slotKey
      ? { ...x, video_url: video.url, video_storage_path: null, video_label: video.label }
      : x));
    toast({ title: "Vídeo selecionado — clique Salvar para confirmar" });
  }

  async function addNewSlot() {
    const rawKey = await prompt({
      title: "Nova pergunta",
      description: "Identificador (sem espaços, ex: garantia_contrato):",
      placeholder: "garantia_contrato",
      confirmText: "Criar",
    });
    if (!rawKey) return;
    const slot_key = rawKey
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9_]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "");
    if (!slot_key) {
      toast({ title: "Identificador inválido", variant: "destructive" });
      return;
    }
    if (slots.some((x) => x.slot_key === slot_key)) {
      toast({ title: "Já existe um slot com esse identificador", variant: "destructive" });
      return;
    }
    const labelInput = await prompt({
      title: "Nome da pergunta",
      description: "Ex: Garantia do contrato",
      defaultValue: slot_key,
      confirmText: "Salvar",
    });
    const label = labelInput || slot_key;
    const nextPosition = (slots.reduce((m, s) => Math.max(m, s.position || 0), 0) || 0) + 1;
    const { error } = await supabase.from("ai_agent_slots").insert({
      slot_key,
      label,
      description: "",
      trigger_hint: "",
      fallback_text: "",
      min_interval_minutes: 60,
      position: nextPosition,
      active: true,
      version: 1,
    });
    if (error) {
      toast({ title: "Erro ao criar", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "✓ Nova pergunta criada — grave o áudio/vídeo abaixo" });
    load();
  }

  async function deleteSlot(slotKey: string) {
    const ok = await confirm({
      title: `Excluir a pergunta "${slotKey}"?`,
      description: "Essa ação não pode ser desfeita.",
      confirmText: "Excluir",
      tone: "danger",
    });
    if (!ok) return;
    const { error } = await supabase.from("ai_agent_slots").delete().eq("slot_key", slotKey);
    if (error) {
      toast({ title: "Erro ao excluir", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Pergunta excluída" });
    load();
  }

  async function uploadDefault(slotKey: string, blob: Blob, durationSec: number) {
    const path = `public/slots/${slotKey}.ogg`;
    const { error: upErr } = await supabase.storage
      .from("ai-agent-media")
      .upload(path, blob, { upsert: true, contentType: "audio/ogg" });
    if (upErr) {
      toast({ title: "Erro upload", description: upErr.message, variant: "destructive" });
      return;
    }
    const { data } = supabase.storage.from("ai-agent-media").getPublicUrl(path);
    const bustedUrl = `${data.publicUrl}?v=${Date.now()}`;
    const existing = defaultMedia[slotKey];
    const slot = slots.find((s) => s.slot_key === slotKey);
    if (existing?.id) {
      await supabase.from("ai_media_library").update({
        url: bustedUrl, storage_path: path, duration_sec: durationSec, active: true,
      }).eq("id", existing.id);
    } else {
      await supabase.from("ai_media_library").insert({
        consultant_id: null, kind: "audio", slot_key: slotKey,
        label: slot?.label || slotKey, url: bustedUrl, storage_path: path,
        duration_sec: durationSec, active: true, is_public: true, is_draft: false,
      });
    }
    toast({ title: "Áudio padrão salvo" });
    load();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="font-heading font-bold text-lg text-foreground flex items-center gap-2">
            <Settings className="w-5 h-5 text-primary" /> Slots padrão (Super Admin)
          </h2>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={addNewSlot}>
              <Plus className="w-4 h-4 mr-1" /> Nova pergunta
            </Button>
            <Button size="icon" variant="ghost" onClick={onClose}><X className="w-4 h-4" /></Button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          ) : (
            slots.map((s) => (
              <div key={s.slot_key} className="p-3 rounded-lg border border-border space-y-2">
                <div className="flex items-center gap-2">
                  <code className="text-xs px-2 py-0.5 bg-muted rounded">{s.slot_key}</code>
                  <input
                    type="text" value={s.label}
                    onChange={(e) => setSlots((p) => p.map((x) => x.slot_key === s.slot_key ? { ...x, label: e.target.value } : x))}
                    className="flex-1 px-2 py-1 text-sm rounded border border-border bg-background"
                  />
                  <label className="flex items-center gap-1 text-xs">
                    <input type="checkbox" checked={s.active}
                      onChange={(e) => setSlots((p) => p.map((x) => x.slot_key === s.slot_key ? { ...x, active: e.target.checked } : x))} />
                    Ativo
                  </label>
                </div>
                <textarea placeholder="Descrição (mostrada ao consultor)"
                  value={s.description || ""} rows={1}
                  onChange={(e) => setSlots((p) => p.map((x) => x.slot_key === s.slot_key ? { ...x, description: e.target.value } : x))}
                  className="w-full px-2 py-1 text-sm rounded border border-border bg-background" />
                <textarea placeholder="Trigger hint (vai pro prompt da IA)"
                  value={s.trigger_hint || ""} rows={2}
                  onChange={(e) => setSlots((p) => p.map((x) => x.slot_key === s.slot_key ? { ...x, trigger_hint: e.target.value } : x))}
                  className="w-full px-2 py-1 text-sm rounded border border-border bg-background" />
                <textarea placeholder="Fallback text (enviado se não houver áudio)"
                  value={s.fallback_text || ""} rows={2}
                  onChange={(e) => setSlots((p) => p.map((x) => x.slot_key === s.slot_key ? { ...x, fallback_text: e.target.value } : x))}
                  className="w-full px-2 py-1 text-sm rounded border border-border bg-background" />
                <div className="flex items-center gap-2 text-xs">
                  <label>Cooldown (min):</label>
                  <input type="number" min={0} value={s.min_interval_minutes}
                    onChange={(e) => setSlots((p) => p.map((x) => x.slot_key === s.slot_key ? { ...x, min_interval_minutes: parseInt(e.target.value) || 0 } : x))}
                    className="w-20 px-2 py-1 rounded border border-border bg-background" />
                  <label className="ml-2">Posição:</label>
                  <input type="number" min={0} value={s.position}
                    onChange={(e) => setSlots((p) => p.map((x) => x.slot_key === s.slot_key ? { ...x, position: parseInt(e.target.value) || 0 } : x))}
                    className="w-20 px-2 py-1 rounded border border-border bg-background" />
                  <span className="text-muted-foreground ml-2">v{s.version}</span>
                </div>
                {defaultMedia[s.slot_key]?.url && (
                  <audio src={defaultMedia[s.slot_key]!.url!} controls className="w-full h-8" />
                )}
                <div className="rounded-md border border-primary/30 bg-primary/5 p-2 space-y-1">
                  <div className="text-xs font-medium text-primary">🎬 Vídeo enviado logo após o áudio (opcional)</div>
                  {s.video_url && (
                    <>
                      <video src={s.video_url} controls className="w-full max-h-40 rounded" />
                      <input type="text" placeholder="Legenda do vídeo (opcional)"
                        value={s.video_label || ""}
                        onChange={(e) => setSlots((p) => p.map((x) => x.slot_key === s.slot_key ? { ...x, video_label: e.target.value } : x))}
                        className="w-full px-2 py-1 text-xs rounded border border-border bg-background" />
                    </>
                  )}
                  <div className="flex flex-wrap gap-2 items-center">
                    <select
                      className="text-xs px-2 py-1 rounded border border-border bg-background min-w-[220px]"
                      value=""
                      onChange={(e) => {
                        if (!e.target.value) return;
                        selectExistingVideo(s.slot_key, e.target.value);
                      }}
                    >
                      <option value="">🎬 Selecionar vídeo já enviado…</option>
                      {availableVideos.map((video) => (
                        <option key={video.id} value={video.id}>{video.label}</option>
                      ))}
                    </select>
                    <label className="inline-flex items-center gap-2 text-xs px-2 py-1 rounded border border-border bg-background hover:bg-muted cursor-pointer">
                      📤 Enviar vídeo novo
                      <input type="file" accept="video/*" className="hidden"
                        onChange={(e) => e.target.files?.[0] && uploadSlotVideo(s.slot_key, e.target.files[0])} />
                    </label>
                    {s.video_url && (
                      <Button size="sm" variant="ghost" onClick={() => removeSlotVideo(s.slot_key)} className="text-destructive h-7 text-xs">
                        Remover vídeo
                      </Button>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 items-center">
                  <AudioRecorderInline onRecorded={(b, d) => uploadDefault(s.slot_key, b, d)} />
                  <Button size="sm" onClick={() => saveSlot(s)} disabled={saving === s.slot_key}>
                    {saving === s.slot_key ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />}
                    Salvar
                  </Button>
                  <Button size="sm" variant="ghost" className="text-destructive ml-auto" onClick={() => deleteSlot(s.slot_key)}>
                    Excluir
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
