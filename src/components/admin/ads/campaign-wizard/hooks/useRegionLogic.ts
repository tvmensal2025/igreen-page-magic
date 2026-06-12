/**
 * useRegionLogic — toda a lógica do Step 1 (região).
 * Extraído sem mudança de comportamento do CreateCampaignWizard legado:
 * cache de presets, carga de cidades, busca, alcance ao vivo e pré-aquecimento.
 */
import { useEffect, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import {
  searchCities, searchCitiesBulk, preflightCampaign,
  type CityHit,
} from "@/services/facebookAds";
import { DISTRIBUIDORAS_PRESETS, type DistribuidoraPreset } from "@/data/distribuidoraPresets";
import type { WizardState } from "./useWizardState";

const PRESET_CACHE_VERSION = "v1";
const presetCacheKey = (id: string) => `ads-preset-cities-${PRESET_CACHE_VERSION}-${id}`;

function readPresetCache(id: string): CityHit[] | null {
  try {
    const raw = localStorage.getItem(presetCacheKey(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.cities) && parsed.cities.length > 0) return parsed.cities as CityHit[];
  } catch { /* ignore */ }
  return null;
}
function writePresetCache(id: string, cities: CityHit[]) {
  try { localStorage.setItem(presetCacheKey(id), JSON.stringify({ ts: Date.now(), cities })); } catch { /* ignore */ }
}

interface Deps {
  open: boolean;
  state: WizardState;
  patch: (p: Partial<WizardState>) => void;
  patchFn: (fn: (prev: WizardState) => Partial<WizardState>) => void;
}

export function useRegionLogic({ open, state, patch, patchFn }: Deps) {
  const { toast } = useToast();

  // Pré-aquece o cache de TODAS as distribuidoras em background.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const targets = DISTRIBUIDORAS_PRESETS.filter((p) => !readPresetCache(p.id));
      if (targets.length === 0) { patch({ warmedCount: DISTRIBUIDORAS_PRESETS.length }); return; }
      patch({ warming: true, warmedCount: DISTRIBUIDORAS_PRESETS.length - targets.length });
      for (const p of targets) {
        if (cancelled) return;
        try {
          const ufPrimary = p.uf.split("/")[0];
          const res = await searchCitiesBulk(p.cidades.map((name) => ({ name, uf: ufPrimary })));
          const clean = (res.cities || []).filter((h) => h?.key);
          if (clean.length > 0) writePresetCache(p.id, clean);
        } catch { /* silencioso */ }
        if (!cancelled) patchFn((prev) => ({ warmedCount: prev.warmedCount + 1 }));
      }
      if (!cancelled) patch({ warming: false });
    })();
    return () => { cancelled = true; };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Alcance ao vivo (debounce 1.5s) no Step 1.
  useEffect(() => {
    if (!open || state.step !== 1 || state.cities.length === 0) { patch({ liveReach: null }); return; }
    const t = setTimeout(async () => {
      patch({ liveReachLoading: true });
      try {
        const r = await preflightCampaign({
          cities: state.cities.map((c) => ({ key: c.key, name: c.name })),
          daily_budget_cents: 3000,
        });
        patch({ liveReach: r.reach ? { lower: r.reach.lower, upper: r.reach.upper } : null });
      } catch { patch({ liveReach: null }); }
      finally { patch({ liveReachLoading: false }); }
    }, 1500);
    return () => clearTimeout(t);
  }, [open, state.step, state.cities]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounce de busca de cidades.
  useEffect(() => {
    if (state.search.trim().length < 2) { patch({ hits: [] }); return; }
    const t = setTimeout(async () => {
      patch({ searchLoading: true });
      try {
        const r = await searchCities(state.search);
        patch({ hits: r.cities });
      } catch (e: any) {
        toast({ title: "Falha na busca", description: e.message, variant: "destructive" });
      } finally { patch({ searchLoading: false }); }
    }, 350);
    return () => clearTimeout(t);
  }, [state.search]); // eslint-disable-line react-hooks/exhaustive-deps

  const addCity = useCallback((c: CityHit) => {
    patchFn((prev) => {
      if (prev.cities.find((x) => x.key === c.key)) return {};
      if (prev.cities.length >= 200) { toast({ title: "Máximo de 200 cidades (limite Facebook)" }); return {}; }
      return {
        cities: [...prev.cities, c],
        cityOrigin: { ...prev.cityOrigin, [c.key]: "manual" },
        search: "", hits: [],
      };
    });
  }, [patchFn, toast]);

  const removeCityKey = useCallback((key: string) => {
    patchFn((prev) => {
      const cities = prev.cities.filter((x) => x.key !== key);
      const cityOrigin = { ...prev.cityOrigin }; const origin = cityOrigin[key]; delete cityOrigin[key];
      const selectedPresetIds = new Set(prev.selectedPresetIds);
      if (origin && origin !== "manual" && !cities.some((c) => cityOrigin[c.key] === origin)) selectedPresetIds.delete(origin);
      return { cities, cityOrigin, selectedPresetIds };
    });
  }, [patchFn]);

  const loadPresetCities = useCallback(async (p: DistribuidoraPreset, opts?: { silent?: boolean; budgetLeft?: number }): Promise<number> => {
    const ufPrimary = p.uf.split("/")[0];
    const cap = opts?.budgetLeft ?? (200 - state.cities.length);
    if (cap <= 0) return 0;
    try {
      let hits = readPresetCache(p.id);
      let unresolved: { name: string; uf: string; reason: string }[] = [];
      if (!hits) {
        const res = await searchCitiesBulk(p.cidades.map((name) => ({ name, uf: ufPrimary })));
        hits = res.cities; unresolved = res.unresolved;
        const clean = (hits || []).filter((h) => h?.key);
        if (clean.length > 0) writePresetCache(p.id, clean);
      }
      let added = 0;
      patchFn((prev) => {
        const seen = new Set(prev.cities.map((c) => c.key));
        const newCities: CityHit[] = []; const newOrigins: Record<string, string> = {};
        for (const h of hits!) {
          if (!h?.key || seen.has(h.key)) continue;
          if (newCities.length >= cap) break;
          newCities.push(h); newOrigins[h.key] = p.id; seen.add(h.key);
        }
        added = newCities.length;
        const selectedPresetIds = new Set(prev.selectedPresetIds); selectedPresetIds.add(p.id);
        return {
          cities: [...prev.cities, ...newCities],
          cityOrigin: { ...prev.cityOrigin, ...newOrigins },
          selectedPresetIds,
        };
      });
      if (!opts?.silent) toast({ title: `${p.nome} carregada`, description: `${added} cidades adicionadas (de ${p.cidades.length}). Bônus: ${p.bonusLabel}.` });
      if (unresolved.length > 0) {
        const nomes = unresolved.slice(0, 5).map((u) => u.name).join(", ");
        toast({ title: `${unresolved.length} cidade(s) não encontradas no Meta`, description: `${nomes}${unresolved.length > 5 ? ` (+${unresolved.length - 5})` : ""}. Foram ignoradas pra evitar tráfego errado.` });
      }
      return added;
    } catch (e: any) {
      if (!opts?.silent) toast({ title: `Falha em ${p.nome}`, description: e?.message || "Tente novamente", variant: "destructive" });
      return 0;
    }
  }, [state.cities.length, patchFn, toast]);

  const togglePreset = useCallback(async (p: DistribuidoraPreset) => {
    if (state.selectedPresetIds.has(p.id)) {
      patchFn((prev) => {
        const cities = prev.cities.filter((c) => prev.cityOrigin[c.key] !== p.id);
        const cityOrigin: Record<string, string> = {};
        for (const k of Object.keys(prev.cityOrigin)) if (prev.cityOrigin[k] !== p.id) cityOrigin[k] = prev.cityOrigin[k];
        const selectedPresetIds = new Set(prev.selectedPresetIds); selectedPresetIds.delete(p.id);
        return { cities, cityOrigin, selectedPresetIds };
      });
      return;
    }
    patch({ presetLoading: true, presetLoadingId: p.id });
    try { await loadPresetCities(p); } finally { patch({ presetLoading: false, presetLoadingId: null }); }
  }, [state.selectedPresetIds, patch, patchFn, loadPresetCities]);

  const clearAllCities = useCallback(() => {
    patch({ cities: [], cityOrigin: {}, selectedPresetIds: new Set(), cityFilter: "" });
  }, [patch]);

  return { addCity, removeCityKey, togglePreset, loadPresetCities, clearAllCities };
}
