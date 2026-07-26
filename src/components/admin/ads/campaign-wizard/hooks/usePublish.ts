/**
 * usePublish — lógica do Step 5 (preflight + publicar + salvar template).
 * Extraído sem mudança de comportamento do submit() do wizard legado:
 * persiste telefone, faz upload de mídia, monta payload, cria campanha e
 * tenta retry em falha de rede.
 */
import { useCallback, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import {
  preflightCampaign, createCampaign, uploadAdPhotos, uploadAdVideo,
  type CreateCampaignBody,
} from "@/services/facebookAds";
import { supabase } from "@/integrations/supabase/client";
import { upsertAdTemplate } from "@/services/adTemplates";
import { isFileValidAny, type AdFile, type AdFormat } from "../wizardHelpers";
import { dddsFromCampaignGeo } from "@/lib/cityToDdd";
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
  const submitLockRef = useRef(false);

  const runPreflight = useCallback(async () => {
    patch({ preflightLoading: true, preflight: null });
    try {
      const result = await preflightCampaign({
        cities: state.geoMode === "cities" ? state.cities.map((c) => ({ key: c.key, name: c.name })) : [],
        custom_locations: state.geoMode === "radius"
          ? state.radiusPoints.map((p) => ({ ...p, distance_unit: "kilometer" as const }))
          : undefined,
        daily_budget_cents: Math.round(state.budget * 100),
        duration_days: state.duration > 0 ? state.duration : null,
      });
      patch({ preflight: result });
      return result;
    } catch (e: any) {
      const result = { ok: false, blockers: [e?.message || "Falha no pré-voo"], warnings: [], reach: null };
      patch({ preflight: result });
      return result;
    } finally {
      patch({ preflightLoading: false });
    }
  }, [state.geoMode, state.cities, state.radiusPoints, state.budget, state.duration, patch]);

  function taggedFiles(): { file: AdFile; format: AdFormat }[] {
    return [
      ...state.filesByFormat.square.map((f) => ({ file: f, format: "square" as const })),
      ...state.filesByFormat.vertical.map((f) => ({ file: f, format: "vertical" as const })),
      ...state.filesByFormat.story.map((f) => ({ file: f, format: "story" as const })),
    ].filter((x) => isFileValidAny(x.file));
  }

  const submit = useCallback(async () => {
    if (submitLockRef.current) return;
    if (!consultantPhone) {
      toast({ title: "Telefone do consultor não configurado", description: "Adicione seu WhatsApp na aba Dados antes de publicar.", variant: "destructive" });
      return;
    }
    // Destino exclusivo / rodízio ligado exige pelo menos 1 participante.
    if (state.rodizioEnabled && state.rodizioPartners.length < 1) {
      toast({
        title: "Participante faltando",
        description: "Adicione pelo menos 1 pessoa (você ou um consultor/parceiro) para receber os leads e as métricas.",
        variant: "destructive",
      });
      return;
    }
    submitLockRef.current = true;
    patch({ submitting: true });
    // Revalida no clique para orçamento, duração e localização nunca usarem um pré-voo antigo.
    const currentPreflight = await runPreflight();
    if (!currentPreflight.ok) {
      submitLockRef.current = false;
      patch({ submitting: false });
      toast({
        title: "Corrija os bloqueios do pré-voo",
        description: currentPreflight.blockers.join(" • ") || "A campanha não pode ser publicada com a configuração atual.",
        variant: "destructive",
      });
      return;
    }
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

      const remarketingPrefix = state.isRemarketing
        ? ((state.namePrefix || "").trim() || "remarketing")
        : (state.namePrefix || "").trim() || undefined;
      const retargetDdds = state.isRemarketing
        ? dddsFromCampaignGeo({
            cities: state.geoMode === "cities" ? state.cities : [],
            addresses:
              state.geoMode === "radius"
                ? state.radiusPoints.map((p) => p.address_string || "")
                : [],
          })
        : [];

      const payload: CreateCampaignBody = {
        name: campaignName,
        name_prefix: remarketingPrefix,
        is_remarketing: state.isRemarketing || undefined,
        retarget_ddds: retargetDdds.length ? retargetDdds : undefined,
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
        // Preferência 30–60: Advantage+ exige age_min≤25 e age_max=65 no hard;
        // o servidor aplica os caps (25/65) e mantém a preferência em telemetria.
        age_min: 30,
        age_max: 60,
        // Rodízio: envia os participantes na ordem da lista para o servidor
        // criar a pool. Sem o toggle, mantém o comportamento de destino único.
        ...(state.rodizioEnabled
          ? {
              rodizio_enabled: true,
              rodizio_partner_ids: state.rodizioPartners.map((p) => p.id),
            }
          : {}),
      };
      const result = await createCampaign(payload);
      const activated = result.local_status === "active" && result.effective_status === "ACTIVE";
      const rodizioConfigured = result.rodizio_configured === true;
      const rodizioWarning = typeof result.rodizio_warning === "string" ? result.rodizio_warning : null;
      const wantedRodizio = state.rodizioEnabled && state.rodizioPartners.length >= 1;

      if (wantedRodizio && !rodizioConfigured) {
        toast({
          title: activated ? "Campanha ativa — rodízio pendente" : "Campanha enviada — rodízio pendente",
          description: rodizioWarning
            ? `A Meta recebeu a campanha, mas o rodízio não ligou: ${rodizioWarning}. Edite a campanha e configure de novo.`
            : "A campanha foi criada, mas a pool de rodízio não foi configurada. Edite a campanha para ligar os participantes.",
          variant: "destructive",
        });
      } else if (wantedRodizio && rodizioWarning) {
        toast({
          title: activated ? "Campanha ativa ✅" : "Campanha enviada à Meta",
          description: `Rodízio ativo com aviso: ${rodizioWarning}`,
        });
      } else {
        toast({
          title: activated ? "Campanha ativa ✅" : "Campanha enviada à Meta",
          description: activated
            ? wantedRodizio
              ? "Rodízio e dados da campanha foram salvos. A Meta confirmou a campanha como ativa."
              : state.isRemarketing
                ? "Remarketing ativo: público da região montado automaticamente. A Meta confirmou a campanha como ativa."
                : "A Meta confirmou a campanha como ativa. A entrega pode levar alguns minutos para começar."
            : state.isRemarketing
              ? "Campanha em análise. Público de remarketing da região já foi mesclado na Audience."
              : "A campanha foi criada e está em análise ou processamento na Meta. O painel mostrará quando ela ficar ativa.",
        });
      }
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
    } finally {
      submitLockRef.current = false;
      patch({ submitting: false });
    }
  }, [consultantPhone, consultantId, state, derived, patch, runPreflight, LS_KEY, onCreated, onClose, toast]); // eslint-disable-line react-hooks/exhaustive-deps

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
        age_min: 30, age_max: 60,
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
