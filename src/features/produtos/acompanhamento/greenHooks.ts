// =============================================================================
// Acompanhamento — Hooks da comissão Green (React Query)
// =============================================================================

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchGreenSettings,
  fetchEntradaRules,
  fetchValidatedCustomers,
  saveCountMode,
  saveGreenProfile,
  upsertEntradaRule,
  deleteEntradaRule,
  seedOfficialEntradaRules,
  type UpsertEntradaRuleInput,
} from "./greenData";
import type { CountMode } from "./greenCommission";

const GREEN_KEY = "green-commission";

export function useGreenSettings(consultantId: string | undefined) {
  return useQuery({
    queryKey: [GREEN_KEY, "settings", consultantId],
    queryFn: () => fetchGreenSettings(consultantId as string),
    enabled: !!consultantId,
  });
}

export function useEntradaRules(consultantId: string | undefined) {
  return useQuery({
    queryKey: [GREEN_KEY, "rules", consultantId],
    queryFn: () => fetchEntradaRules(consultantId as string),
    enabled: !!consultantId,
  });
}

export function useValidatedCustomers(consultantId: string | undefined) {
  return useQuery({
    queryKey: [GREEN_KEY, "customers", consultantId],
    queryFn: () => fetchValidatedCustomers(consultantId as string),
    enabled: !!consultantId,
  });
}

export function useSaveCountMode(consultantId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mode: CountMode) => saveCountMode(consultantId as string, mode),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [GREEN_KEY, "settings", consultantId] });
      qc.invalidateQueries({ queryKey: [GREEN_KEY, "customers", consultantId] });
    },
  });
}

export function useSaveGreenProfile(consultantId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Parameters<typeof saveGreenProfile>[1]) =>
      saveGreenProfile(consultantId as string, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [GREEN_KEY, "settings", consultantId] });
      qc.invalidateQueries({ queryKey: [GREEN_KEY, "customers", consultantId] });
    },
  });
}

export function useUpsertEntradaRule(consultantId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpsertEntradaRuleInput) => upsertEntradaRule(consultantId as string, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: [GREEN_KEY, "rules", consultantId] }),
  });
}

export function useDeleteEntradaRule(consultantId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteEntradaRule(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: [GREEN_KEY, "rules", consultantId] }),
  });
}

export function useSeedOfficialEntradaRules(consultantId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => seedOfficialEntradaRules(consultantId as string),
    onSuccess: () => qc.invalidateQueries({ queryKey: [GREEN_KEY, "rules", consultantId] }),
  });
}

/** Timestamp da última sincronização com o portal iGreen (settings.last_igreen_sync). */
export function useLastIgreenSync() {
  return useQuery({
    queryKey: [GREEN_KEY, "last-sync"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("settings")
        .select("value")
        .eq("key", "last_igreen_sync")
        .maybeSingle();
      if (error) throw error;
      const raw = data?.value;
      return typeof raw === "string" ? raw : null;
    },
    staleTime: 60_000,
  });
}
