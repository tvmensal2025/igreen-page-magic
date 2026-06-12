/**
 * useCreativeLogic — lógica do Step 2 (criativo: fotos e vídeo).
 * Extraído do wizard legado: validação/upload de fotos, recorte, reenquadre
 * com IA, leitura de metadata de vídeo e geração de legenda.
 */
import { useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { uploadAdPhotos, uploadAdVideo } from "@/services/facebookAds";
import { supabase } from "@/integrations/supabase/client";
import {
  FORMAT_SPEC, PER_FORMAT_LIMIT, readImageDimensions, cropToFormat,
  type AdFile,
} from "../wizardHelpers";
import type { WizardState } from "./useWizardState";

interface Deps {
  consultantId: string;
  state: WizardState;
  patch: (p: Partial<WizardState>) => void;
  patchFn: (fn: (prev: WizardState) => Partial<WizardState>) => void;
}

export function useCreativeLogic({ consultantId, state, patch, patchFn }: Deps) {
  const { toast } = useToast();

  const handleFiles = useCallback(async (list: FileList | null) => {
    if (!list || !list.length) return;
    const format = state.format;
    const spec = FORMAT_SPEC[format];
    const current = state.filesByFormat[format];
    const accepted: AdFile[] = [];
    const rejected: string[] = [];
    for (const file of Array.from(list)) {
      if (current.length + accepted.length >= PER_FORMAT_LIMIT) break;
      if (file.size > 8 * 1024 * 1024) { rejected.push(`${file.name}: maior que 8 MB`); continue; }
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { rejected.push(`${file.name}: use JPG, PNG ou WebP`); continue; }
      try {
        const dim = await readImageDimensions(file);
        if (dim.w < spec.w || dim.h < spec.h) {
          rejected.push(`${file.name}: ${dim.w}×${dim.h} é menor que o exigido (${spec.w}×${spec.h})`);
          continue;
        }
        const diff = Math.abs(dim.w / dim.h - spec.ratio) / spec.ratio;
        if (diff > 0.02) rejected.push(`${file.name}: proporção fora — use "Cortar" ou "IA"`);
        accepted.push({ file, url: URL.createObjectURL(file), w: dim.w, h: dim.h });
      } catch { rejected.push(`${file.name}: arquivo inválido`); }
    }
    if (accepted.length) {
      patchFn((prev) => ({
        filesByFormat: { ...prev.filesByFormat, [format]: [...prev.filesByFormat[format], ...accepted].slice(0, PER_FORMAT_LIMIT) },
      }));
    }
    if (rejected.length) toast({ title: `${rejected.length} arquivo(s) com problema`, description: rejected.slice(0, 3).join("\n"), variant: "destructive" });
  }, [state.format, state.filesByFormat, patchFn, toast]);

  const removeFile = useCallback((idx: number) => {
    patchFn((prev) => ({
      filesByFormat: { ...prev.filesByFormat, [prev.format]: prev.filesByFormat[prev.format].filter((_, i) => i !== idx) },
    }));
  }, [patchFn]);

  const handleCrop = useCallback(async (idx: number) => {
    const format = state.format;
    const target = state.filesByFormat[format][idx]; if (!target) return;
    try {
      const cropped = await cropToFormat(target.file, FORMAT_SPEC[format]);
      const dim = await readImageDimensions(cropped);
      patchFn((prev) => ({
        filesByFormat: {
          ...prev.filesByFormat,
          [format]: prev.filesByFormat[format].map((a, i) => i === idx ? { file: cropped, url: URL.createObjectURL(cropped), w: dim.w, h: dim.h } : a),
        },
      }));
      toast({ title: "Imagem recortada", description: `Agora em ${dim.w}×${dim.h}` });
    } catch (e: any) { toast({ title: "Falha no recorte", description: e.message, variant: "destructive" }); }
  }, [state.format, state.filesByFormat, patchFn, toast]);

  const handleAiResize = useCallback(async (idx: number) => {
    const format = state.format;
    const target = state.filesByFormat[format][idx]; if (!target) return;
    patch({ aiResizingIdx: idx });
    try {
      const tempUrls = await uploadAdPhotos(consultantId, [target.file]);
      const { data, error } = await supabase.functions.invoke("ai-resize-image", { body: { url: tempUrls[0], format } });
      if (error) throw error;
      if (!data?.url) throw new Error(data?.detail || "IA não retornou imagem");
      const blob = await (await fetch(data.url)).blob();
      const aiFile = new File([blob], target.file.name.replace(/\.[^.]+$/, "") + `-ai-${format}.jpg`, { type: blob.type || "image/jpeg" });
      const dim = await readImageDimensions(aiFile);
      patchFn((prev) => ({
        filesByFormat: {
          ...prev.filesByFormat,
          [format]: prev.filesByFormat[format].map((a, i) => i === idx ? { file: aiFile, url: URL.createObjectURL(aiFile), w: dim.w, h: dim.h } : a),
        },
      }));
      toast({ title: "Reenquadrada com IA ✨", description: `Agora em ${dim.w}×${dim.h} sem cortar o sujeito.` });
    } catch (e: any) {
      toast({ title: "IA não conseguiu reenquadrar", description: e?.message || "Tente cortar manualmente", variant: "destructive" });
    } finally { patch({ aiResizingIdx: null }); }
  }, [state.format, state.filesByFormat, consultantId, patch, patchFn, toast]);

  const handleVideoPick = useCallback((f: File | null) => {
    if (!f) return;
    if (f.size > 50 * 1024 * 1024) { toast({ title: "Vídeo maior que 50 MB", description: "Comprima o vídeo (ex: HandBrake, CapCut) e tente de novo.", variant: "destructive" }); return; }
    if (!/^video\/(mp4|quicktime|mov)$/.test(f.type)) { toast({ title: "Use MP4 ou MOV", variant: "destructive" }); return; }
    const url = URL.createObjectURL(f);
    const v = document.createElement("video");
    v.preload = "metadata"; v.src = url;
    v.onloadedmetadata = () => {
      const meta = { duration: v.duration, w: v.videoWidth, h: v.videoHeight };
      patch({ videoFile: f, videoUrl: url, videoMeta: meta });
      if (meta.duration < 4) toast({ title: "Vídeo muito curto", description: "Mínimo 4 segundos.", variant: "destructive" });
      else if (meta.w / meta.h > 0.65) toast({ title: "Atenção: vídeo não é vertical", description: "Recomendado 9:16 (1080×1920) p/ Reels.", variant: "destructive" });
    };
  }, [patch, toast]);

  const clearVideo = useCallback(() => {
    patch({ videoFile: null, videoUrl: null, videoMeta: null, videoCaptionsSrt: null, videoCaptionsError: null, videoCaptionsLoading: false });
  }, [patch]);

  const generateCaptions = useCallback(async () => {
    if (!state.videoFile) return;
    patch({ videoCaptionsLoading: true, videoCaptionsError: null });
    try {
      const up = await uploadAdVideo(consultantId, state.videoFile);
      const { data, error } = await supabase.functions.invoke("ad-video-captions", { body: { video_url: up.url } });
      if (error) throw error;
      if ((data as any)?.error) patch({ videoCaptionsError: (data as any).hint || (data as any).error });
      else if ((data as any)?.srt) patch({ videoCaptionsSrt: (data as any).srt });
      else patch({ videoCaptionsError: "Falha desconhecida ao gerar legenda" });
    } catch (e: any) {
      patch({ videoCaptionsError: e?.message || "Erro ao gerar legenda" });
    } finally { patch({ videoCaptionsLoading: false }); }
  }, [state.videoFile, consultantId, patch]);

  return { handleFiles, removeFile, handleCrop, handleAiResize, handleVideoPick, clearVideo, generateCaptions };
}
