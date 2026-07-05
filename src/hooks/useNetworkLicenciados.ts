import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface NetworkLicenciado {
  igreenId: string;
  name: string;
  clientesAtivos: number;
  nivel: number | null;
}

/**
 * Lista completa de licenciados da rede sincronizada do consultor.
 * Usada pra popular dropdown "Licenciado" (mesmo os que ainda não têm
 * cliente atribuído no CRM local).
 */
export function useNetworkLicenciados(consultantId: string | null | undefined) {
  return useQuery({
    queryKey: ["network-licenciados", consultantId],
    enabled: !!consultantId,
    staleTime: 10 * 60_000,
    gcTime: 60 * 60_000,
    queryFn: async (): Promise<NetworkLicenciado[]> => {
      const { data } = await supabase
        .from("network_members" as never)
        .select("igreen_id, name, clientes_ativos, nivel")
        .eq("consultant_id", consultantId!)
        .not("igreen_id", "is", null)
        .limit(5000);

      const rows = (data ?? []) as Array<{
        igreen_id: unknown;
        name: string | null;
        clientes_ativos: number | null;
        nivel: number | null;
      }>;

      return rows
        .filter((r) => r.igreen_id != null && String(r.igreen_id).length > 0)
        .map((r) => ({
          igreenId: String(r.igreen_id),
          name: (r.name ?? "").trim() || `#${r.igreen_id}`,
          clientesAtivos: Number(r.clientes_ativos ?? 0),
          nivel: r.nivel,
        }))
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    },
  });
}
