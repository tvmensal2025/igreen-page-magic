import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import {
  Check, Sparkles, Upload, FileAudio, Image as ImageIcon, Video, Type,
  Loader2, ChevronUp, ChevronDown, GripVertical,
} from "lucide-react";
import { toast } from "sonner";
import { POS_VENDA_STAGES, type PosVendaStage } from "@/lib/posVenda/format";
import { uploadMedia, getAcceptString } from "@/services/minioUpload";
import { sha256File, findExistingByHash } from "@/lib/mediaHash";

interface Props {
  consultantId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onComplete?: () => void;
}

interface MediaItem {
  id: string;
  kind: string;
  label: string | null;
  url: string | null;
  is_public: boolean | null;
  source?: "library" | "template_public" | "template_mine";
}

type Slot = "text" | "audio" | "image" | "video";

const DEFAULT_ORDER: Slot[] = ["text", "audio", "image", "video"];

interface StageConfig {
  text_content: string;
  audio_media_id: string | null;
  image_media_id: string | null;
  video_media_id: string | null;
  use_default: boolean;
  send_order: Slot[];
}

const EMPTY: StageConfig = {
  text_content: "",
  audio_media_id: null,
  image_media_id: null,
  video_media_id: null,
  use_default: true,
  send_order: DEFAULT_ORDER,
};

const SLOT_META: Record<Slot, { label: string; icon: any }> = {
  text: { label: "Texto", icon: Type },
  audio: { label: "Áudio", icon: FileAudio },
  image: { label: "Imagem", icon: ImageIcon },
  video: { label: "Vídeo", icon: Video },
};

export default function PosVendaSetupWizard({ consultantId, open, onOpenChange, onComplete }: Props) {
  const [activeStage, setActiveStage] = useState<PosVendaStage>("aprovado");
  const [configs, setConfigs] = useState<Record<PosVendaStage, StageConfig>>(() => {
    const init: any = {};
    POS_VENDA_STAGES.forEach((s) => (init[s.key] = { ...EMPTY }));
    return init;
  });
  const [publicMedia, setPublicMedia] = useState<MediaItem[]>([]);
  const [myMedia, setMyMedia] = useState<MediaItem[]>([]);
  const [templateMedia, setTemplateMedia] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    (async () => {
      setLoading(true);
      const [cfgRes, pubRes, mineRes, tplRes] = await Promise.all([
        supabase
          .from("consultant_pos_venda_media" as any)
          .select("stage,text_content,audio_media_id,image_media_id,video_media_id,use_default,send_order")
          .eq("consultant_id", consultantId),
        supabase
          .from("ai_media_library")
          .select("id,kind,label,url,is_public")
          .eq("is_public", true)
          .eq("active", true)
          .not("url", "is", null)
          .order("kind"),
        supabase
          .from("ai_media_library")
          .select("id,kind,label,url,is_public")
          .eq("consultant_id", consultantId)
          .eq("active", true)
          .not("url", "is", null)
          .order("created_at", { ascending: false }),
        supabase
          .from("message_templates")
          .select("id,name,media_type,media_url,image_url,is_public,consultant_id")
          .in("media_type", ["audio", "image", "video"])
          .or(`is_public.eq.true,consultant_id.eq.${consultantId}`)
          .order("created_at", { ascending: false }),
      ]);

      const next: any = {};
      POS_VENDA_STAGES.forEach((s) => (next[s.key] = { ...EMPTY }));
      for (const row of (cfgRes.data || []) as any[]) {
        next[row.stage as PosVendaStage] = {
          text_content: row.text_content || "",
          audio_media_id: row.audio_media_id,
          image_media_id: row.image_media_id,
          video_media_id: row.video_media_id,
          use_default: row.use_default,
          send_order:
            Array.isArray(row.send_order) && row.send_order.length === 4
              ? (row.send_order as Slot[])
              : DEFAULT_ORDER,
        };
      }
      setConfigs(next);
      setPublicMedia((pubRes.data || []) as MediaItem[]);
      setMyMedia((mineRes.data || []) as MediaItem[]);
      const tpls: MediaItem[] = ((tplRes.data || []) as any[])
        .map((t): MediaItem => ({
          id: `tpl:${t.id}`,
          kind: t.media_type,
          label: t.name,
          url: t.media_type === "image" ? (t.image_url || t.media_url) : t.media_url,
          is_public: t.is_public,
          source: t.is_public ? "template_public" as const : "template_mine" as const,
        }))
        .filter((t) => !!t.url);

      setTemplateMedia(tpls);
      setLoading(false);
    })();
    // eslint-disable-next-line
  }, [open, consultantId]);


  const completedCount = useMemo(
    () =>
      POS_VENDA_STAGES.filter((s) => {
        const c = configs[s.key];
        return !c.use_default || c.text_content || c.audio_media_id || c.image_media_id || c.video_media_id;
      }).length,
    [configs],
  );

  function updateStage(stage: PosVendaStage, patch: Partial<StageConfig>) {
    setConfigs((prev) => ({
      ...prev,
      [stage]: { ...prev[stage], ...patch, use_default: false },
    }));
  }

  function moveSlot(stage: PosVendaStage, slot: Slot, dir: -1 | 1) {
    setConfigs((prev) => {
      const order = [...prev[stage].send_order];
      const i = order.indexOf(slot);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= order.length) return prev;
      [order[i], order[j]] = [order[j], order[i]];
      return { ...prev, [stage]: { ...prev[stage], send_order: order } };
    });
  }

  async function saveAll() {
    setSaving(true);
    try {
      const rows = POS_VENDA_STAGES.map((s) => ({
        consultant_id: consultantId,
        stage: s.key,
        ...configs[s.key],
        configured_at: new Date().toISOString(),
      }));
      const { error } = await supabase
        .from("consultant_pos_venda_media" as any)
        .upsert(rows, { onConflict: "consultant_id,stage" });
      if (error) throw error;
      toast.success("Configuração salva!");
      onOpenChange(false);
      onComplete?.();
    } catch (e: any) {
      toast.error(e.message || "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  async function handleUpload(file: File, kind: "audio" | "image" | "video", stage: PosVendaStage) {
    try {
      // 1) dedupe por hash
      const hash = await sha256File(file);
      const existing = await findExistingByHash(consultantId, hash);
      let mediaId: string;

      if (existing) {
        mediaId = existing.id;
        toast.success("Arquivo já existia — reutilizado.");
      } else {
        const result = await uploadMedia(file, undefined, { scope: "generic", kind, consultant_id: consultantId });
        const label = file.name.replace(/\.[^/.]+$/, "").slice(0, 80);
        const { data, error } = await supabase
          .from("ai_media_library")
          .insert({
            consultant_id: consultantId,
            kind,
            label,
            url: result.url,
            storage_path: (result as any).storage_path || null,
            content_hash: hash,
            original_size_bytes: file.size,
            final_size_bytes: (result as any).size || file.size,
            active: true,
            is_public: false,
          })
          .select("id,kind,label,url,is_public")
          .single();
        if (error) throw error;
        mediaId = data.id;
        setMyMedia((prev) => [data as MediaItem, ...prev]);
        toast.success("Mídia enviada!");
      }

      const patch: Partial<StageConfig> = {};
      if (kind === "audio") patch.audio_media_id = mediaId;
      if (kind === "image") patch.image_media_id = mediaId;
      if (kind === "video") patch.video_media_id = mediaId;
      updateStage(stage, patch);
    } catch (e: any) {
      toast.error(e.message || "Falha no upload");
    }
  }

  const stageCfg = configs[activeStage];
  const stageMeta = POS_VENDA_STAGES.find((s) => s.key === activeStage)!;
  const stageIndex = POS_VENDA_STAGES.findIndex((s) => s.key === activeStage);
  const progress = (completedCount / POS_VENDA_STAGES.length) * 100;

  const mediaById = useMemo(() => {
    const m = new Map<string, MediaItem>();
    for (const x of [...publicMedia, ...myMedia, ...templateMedia]) m.set(x.id, x);
    return m;
  }, [publicMedia, myMedia, templateMedia]);

  // Quando o slot está vazio, usa o primeiro público do tipo como preview "default"
  const defaultsByKind = useMemo(() => {
    const map: Record<string, MediaItem | undefined> = {};
    for (const x of publicMedia) if (!map[x.kind]) map[x.kind] = x;
    return map;
  }, [publicMedia]);

  async function pickMedia(stage: PosVendaStage, kind: "audio" | "image" | "video", item: MediaItem) {
    // Templates têm id "tpl:<uuid>" — não dá pra gravar direto como media_id.
    // Inserimos/reutilizamos em ai_media_library para virar um id real.
    let mediaId = item.id;
    if (item.id.startsWith("tpl:") && item.url) {
      const { data: existing } = await supabase
        .from("ai_media_library")
        .select("id")
        .eq("url", item.url)
        .or(`consultant_id.eq.${consultantId},is_public.eq.true`)
        .maybeSingle();
      if (existing?.id) {
        mediaId = existing.id;
      } else {
        const { data, error } = await supabase
          .from("ai_media_library")
          .insert({
            consultant_id: consultantId,
            kind,
            label: item.label || "Do template",
            url: item.url,
            active: true,
            is_public: false,
          })
          .select("id,kind,label,url,is_public")
          .single();
        if (error) {
          toast.error("Não consegui usar este template");
          return;
        }
        mediaId = data.id;
        setMyMedia((p) => [data as MediaItem, ...p]);
      }
    }
    const patch: Partial<StageConfig> = {};
    if (kind === "audio") patch.audio_media_id = mediaId;
    if (kind === "image") patch.image_media_id = mediaId;
    if (kind === "video") patch.video_media_id = mediaId;
    updateStage(stage, patch);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[94vh] overflow-hidden flex flex-col gap-0 p-0">

        <DialogHeader className="px-6 pt-6 pb-3 border-b">
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            Configure suas mensagens pós-venda
          </DialogTitle>
          <DialogDescription>
            Escolha texto, áudio, imagem ou vídeo, defina a ordem e veja como vai chegar no WhatsApp.
          </DialogDescription>

          <div className="space-y-1.5 mt-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{completedCount} de {POS_VENDA_STAGES.length} estágios configurados</span>
              <span>Passo {stageIndex + 1}/{POS_VENDA_STAGES.length}</span>
            </div>
            <Progress value={progress} className="h-1.5" />
          </div>
        </DialogHeader>

        {loading ? (
          <div className="flex-1 flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="flex-1 grid lg:grid-cols-[1fr,460px] min-h-0">
            {/* COLUNA ESQUERDA: editor */}
            <div className="flex flex-col min-h-0 overflow-hidden border-r">
              <Tabs
                value={activeStage}
                onValueChange={(v) => setActiveStage(v as PosVendaStage)}
                className="flex-1 flex flex-col min-h-0"
              >
                <div className="px-6 pt-4">
                  <TabsList className="grid grid-cols-6 w-full h-9">
                    {POS_VENDA_STAGES.map((s) => {
                      const c = configs[s.key];
                      const done =
                        !c.use_default ||
                        c.text_content ||
                        c.audio_media_id ||
                        c.image_media_id ||
                        c.video_media_id;
                      return (
                        <TabsTrigger key={s.key} value={s.key} className="relative text-xs">
                          {s.label}
                          {done && <Check className="w-3 h-3 absolute top-0.5 right-0.5 text-emerald-500" />}
                        </TabsTrigger>
                      );
                    })}
                  </TabsList>
                </div>

                <TabsContent value={activeStage} className="flex-1 overflow-y-auto px-6 py-4 space-y-4 mt-0">
                  <Card className="p-3 bg-muted/30 border-border/50">
                    <h3 className="font-semibold text-sm">{stageMeta.label}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">{stageMeta.description}</p>
                  </Card>

                  {/* Ordem de envio */}
                  <div>
                    <h4 className="text-sm font-semibold mb-2">Ordem de envio</h4>
                    <div className="flex flex-col gap-1.5">
                      {stageCfg.send_order.map((slot, idx) => {
                        const meta = SLOT_META[slot];
                        const Icon = meta.icon;
                        return (
                          <div
                            key={slot}
                            className="flex items-center gap-2 rounded-lg border border-border/50 bg-muted/20 px-2 py-1.5"
                          >
                            <GripVertical className="w-3.5 h-3.5 text-muted-foreground/60" />
                            <span className="w-5 text-xs text-muted-foreground font-mono">{idx + 1}.</span>
                            <Icon className="w-4 h-4 text-muted-foreground" />
                            <span className="text-sm flex-1">{meta.label}</span>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6"
                              disabled={idx === 0}
                              onClick={() => moveSlot(activeStage, slot, -1)}
                            >
                              <ChevronUp className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6"
                              disabled={idx === stageCfg.send_order.length - 1}
                              onClick={() => moveSlot(activeStage, slot, 1)}
                            >
                              <ChevronDown className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <h4 className="text-sm font-semibold flex items-center gap-2 mb-2">
                      <Type className="w-4 h-4 text-muted-foreground" />
                      Texto
                    </h4>
                    <Textarea
                      placeholder="Mensagem (deixe vazio para usar o padrão)"
                      value={stageCfg.text_content}
                      onChange={(e) => updateStage(activeStage, { text_content: e.target.value })}
                      rows={3}
                    />
                  </div>

                  <MediaPicker
                    kind="audio"
                    publicMedia={publicMedia}
                    myMedia={myMedia}
                    templateMedia={templateMedia}
                    selectedId={stageCfg.audio_media_id}
                    onPick={(item) => pickMedia(activeStage, "audio", item)}
                    onClear={() => updateStage(activeStage, { audio_media_id: null })}
                    onUpload={(f) => handleUpload(f, "audio", activeStage)}
                  />
                  <MediaPicker
                    kind="image"
                    publicMedia={publicMedia}
                    myMedia={myMedia}
                    templateMedia={templateMedia}
                    selectedId={stageCfg.image_media_id}
                    onPick={(item) => pickMedia(activeStage, "image", item)}
                    onClear={() => updateStage(activeStage, { image_media_id: null })}
                    onUpload={(f) => handleUpload(f, "image", activeStage)}
                  />
                  <MediaPicker
                    kind="video"
                    publicMedia={publicMedia}
                    myMedia={myMedia}
                    templateMedia={templateMedia}
                    selectedId={stageCfg.video_media_id}
                    onPick={(item) => pickMedia(activeStage, "video", item)}
                    onClear={() => updateStage(activeStage, { video_media_id: null })}
                    onUpload={(f) => handleUpload(f, "video", activeStage)}
                  />

                </TabsContent>
              </Tabs>
            </div>

            {/* COLUNA DIREITA: preview celular */}
            <div className="hidden lg:flex flex-col items-center justify-start bg-gradient-to-b from-muted/40 to-muted/10 p-4 overflow-hidden">
              <p className="text-xs text-muted-foreground mb-2">Preview no WhatsApp</p>
              <PhonePreview cfg={stageCfg} mediaById={mediaById} stageLabel={stageMeta.label} />
            </div>
          </div>
        )}

        <div className="flex items-center justify-between px-6 py-3 border-t bg-background">
          <Badge variant="outline" className="text-xs">
            Pode editar depois nas configurações
          </Badge>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Pular
            </Button>
            <Button onClick={saveAll} disabled={saving} className="gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Salvar e continuar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─────────── Picker ───────────

function MediaPicker({
  kind,
  consultantId,
  publicMedia,
  myMedia,
  selectedId,
  onSelect,
  onUpload,
}: {
  kind: "audio" | "image" | "video";
  consultantId: string;
  publicMedia: MediaItem[];
  myMedia: MediaItem[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onUpload: (file: File) => Promise<void>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const Icon = kind === "audio" ? FileAudio : kind === "image" ? ImageIcon : Video;
  const pub = publicMedia.filter((m) => m.kind === kind).slice(0, 6);
  const mine = myMedia.filter((m) => m.kind === kind).slice(0, 6);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setProgress(10);
    const tick = setInterval(() => setProgress((p) => Math.min(p + 10, 85)), 300);
    try {
      await onUpload(file);
      setProgress(100);
    } finally {
      clearInterval(tick);
      setUploading(false);
      setProgress(0);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold flex items-center gap-2">
          <Icon className="w-4 h-4 text-muted-foreground" />
          {kind === "audio" ? "Áudio" : kind === "image" ? "Imagem" : "Vídeo"}
        </h4>
        {selectedId && (
          <Button size="sm" variant="ghost" onClick={() => onSelect(null)}>
            Remover
          </Button>
        )}
      </div>

      {pub.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1">
            <Sparkles className="w-3 h-3" /> Sugestões nossas
          </p>
          <div className="grid grid-cols-2 gap-2">
            {pub.map((m) => (
              <MediaCard key={m.id} m={m} selected={selectedId === m.id} onSelect={() => onSelect(m.id)} />
            ))}
          </div>
        </div>
      )}

      {mine.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground mb-1.5">Meus uploads</p>
          <div className="grid grid-cols-2 gap-2">
            {mine.map((m) => (
              <MediaCard key={m.id} m={m} selected={selectedId === m.id} onSelect={() => onSelect(m.id)} />
            ))}
          </div>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept={getAcceptString(kind)}
        onChange={handleFile}
        className="hidden"
      />
      <Button
        size="sm"
        variant="outline"
        className="w-full gap-2 border-dashed"
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
      >
        {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
        Subir do meu computador
      </Button>
      {uploading && <Progress value={progress} className="h-1" />}
    </div>
  );
}

function MediaCard({ m, selected, onSelect }: { m: MediaItem; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`text-left p-2 rounded-lg border transition-all hover:border-primary/50 ${
        selected ? "border-primary bg-primary/5" : "border-border bg-card"
      }`}
    >
      <div className="flex items-center justify-between gap-1">
        <p className="text-xs font-medium truncate flex-1">{m.label || "Sem nome"}</p>
        {selected && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
      </div>
      {m.kind === "image" && m.url && (
        <img src={m.url} alt="" className="w-full h-16 object-cover rounded mt-1" loading="lazy" />
      )}
      {m.kind === "audio" && m.url && (
        <audio src={m.url} controls className="w-full h-7 mt-1" preload="none" />
      )}
      {m.kind === "video" && m.url && (
        <video src={m.url} className="w-full h-16 object-cover rounded mt-1" preload="metadata" muted />
      )}
    </button>
  );
}

// ─────────── Preview do celular ───────────

function PhonePreview({
  cfg,
  mediaById,
  stageLabel,
}: {
  cfg: StageConfig;
  mediaById: Map<string, MediaItem>;
  stageLabel: string;
}) {
  return (
    <div className="w-full max-w-[280px] aspect-[9/19] rounded-[2.5rem] border-[10px] border-zinc-800 bg-zinc-900 shadow-2xl overflow-hidden flex flex-col">
      {/* Notch */}
      <div className="h-5 bg-zinc-900 flex items-center justify-center">
        <div className="w-16 h-1 bg-zinc-700 rounded-full" />
      </div>
      {/* Header WhatsApp */}
      <div className="bg-emerald-700 text-white px-3 py-2 flex items-center gap-2">
        <div className="w-7 h-7 rounded-full bg-emerald-900 flex items-center justify-center text-[10px] font-bold">
          IG
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold truncate">iGreen — {stageLabel}</p>
          <p className="text-[9px] text-emerald-100/80">online</p>
        </div>
      </div>
      {/* Mensagens */}
      <div
        className="flex-1 overflow-y-auto p-2 space-y-1.5"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 20%, rgba(16,185,129,0.06), transparent 40%), radial-gradient(circle at 80% 70%, rgba(16,185,129,0.04), transparent 40%)",
          backgroundColor: "#0e1614",
        }}
      >
        {cfg.send_order.map((slot, idx) => {
          if (slot === "text") {
            const txt = cfg.text_content.trim();
            if (!txt) return null;
            return <Bubble key={`t-${idx}`}><p className="text-[11px] whitespace-pre-wrap">{txt}</p></Bubble>;
          }
          const id =
            slot === "audio" ? cfg.audio_media_id : slot === "image" ? cfg.image_media_id : cfg.video_media_id;
          if (!id) return null;
          const m = mediaById.get(id);
          if (!m?.url) return null;
          if (slot === "audio") {
            return (
              <Bubble key={`a-${idx}`}>
                <audio src={m.url} controls className="w-full h-7" preload="none" />
              </Bubble>
            );
          }
          if (slot === "image") {
            return (
              <Bubble key={`i-${idx}`}>
                <img src={m.url} alt="" className="rounded max-w-full max-h-32 object-cover" loading="lazy" />
              </Bubble>
            );
          }
          return (
            <Bubble key={`v-${idx}`}>
              <video src={m.url} controls className="rounded max-w-full max-h-32" preload="metadata" />
            </Bubble>
          );
        })}
        {!cfg.text_content && !cfg.audio_media_id && !cfg.image_media_id && !cfg.video_media_id && (
          <p className="text-[10px] text-zinc-500 text-center pt-4">
            Escolha mídias à esquerda para ver o preview
          </p>
        )}
      </div>
    </div>
  );
}

function Bubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] bg-emerald-600/90 text-white rounded-lg rounded-tr-sm px-2 py-1.5 shadow">
        {children}
      </div>
    </div>
  );
}
