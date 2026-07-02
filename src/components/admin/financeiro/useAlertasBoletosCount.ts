import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Soma boletos vencendo hoje + já vencidos (em aberto) para exibir como badge
 * na sidebar. Substitui o antigo `useVenceHojeCount`, que só mostrava hoje e
 * deixava vencidos antigos invisíveis.
 */
export function useAlertasBoletosCount(userId: string | undefined, scope: "all" | "self") {
  return useQuery({
    queryKey: ["alertas-boletos-count", scope, userId ?? null],
    enabled: scope === "all" || !!userId,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    queryFn: async (): Promise<number> => {
      const today = new Date().toISOString().slice(0, 10);
      let q = supabase
        .from("v_boletos_carteira" as never)
        .select("id", { count: "exact", head: true })
        .lte("vencimento", today)
        .is("pagamento", null);
      if (scope === "self" && userId) q = q.eq("consultant_id", userId);
      const { count, error } = await q;
      if (error) return 0;
      return count ?? 0;
    },
  });
}
