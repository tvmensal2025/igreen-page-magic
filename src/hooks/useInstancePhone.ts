import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Busca o telefone conectado na instância WhatsApp do consultor.
 * Retorna o connected_phone ou null se não houver instância/telefone.
 */
export function useInstancePhone(consultantId: string | undefined) {
  return useQuery({
    queryKey: ["instance-phone", consultantId],
    queryFn: async () => {
      if (!consultantId) return null;
      try {
        // RPC individual (sem listagem em massa): devolve só o telefone
        // conectado deste consultor.
        const { data, error } = await supabase.rpc(
          "get_public_instance_phone" as any,
          { _consultant_id: consultantId },
        );
        // Em páginas públicas o anon pode não ter acesso (RLS/401):
        // tratamos como "sem instância" e seguimos com o telefone do perfil.
        if (error) return null;
        return ((data as unknown as string | null) ?? null) || null;
      } catch {
        return null;
      }
    },
    enabled: !!consultantId,
  });
}
