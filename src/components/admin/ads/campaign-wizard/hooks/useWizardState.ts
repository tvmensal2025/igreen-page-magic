/**
 * useWizardState — hook central do wizard de campanha (Modelo A).
 * Consolida TODOS os estados do wizard monolítico num único objeto + patch.
 * Cada step consome só o que precisa via `state` e altera via `actions`/`patch`.
 */
import { useState, useCallback, useEffect, useMemo } from "react";
import type { CityHit, CopyPackV2, PreflightResult } from "@/services/facebookAds";
import type { RadiusPoint } from "../../AddressRadiusPicker";
import type { QualityResult } from "@/lib/adQualityScore";
import type { AdImageLibraryItem } from "@/services/adImageLibrary";
import { DISTRIBUIDORAS_PRESETS } from "@/data/distribuidoraPresets";
import {
  EMPTY_FILES, ALL_PLACEMENTS, buildDefaultInitialMessage,
  type AdFormat, type FilesByFormat,
} from "../wizardHelpers";

export type WizardStep = 1 | 2 | 3 | 4 | 5;
export type CreativeMode = "photo" | "video";
export type GeoMode = "cities" | "radius";
export type PlacementMode = "auto" | "manual";

/** Participante já adicionado à lista ordenada do rodízio. */
export interface RodizioPartnerDraft {
  id: string; // referral_partners.id (existente ou recém-criado)
  nome: string;
  tipo: "consultor" | "parceiro";
  partner_igreen_id: string | null;
  cli: string | null;
  notification_phone: string | null;
}

/** Form inline aberto para criar um novo participante (2 tipos). */
export interface RodizioInlineForm {
  tipo: "consultor" | "parceiro";
  nome: string;
  notification_phone: string;
  partner_igreen_id: string; // obrigatório quando tipo=consultor
  cli: string; // obrigatório quando tipo=parceiro
}

export interface WizardState {
  // Global / navegação
  step: WizardStep;
  direction: number; // +1 avançar, -1 voltar (anima slide)
  submitting: boolean;
  issues: string[] | null;
  ctwaReady: boolean;

  // Step 1: Region
  geoMode: GeoMode;
  search: string;
  searchLoading: boolean;
  hits: CityHit[];
  cities: CityHit[];
  selectedPresetIds: Set<string>;
  cityOrigin: Record<string, string>;
  presetLoading: boolean;
  presetLoadingId: string | null;
  cityFilter: string;
  liveReach: { lower: number; upper: number } | null;
  liveReachLoading: boolean;
  radiusPoints: RadiusPoint[];
  warmedCount: number;
  warming: boolean;

  // Step 2: Creative
  creativeMode: CreativeMode;
  format: AdFormat;
  filesByFormat: FilesByFormat;
  pickedLibrary: AdImageLibraryItem[];
  photoTab: "upload" | "library";
  aiResizingIdx: number | null;
  videoFile: File | null;
  videoUrl: string | null;
  videoMeta: { duration: number; w: number; h: number } | null;
  videoCaptionsSrt: string | null;
  videoCaptionsLoading: boolean;
  videoCaptionsError: string | null;
  videoCaptionsEnabled: boolean;

  // Step 3: Copy
  copy: CopyPackV2 | null;
  headline: string;
  primaryText: string;
  description: string;
  copyLoading: boolean;
  initialMessage: string;
  initialMessageTouched: boolean;
  initialMsgDuplicate: boolean;
  initialMsgChecking: boolean;
  initialMsgVarying: boolean;

  // Step 4: Budget
  budget: number;
  duration: number;
  placementMode: PlacementMode;
  placements: string[];

  // Step 4: Rodízio de leads (distribuição entre participantes)
  rodizioEnabled: boolean; // toggle; inicial false
  rodizioPartners: RodizioPartnerDraft[]; // lista ORDENADA de participantes
  rodizioPartnersLoading: boolean; // carregando referral_partners do dono
  rodizioInlineForm: RodizioInlineForm | null; // form inline aberto (ou null)

  // Step 5: Review
  quality: QualityResult | null;
  lowScoreConfirm: boolean;
  preflight: PreflightResult | null;
  preflightLoading: boolean;
  saveTplOpen: boolean;
  savingTemplate: boolean;
  // Prefixo livre no nome da campanha (aparece no Meta Ads na frente do padrão).
  namePrefix: string;
}


const INITIAL_STATE: WizardState = {
  step: 1,
  direction: 1,
  submitting: false,
  issues: null,
  ctwaReady: false,
  geoMode: "cities",
  search: "",
  searchLoading: false,
  hits: [],
  cities: [],
  selectedPresetIds: new Set(),
  cityOrigin: {},
  presetLoading: false,
  presetLoadingId: null,
  cityFilter: "",
  liveReach: null,
  liveReachLoading: false,
  radiusPoints: [],
  warmedCount: 0,
  warming: false,
  creativeMode: "photo",
  format: "square",
  filesByFormat: EMPTY_FILES,
  pickedLibrary: [],
  photoTab: "upload",
  aiResizingIdx: null,
  videoFile: null,
  videoUrl: null,
  videoMeta: null,
  videoCaptionsSrt: null,
  videoCaptionsLoading: false,
  videoCaptionsError: null,
  videoCaptionsEnabled: true,
  copy: null,
  headline: "",
  primaryText: "",
  description: "",
  copyLoading: false,
  initialMessage: buildDefaultInitialMessage(null),
  initialMessageTouched: false,
  initialMsgDuplicate: false,
  initialMsgChecking: false,
  initialMsgVarying: false,
  budget: 15,
  duration: 3,
  placementMode: "auto",
  placements: ALL_PLACEMENTS,
  rodizioEnabled: false,
  rodizioPartners: [],
  rodizioPartnersLoading: false,
  rodizioInlineForm: null,
  quality: null,
  lowScoreConfirm: false,
  preflight: null,
  preflightLoading: false,
  saveTplOpen: false,
  savingTemplate: false,
};

export interface WizardDerived {
  totalFiles: number;
  activePresetNames: string[];
  distribuidoraPrimary: string | null;
  distribuidoraJoined: string | null;
  visibleIssues: string[];
}

export function useWizardState(open: boolean, consultantId: string) {
  const [state, setState] = useState<WizardState>(INITIAL_STATE);
  const LS_KEY = `ads-wizard-draft-${consultantId}`;

  // Reset ao abrir; recupera rascunho de cidades/presets do localStorage.
  useEffect(() => {
    if (!open) return;
    let draft: any = null;
    try { draft = JSON.parse(localStorage.getItem(LS_KEY) || "null"); } catch { /* ignore */ }
    setState({
      ...INITIAL_STATE,
      selectedPresetIds: Array.isArray(draft?.selectedPresetIds) ? new Set(draft.selectedPresetIds) : new Set(),
      cities: Array.isArray(draft?.cities) ? draft.cities : [],
      cityOrigin: draft?.cityOrigin && typeof draft.cityOrigin === "object" ? draft.cityOrigin : {},
    });
  }, [open, LS_KEY]);

  // Persiste rascunho (só Step 1 importa).
  useEffect(() => {
    if (!open) return;
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        cities: state.cities,
        selectedPresetIds: Array.from(state.selectedPresetIds),
        cityOrigin: state.cityOrigin,
      }));
    } catch { /* ignore */ }
  }, [open, state.cities, state.selectedPresetIds, state.cityOrigin, LS_KEY]);

  const patch = useCallback((partial: Partial<WizardState>) => {
    setState((prev) => ({ ...prev, ...partial }));
  }, []);

  // Setter funcional (quando o próximo estado depende do anterior).
  const patchFn = useCallback((fn: (prev: WizardState) => Partial<WizardState>) => {
    setState((prev) => ({ ...prev, ...fn(prev) }));
  }, []);

  const derived: WizardDerived = useMemo(() => {
    const activePresetNames = DISTRIBUIDORAS_PRESETS
      .filter((p) => state.selectedPresetIds.has(p.id))
      .map((p) => p.nome);
    return {
      totalFiles: state.filesByFormat.square.length + state.filesByFormat.vertical.length + state.filesByFormat.story.length,
      activePresetNames,
      distribuidoraPrimary: activePresetNames[0] || null,
      distribuidoraJoined: activePresetNames.join(" + ") || null,
      visibleIssues: (state.issues || []).filter((i) => !i.includes("Pixel")),
    };
  }, [state.selectedPresetIds, state.filesByFormat, state.issues]);

  return { state, patch, patchFn, derived, LS_KEY };
}
