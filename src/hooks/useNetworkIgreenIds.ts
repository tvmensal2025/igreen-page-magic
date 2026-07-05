import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * IDs iGreen de toda a rede/downline do consultor. Usa como fonte principal
 * a tabela `network_members` (onde a sync-igreen-customers grava hoje).
 * Cai para `consultant_network` (legado) apenas se a nova estiver vazia,
 * pra não quebrar contas antigas.
 */
export function useNetworkIgreenIds(consultantId: string | null | undefined) {
  return useQuery({
    queryKey: ["network-igreen-ids", consultantId],
    enabled: !!consultantId,
    staleTime: 10 * 60_000,
    gcTime: 60 * 60_000,
    queryFn: async (): Promise<string[]> => {
      const ids = new Set<string>();

      // Fonte principal: network_members (nova tabela do sync worker)
      const { data: nm } = await supabase
        .from("network_members" as never)
        .select("igreen_id")
        .eq("consultant_id", consultantId!)
        .not("igreen_id", "is", null)
        .limit(5000);
      for (const row of (nm ?? []) as Array<{ igreen_id: unknown }>) {
        const v = row.igreen_id;
        if (v != null && String(v).length > 0) ids.add(String(v));
      }

      // Fallback legado — só consulta se a rede nova ainda não estiver populada.
      if (ids.size === 0) {
        const { data: cn } = await supabase
          .from("consultant_network")
          .select("codigo_igreen")
          .eq("consultant_id", consultantId!)
          .not("codigo_igreen", "is", null)
          .limit(5000);
        for (const row of (cn ?? []) as Array<{ codigo_igreen: unknown }>) {
          const v = row.codigo_igreen;
          if (v != null && String(v).length > 0) ids.add(String(v));
        }
      }

      return Array.from(ids);
    },
  });
}
