import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isIgreenWalletOrigin } from "@/lib/customerOrigin";
import { filterMyClients, type MyClientsSettings } from "@/lib/myClientsFilter";
import { loadLocalGreenSettings } from "@/features/produtos/acompanhamento/greenData";

export interface DailyViews {
  date: string;
  client: number;
  licenciada: number;
}

export interface HourlyData {
  hour: number;
  views: number;
}

export interface DeviceData {
  device: string;
  count: number;
}

export interface UtmData {
  source: string;
  count: number;
}

export interface CustomerStatusData {
  status: string;
  count: number;
  label: string;
}

export interface TopLicenciado {
  name: string;
  deals: number;
}

export interface WeeklyNewCustomers {
  week: string;
  count: number;
}

const CLICK_LABELS: Record<string, string> = {
  whatsapp: "💬 WhatsApp",
  whatsapp_intermediate: "💬 WhatsApp (CTA)",
  cadastro_cta: "📋 Botão de Cadastro",
  cadastro: "📋 Cadastro",
  cadastro_hero: "🏠 Cadastro (Hero)",
  cadastro_final: "📋 Cadastro (Final)",
  licenciada_cta: "💼 Licenciada (CTA)",
  licenciada: "💼 Licenciada",
  telefone: "📞 Telefone",
  instagram: "📸 Instagram",
  facebook: "📘 Facebook",
};

export function friendlyClickLabel(target: string): string {
  return CLICK_LABELS[target] || target.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function useAnalytics(
  consultantId: string | null,
  periodDays: number = 30,
  teamIds?: string[] | null,
  networkIgreenIds?: string[] | null,
) {
  const idsKey = teamIds && teamIds.length > 1 ? [...teamIds].sort().join(",") : null;
  const netKey = networkIgreenIds && networkIgreenIds.length > 0
    ? `n${networkIgreenIds.length}`
    : null;
  return useQuery({
    queryKey: ["analytics", consultantId, periodDays, idsKey, netKey],
    enabled: !!consultantId,
    refetchOnMount: true,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    placeholderData: keepPreviousData,
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    queryFn: async () => {
      // Refresh de sessão defensivo: se o JWT expirou, RLS devolve 0 linhas sem
      // erro visível — o Dashboard aparece zerado mesmo com dados no banco.
      try {
        const { data: sess } = await supabase.auth.getSession();
        const expMs = (sess?.session?.expires_at ?? 0) * 1000;
        if (!sess?.session || expMs - Date.now() < 60_000) {
          await supabase.auth.refreshSession();
        }
      } catch { /* segue o baile */ }

      const sinceDate = new Date();
      sinceDate.setDate(sinceDate.getDate() - periodDays);
      const since = sinceDate.toISOString();

      const useTeam = !!(teamIds && teamIds.length > 1);
      const applyScope = <T extends { in: any; eq: any }>(q: T): T =>
        useTeam ? q.in("consultant_id", teamIds!) : q.eq("consultant_id", consultantId!);

      // Pagina views/events (PostgREST corta em 1000 sem .range). Teto evita
      // baixar dezenas de milhares de linhas e travar PCs fracos — métricas
      // típicas ficam iguais; contas gigantes já vinham truncadas em 1k.
      const ANALYTICS_PAGE = 1000;
      const ANALYTICS_MAX_ROWS = 10_000;
      const fetchScopedRows = async <T,>(
        build: () => any,
      ): Promise<T[]> => {
        const rows: T[] = [];
        let page = 0;
        while (rows.length < ANALYTICS_MAX_ROWS) {
          const from = page * ANALYTICS_PAGE;
          const to = from + ANALYTICS_PAGE - 1;
          const { data, error } = await applyScope(build()).gte("created_at", since).range(from, to);
          if (error) throw error;
          const batch = (data ?? []) as T[];
          rows.push(...batch);
          if (batch.length < ANALYTICS_PAGE) break;
          page++;
        }
        return rows;
      };

      const [views, events, campsRes] = await Promise.all([
        fetchScopedRows<{ page_type: string; created_at: string; device_type: string | null; utm_source: string | null }>(
          () => supabase.from("page_views").select("page_type, created_at, device_type, utm_source") as any,
        ),
        fetchScopedRows<{
          event_type: string;
          event_target: string | null;
          page_type: string;
          created_at: string;
          device_type: string | null;
          utm_source: string | null;
        }>(
          () =>
            supabase
              .from("page_events")
              .select("event_type, event_target, page_type, created_at, device_type, utm_source") as any,
        ),
        applyScope(
          supabase.from("facebook_campaigns").select("id") as any,
        ),
      ]);

      if (campsRes.error) throw campsRes.error;

      const scopeConsultantId = consultantId!;

      const [{ data: consultantProfile }, { data: greenRow }, partnersRes] = await Promise.all([
        supabase.from("consultants").select("igreen_id, name").eq("id", scopeConsultantId).maybeSingle(),
        supabase
          .from("consultant_commission_settings" as any)
          .select("cadastro_igreen_ids")
          .eq("consultant_id", scopeConsultantId)
          .maybeSingle(),
        applyScope(
          supabase
            .from("referral_partners")
            .select("cli, partner_igreen_id") as any,
        ).eq("is_active", true),
      ]);
      if ((partnersRes as any)?.error) throw (partnersRes as any).error;
      const normalizeIgreenId = (value: unknown): string | null => {
        const digits = String(value ?? "").replace(/\D/g, "");
        return digits.length > 0 ? digits : null;
      };
      const partnerIgreenIds = ((partnersRes as any)?.data ?? [])
        .flatMap((row: any) => [row.cli, row.partner_igreen_id])
        .map(normalizeIgreenId)
        .filter((v: string | null): v is string => !!v);
      const localGreen = loadLocalGreenSettings(scopeConsultantId);
      const dbCadastroIds = (greenRow as { cadastro_igreen_ids?: string[] } | null)?.cadastro_igreen_ids;
      const myClientsSettings: MyClientsSettings = {
        myIgreenId: normalizeIgreenId(consultantProfile?.igreen_id),
        consultantName: consultantProfile?.name ?? null,
        cadastroIgreenIds: dbCadastroIds?.length
          ? dbCadastroIds.map(normalizeIgreenId).filter((v): v is string => !!v)
          : localGreen?.cadastroIgreenIds?.map(normalizeIgreenId).filter((v): v is string => !!v) ?? [],
      };

      // Gasto real de anúncio no período (para CPC blended do painel "Custo por clique")
      const campaignIds = ((campsRes.data ?? []) as any[]).map((c) => c.id as string);
      let adSpendCents = 0;
      if (campaignIds.length) {
        const { data: spendRows } = await supabase
          .from("facebook_metrics_daily")
          .select("spend_cents")
          .in("campaign_id", campaignIds)
          .gte("date", since.slice(0, 10));
        adSpendCents = ((spendRows ?? []) as any[]).reduce((s, r) => s + Number(r.spend_cents ?? 0), 0);
      }

      // Fetch ALL customers with pagination (por consultant_id / equipe)
      const allCustomers: any[] = [];
      let page = 0;
      const pageSize = 1000;
      while (true) {
        const baseQ = supabase
          .from("customers")
          .select("id, name, status, media_consumo, electricity_bill_value, created_at, updated_at, registered_by_name, registered_by_igreen_id, customer_origin, address_state, address_city, distribuidora, phone_whatsapp, consultant_id, data_nascimento");
        const scoped = useTeam
          ? baseQ.in("consultant_id", teamIds!)
          : baseQ.eq("consultant_id", consultantId!);
        const { data, error } = await scoped.range(page * pageSize, (page + 1) * pageSize - 1);
        if (error) throw error;
        if (data) allCustomers.push(...data);
        if (!data || data.length < pageSize) break;
        page++;
      }

      // Também busca clientes da carteira iGreen por registered_by_igreen_id
      // (inclui cadastros feitos por licenciados da rede que não têm consultant_id local)
      const myIgreenIds = Array.from(
        new Set(
          [
            myClientsSettings.myIgreenId,
            ...(myClientsSettings.cadastroIgreenIds || []),
            ...partnerIgreenIds,
            ...((networkIgreenIds ?? []) as (string | null)[]).map(normalizeIgreenId),
          ]
            .filter((v): v is string => !!v && String(v).length > 0)
            .map(String),
        ),
      );
      if (myIgreenIds.length > 0) {
        const seen = new Set(allCustomers.map((c) => c.id));
        // .in(...) do PostgREST pode estourar URL — fatiar em lotes
        const BATCH = 300;
        const batches: string[][] = [];
        for (let i = 0; i < myIgreenIds.length; i += BATCH) {
          batches.push(myIgreenIds.slice(i, i + BATCH));
        }
        for (const batch of batches) {
          let pageL = 0;
          while (true) {
            const { data, error } = await supabase
              .from("customers")
              .select("id, name, status, media_consumo, electricity_bill_value, created_at, updated_at, registered_by_name, registered_by_igreen_id, customer_origin, address_state, address_city, distribuidora, phone_whatsapp, consultant_id, data_nascimento")
              .in("registered_by_igreen_id", batch)
              .in("customer_origin", ["igreen_sync", "igreen_extension"])
              .range(pageL * pageSize, (pageL + 1) * pageSize - 1);
            if (error) throw error;
            if (data) {
              for (const row of data) {
                if (!seen.has(row.id)) {
                  seen.add(row.id);
                  allCustomers.push(row);
                }
              }
            }
            if (!data || data.length < pageSize) break;
            pageL++;
          }
        }
      }

      const totalClient = views.filter((v) => v.page_type === "client").length;
      const totalLicenciada = views.filter((v) => v.page_type === "licenciada").length;

      const totalClicks = events.filter((e) => e.event_type === "click").length;
      const clicksByTarget: Record<string, number> = {};
      const clicksByPage: Record<string, Record<string, number>> = { client: {}, licenciada: {} };
      for (const e of events) {
        if (e.event_type === "click" && e.event_target) {
          clicksByTarget[e.event_target] = (clicksByTarget[e.event_target] || 0) + 1;
          const pg = e.page_type === "licenciada" ? "licenciada" : "client";
          if (!clicksByPage[pg][e.event_target]) clicksByPage[pg][e.event_target] = 0;
          clicksByPage[pg][e.event_target]++;
        }
      }

      const dayMap = new Map<string, { client: number; licenciada: number }>();
      for (let i = periodDays - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        dayMap.set(d.toISOString().split("T")[0], { client: 0, licenciada: 0 });
      }
      for (const row of views) {
        const key = row.created_at.split("T")[0];
        const entry = dayMap.get(key);
        if (entry) {
          if (row.page_type === "client") entry.client++;
          else entry.licenciada++;
        }
      }
      const daily: DailyViews[] = Array.from(dayMap.entries()).map(([date, counts]) => ({ date, ...counts }));

      const hourMap = new Map<number, number>();
      for (let h = 0; h < 24; h++) hourMap.set(h, 0);
      for (const row of views) {
        const h = new Date(row.created_at).getHours();
        hourMap.set(h, (hourMap.get(h) || 0) + 1);
      }
      const hourly: HourlyData[] = Array.from(hourMap.entries()).map(([hour, views]) => ({ hour, views }));

      const deviceMap = new Map<string, number>();
      for (const row of views) {
        const d = row.device_type || "desconhecido";
        deviceMap.set(d, (deviceMap.get(d) || 0) + 1);
      }
      const devices: DeviceData[] = Array.from(deviceMap.entries()).map(([device, count]) => ({ device, count })).sort((a, b) => b.count - a.count);

      const utmMap = new Map<string, number>();
      for (const row of views) {
        const s = row.utm_source || "direto";
        utmMap.set(s, (utmMap.get(s) || 0) + 1);
      }
      const utmSources: UtmData[] = Array.from(utmMap.entries()).map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count);

      // === SPLIT por origem — NUNCA misturar leads de WhatsApp com carteira iGreen ===
      const leadCustomers = allCustomers.filter((c: any) => {
        const o = c.customer_origin || "whatsapp_lead";
        return o === "whatsapp_lead" || o === "manual";
      });
      const walletCustomers = allCustomers.filter((c: any) => isIgreenWalletOrigin(c.customer_origin));
      const myIgreenIdSet = new Set(myIgreenIds);
      const scopedWalletCustomers = useTeam
        ? walletCustomers
        : walletCustomers.filter((c: any) => {
            const igid = c.registered_by_igreen_id != null ? String(c.registered_by_igreen_id) : null;
            if (igid && myIgreenIdSet.has(igid)) return true;
            // fallback: mantém compatibilidade com filtro por nome/consultor local
            return filterMyClients([c], myClientsSettings).length > 0;
          });

      // Log de diagnóstico — abrir F12 → Console. Aparece quando o Dashboard
      // reporta 0 mesmo tendo cliente no banco, mostra em qual filtro sumiu.
      try {
        console.info("[analytics.fetch]", {
          userId: consultantId,
          scope: useTeam ? "team" : "me",
          total: allCustomers.length,
          wallet: walletCustomers.length,
          scoped: scopedWalletCustomers.length,
          myIgreenIds: myIgreenIds.length,
          partnerIgreenIds: partnerIgreenIds.length,
        });
      } catch { /* noop */ }

      const totalCustomers = scopedWalletCustomers.length;
      const statusMap = new Map<string, number>();
      for (const c of scopedWalletCustomers) {
        const s = c.status || "pending";
        statusMap.set(s, (statusMap.get(s) || 0) + 1);
      }
      const statusLabels: Record<string, string> = {
        approved: "Aprovados", pending: "Pendentes", rejected: "Rejeitados", lead: "Leads",
        data_complete: "Dados Completos", registered_igreen: "Cadastrado iGreen", contract_sent: "Contrato Enviado",
      };
      const customersByStatus: CustomerStatusData[] = Array.from(statusMap.entries())
        .map(([status, count]) => ({ status, count, label: statusLabels[status] || status.charAt(0).toUpperCase() + status.slice(1) }))
        .sort((a, b) => b.count - a.count);

      const totalKw = scopedWalletCustomers.reduce((sum, c) => sum + (Number(c.media_consumo) || 0), 0);
      const customersWithConsumption = scopedWalletCustomers.filter((c) => Number(c.media_consumo) > 0);
      const avgKw = customersWithConsumption.length > 0 ? totalKw / customersWithConsumption.length : 0;

      // Ranking por licenciado — chaveia por registered_by_igreen_id quando disponível
      const licMap = new Map<string, { name: string; deals: number }>();
      for (const c of scopedWalletCustomers) {
        const nm = (c as any).registered_by_name?.trim();
        const igid = (c as any).registered_by_igreen_id;
        const key = igid ? `id:${igid}` : (nm && nm.length > 0 ? `nm:${nm}` : "none");
        const displayRaw = nm && nm.length > 0 ? nm : (igid ? `#${igid}` : "Sem licenciado");
        const prev = licMap.get(key);
        if (prev) prev.deals++;
        else licMap.set(key, { name: displayRaw, deals: 1 });
      }
      const topLicenciados: TopLicenciado[] = Array.from(licMap.values())
        .map(({ name, deals }) => {
          const parts = name.trim().split(/\s+/);
          const shortName = parts.length > 2 ? `${parts[0]} ${parts[parts.length - 1]}` : name;
          return { name: shortName, deals };
        })
        .sort((a, b) => b.deals - a.deals)
        .slice(0, 10);

      const weeks = Math.ceil(periodDays / 7);
      const weekMap = new Map<string, number>();
      for (let i = weeks - 1; i >= 0; i--) {
        const start = new Date(); start.setDate(start.getDate() - (i + 1) * 7);
        const end = new Date(); end.setDate(end.getDate() - i * 7);
        const label = `${start.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} - ${end.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}`;
        weekMap.set(label, 0);
      }
      for (const c of scopedWalletCustomers) {
        const created = new Date(c.created_at);
        if (created >= sinceDate) {
          const daysAgo = Math.floor((Date.now() - created.getTime()) / (1000 * 60 * 60 * 24));
          const weekIdx = Math.min(weeks - 1, Math.floor(daysAgo / 7));
          const keys = Array.from(weekMap.keys());
          const key = keys[keys.length - 1 - weekIdx];
          if (key) weekMap.set(key, (weekMap.get(key) || 0) + 1);
        }
      }
      const weeklyNewCustomers: WeeklyNewCustomers[] = Array.from(weekMap.entries()).map(([week, count]) => ({ week, count }));

      const total = totalClient + totalLicenciada;
      const conversionRate = total > 0 ? (totalClicks / total) * 100 : 0;

      // === FUNNEL ===
      const ctaClicks = events.filter((e) =>
        e.event_type === "click" &&
        (e.event_target?.includes("whatsapp") || e.event_target?.includes("cadastro"))
      ).length;
      const periodLeads = leadCustomers.filter((c) => new Date(c.created_at) >= sinceDate);
      const leadsCount = periodLeads.length;
      // "Aprovados" no funil = leads que avançaram (não mistura com carteira iGreen sincronizada)
      const approvedCount = periodLeads.filter((c: any) =>
        c.status === "approved" || c.status === "active" || c.status === "registered_igreen" || c.status === "complete"
      ).length;
      const funnel = [
        { stage: "Visitas", count: total, pct: 100 },
        { stage: "Cliques CTA", count: ctaClicks, pct: total ? (ctaClicks / total) * 100 : 0 },
        { stage: "Leads", count: leadsCount, pct: total ? (leadsCount / total) * 100 : 0 },
        { stage: "Aprovados", count: approvedCount, pct: total ? (approvedCount / total) * 100 : 0 },
      ];

      // === WEEKDAY ===
      const weekdayNames = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
      const weekdayMap = new Map<number, { views: number; clicks: number }>();
      for (let i = 0; i < 7; i++) weekdayMap.set(i, { views: 0, clicks: 0 });
      for (const v of views) {
        const d = new Date(v.created_at).getDay();
        weekdayMap.get(d)!.views++;
      }
      for (const e of events) {
        if (e.event_type === "click") {
          const d = new Date(e.created_at).getDay();
          weekdayMap.get(d)!.clicks++;
        }
      }
      const weekday = Array.from(weekdayMap.entries()).map(([d, v]) => ({
        day: weekdayNames[d], views: v.views, clicks: v.clicks,
      }));

      // === PERIOD COMPARISON (segue periodDays — janela atual vs anterior do mesmo tamanho) ===
      const now = Date.now();
      const day = 24 * 60 * 60 * 1000;
      const curStart = now - periodDays * day;
      const prevStart = now - 2 * periodDays * day;
      const inCur = (ts: number) => ts >= curStart;
      const inPrev = (ts: number) => ts >= prevStart && ts < curStart;

      const curViews = views.filter((v) => inCur(new Date(v.created_at).getTime())).length;
      const prevViews = views.filter((v) => inPrev(new Date(v.created_at).getTime())).length;
      // Cliques = só CTAs de conversão (whatsapp/cadastro), alinhado ao funil
      const isCtaClick = (e: any) =>
        e.event_type === "click" && e.event_target &&
        (e.event_target.includes("whatsapp") || e.event_target.includes("cadastro"));
      const curClicks = events.filter((e) => isCtaClick(e) && inCur(new Date(e.created_at).getTime())).length;
      const prevClicks = events.filter((e) => isCtaClick(e) && inPrev(new Date(e.created_at).getTime())).length;
      const curLeads = leadCustomers.filter((c) => inCur(new Date(c.created_at).getTime())).length;
      const prevLeads = leadCustomers.filter((c) => inPrev(new Date(c.created_at).getTime())).length;
      const pctChange = (cur: number, prev: number) => prev === 0 ? (cur > 0 ? 100 : 0) : ((cur - prev) / prev) * 100;
      const weekComparison = {
        views: { current: curViews, previous: prevViews, change: pctChange(curViews, prevViews) },
        clicks: { current: curClicks, previous: prevClicks, change: pctChange(curClicks, prevClicks) },
        leads: { current: curLeads, previous: prevLeads, change: pctChange(curLeads, prevLeads) },
      };

      // === TOP CAMPAIGNS ===
      const campaignMap = new Map<string, { views: number; clicks: number; leads: number }>();
      for (const v of views) {
        const key = v.utm_source || "direto";
        if (!campaignMap.has(key)) campaignMap.set(key, { views: 0, clicks: 0, leads: 0 });
        campaignMap.get(key)!.views++;
      }
      for (const e of events) {
        if (e.event_type === "click") {
          const key = e.utm_source || "direto";
          if (!campaignMap.has(key)) campaignMap.set(key, { views: 0, clicks: 0, leads: 0 });
          campaignMap.get(key)!.clicks++;
        }
      }
      const topCampaigns = Array.from(campaignMap.entries())
        .map(([source, v]) => ({ source, ...v, conversionRate: v.views > 0 ? (v.clicks / v.views) * 100 : 0 }))
        .sort((a, b) => b.views - a.views)
        .slice(0, 8);

      // === PER-CTA TIME SERIES ===
      const allTargets = Array.from(new Set(
        events.filter((e) => e.event_type === "click" && e.event_target).map((e) => e.event_target as string)
      ));
      const clicksByTargetDetailed: Record<string, { total: number; spark: number[]; current: number; previous: number; change: number; }> = {};
      for (const tRaw of allTargets) {
        const t = tRaw as string;
        const targetEvents = events.filter((e) => e.event_type === "click" && e.event_target === t);
        const spark: number[] = [];
        for (let i = 6; i >= 0; i--) {
          const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0); dayStart.setDate(dayStart.getDate() - i);
          const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
          spark.push(targetEvents.filter((e) => {
            const ts = new Date(e.created_at).getTime();
            return ts >= dayStart.getTime() && ts < dayEnd.getTime();
          }).length);
        }
        const cur = targetEvents.filter((e) => inCur(new Date(e.created_at).getTime())).length;
        const prv = targetEvents.filter((e) => inPrev(new Date(e.created_at).getTime())).length;
        clicksByTargetDetailed[t] = { total: targetEvents.length, spark, current: cur, previous: prv, change: pctChange(cur, prv) };
      }

      const buildDailySpark = (rows: Array<{ created_at: string }>) => {
        const out: number[] = [];
        for (let i = 6; i >= 0; i--) {
          const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0); dayStart.setDate(dayStart.getDate() - i);
          const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
          out.push(rows.filter((r) => {
            const ts = new Date(r.created_at).getTime();
            return ts >= dayStart.getTime() && ts < dayEnd.getTime();
          }).length);
        }
        return out;
      };
      const sparkViews = buildDailySpark(views);
      const sparkClicks = buildDailySpark(events.filter((e) => isCtaClick(e)) as any);
      const sparkLeads = buildDailySpark(leadCustomers as Array<{ created_at: string }>);

      // === Carteira iGreen — SNAPSHOT (não janela), inclui receita potencial ===
      const approvedWallet = scopedWalletCustomers.filter((c: any) => c.status === "approved" || c.status === "active");
      const walletSnapshot = {
        totalApproved: approvedWallet.length,
        totalWallet: scopedWalletCustomers.length,
        receitaPotencial: approvedWallet.reduce((s: number, c: any) => s + (Number(c.electricity_bill_value) || 0), 0),
      };
      const sparkApproved = buildDailySpark(approvedWallet as Array<{ created_at: string }>);

      const heroKpis = {
        views: { ...weekComparison.views, spark: sparkViews },
        clicks: { ...weekComparison.clicks, spark: sparkClicks },
        leads: { ...weekComparison.leads, spark: sparkLeads },
        approved: {
          current: walletSnapshot.totalApproved,
          previous: walletSnapshot.totalApproved,
          change: 0,
          spark: sparkApproved,
          isSnapshot: true as const,
        },
        periodDays,
      };

      // === HEATMAP hora × dia da semana ===
      const heatMap = new Map<string, number>();
      for (const v of views) {
        const d = new Date(v.created_at);
        heatMap.set(`${d.getDay()}-${d.getHours()}`, (heatMap.get(`${d.getDay()}-${d.getHours()}`) || 0) + 1);
      }
      const heatmap: Array<{ day: number; hour: number; value: number }> = [];
      for (let dy = 0; dy < 7; dy++) {
        for (let hr = 0; hr < 24; hr++) {
          heatmap.push({ day: dy, hour: hr, value: heatMap.get(`${dy}-${hr}`) || 0 });
        }
      }

      // === RECENT CLICKS — timeline editorial ===
      const recentClicks = events
        .filter((e) => e.event_type === "click" && e.event_target)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 20)
        .map((e) => ({
          target: e.event_target as string,
          page: e.page_type as string,
          device: (e.device_type as string) || "—",
          source: (e.utm_source as string) || "direto",
          created_at: e.created_at,
        }));

      // === CPC POR CTA — share + CPC blended quando há gasto de anúncio ===
      const totalCtaClicks = Object.entries(clicksByTarget)
        .filter(([t]) => t.includes("whatsapp") || t.includes("cadastro"))
        .reduce((s, [, n]) => s + n, 0);
      // CPC blended (R$) = gasto real de anúncio ÷ total de cliques CTA do período.
      // É uma aproximação: distribui o gasto igualmente entre os cliques de conversão.
      const blendedCpc = adSpendCents > 0 && totalCtaClicks > 0
        ? adSpendCents / 100 / totalCtaClicks
        : null;
      const cpcByTarget = Object.entries(clicksByTarget)
        .map(([target, clicks]) => {
          const isCta = target.includes("whatsapp") || target.includes("cadastro");
          return {
            target,
            clicks,
            share: totalCtaClicks > 0 ? (clicks / totalCtaClicks) * 100 : 0,
            // Só CTAs recebem CPC (o gasto de anúncio busca conversa/cadastro).
            cpc: isCta ? blendedCpc : null,
          };
        })
        .sort((a, b) => b.clicks - a.clicks);

      // === DAILY MAIN SERIES — visitas + cliques CTA + novos leads ===
      const dailyMain: Array<{ date: string; label: string; visitas: number; cliques: number; leads: number }> = [];
      for (let i = periodDays - 1; i >= 0; i--) {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() - i);
        dailyMain.push({
          date: d.toISOString().split("T")[0],
          label: d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
          visitas: 0,
          cliques: 0,
          leads: 0,
        });
      }
      const dailyIdx = new Map(dailyMain.map((r, i) => [r.date, i]));
      for (const v of views) {
        const i = dailyIdx.get(v.created_at.split("T")[0]);
        if (i != null) dailyMain[i].visitas++;
      }
      for (const e of events) {
        if (!isCtaClick(e)) continue;
        const i = dailyIdx.get(e.created_at.split("T")[0]);
        if (i != null) dailyMain[i].cliques++;
      }
      for (const l of leadCustomers) {
        const i = dailyIdx.get(l.created_at.split("T")[0]);
        if (i != null) dailyMain[i].leads++;
      }

      return {
        totalClient, totalLicenciada, total, totalClicks, clicksByTarget, clicksByPage,
        daily, hourly, devices, utmSources, totalCustomers, customersByStatus,
        totalKw, avgKw, topLicenciados, weeklyNewCustomers, conversionRate, allCustomers,
        funnel, weekday, weekComparison, topCampaigns,
        clicksByTargetDetailed, heroKpis, walletSnapshot, heatmap, periodDays,
        recentClicks, cpcByTarget, totalCtaClicks, dailyMain,
      };

    },
  });
}
