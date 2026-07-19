/**
 * StepCreative — Step 2: fotos (com arrastar/ordenar via @dnd-kit) ou vídeo Reels.
 * Reaproveita toda a lógica de upload/crop/IA/legenda do hook useCreativeLogic.
 */
import { ImageIcon, Video, Upload, X, Wand2, Loader2, Check, GripVertical } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AdImageLibraryPanel } from "../../AdImageLibraryPanel";
import { FORMAT_SPEC, PER_FORMAT_LIMIT, isFileValidFor, type AdFile, type AdFormat } from "../wizardHelpers";
import type { WizardState } from "../hooks/useWizardState";
import type { useCreativeLogic } from "../hooks/useCreativeLogic";

interface Props {
  state: WizardState;
  patch: (p: Partial<WizardState>) => void;
  patchFn: (fn: (prev: WizardState) => Partial<WizardState>) => void;
  creative: ReturnType<typeof useCreativeLogic>;
  consultantId: string;
}

export function StepCreative({ state, patch, patchFn, creative, consultantId }: Props) {
  const format = state.format;
  const adFiles = state.filesByFormat[format];
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    patchFn((prev) => {
      const list = prev.filesByFormat[format];
      const oldIndex = Number(active.id), newIndex = Number(over.id);
      return { filesByFormat: { ...prev.filesByFormat, [format]: arrayMove(list, oldIndex, newIndex) } };
    });
  }

  return (
    <div className="space-y-4">
      {/* Modo do criativo */}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => patch({ creativeMode: "photo" })}
          className={`ads-select-card ${state.creativeMode === "photo" ? "is-active" : ""}`}>
          <div className="font-semibold text-sm flex items-center gap-1.5">
            {state.creativeMode === "photo" && <Check className="w-3.5 h-3.5 text-[hsl(var(--ads-emerald-2))]" />}
            <ImageIcon className="w-3.5 h-3.5" /> Fotos
          </div>
          <div className="text-[11px] text-[hsl(var(--ads-muted))] mt-1">Até 4 por formato — Meta escolhe a melhor.</div>
        </button>
        <button type="button" onClick={() => patch({ creativeMode: "video" })}
          className={`ads-select-card ${state.creativeMode === "video" ? "is-active" : ""}`}>
          <div className="font-semibold text-sm flex items-center gap-1.5">
            {state.creativeMode === "video" && <Check className="w-3.5 h-3.5 text-[hsl(var(--ads-emerald-2))]" />}
            <Video className="w-3.5 h-3.5" /> Vídeo Reels
          </div>
          <div className="text-[11px] text-[hsl(var(--ads-muted))] mt-1">1 vídeo vertical 9:16 — Reels e Stories.</div>
        </button>
      </div>

      {state.creativeMode === "video" ? (
        <VideoUploader state={state} patch={patch} creative={creative} />
      ) : (
        <>
          {/* Formatos */}
          <div>
            <Label className="flex items-center gap-1.5"><ImageIcon className="w-3.5 h-3.5 text-[hsl(var(--ads-emerald-2))]" /> Formato do anúncio</Label>
            <p className="text-[11px] text-[hsl(var(--ads-muted))] mt-1 mb-1">
              Padrão: <strong className="text-foreground">Stories / Reels (1080×1920)</strong> — escolha até 4 fotos na biblioteca.
            </p>
            <div className="grid grid-cols-3 gap-2 mt-2">
              {(Object.keys(FORMAT_SPEC) as AdFormat[]).map((k) => (
                <button key={k} type="button" onClick={() => patch({ format: k })}
                  className={`ads-select-card text-xs ${format === k ? "is-active" : ""}`}>
                  <div className="font-bold">{FORMAT_SPEC[k].label}</div>
                  <div className="text-[10px] text-[hsl(var(--ads-muted))] mt-0.5">{FORMAT_SPEC[k].desc}</div>
                  <div className="text-[10px] mt-1 font-bold text-[hsl(var(--ads-emerald-2))]">{state.filesByFormat[k].length}/{PER_FORMAT_LIMIT} foto(s)</div>
                </button>
              ))}
            </div>
          </div>

          <Tabs value={state.photoTab} onValueChange={(v) => patch({ photoTab: v as "upload" | "library" })}>
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="upload">🆕 Enviar novo</TabsTrigger>
              <TabsTrigger value="library">📁 Minhas imagens</TabsTrigger>
            </TabsList>
            <TabsContent value="upload" className="space-y-3 mt-3">
              <div className={`border-2 border-dashed border-[hsl(var(--ads-border))] rounded-xl p-6 text-center ${adFiles.length >= PER_FORMAT_LIMIT ? "opacity-50 pointer-events-none" : ""}`}>
                <input type="file" accept="image/jpeg,image/png,image/webp" multiple id="wz-photos-input" className="hidden"
                  onChange={(e) => { creative.handleFiles(e.target.files); e.currentTarget.value = ""; }} />
                <label htmlFor="wz-photos-input" className="cursor-pointer space-y-2 block">
                  <Upload className="w-8 h-8 text-[hsl(var(--ads-emerald-2))] mx-auto" />
                  <div className="text-sm font-medium">Clique para enviar fotos {FORMAT_SPEC[format].label} ({adFiles.length}/{PER_FORMAT_LIMIT})</div>
                  <div className="text-xs text-[hsl(var(--ads-muted))]">
                    Tamanho exigido: <strong className="text-foreground">{FORMAT_SPEC[format].w}×{FORMAT_SPEC[format].h}</strong> · JPG/PNG/WebP · até 8 MB
                  </div>
                </label>
              </div>
              {adFiles.length > 0 && (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                  <SortableContext items={adFiles.map((_, i) => String(i))} strategy={rectSortingStrategy}>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {adFiles.map((a, i) => (
                        <SortablePhoto key={`${a.url}-${i}`} id={String(i)} file={a} format={format}
                          aiResizing={state.aiResizingIdx === i}
                          onCrop={() => creative.handleCrop(i)}
                          onAi={() => creative.handleAiResize(i)}
                          onRemove={() => creative.removeFile(i)} />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              )}
              {adFiles.length > 1 && <div className="text-[10px] text-[hsl(var(--ads-muted))]">Arraste para reordenar — a 1ª foto é a principal.</div>}
            </TabsContent>
            <TabsContent value="library" className="mt-3">
              <AdImageLibraryPanel
                consultantId={consultantId}
                format={format}
                selectedUrls={new Set(state.pickedLibrary.map((it) => it.url))}
                onPick={(it) => patchFn((prev) => ({
                  pickedLibrary: prev.pickedLibrary.find((x) => x.url === it.url)
                    ? prev.pickedLibrary.filter((x) => x.url !== it.url)
                    : [...prev.pickedLibrary, it],
                }))}
              />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

function SortablePhoto({ id, file, format, aiResizing, onCrop, onAi, onRemove }: {
  id: string; file: AdFile; format: AdFormat; aiResizing: boolean;
  onCrop: () => void; onAi: () => void; onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const ok = isFileValidFor(file, format);
  const aspect = FORMAT_SPEC[format].ratio === 0.5625 ? "aspect-[9/16]" : FORMAT_SPEC[format].ratio === 0.8 ? "aspect-[4/5]" : "aspect-square";
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      className={`relative group rounded-lg overflow-hidden border-2 ${ok ? "border-[hsl(var(--ads-emerald-2))]/50" : "border-warning/60"} bg-black/20`}>
      <div className={aspect}><img src={file.url} alt="" className="w-full h-full object-cover" /></div>
      <button {...attributes} {...listeners} aria-label="Reordenar imagem" title="Arrastar para reordenar" className="absolute top-1 left-1 bg-black/60 text-white rounded p-1 cursor-grab active:cursor-grabbing">
        <GripVertical className="w-3 h-3" />
      </button>
      <div className="absolute bottom-0 inset-x-0 bg-black/70 text-[10px] text-white px-1.5 py-1 flex items-center justify-between">
        <span>{file.w}×{file.h}</span>
        {ok ? <span className="text-primary">✓</span> : (
          <div className="flex gap-1.5">
            <button type="button" onClick={onCrop} className="text-warning underline">Cortar</button>
            <button type="button" onClick={onAi} disabled={aiResizing} aria-label="Ajustar com IA" title="Ajustar enquadramento com IA" className="text-primary underline flex items-center gap-0.5">
              {aiResizing ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Wand2 className="w-2.5 h-2.5" />} Ajustar com IA
            </button>
          </div>
        )}
      </div>
      <button onClick={onRemove} aria-label="Remover imagem" title="Remover imagem" className="absolute top-1 right-1 bg-destructive text-destructive-foreground rounded-full p-1 opacity-0 group-hover:opacity-100 transition">
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

function VideoUploader({ state, patch, creative }: { state: WizardState; patch: (p: Partial<WizardState>) => void; creative: ReturnType<typeof useCreativeLogic> }) {
  return (
    <div className="space-y-3">
      <div className={`border-2 border-dashed border-[hsl(var(--ads-border))] rounded-xl p-6 text-center ${state.videoFile ? "opacity-60" : ""}`}>
        <input type="file" accept="video/mp4,video/quicktime,video/mov" id="wz-video-input" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; e.currentTarget.value = ""; creative.handleVideoPick(f || null); }} />
        <label htmlFor="wz-video-input" className="cursor-pointer space-y-2 block">
          <Video className="w-8 h-8 text-[hsl(var(--ads-emerald-2))] mx-auto" />
          <div className="text-sm font-medium">Clique para enviar 1 vídeo Reels</div>
          <div className="text-xs text-[hsl(var(--ads-muted))]">MP4 ou MOV · vertical <strong className="text-foreground">9:16</strong> · 4–60s · até 50 MB</div>
        </label>
      </div>
      {state.videoUrl && (
        <div className="space-y-2">
          <div className="relative rounded-lg overflow-hidden border border-[hsl(var(--ads-emerald-2))]/40 bg-black max-w-[280px] mx-auto">
            <video src={state.videoUrl} controls className="w-full aspect-[9/16] object-cover" />
            <button type="button" onClick={creative.clearVideo} aria-label="Remover vídeo" title="Remover vídeo" className="absolute top-1 right-1 bg-destructive text-destructive-foreground rounded-full p-1">
              <X className="w-3 h-3" />
            </button>
            {state.videoMeta && (
              <div className="text-[10px] text-center py-1 bg-black/60 text-white">{state.videoMeta.w}×{state.videoMeta.h} · {state.videoMeta.duration.toFixed(1)}s</div>
            )}
          </div>
          <div className="max-w-[320px] mx-auto rounded-lg border border-[hsl(var(--ads-border))] bg-black/20 p-3 text-xs space-y-2">
            <label className="flex items-center justify-between gap-2 cursor-pointer select-none">
              <span className="flex items-center gap-2 font-medium">
                <input type="checkbox" checked={state.videoCaptionsEnabled}
                  onChange={(e) => patch({ videoCaptionsEnabled: e.target.checked })} />
                Gerar legenda automática
              </span>
            </label>
            {state.videoCaptionsLoading && <div className="flex items-center gap-2 text-[hsl(var(--ads-muted))]"><Loader2 className="w-3 h-3 animate-spin" /> Transcrevendo áudio…</div>}
            {!state.videoCaptionsLoading && state.videoCaptionsSrt && <div className="text-primary">✓ Legenda pronta — vai junto com o vídeo.</div>}
            {!state.videoCaptionsLoading && state.videoCaptionsError && <div className="text-warning">⚠ {state.videoCaptionsError} (vídeo sobe sem legenda)</div>}
            {!state.videoCaptionsLoading && !state.videoCaptionsSrt && !state.videoCaptionsError && state.videoFile && (
              <button type="button" onClick={creative.generateCaptions}
                className="w-full px-2 py-1.5 rounded bg-primary/10 hover:bg-primary/20 text-[hsl(var(--ads-emerald-2))] font-medium">
                Gerar legenda agora
              </button>
            )}
            <div className="text-[10px] text-[hsl(var(--ads-muted))] leading-snug">85% das pessoas assistem vídeos sem som. Legenda costuma subir CTR em 30–60%.</div>
          </div>
        </div>
      )}
    </div>
  );
}
