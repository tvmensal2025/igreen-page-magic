import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Soma de `gp_mes` (green points do mês = base bonificável mensal) de todos
 * os licenciados na rede/downline do consultor. Usada como proxy do
 * faturamento mensal da rede para calcular a comissão de 1% (indireto).
 */
export function useNetworkGpMes(consultantId: string | null | undefined) {
  return useQuery({
    queryKey: ["network-gp-mes", consultantId],
    enabled: !!consultantId,
    staleTime: 10 * 60_000,
    gcTime: 60 * 60_000,
    queryFn: async (): Promise<number> => {
      const { data } = await supabase
        .from("network_members" as never)
        .select("gp_mes")
        .eq("consultant_id", consultantId!)
        .limit(10000);

      const rows = (data ?? []) as Array<{ gp_mes: number | string | null }>;
      let total = 0;
      for (const r of rows) {
        const v = Number(r.gp_mes);
        if (Number.isFinite(v)) total += v;
      }
      return total;
    },
  });
}
