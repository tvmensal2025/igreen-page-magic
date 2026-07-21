import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface AdMetricsDailyPoint {
  date: string;
  spend_cents: number;
  /** Só lead actions da Meta (formulário). CTWA normalmente = 0. */
  meta_leads: number;
  /** Conversas iniciadas reportadas pela Meta (CTWA). */
  conversations: number;
  cpl_conversation_cents: number | null;
  impressions: number;
  clicks: number;
}

export interface AdMetrics {
  spendCents: number;
  /** @deprecated use conversations / metaLeadActions / crmLeads — não misturar */
  leads: number;
  metaLeadActions: number;
  conversations: number;
  /**
   * Leads reais no CRM vindos de Meta (união sem duplicar):
   * source_campaign_id das campanhas + match_log + lead_source meta_ads + CTWA/ad id.
   */
  crmLeads: number;
  /** Só source_campaign_id preenchido (subconjunto; pode subcontar). */
  crmLeadsStrict: number;
  /** Custo por lead action Meta (só se metaLeadActions > 0) */
  cplMetaCents: number | null;
  /** Custo por conversa CTWA Meta */
  costPerConversationCents: number | null;
  /** Custo por lead CRM real (união de sinais Meta) */
  cplCrmCents: number | null;
  /** Alias legado: costPerConversationCents (CTWA) */
  cplCents: number | null;
  impressions: number;
  clicks: number;
  ctr: number | null;
  daily: AdMetricsDailyPoint[];
  hasConnection: boolean;
  hasCampaigns: boolean;
  periodSince: string;
  periodUntil: string;
}

/** YYYY-MM-DD no fuso America/Sao_Paulo (evita shift UTC do toISOString). */
function ymdSaoPaulo(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function addDaysYmd(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

/**
 * Conta leads CRM 100% reais atribuídos a Meta no período.
 * Só sinais fortes (sem fallback de rodízio / pool ativo).
 * Uniao sem duplicar: source_campaign_id ∪ lead_source meta_ads ∪ CTWA/ad id.
 */
async function countRealMetaCrmLeads(
  consultantId: string,
  campaignIds: string[],
  sinceISO: string,
): Promise<{ total: number; strict: number }> {
  const ids = new Set<string>();

  const [byCampaign, byMetaFlag, byCtwa] = await Promise.all([
    campaignIds.length
      ? supabase
          .from("customers")
          .select("id")
          .eq("consultant_id", consultantId)
          .in("source_campaign_id", campaignIds)
          .gte("created_at", sinceISO)
      : Promise.resolve({ data: [] as { id: string }[] }),
    // lead_source é jsonb (string "meta_ads") — filtra no client pra não perder match
    supabase
      .from("customers")
      .select("id, lead_source")
      .eq("consultant_id", consultantId)
      .not("lead_source", "is", null)
      .gte("created_at", sinceISO),
    supabase
      .from("customers")
      .select("id")
      .eq("consultant_id", consultantId)
      .gte("created_at", sinceISO)
      .or("ctwa_clid.not.is.null,source_ctwa_clid.not.is.null,source_ad_id.not.is.null"),
  ]);

  for (const r of (byCampaign.data || []) as { id: string }[]) ids.add(r.id);
  const strict = ids.size;

  for (const r of (byMetaFlag.data || []) as { id: string; lead_source?: unknown }[]) {
    const ls = r.lead_source;
    const asText = typeof ls === "string" ? ls : JSON.stringify(ls ?? "");
    if (asText.includes("meta_ads")) ids.add(r.id);
  }
  for (const r of (byCtwa.data || []) as { id: string }[]) ids.add(r.id);

  return { total: ids.size, strict };
}

export function useAdMetrics(consultantId: string | undefined | null, periodDays: number) {
  return useQuery({
    queryKey: ["ad-metrics-wa", consultantId, periodDays],
    enabled: !!consultantId,
    queryFn: async (): Promise<AdMetrics> => {
      const until = ymdSaoPaulo();
      const sinceDate = addDaysYmd(until, -(Math.max(1, periodDays) - 1));
      // Início do dia SP ≈ 03:00 UTC no horário de Brasília
      const sinceISO = `${sinceDate}T03:00:00.000Z`;

      const { data: campRows } = await supabase
        .from("facebook_campaigns")
        .select("id")
        .eq("consultant_id", consultantId!);
      const campaignIds = (campRows ?? []).map((c: { id: string }) => c.id);

      const [metricsRes, fbRes, crmCounts] = await Promise.all([
        campaignIds.length
          ? supabase
              .from("facebook_metrics_daily")
              .select(
                "date, spend_cents, impressions, clicks, meta_lead_actions, messaging_conversations_started",
              )
              .in("campaign_id", campaignIds)
              .gte("date", sinceDate)
              .lte("date", until)
              .order("date", { ascending: true })
          : Promise.resolve({ data: [] as Record<string, unknown>[] }),
        supabase
          .from("facebook_connections")
          .select("id")
          .eq("consultant_id", consultantId!)
          .maybeSingle(),
        countRealMetaCrmLeads(consultantId!, campaignIds, sinceISO),
      ]);

      const metricRows = ((metricsRes as { data?: Record<string, unknown>[] }).data ?? []) as Array<{
        date: string;
        spend_cents?: number;
        impressions?: number;
        clicks?: number;
        meta_lead_actions?: number;
        messaging_conversations_started?: number;
      }>;

      type DayAgg = {
        spend: number;
        impressions: number;
        clicks: number;
        metaLeads: number;
        conv: number;
      };
      const metricsByDay = new Map<string, DayAgg>();
      for (const r of metricRows) {
        const d = String(r.date).slice(0, 10);
        const cur = metricsByDay.get(d) ?? {
          spend: 0,
          impressions: 0,
          clicks: 0,
          metaLeads: 0,
          conv: 0,
        };
        cur.spend += Number(r.spend_cents ?? 0);
        cur.impressions += Number(r.impressions ?? 0);
        cur.clicks += Number(r.clicks ?? 0);
        cur.metaLeads += Number(r.meta_lead_actions ?? 0);
        cur.conv += Number(r.messaging_conversations_started ?? 0);
        metricsByDay.set(d, cur);
      }

      const days: string[] = [];
      let cursor = sinceDate;
      while (cursor <= until) {
        days.push(cursor);
        cursor = addDaysYmd(cursor, 1);
      }

      const daily: AdMetricsDailyPoint[] = days.map((d) => {
        const m = metricsByDay.get(d);
        const spend_cents = m?.spend ?? 0;
        const conversations = m?.conv ?? 0;
        const meta_leads = m?.metaLeads ?? 0;
        return {
          date: d,
          spend_cents,
          meta_leads,
          conversations,
          cpl_conversation_cents:
            conversations > 0 ? Math.round(spend_cents / conversations) : null,
          impressions: m?.impressions ?? 0,
          clicks: m?.clicks ?? 0,
        };
      });

      const spendCents = daily.reduce((s, r) => s + r.spend_cents, 0);
      const metaLeadActions = daily.reduce((s, r) => s + r.meta_leads, 0);
      const conversations = daily.reduce((s, r) => s + r.conversations, 0);
      const impressions = daily.reduce((s, r) => s + r.impressions, 0);
      const clicks = daily.reduce((s, r) => s + r.clicks, 0);
      const crmLeads = crmCounts.total;
      const crmLeadsStrict = crmCounts.strict;

      const costPerConversationCents =
        conversations > 0 ? Math.round(spendCents / conversations) : null;
      const cplMetaCents =
        metaLeadActions > 0 ? Math.round(spendCents / metaLeadActions) : null;
      const cplCrmCents = crmLeads > 0 ? Math.round(spendCents / crmLeads) : null;

      return {
        spendCents,
        leads: conversations,
        metaLeadActions,
        conversations,
        crmLeads,
        crmLeadsStrict,
        cplMetaCents,
        costPerConversationCents,
        cplCrmCents,
        cplCents: costPerConversationCents,
        impressions,
        clicks,
        ctr: impressions > 0 ? clicks / impressions : null,
        daily,
        hasConnection: !!(fbRes as { data?: unknown }).data || campaignIds.length > 0,
        hasCampaigns: campaignIds.length > 0,
        periodSince: sinceDate,
        periodUntil: until,
      };
    },
    staleTime: 60_000,
  });
}
