import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface StageBreakdownRow {
  stage: string;
  label: string;
  count: number;
}

const STAGE_LABELS: Record<string, string> = {
  novo_lead: "Novo Lead",
  qualificando: "Em qualificação",
  valor_conta: "Valor da conta",
  conta_enviada: "Conta enviada",
  doc_enviado: "Documento enviado",
  finalizando: "Finalizando cadastro",
  aprovado: "Aprovado",
  reprovado: "Reprovado",
  "30_dias": "30 dias",
  "60_dias": "60 dias",
  "90_dias": "90 dias",
  "120_dias": "120 dias",
};

export function useLeadsByStage(consultantId: string | undefined | null, periodDays: number) {
  return useQuery({
    queryKey: ["leads-by-stage", consultantId, periodDays],
    enabled: !!consultantId,
    queryFn: async (): Promise<StageBreakdownRow[]> => {
      const since = new Date();
      since.setDate(since.getDate() - periodDays);
      since.setHours(0, 0, 0, 0);

      const { data } = await supabase
        .from("crm_deals")
        .select("stage")
        .eq("consultant_id", consultantId!)
        .gte("created_at", since.toISOString())
        .limit(10000);

      const map = new Map<string, number>();
      for (const r of data ?? []) {
        const s = ((r as any).stage || "novo_lead") as string;
        map.set(s, (map.get(s) ?? 0) + 1);
      }

      return Array.from(map.entries())
        .map(([stage, count]) => ({
          stage,
          label: STAGE_LABELS[stage] ?? stage,
          count,
        }))
        .sort((a, b) => b.count - a.count);
    },
    staleTime: 60_000,
  });
}
