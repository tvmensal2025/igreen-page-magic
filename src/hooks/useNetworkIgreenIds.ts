import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Retorna todos os igreen_ids da rede (downline) de um consultor, a partir de
 * consultant_network. Deduplicado, como string[]. Vazio quando não há rede.
 */
export function useNetworkIgreenIds(consultantId: string | null | undefined) {
  return useQuery({
    queryKey: ["network-igreen-ids", consultantId],
    enabled: !!consultantId,
    staleTime: 10 * 60_000,
    gcTime: 60 * 60_000,
    queryFn: async (): Promise<string[]> => {
      const pageSize = 1000;
      const ids = new Set<string>();
      let page = 0;
      while (true) {
        const { data, error } = await supabase
          .from("consultant_network")
          .select("igreen_id")
          .eq("consultant_id", consultantId!)
          .not("igreen_id", "is", null)
          .range(page * pageSize, (page + 1) * pageSize - 1);
        if (error) throw error;
        for (const row of data ?? []) {
          const v = (row as { igreen_id: unknown }).igreen_id;
          if (v != null && String(v).length > 0) ids.add(String(v));
        }
        if (!data || data.length < pageSize) break;
        page++;
      }
      return Array.from(ids);
    },
  });
}
