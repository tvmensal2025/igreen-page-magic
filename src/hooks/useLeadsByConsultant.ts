import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface LeadsByConsultantRow {
  consultantId: string;
  name: string;
  leads: number;
  spendCents: number;
  cplCents: number | null;
}

function leadSourceValue(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === "string") return raw;
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (typeof o.utm_source === "string") return o.utm_source;
  }
  return null;
}

export function useLeadsByConsultant(
  consultantIds: string[],
  consultantNames: Record<string, string>,
  periodDays: number,
) {
  return useQuery({
    queryKey: ["leads-by-consultant", consultantIds.sort().join(","), periodDays],
    enabled: consultantIds.length > 1,
    queryFn: async (): Promise<LeadsByConsultantRow[]> => {
      const since = new Date();
      since.setDate(since.getDate() - periodDays);
      since.setHours(0, 0, 0, 0);
      const sinceISO = since.toISOString();
      const sinceDate = sinceISO.slice(0, 10);

      // Campanhas → mapeia campaign_id de volta pro consultor (gasto vive em facebook_metrics_daily)
      const { data: camps } = await supabase
        .from("facebook_campaigns")
        .select("id, consultant_id")
        .in("consultant_id", consultantIds);
      const campToConsultant = new Map<string, string>();
      for (const c of (camps ?? []) as any[]) campToConsultant.set(c.id, c.consultant_id);
      const campaignIds = Array.from(campToConsultant.keys());

      const [custRes, metricsRes] = await Promise.all([
        supabase
          .from("customers")
          .select("consultant_id, lead_source")
          .in("consultant_id", consultantIds)
          .not("lead_source", "is", null)
          .gte("created_at", sinceISO)
          .limit(20000),
        campaignIds.length
          ? supabase
              .from("facebook_metrics_daily")
              .select("campaign_id, spend_cents")
              .in("campaign_id", campaignIds)
              .gte("date", sinceDate)
          : Promise.resolve({ data: [] as any[] }),
      ]);

      // Leads de anúncio (meta_ads) por consultor
      const leadCount = new Map<string, number>();
      for (const r of (custRes.data ?? []) as any[]) {
        if (leadSourceValue(r.lead_source) !== "meta_ads") continue;
        const id = r.consultant_id as string;
        leadCount.set(id, (leadCount.get(id) ?? 0) + 1);
      }

      // Gasto por consultor (via campanha)
      const spendSum = new Map<string, number>();
      for (const r of ((metricsRes as any).data ?? []) as any[]) {
        const id = campToConsultant.get(r.campaign_id);
        if (!id) continue;
        spendSum.set(id, (spendSum.get(id) ?? 0) + Number(r.spend_cents ?? 0));
      }

      return consultantIds
        .map((id) => {
          const leads = leadCount.get(id) ?? 0;
          const spendCents = spendSum.get(id) ?? 0;
          return {
            consultantId: id,
            name: consultantNames[id] ?? id.slice(0, 6),
            leads,
            spendCents,
            cplCents: leads > 0 ? Math.round(spendCents / leads) : null,
          };
        })
        .sort((a, b) => b.leads - a.leads);
    },
    staleTime: 60_000,
  });
}
