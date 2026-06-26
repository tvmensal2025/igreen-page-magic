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
        const { data, error } = await supabase
          .from("whatsapp_instances_public" as any)
          .select("connected_phone")
          .eq("consultant_id", consultantId)
          .limit(1)
          .maybeSingle();
        // Em páginas públicas o anon pode não ter acesso (RLS/401):
        // tratamos como "sem instância" e seguimos com o telefone do perfil.
        if (error) return null;
        return ((data as any)?.connected_phone as string | null) ?? null;
      } catch {
        return null;
      }
    },
    enabled: !!consultantId,
  });
}
