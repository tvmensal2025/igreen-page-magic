import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { loadLocalGreenSettings } from "@/features/produtos/acompanhamento/greenData";
import type { MyClientsSettings } from "@/lib/myClientsFilter";

/**
 * IDs iGreen + nome do consultor para filtrar "meus clientes" vs carteira da rede.
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
      const [{ data: consultant }, { data: greenRow }] = await Promise.all([
        supabase.from("consultants").select("igreen_id, name").eq("id", id).maybeSingle(),
        supabase
          .from("consultant_commission_settings" as any)
          .select("cadastro_igreen_ids")
          .eq("consultant_id", id)
          .maybeSingle(),
      ]);

      const local = loadLocalGreenSettings(id);
      const dbIds = (greenRow as { cadastro_igreen_ids?: string[] } | null)?.cadastro_igreen_ids;

      return {
        myIgreenId:
          (consultant?.igreen_id != null ? String(consultant.igreen_id) : null) ||
          fallback?.myIgreenId ||
          null,
        consultantName: consultant?.name ?? fallback?.consultantName ?? null,
        cadastroIgreenIds: dbIds?.length
          ? dbIds.map(String)
          : local?.cadastroIgreenIds?.map(String) ?? fallback?.cadastroIgreenIds ?? [],
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
