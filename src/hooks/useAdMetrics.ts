import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface AdMetricsDailyPoint {
  date: string;
  spend_cents: number;
  leads: number;
  cpl_cents: number | null;
  impressions: number;
  clicks: number;
}

export interface AdMetrics {
  spendCents: number;
  leads: number;
  cplCents: number | null;
  impressions: number;
  clicks: number;
  conversations: number;
  ctr: number | null;
  daily: AdMetricsDailyPoint[];
  hasConnection: boolean;
  hasCampaigns: boolean;
}

/**
 * Extrai o valor textual de customers.lead_source (coluna jsonb que guarda
 * a string "meta_ads"). Cobre os casos: string já parseada, objeto legado
 * { utm_source } e null.
 */
function leadSourceValue(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === "string") return raw;
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (typeof o.utm_source === "string") return o.utm_source;
  }
  return null;
}

export function useAdMetrics(consultantId: string | undefined | null, periodDays: number) {
  return useQuery({
    queryKey: ["ad-metrics-wa", consultantId, periodDays],
    enabled: !!consultantId,
    queryFn: async (): Promise<AdMetrics> => {
      const since = new Date();
      since.setDate(since.getDate() - periodDays);
      since.setHours(0, 0, 0, 0);
      const sinceISO = since.toISOString();
      const sinceDate = sinceISO.slice(0, 10);

      // 1) Campanhas do consultor (mapeia spend/impressões/cliques reais)
      const { data: campRows } = await supabase
        .from("facebook_campaigns")
        .select("id")
        .eq("consultant_id", consultantId!);
      const campaignIds = (campRows ?? []).map((c: any) => c.id as string);

      // 2) Métricas reais por dia (facebook_metrics_daily, já reconciliado por
      //    source_campaign_id no sync) — leads vêm DAQUI, não de customers.lead_source,
      //    pra não inflar/desinflar CPL por causa de leads atribuídos a outras campanhas.
      // 3) Conexão Meta ativa
      const [metricsRes, fbRes] = await Promise.all([
        campaignIds.length
          ? supabase
              .from("facebook_metrics_daily")
              .select("date, spend_cents, impressions, clicks, leads, messaging_conversations_started")
              .in("campaign_id", campaignIds)
              .gte("date", sinceDate)
              .order("date", { ascending: true })
          : Promise.resolve({ data: [] as any[] }),
        supabase
          .from("facebook_connections")
          .select("id")
          .eq("consultant_id", consultantId!)
          .maybeSingle(),
      ]);

      const metricRows = (metricsRes as any).data ?? [];

      // Agrega métricas por dia (spend/impressões/cliques/leads vêm de facebook_metrics_daily)
      const metricsByDay = new Map<string, { spend: number; impressions: number; clicks: number; leads: number }>();
      for (const r of metricRows as any[]) {
        const d = String(r.date).slice(0, 10);
        const cur = metricsByDay.get(d) ?? { spend: 0, impressions: 0, clicks: 0, leads: 0 };
        cur.spend += Number(r.spend_cents ?? 0);
        cur.impressions += Number(r.impressions ?? 0);
        cur.clicks += Number(r.clicks ?? 0);
        cur.leads += Number(r.leads ?? 0);
        metricsByDay.set(d, cur);
      }

      // Range de dias (since → hoje)
      const days: string[] = [];
      const cursor = new Date(since);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      while (cursor <= today) {
        days.push(cursor.toISOString().slice(0, 10));
        cursor.setDate(cursor.getDate() + 1);
      }

      const daily: AdMetricsDailyPoint[] = days.map((d) => {
        const m = metricsByDay.get(d);
        const spend_cents = m?.spend ?? 0;
        const leads = m?.leads ?? 0;
        return {
          date: d,
          spend_cents,
          leads,
          cpl_cents: leads > 0 ? Math.round(spend_cents / leads) : null,
          impressions: m?.impressions ?? 0,
          clicks: m?.clicks ?? 0,
        };
      });

      const spendCents = daily.reduce((s, r) => s + r.spend_cents, 0);
      const leads = daily.reduce((s, r) => s + r.leads, 0);
      const impressions = daily.reduce((s, r) => s + r.impressions, 0);
      const clicks = daily.reduce((s, r) => s + r.clicks, 0);
      const conversations = (metricRows as any[]).reduce(
        (s, r) => s + Number(r.messaging_conversations_started ?? 0),
        0,
      );

      return {
        spendCents,
        leads,
        cplCents: leads > 0 ? Math.round(spendCents / leads) : null,
        impressions,
        clicks,
        conversations,
        ctr: impressions > 0 ? clicks / impressions : null,
        daily,
        hasConnection: !!fbRes.data,
        hasCampaigns: campaignIds.length > 0,
      };
    },
    staleTime: 60_000,
  });
}
