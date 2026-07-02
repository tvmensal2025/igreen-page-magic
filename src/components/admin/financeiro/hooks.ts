// Hooks React Query para a aba Financeiro (visão admin de boletos da rede).
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { BoletoRow } from "@/features/produtos/carteira-green/hooks";

export type BoletoAdminRow = BoletoRow & { consultant_name?: string | null };

/**
 * Busca boletos de todos os consultores (visão admin) ou apenas do próprio
 * consultor, quando `scope="self"`. Enriquece com o nome do consultor via
 * segunda query (join manual, já que a view não expõe).
 */
export function useBoletosAdmin(params: { userId?: string; scope: "all" | "self" }) {
  const { userId, scope } = params;
  return useQuery({
    queryKey: ["financeiro-boletos", scope, userId ?? null],
    enabled: scope === "all" || !!userId,
    staleTime: 60_000,
    queryFn: async (): Promise<BoletoAdminRow[]> => {
      let q = supabase
        .from("v_boletos_carteira" as never)
        .select("*")
        .order("vencimento", { ascending: false })
        .limit(5000);
      if (scope === "self" && userId) q = q.eq("consultant_id", userId);
      const { data, error } = await q;
      if (error) throw error;
      const rows = ((data || []) as unknown) as BoletoAdminRow[];

      // Enriquecer com nome do consultor
      const ids = Array.from(new Set(rows.map((r) => r.consultant_id).filter(Boolean)));
      if (ids.length === 0) return rows;
      const { data: consultants } = await supabase
        .from("consultants")
        .select("id, full_name, name")
        .in("id", ids as string[]);
      const nameById = new Map<string, string>();
      for (const c of (consultants || []) as Array<{ id: string; full_name?: string | null; name?: string | null }>) {
        nameById.set(c.id, c.full_name || c.name || "");
      }
      for (const r of rows) {
        r.consultant_name = nameById.get(r.consultant_id) || null;
      }
      return rows;
    },
  });
}
