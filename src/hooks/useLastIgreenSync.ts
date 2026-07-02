import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Último sync do iGreen concluído com sucesso.
 * Usado para exibir "Atualizado há X" e alertar quando o dado está defasado.
 */
export function useLastIgreenSync(consultantId?: string | null) {
  return useQuery({
    queryKey: ["last-igreen-sync", consultantId ?? "any"],
    enabled: !!consultantId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("igreen_sync_runs")
        .select("finished_at,status")
        .eq("consultant_id", consultantId!)
        .eq("status", "ok")
        .order("finished_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) return null;
      return data?.finished_at ? new Date(data.finished_at) : null;
    },
  });
}
