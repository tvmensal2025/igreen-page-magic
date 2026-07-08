import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface NetworkAggregates {
  /** Soma de gp_mes (green points do mês). Proxy antigo. */
  gpMes: number;
  /** Soma de clientes_ativos de TODA a rede/downline (todos os níveis). */
  clientesAtivos: number;
  /** Quantidade de licenciados na rede (nivel > 0). */
  licenciadosCount: number;
}

/**
 * Agrega dados da rede/downline do consultor (todos os níveis abaixo).
 * Usado como base para estimar a comissão recorrente indireta.
 *
 * Como somamos por (consultant_id, igreen_account_id) sem duplicar
 * membros que aparecem em mais de uma subconta configurada, o total
 * escala conforme o admin adiciona mais consultores em "Configuração
 * de contas iGreen" — Rafael + Sirlene + Nilma + N.
 */
export function useNetworkAggregates(consultantId: string | null | undefined) {
  return useQuery({
    queryKey: ["network-aggregates", consultantId],
    enabled: !!consultantId,
    staleTime: 10 * 60_000,
    gcTime: 60 * 60_000,
    queryFn: async (): Promise<NetworkAggregates> => {
      const { data } = await supabase
        .from("network_members" as never)
        .select("gp_mes, clientes_ativos, nivel")
        .eq("consultant_id", consultantId!)
        .limit(20000);

      const rows = (data ?? []) as Array<{
        gp_mes: number | string | null;
        clientes_ativos: number | string | null;
        nivel: number | null;
      }>;

      let gpMes = 0;
      let clientesAtivos = 0;
      let licenciadosCount = 0;
      for (const r of rows) {
        const gp = Number(r.gp_mes);
        if (Number.isFinite(gp)) gpMes += gp;
        const ca = Number(r.clientes_ativos);
        if (Number.isFinite(ca)) clientesAtivos += ca;
        if ((r.nivel ?? 0) > 0) licenciadosCount += 1;
      }
      return { gpMes, clientesAtivos, licenciadosCount };
    },
  });
}

/**
 * @deprecated Use `useNetworkAggregates` — retorna também clientes_ativos.
 * Mantido só por compatibilidade; devolve apenas `gp_mes`.
 */
export function useNetworkGpMes(consultantId: string | null | undefined) {
  const q = useNetworkAggregates(consultantId);
  return { ...q, data: q.data?.gpMes ?? 0 };
}
