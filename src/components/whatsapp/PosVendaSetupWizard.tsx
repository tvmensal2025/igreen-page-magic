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
  Loader2, ChevronUp, ChevronDown, GripVertical, FileText, HelpCircle,
} from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { POS_VENDA_STAGES, type PosVendaStage } from "@/lib/posVenda/format";
import { uploadMedia, getAcceptString } from "@/services/minioUpload";
import { sha256File, findExistingByHash } from "@/lib/mediaHash";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";


interface FullTemplate {
  id: string;
  name: string;
  content: string | null;
  media_type: string | null;
  media_url: string | null;
  image_url: string | null;
  is_public: boolean;
}

interface DefaultMedia {
  stage: string;
  message_type: string;
  message_text: string | null;
  media_url: string | null;
  image_url: string | null;
  is_active: boolean;
}

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

  const [allTemplates, setAllTemplates] = useState<FullTemplate[]>([]);
  /** Padrão institucional (pos_venda_default_media) — já cobre o envio automático. */
  const [defaultsByStage, setDefaultsByStage] = useState<Record<string, DefaultMedia>>({});

  useEffect(() => {
    if (!open) return;
    (async () => {
      setLoading(true);
      const [cfgRes, pubRes, mineRes, tplRes, defRes] = await Promise.all([
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
          .select("id,name,content,media_type,media_url,image_url,is_public,consultant_id")
          .or(`is_public.eq.true,consultant_id.eq.${consultantId}`)
          .order("created_at", { ascending: false }),
        supabase
          .from("pos_venda_default_media")
          .select("stage,message_type,message_text,media_url,image_url,is_active")
          .eq("is_active", true),
      ]);

      const defMap: Record<string, DefaultMedia> = {};
      for (const d of (defRes.data || []) as DefaultMedia[]) {
        if (d?.stage) defMap[d.stage] = d;
      }
      setDefaultsByStage(defMap);

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
      const tplRows = (tplRes.data || []) as any[];
      setAllTemplates(tplRows.map((t) => ({
        id: t.id, name: t.name, content: t.content,
        media_type: t.media_type, media_url: t.media_url, image_url: t.image_url,
        is_public: !!t.is_public,
      })));
      const tpls: MediaItem[] = tplRows
        .filter((t) => ["audio", "image", "video"].includes(t.media_type))
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


  const stageIsReady = (stageKey: PosVendaStage, c: StageConfig) => {
    if (c.text_content || c.audio_media_id || c.image_media_id || c.video_media_id) return true;
    // Sem personalização: cobre pelo padrão institucional (usado no envio automático)
    if (c.use_default === false) return false;
    const d = defaultsByStage[stageKey];
    return !!(d && d.is_active !== false && (d.message_text || d.media_url || d.image_url));
  };

  const completedCount = useMemo(
    () => POS_VENDA_STAGES.filter((s) => stageIsReady(s.key, configs[s.key])).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [configs, defaultsByStage],
  );

  const usingInstitutionalDefaults = useMemo(
    () =>
      POS_VENDA_STAGES.every((s) => {
        const c = configs[s.key];
        const hasPersonal = !!(c.text_content || c.audio_media_id || c.image_media_id || c.video_media_id) && !c.use_default;
        return !hasPersonal && !!defaultsByStage[s.key];
      }),
    [configs, defaultsByStage],
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

  async function applyTemplate(stage: PosVendaStage, tplId: string) {
    const tpl = allTemplates.find((t) => t.id === tplId);
    if (!tpl) return;
    const patch: Partial<StageConfig> = {};
    if (tpl.content) patch.text_content = tpl.content;
    const url = tpl.media_type === "image" ? (tpl.image_url || tpl.media_url) : tpl.media_url;
    if (url && tpl.media_type && ["audio", "image", "video"].includes(tpl.media_type)) {
      // reuse or create ai_media_library entry
      const { data: existing } = await supabase
        .from("ai_media_library")
        .select("id")
        .eq("url", url)
        .or(`consultant_id.eq.${consultantId},is_public.eq.true`)
        .maybeSingle();
      let mediaId = existing?.id as string | undefined;
      if (!mediaId) {
        const { data, error } = await supabase
          .from("ai_media_library")
          .insert({
            consultant_id: consultantId,
            kind: tpl.media_type,
            label: tpl.name || "Do template",
            url,
            active: true,
            is_public: false,
          })
          .select("id,kind,label,url,is_public")
          .single();
        if (!error && data) {
          mediaId = data.id;
          setMyMedia((p) => [data as MediaItem, ...p]);
        }
      }
      if (mediaId) {
        if (tpl.media_type === "audio") patch.audio_media_id = mediaId;
        if (tpl.media_type === "image") patch.image_media_id = mediaId;
        if (tpl.media_type === "video") patch.video_media_id = mediaId;
      }
    }
    updateStage(stage, patch);
    toast.success(`Template "${tpl.name}" aplicado — agora ajuste o que quiser.`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[94vh] overflow-hidden flex flex-col gap-0 p-0">

        <DialogHeader className="px-6 pt-6 pb-3 border-b bg-muted/20">
          <DialogTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              Configuração Profissional do Pós-Venda
            </div>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                  <HelpCircle className="w-4 h-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80">
                <div className="space-y-2">
                  <h4 className="font-semibold text-sm">Como configurar seu fluxo?</h4>
                  <p className="text-xs text-muted-foreground">
                    1. Escolha um dos 6 estágios no topo.<br/>
                    2. Use um template pronto ou crie o seu.<br/>
                    3. Defina a ordem de envio (ex: texto primeiro, depois áudio).<br/>
                    4. Veja o preview no celular à direita.<br/>
                    5. Clique em salvar para aplicar em todos os novos clientes.
                  </p>
                </div>
              </PopoverContent>
            </Popover>
          </DialogTitle>
          <DialogDescription className="mt-1">
            {usingInstitutionalDefaults
              ? "Padrão institucional iGreen já está ativo nos 6 estágios — o envio automático já funciona. Personalize só se quiser trocar as mensagens."
              : "Personalize as mensagens que seus clientes receberão automaticamente após a aprovação iGreen."}
          </DialogDescription>


          <div className="space-y-1.5 mt-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {completedCount} de {POS_VENDA_STAGES.length} estágios configurados
                {usingInstitutionalDefaults ? " · padrão iGreen" : ""}
              </span>
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
          <div className="flex-1 grid lg:grid-cols-[1fr,360px] min-h-0">
            {/* COLUNA ESQUERDA: editor */}
            <div className="flex flex-col min-h-0 overflow-hidden border-r">
              <Tabs
                value={activeStage}
                onValueChange={(v) => setActiveStage(v as PosVendaStage)}
                className="flex-1 flex flex-col min-h-0"
              >
                <div className="px-3 sm:px-6 pt-4 min-w-0">
                  <div className="w-full max-w-full min-w-0 overflow-x-auto overscroll-x-contain">
                    <TabsList className="inline-flex h-auto min-h-9 w-max max-w-none gap-0.5 p-1 sm:grid sm:w-full sm:grid-cols-3 lg:grid-cols-6 sm:min-w-0">
                      {POS_VENDA_STAGES.map((s) => {
                        const done = stageIsReady(s.key, configs[s.key]);
                        return (
                          <TabsTrigger key={s.key} value={s.key} className="relative text-[10px] sm:text-xs shrink-0 px-2.5 sm:px-3 whitespace-nowrap">
                            {s.label}
                            {done && <Check className="w-3 h-3 absolute top-0.5 right-0.5 text-primary" />}
                          </TabsTrigger>
                        );
                      })}
                    </TabsList>
                  </div>
                </div>

                <TabsContent value={activeStage} className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 space-y-4 mt-0">
                  <Card className="p-3 bg-muted/30 border-border/50">
                    <h3 className="font-semibold text-sm">{stageMeta.label}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">{stageMeta.description}</p>
                    {stageCfg.use_default && defaultsByStage[activeStage] && (
                      <p className="text-[11px] text-primary mt-2">
                        Usando padrão institucional. Edite abaixo só se quiser personalizar este estágio.
                      </p>
                    )}
                  </Card>

                  {/* Carregar template completo */}
                  <div>
                    <h4 className="text-sm font-semibold flex items-center gap-2 mb-2">
                      <FileText className="w-4 h-4 text-muted-foreground" />
                      Carregar template (opcional)
                    </h4>
                    <Select onValueChange={(v) => applyTemplate(activeStage, v)}>
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue placeholder="Escolher um template para preencher o estágio…" />
                      </SelectTrigger>
                      <SelectContent>
                        {allTemplates.length === 0 && (
                          <div className="px-2 py-1.5 text-xs text-muted-foreground">Nenhum template disponível.</div>
                        )}
                        {allTemplates.map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            <span className="flex items-center gap-2">
                              <span className="text-[10px] uppercase rounded bg-muted px-1 py-0.5">
                                {t.media_type || "texto"}
                              </span>
                              <span>{t.name}</span>
                              {t.is_public && <span className="text-[10px] text-muted-foreground">público</span>}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Aplica texto + mídia do template. Depois você pode trocar áudio, imagem ou vídeo livremente abaixo.
                    </p>
                  </div>

                  {/* Ordem de envio */}
                  <div>
                    <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                      Ordem de envio
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <HelpCircle className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="text-xs">Clique nas setas para definir qual mídia será enviada primeiro.</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </h4>

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
                      placeholder={
                        defaultsByStage[activeStage]?.message_text
                          || "Mensagem (deixe vazio para usar o padrão)"
                      }
                      value={stageCfg.text_content}
                      onChange={(e) => updateStage(activeStage, { text_content: e.target.value })}
                      rows={3}
                    />
                    {!stageCfg.text_content && defaultsByStage[activeStage]?.message_text && (
                      <p className="text-[11px] text-muted-foreground mt-1 italic">
                        Preview do padrão: {defaultsByStage[activeStage]!.message_text!.slice(0, 120)}
                        {(defaultsByStage[activeStage]!.message_text!.length > 120) ? "…" : ""}
                      </p>
                    )}
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
              <PhonePreview
                cfg={stageCfg}
                mediaById={mediaById}
                defaultsByKind={defaultsByKind}
                institutionalDefault={defaultsByStage[activeStage] || null}
                stageLabel={stageMeta.label}
              />
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-3 sm:px-6 py-3 border-t bg-background min-w-0">
          <Badge variant="outline" className="text-xs w-fit max-w-full whitespace-normal text-left">
            {usingInstitutionalDefaults
              ? "Padrão iGreen ativo — personalizar é opcional"
              : "Pode editar depois nas configurações"}
          </Badge>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {usingInstitutionalDefaults ? "Fechar" : "Pular"}
            </Button>
            <Button onClick={saveAll} disabled={saving} className="gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {usingInstitutionalDefaults ? "Salvar personalização" : "Salvar e continuar"}
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
  publicMedia,
  myMedia,
  templateMedia,
  selectedId,
  onPick,
  onClear,
  onUpload,
}: {
  kind: "audio" | "image" | "video";
  publicMedia: MediaItem[];
  myMedia: MediaItem[];
  templateMedia: MediaItem[];
  selectedId: string | null;
  onPick: (item: MediaItem) => void;
  onClear: () => void;
  onUpload: (file: File) => Promise<void>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [tab, setTab] = useState<"templates" | "publicos" | "meus">("templates");

  const Icon = kind === "audio" ? FileAudio : kind === "image" ? ImageIcon : Video;
  const pub = publicMedia.filter((m) => m.kind === kind);
  const mine = myMedia.filter((m) => m.kind === kind);
  const tpls = templateMedia.filter((m) => m.kind === kind);

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

  const current = tab === "templates" ? tpls : tab === "publicos" ? pub : mine;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold flex items-center gap-2">
          <Icon className="w-4 h-4 text-muted-foreground" />
          {kind === "audio" ? "Áudio" : kind === "image" ? "Imagem" : "Vídeo"}
        </h4>
        {selectedId && (
          <Button size="sm" variant="ghost" onClick={onClear}>
            Remover
          </Button>
        )}
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList className="grid grid-cols-3 h-8 w-full">
          <TabsTrigger value="templates" className="text-[11px]">Templates ({tpls.length})</TabsTrigger>
          <TabsTrigger value="publicos" className="text-[11px]">Públicos ({pub.length})</TabsTrigger>
          <TabsTrigger value="meus" className="text-[11px]">Meus ({mine.length})</TabsTrigger>
        </TabsList>
      </Tabs>

      {current.length > 0 ? (
        <div className="grid grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-1">
          {current.slice(0, 12).map((m) => (
            <MediaCard
              key={m.id}
              m={m}
              selected={selectedId === m.id}
              onSelect={() => onPick(m)}
            />
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground italic py-2 text-center">
          {tab === "templates"
            ? "Nenhum template com mídia desse tipo ainda."
            : tab === "publicos"
            ? "Nada na biblioteca pública."
            : "Você ainda não enviou nada."}
        </p>
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
    <div
      className={`p-2 rounded-lg border transition-all ${
        selected ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/40"
      }`}
    >
      <button type="button" onClick={onSelect} className="w-full text-left">
        <div className="flex items-center justify-between gap-1">
          <p className="text-xs font-medium truncate flex-1">{m.label || "Sem nome"}</p>
          {selected && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
        </div>
      </button>
      {m.kind === "image" && m.url && (
        <button type="button" onClick={onSelect} className="block w-full">
          <img src={m.url} alt="" className="w-full h-20 object-cover rounded mt-1" loading="lazy" />
        </button>
      )}
      {m.kind === "audio" && m.url && (
        <audio src={m.url} controls className="w-full h-8 mt-1" preload="none" />
      )}
      {m.kind === "video" && m.url && (
        <video src={m.url} controls className="w-full h-20 object-cover rounded mt-1" preload="metadata" />
      )}
    </div>
  );
}

// ─────────── Preview do celular (iPhone 14 Pro Max) ───────────

function PhonePreview({
  cfg,
  mediaById,
  defaultsByKind,
  institutionalDefault,
  stageLabel,
}: {
  cfg: StageConfig;
  mediaById: Map<string, MediaItem>;
  defaultsByKind: Record<string, MediaItem | undefined>;
  institutionalDefault: DefaultMedia | null;
  stageLabel: string;
}) {
  function resolve(slot: Slot): MediaItem | undefined {
    const id =
      slot === "audio" ? cfg.audio_media_id : slot === "image" ? cfg.image_media_id : slot === "video" ? cfg.video_media_id : null;
    if (id) return mediaById.get(id);
    if (cfg.use_default && institutionalDefault) {
      if (slot === "image" && institutionalDefault.image_url) {
        return { id: "def-image", kind: "image", label: "Padrão", url: institutionalDefault.image_url, is_public: true };
      }
      if (slot === "audio" && institutionalDefault.media_url && institutionalDefault.message_type === "audio") {
        return { id: "def-audio", kind: "audio", label: "Padrão", url: institutionalDefault.media_url, is_public: true };
      }
      if (slot === "video" && institutionalDefault.media_url && institutionalDefault.message_type === "video") {
        return { id: "def-video", kind: "video", label: "Padrão", url: institutionalDefault.media_url, is_public: true };
      }
      // media_url genérico (muitas vezes áudio/vídeo sem type estrito)
      if (slot === "audio" && institutionalDefault.media_url && !institutionalDefault.image_url) {
        return { id: "def-media", kind: "audio", label: "Padrão", url: institutionalDefault.media_url, is_public: true };
      }
    }
    if (cfg.use_default) return defaultsByKind[slot];
    return undefined;
  }

  const previewText = cfg.text_content.trim() || (cfg.use_default ? (institutionalDefault?.message_text || "").trim() : "");

  const hasAny =
    previewText ||
    resolve("audio") ||
    resolve("image") ||
    resolve("video");

  return (
    <div className="w-[300px] h-[600px] rounded-[3rem] border-[12px] border-zinc-900 bg-zinc-900 shadow-[0_20px_50px_rgba(0,0,0,0.3)] overflow-hidden flex flex-col relative scale-[0.95] origin-top ring-1 ring-zinc-800">
      {/* iPhone 14 Pro Dynamic Island */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 z-20 h-7 w-28 bg-black rounded-b-2xl flex items-center justify-center">
        <div className="h-1 w-8 bg-zinc-800 rounded-full" />
      </div>

      {/* Status bar */}
      <div className="h-9 bg-zinc-900 flex items-center justify-between px-6 pt-1">
        <span className="text-[10px] text-white font-medium">9:41</span>
        <span className="text-[10px] text-white opacity-70">●●●● 5G</span>
      </div>
      {/* Header WhatsApp */}
      <div className="bg-primary text-white px-3 py-2 flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-[11px] font-bold">
          IG
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">iGreen — {stageLabel}</p>
          <p className="text-[10px] text-primary/80">online</p>
        </div>
      </div>
      {/* Mensagens */}
      <div
        className="flex-1 overflow-y-auto p-3 space-y-2"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 20%, rgba(16,185,129,0.06), transparent 40%), radial-gradient(circle at 80% 70%, rgba(16,185,129,0.04), transparent 40%)",
          backgroundColor: "#0e1614",
        }}
      >
        {cfg.send_order.map((slot, idx) => {
          if (slot === "text") {
            if (!previewText) return null;
            return <Bubble key={`t-${idx}`}><p className="text-[12px] whitespace-pre-wrap">{previewText}</p></Bubble>;
          }
          const m = resolve(slot);
          if (!m?.url) return null;
          if (slot === "audio") {
            return (
              <Bubble key={`a-${idx}`}>
                <audio src={m.url} controls className="w-full h-8" preload="metadata" />
              </Bubble>
            );
          }
          if (slot === "image") {
            return (
              <Bubble key={`i-${idx}`}>
                <img src={m.url} alt="" className="rounded max-w-full max-h-48 object-cover" loading="lazy" />
              </Bubble>
            );
          }
          return (
            <Bubble key={`v-${idx}`}>
              <video src={m.url} controls className="rounded max-w-full max-h-48" preload="metadata" />
            </Bubble>
          );
        })}
        {!hasAny && (
          <p className="text-[11px] text-zinc-500 text-center pt-4">
            Escolha mídias à esquerda para ver o preview
          </p>
        )}
      </div>
      {/* Home indicator */}
      <div className="h-5 bg-zinc-900 flex items-center justify-center">
        <div className="w-28 h-1 bg-white/60 rounded-full" />
      </div>
    </div>
  );
}

function Bubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[88%] bg-primary/90 text-white rounded-lg rounded-tr-sm px-2.5 py-2 shadow">
        {children}
      </div>
    </div>
  );
}

