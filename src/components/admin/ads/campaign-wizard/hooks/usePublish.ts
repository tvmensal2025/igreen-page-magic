/**
 * usePublish — lógica do Step 5 (preflight + publicar + salvar template).
 * Extraído sem mudança de comportamento do submit() do wizard legado:
 * persiste telefone, faz upload de mídia, monta payload, cria campanha e
 * tenta retry em falha de rede.
 */
import { useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import {
  preflightCampaign, createCampaign, uploadAdPhotos, uploadAdVideo,
  type CreateCampaignBody,
} from "@/services/facebookAds";
import { supabase } from "@/integrations/supabase/client";
import { upsertAdTemplate } from "@/services/adTemplates";
import { isFileValidAny, type AdFile, type AdFormat } from "../wizardHelpers";
import type { WizardState, WizardDerived } from "./useWizardState";

interface Deps {
  consultantId: string;
  consultantPhone: string | null;
  isSuperAdmin: boolean;
  state: WizardState;
  derived: WizardDerived;
  patch: (p: Partial<WizardState>) => void;
  LS_KEY: string;
  onCreated?: () => void;
  onClose: () => void;
}

export function usePublish({ consultantId, consultantPhone, isSuperAdmin, state, derived, patch, LS_KEY, onCreated, onClose }: Deps) {
  const { toast } = useToast();

  const runPreflight = useCallback(async () => {
    patch({ preflightLoading: true, preflight: null });
    try {
      const r = await preflightCampaign({
        cities: state.geoMode === "cities" ? state.cities.map((c) => ({ key: c.key, name: c.name })) : [],
        custom_locations: state.geoMode === "radius"
          ? state.radiusPoints.map((p) => ({ ...p, distance_unit: "kilometer" as const }))
          : undefined,
        daily_budget_cents: Math.round(state.budget * 100),
      });
      patch({ preflight: r });
    } catch (e: any) {
      patch({ preflight: { ok: false, blockers: [e?.message || "Falha no pré-voo"], warnings: [], reach: null } });
    } finally { patch({ preflightLoading: false }); }
  }, [state.geoMode, state.cities, state.radiusPoints, state.budget, patch]);

  function taggedFiles(): { file: AdFile; format: AdFormat }[] {
    return [
      ...state.filesByFormat.square.map((f) => ({ file: f, format: "square" as const })),
      ...state.filesByFormat.vertical.map((f) => ({ file: f, format: "vertical" as const })),
      ...state.filesByFormat.story.map((f) => ({ file: f, format: "story" as const })),
    ].filter((x) => isFileValidAny(x.file));
  }

  const submit = useCallback(async () => {
    if (!consultantPhone) {
      toast({ title: "Telefone do consultor não configurado", description: "Adicione seu WhatsApp na aba Dados antes de publicar.", variant: "destructive" });
      return;
    }
    // Rodízio ligado exige pelo menos 2 participantes para fazer sentido (Req 5.2).
    if (state.rodizioEnabled && state.rodizioPartners.length < 2) {
      toast({ title: "Rodízio incompleto", description: "O rodízio exige pelo menos 2 participantes.", variant: "destructive" });
      return;
    }
    if (state.preflight && !state.preflight.ok) {
      toast({ title: "Pré-voo em revisão", description: "Vou tentar publicar direto pela conta principal.", variant: "destructive" });
    }
    patch({ submitting: true });
    try {
      try {
        await supabase.from("consultant_ad_settings").upsert(
          { consultant_id: consultantId, whatsapp_destination_number: consultantPhone },
          { onConflict: "consultant_id" },
        );
      } catch (e) { console.warn("[wizard] persist phone failed:", e); }

      let videoPayload: { url: string; thumb_url?: string; captions_srt?: string } | undefined;
      if (state.creativeMode === "video") {
        if (state.videoFile) videoPayload = { url: (await uploadAdVideo(consultantId, state.videoFile)).url };
        else if (state.videoUrl) videoPayload = { url: state.videoUrl };
        if (videoPayload && state.videoCaptionsEnabled && state.videoCaptionsSrt) videoPayload.captions_srt = state.videoCaptionsSrt;
      }

      const tagged = state.creativeMode === "photo" ? taggedFiles() : [];
      const photoUrls = tagged.length
        ? await uploadAdPhotos(consultantId, tagged.map((t) => t.file.file), { formats: tagged.map((t) => t.format) })
        : [];
      const photos = state.creativeMode === "photo" ? [
        ...photoUrls.map((url, i) => ({ url, format: tagged[i].format })),
        ...state.pickedLibrary.map((it) => ({ url: it.url, format: it.format as AdFormat })),
      ] : [];

      const names = derived.activePresetNames;
      const campaignName = names.length > 1
        ? `iGreen — ${names.length} distribuidoras`
        : derived.distribuidoraPrimary
          ? `iGreen — ${derived.distribuidoraPrimary}`
          : state.geoMode === "radius" && state.radiusPoints[0]
            ? `iGreen — ${state.radiusPoints[0].address_string.slice(0, 40)}`
            : `iGreen — ${state.cities.map((c) => c.name).slice(0, 3).join(", ")}`;

      const payload: CreateCampaignBody = {
        name: campaignName,
        name_prefix: (state.namePrefix || "").trim() || undefined,
        cities: state.geoMode === "cities" ? state.cities.map((c) => ({ key: c.key, name: c.name })) : [],

        custom_locations: state.geoMode === "radius"
          ? state.radiusPoints.map((p) => ({ ...p, distance_unit: "kilometer" as const }))
          : undefined,
        daily_budget_cents: Math.round(state.budget * 100),
        duration_days: state.duration > 0 ? state.duration : null,
        creative_mode: state.creativeMode,
        photos: state.creativeMode === "photo" ? photos : undefined,
        video: videoPayload,
        headline: state.headline, primary_text: state.primaryText, description: state.description,
        distribuidora: derived.distribuidoraPrimary || undefined,
        placement_mode: state.placementMode,
        placements: state.placementMode === "manual" ? state.placements : undefined,
        initial_message: state.initialMessage.trim() || undefined,
        // Rodízio: envia os participantes na ordem da lista para o servidor
        // criar a pool. Sem o toggle, mantém o comportamento de destino único.
        ...(state.rodizioEnabled
          ? {
              rodizio_enabled: true,
              rodizio_partner_ids: state.rodizioPartners.map((p) => p.id),
            }
          : {}),
      };
      try {
        await createCampaign(payload);
      } catch (err: any) {
        const msg = String(err?.message || "");
        if (/failed to fetch|network|5\d\d/i.test(msg)) {
          await new Promise((r) => setTimeout(r, 1500));
          await createCampaign(payload);
        } else throw err;
      }
      toast({ title: "Campanha criada!", description: "Em revisão pelo Facebook. Em até 30s tentamos ativar." });
      try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
      onCreated?.();
      onClose();
    } catch (e: any) {
      const msg = String(e?.message || "Falha desconhecida");
      const nextSteps: string[] = Array.isArray(e?.next_steps) ? e.next_steps : [];
      const isWaba = msg.includes("WHATSAPP_BUSINESS_REQUIRED") || msg.includes("1487246") || /not linked to your account/i.test(msg);
      toast({
        title: isWaba ? "WhatsApp Business não validado na Meta" : "Falha ao criar campanha",
        description: isWaba
          ? `${msg}\n\nVá em Admin → Dados → WhatsApp dos anúncios Meta e clique em “Validar e corrigir automático”.${nextSteps.length ? `\n\n${nextSteps.join("\n")}` : ""}`
          : msg,
        variant: "destructive",
      });
    } finally { patch({ submitting: false }); }
  }, [consultantPhone, consultantId, state, derived, patch, LS_KEY, onCreated, onClose, toast]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSaveAsTemplate = useCallback(async (meta: { title: string; description: string }) => {
    if (!state.headline.trim() || !state.primaryText.trim()) return toast({ title: "Preencha headline e texto antes", variant: "destructive" });
    const isVideo = state.creativeMode === "video";
    if (isVideo) {
      if (!state.videoFile && !state.videoUrl) return toast({ title: "Adicione o vídeo antes de salvar como template", variant: "destructive" });
    } else {
      if (derived.totalFiles === 0 && state.pickedLibrary.length === 0) return toast({ title: "Adicione ao menos 1 imagem", variant: "destructive" });
    }
    if (!meta.title.trim()) return toast({ title: "Informe um nome para o template", variant: "destructive" });
    patch({ savingTemplate: true });
    try {
      let photos: { url: string; format: AdFormat }[] = [];
      let videoUrl: string | null = null;
      if (isVideo) {
        videoUrl = state.videoFile
          ? (await uploadAdVideo(consultantId, state.videoFile)).url
          : state.videoUrl;
      } else {
        const tagged = taggedFiles();
        const photoUrls = tagged.length
          ? await uploadAdPhotos(consultantId, tagged.map((t) => t.file.file), { formats: tagged.map((t) => t.format) })
          : [];
        photos = [
          ...photoUrls.map((url, i) => ({ url, format: tagged[i].format })),
          ...state.pickedLibrary.map((it) => ({ url: it.url, format: it.format as AdFormat })),
        ];
      }
      await upsertAdTemplate({
        title: meta.title.trim(),
        description: meta.description.trim() || null,
        photos,
        video_url: videoUrl,
        video_thumb_url: null,
        creative_mode: isVideo ? "video" : "photo",
        headline: state.headline, primary_text: state.primaryText, description_text: state.description,
        age_min: 28, age_max: 60,
        suggested_daily_budget_cents: Math.round(state.budget * 100),
        status: isSuperAdmin ? "published" : "draft",
        target_distribuidora_ids: Array.from(state.selectedPresetIds),
        target_cidades: state.cities.map((c) => c.name),
      });
      toast({ title: "Template salvo ✓", description: isSuperAdmin ? "Publicado para todos os consultores." : "Salvo como rascunho pessoal." });
      patch({ saveTplOpen: false });
    } catch (e: any) {
      toast({ title: "Erro ao salvar template", description: e?.message || "Tente novamente", variant: "destructive" });
    } finally { patch({ savingTemplate: false }); }
  }, [state, derived.totalFiles, consultantId, isSuperAdmin, patch, toast]); // eslint-disable-line react-hooks/exhaustive-deps

  return { runPreflight, submit, handleSaveAsTemplate };
}
