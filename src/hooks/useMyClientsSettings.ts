import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { loadLocalGreenSettings } from "@/features/produtos/acompanhamento/greenData";
import type { MyClientsSettings } from "@/lib/myClientsFilter";

/**
 * IDs iGreen + nome do consultor para filtrar "meus clientes" vs carteira da rede.
 *
 * Prioridade dos `cadastroIgreenIds`:
 *   1. Coluna `cadastro_igreen_ids` em `consultant_commission_settings` (override manual).
 *   2. IDs de todos os licenciados da rede sincronizada (`network_members`) — auto,
 *      preenche pra todo consultor assim que a sync roda. Sem isso, `filterMyClients`
 *      cai no fallback frágil por nome do licenciado.
 *   3. LocalStorage (edição manual antiga do painel green).
 *   4. Fallback passado pelo componente.
 */
export function useMyClientsSettings(
  consultantId: string | null | undefined,
  fallback?: Partial<MyClientsSettings>,
) {
  return useQuery({
    queryKey: ["my-clients-settings", consultantId],
    enabled: !!consultantId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<MyClientsSettings> => {
      const id = consultantId!;
      const [{ data: consultant }, { data: greenRow }, { data: netRows }] = await Promise.all([
        supabase.from("consultants").select("igreen_id, name").eq("id", id).maybeSingle(),
        supabase
          .from("consultant_commission_settings" as any)
          .select("cadastro_igreen_ids")
          .eq("consultant_id", id)
          .maybeSingle(),
        supabase
          .from("network_members" as never)
          .select("igreen_id")
          .eq("consultant_id", id)
          .not("igreen_id", "is", null)
          .limit(5000),
      ]);

      const local = loadLocalGreenSettings(id);
      const dbIds = (greenRow as { cadastro_igreen_ids?: string[] } | null)?.cadastro_igreen_ids;
      const netIds = ((netRows ?? []) as Array<{ igreen_id: unknown }>)
        .map((r) => (r.igreen_id != null ? String(r.igreen_id) : ""))
        .filter((v) => v.length > 0);

      const cadastroIgreenIds = dbIds?.length
        ? dbIds.map(String)
        : netIds.length
        ? netIds
        : local?.cadastroIgreenIds?.map(String) ?? fallback?.cadastroIgreenIds ?? [];

      return {
        myIgreenId:
          (consultant?.igreen_id != null ? String(consultant.igreen_id) : null) ||
          fallback?.myIgreenId ||
          null,
        consultantName: consultant?.name ?? fallback?.consultantName ?? null,
        cadastroIgreenIds,
      };
    },
    initialData: fallback?.myIgreenId
      ? {
          myIgreenId: fallback.myIgreenId ?? null,
          consultantName: fallback.consultantName ?? null,
          cadastroIgreenIds: fallback.cadastroIgreenIds ?? [],
        }
      : undefined,
  });
}
