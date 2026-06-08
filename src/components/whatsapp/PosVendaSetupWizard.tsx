import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Check, Sparkles, Upload, FileAudio, Image as ImageIcon, Video, Type, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { POS_VENDA_STAGES, type PosVendaStage } from "@/lib/posVenda/format";

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
}

interface StageConfig {
  text_content: string;
  audio_media_id: string | null;
  image_media_id: string | null;
  video_media_id: string | null;
  use_default: boolean;
}

const EMPTY: StageConfig = {
  text_content: "",
  audio_media_id: null,
  image_media_id: null,
  video_media_id: null,
  use_default: true,
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Carregar configs existentes + biblioteca de mídias.
  useEffect(() => {
    if (!open) return;
    (async () => {
      setLoading(true);
      const [cfgRes, pubRes, mineRes] = await Promise.all([
        supabase
          .from("consultant_pos_venda_media" as any)
          .select("stage,text_content,audio_media_id,image_media_id,video_media_id,use_default")
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
      ]);

      const next = { ...configs };
      for (const row of (cfgRes.data || []) as any[]) {
        next[row.stage as PosVendaStage] = {
          text_content: row.text_content || "",
          audio_media_id: row.audio_media_id,
          image_media_id: row.image_media_id,
          video_media_id: row.video_media_id,
          use_default: row.use_default,
        };
      }
      setConfigs(next);
      setPublicMedia((pubRes.data || []) as MediaItem[]);
      setMyMedia((mineRes.data || []) as MediaItem[]);
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

  function clearStage(stage: PosVendaStage) {
    setConfigs((prev) => ({ ...prev, [stage]: { ...EMPTY } }));
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

  function MediaPicker({
    kind,
    selectedId,
    onSelect,
  }: {
    kind: "audio" | "image" | "video";
    selectedId: string | null;
    onSelect: (id: string | null) => void;
  }) {
    const Icon = kind === "audio" ? FileAudio : kind === "image" ? ImageIcon : Video;
    const pub = publicMedia.filter((m) => m.kind === kind).slice(0, 6);
    const mine = myMedia.filter((m) => m.kind === kind).slice(0, 6);

    return (
      <div className="space-y-3">
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
            <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
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
            <p className="text-xs text-muted-foreground mb-2">Meus uploads</p>
            <div className="grid grid-cols-2 gap-2">
              {mine.map((m) => (
                <MediaCard key={m.id} m={m} selected={selectedId === m.id} onSelect={() => onSelect(m.id)} />
              ))}
            </div>
          </div>
        )}

        <Button size="sm" variant="outline" className="w-full gap-2" disabled>
          <Upload className="w-4 h-4" />
          Subir o meu (em breve)
        </Button>
      </div>
    );
  }

  const stageCfg = configs[activeStage];
  const stageMeta = POS_VENDA_STAGES.find((s) => s.key === activeStage)!;
  const stageIndex = POS_VENDA_STAGES.findIndex((s) => s.key === activeStage);
  const progress = (completedCount / POS_VENDA_STAGES.length) * 100;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            Configure suas mensagens pós-venda
          </DialogTitle>
          <DialogDescription>
            Escolha um texto, áudio, imagem ou vídeo para cada momento. Pode usar as nossas sugestões ou as suas próprias.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {completedCount} de {POS_VENDA_STAGES.length} estágios configurados
            </span>
            <span>
              Passo {stageIndex + 1}/{POS_VENDA_STAGES.length}
            </span>
          </div>
          <Progress value={progress} className="h-1.5" />
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Tabs value={activeStage} onValueChange={(v) => setActiveStage(v as PosVendaStage)} className="flex-1 flex flex-col min-h-0">
            <TabsList className="grid grid-cols-6 w-full">
              {POS_VENDA_STAGES.map((s) => {
                const c = configs[s.key];
                const done = !c.use_default || c.text_content || c.audio_media_id || c.image_media_id || c.video_media_id;
                return (
                  <TabsTrigger key={s.key} value={s.key} className="relative text-xs">
                    {s.label}
                    {done && <Check className="w-3 h-3 absolute top-0.5 right-0.5 text-emerald-500" />}
                  </TabsTrigger>
                );
              })}
            </TabsList>

            <TabsContent value={activeStage} className="flex-1 overflow-y-auto mt-4 space-y-4 pr-2">
              <Card className="p-4 bg-muted/30">
                <h3 className="font-semibold">{stageMeta.label}</h3>
                <p className="text-xs text-muted-foreground mt-0.5">{stageMeta.description}</p>
              </Card>

              <div>
                <h4 className="text-sm font-semibold flex items-center gap-2 mb-2">
                  <Type className="w-4 h-4 text-muted-foreground" />
                  Texto opcional
                </h4>
                <Textarea
                  placeholder="Mensagem personalizada (deixe vazio para usar o padrão)"
                  value={stageCfg.text_content}
                  onChange={(e) => updateStage(activeStage, { text_content: e.target.value })}
                  rows={3}
                />
              </div>

              <MediaPicker
                kind="audio"
                selectedId={stageCfg.audio_media_id}
                onSelect={(id) => updateStage(activeStage, { audio_media_id: id })}
              />
              <MediaPicker
                kind="image"
                selectedId={stageCfg.image_media_id}
                onSelect={(id) => updateStage(activeStage, { image_media_id: id })}
              />
              <MediaPicker
                kind="video"
                selectedId={stageCfg.video_media_id}
                onSelect={(id) => updateStage(activeStage, { video_media_id: id })}
              />

              <div className="flex items-center justify-between pt-2 border-t">
                <Button variant="ghost" size="sm" onClick={() => clearStage(activeStage)}>
                  Usar padrão público
                </Button>
                {stageIndex < POS_VENDA_STAGES.length - 1 && (
                  <Button size="sm" onClick={() => setActiveStage(POS_VENDA_STAGES[stageIndex + 1].key)}>
                    Próximo estágio →
                  </Button>
                )}
              </div>
            </TabsContent>
          </Tabs>
        )}

        <div className="flex items-center justify-between pt-4 border-t">
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
    </button>
  );
}
