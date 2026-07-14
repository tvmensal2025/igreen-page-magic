// rodizio-metrics-broadcast
// ─────────────────────────
// Roda a cada 10 min via pg_cron. Para cada pool de rodízio ativo (ligado a
// campanha ativa), pega métricas AO VIVO da Meta Graph API (não usa a tabela
// facebook_metrics_daily que é atualizada só 1x/dia), monta uma mensagem
// formatada com emojis e envia para cada parceiro do pool via WhatsApp
// (Whapi → Evolution fallback).
//
// Guardrails principais:
//  - Quiet hours POR POOL (padrão 21h–09h BRT; configurável na UI)
//  - Respeita `rodizio_pools.metrics_broadcast_interval_minutes` (0=off, 30/60/120/240; padrão 60)
//  - NUNCA envia com métricas fake: se a Meta API falhar → mensagem de fallback
//  - Se campanha < 30 min e tudo zero → skip (evita "vazio")
//  - Dedup por (partner_id, campaign_id, slot_da_pool) via outbound_message_log
//  - 1× por pool: quando a campanha entra em ACTIVE (aprovada pela Meta), avisa
//    todos os parceiros elegíveis e marca `rodizio_pools.approval_notified_at`.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendRawToNumber } from "../_shared/notify-consultant.ts";
import {
  formatRodizioMetricsMessage,
  formatRodizioFallbackMessage,
  formatCampaignApprovedMessage,
} from "../_shared/rodizio-metrics-format.ts";
import { fbFetch, loadCampaignConnection } from "../_shared/fb-graph.ts";
import { META_CAMPAIGN_PROOF_OR } from "../_shared/meta-campaign-proof.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type PartnerLeadRow = { id: string; created_at: string };

/**
 * Leads do parceiro nesta campanha (rodízio): referral_partner_id +
 * (source_campaign_id = campanha OU campaign_match_log). Sem prova Meta.
 * Só quantidade — não lista telefone/nome no aviso.
 */
async function loadPartnerCampaignLeads(
  supabase: ReturnType<typeof createClient>,
  campaignId: string,
  partnerId: string,
  sinceIso?: string,
): Promise<PartnerLeadRow[]> {
  let query = supabase
    .from("rodizio_assignments")
    .select("customer_id, assigned_at")
    .eq("campaign_id", campaignId)
    .eq("partner_id", partnerId)
    .order("assigned_at", { ascending: false })
    .limit(500);
  if (sinceIso) query = query.gte("assigned_at", sinceIso);
  const { data, error } = await query;
  if (error) {
    console.error("[rodizio-metrics] ledger de atribuições indisponível:", error.message);
    return [];
  }
  return ((data || []) as any[]).map((row) => ({
    id: String(row.customer_id),
    created_at: String(row.assigned_at),
  }));
}

function nowBRT(): { label: string; hour: number; minutesSinceMidnightUTC: number } {
  const d = new Date();
  const brtStr = d.toLocaleString("en-US", { timeZone: "America/Sao_Paulo", hour12: false });
  const [datePart, timePart] = brtStr.split(", ");
  const [mm, dd] = datePart.split("/");
  const [hh, mi] = timePart.split(":");
  return {
    label: `${dd}/${mm} ${hh}:${mi}`,
    hour: parseInt(hh, 10),
    // slot global em minutos desde epoch UTC — usado para dedup por intervalo
    minutesSinceMidnightUTC: Math.floor(Date.now() / 60_000),
  };
}

function todayBRTStartISO(): string {
  const d = new Date();
  const brt = new Date(d.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  brt.setHours(0, 0, 0, 0);
  const utcMs = brt.getTime() + 3 * 60 * 60 * 1000;
  return new Date(utcMs).toISOString();
}

interface LiveMetrics {
  spendTodayCents: number;
  reachToday: number;
  impressionsToday: number;
  clicksToday: number;
  conversationsToday: number;
  spend7dCents: number;
  clicks7d: number;
  conversations7d: number;
}

function parseInsightRow(row: any): {
  spendCents: number;
  reach: number;
  impressions: number;
  clicks: number;
  conversations: number;
} {
  const spendCents = Math.round(Number(row?.spend || 0) * 100);
  const reach = Number(row?.reach || 0);
  const impressions = Number(row?.impressions || 0);
  // link_clicks / clicks — Meta manda em actions ou campo clicks
  let clicks = Number(row?.clicks || 0);
  let conversations = 0;
  for (const a of (row?.actions || []) as any[]) {
    const t = typeof a?.action_type === "string" ? a.action_type : "";
    // CTWA: onsite_conversion.messaging_conversation_started_7d
    if (t.includes("messaging_conversation_started")) {
      conversations += Number(a.value || 0);
    }
    if (!clicks && (t === "link_click" || t === "outbound_click")) {
      clicks += Number(a.value || 0);
    }
  }
  return { spendCents, reach, impressions, clicks, conversations };
}

// Cache em memória por 5 min para não bater na Meta por cada parceiro do pool
const liveCache = new Map<string, { at: number; data: LiveMetrics | null }>();
async function fetchLiveMetrics(fbCampaignId: string, token: string): Promise<LiveMetrics | null> {
  const cached = liveCache.get(fbCampaignId);
  if (cached && Date.now() - cached.at < 5 * 60_000) return cached.data;

  try {
    const fields = "spend,reach,impressions,clicks,actions";
    const [today, week] = await Promise.all([
      fbFetch(`/${fbCampaignId}/insights?fields=${fields}&date_preset=today&access_token=${encodeURIComponent(token)}`),
      fbFetch(`/${fbCampaignId}/insights?fields=${fields}&date_preset=last_7d&access_token=${encodeURIComponent(token)}`),
    ]);
    const t = parseInsightRow(today?.data?.[0] || {});
    const w = parseInsightRow(week?.data?.[0] || {});
    // Meta date_preset=last_7d = últimos 7 dias COMPLETOS (exclui hoje).
    // "Últimos 7 dias" na mensagem = last_7d + today (janela rolante real).
    const data: LiveMetrics = {
      spendTodayCents: t.spendCents,
      reachToday: t.reach,
      impressionsToday: t.impressions,
      clicksToday: t.clicks,
      conversationsToday: t.conversations,
      spend7dCents: w.spendCents + t.spendCents,
      clicks7d: w.clicks + t.clicks,
      conversations7d: w.conversations + t.conversations,
    };
    liveCache.set(fbCampaignId, { at: Date.now(), data });
    return data;
  } catch (e) {
    console.error("[rodizio-metrics] fetchLiveMetrics fail:", (e as Error).message);
    liveCache.set(fbCampaignId, { at: Date.now(), data: null });
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { label, hour, minutesSinceMidnightUTC } = nowBRT();

  /** Quiet hours por pool. start=21 end=9 → silêncio de 21h até 08:59. start===end → desligado. */
  function inQuietHours(startH: number, endH: number, h: number): boolean {
    if (startH === endH) return false;
    if (startH < endH) return h >= startH && h < endH; // ex: 0–6
    return h >= startH || h < endH; // ex: 21–9 (atravessa meia-noite)
  }

  const todayStart = todayBRTStartISO();
  const sevenDaysAgoISO = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

  let sent = 0;
  let skippedInterval = 0;
  let skippedQuiet = 0;
  let skippedDedup = 0;
  let skippedColdStart = 0;
  let fallbackSent = 0;
  let approvedSent = 0;
  let errors = 0;

  try {
    const { data: pools } = await supabase
      .from("rodizio_pools")
      .select(`
        id, campaign_id, consultant_id, metrics_broadcast_interval_minutes, approval_notified_at,
        metrics_quiet_start_hour, metrics_quiet_end_hour,
        facebook_campaigns!inner(id, name, status, fb_campaign_id, consultant_id, created_at, cities, duration_days, daily_budget_cents, tracking_protocol, fb_adset_ids)
      `)
      .eq("is_enabled", true)
      .eq("is_active", true)
      .eq("facebook_campaigns.status", "active");

    for (const pool of (pools || []) as any[]) {
      const camp = pool.facebook_campaigns;
      if (pool.consultant_id !== camp?.consultant_id) {
        console.error(`[rodizio-metrics] pool ${pool.id} pertence a outro consultor; envio bloqueado`);
        errors++;
        continue;
      }
      const intervalMin: number = Number(pool.metrics_broadcast_interval_minutes ?? 60);
      if (!camp?.id || !camp.fb_campaign_id) continue;
      if (intervalMin <= 0) { skippedInterval++; continue; }

      const quietStart = Number(pool.metrics_quiet_start_hour ?? 21);
      const quietEnd = Number(pool.metrics_quiet_end_hour ?? 9);
      if (inQuietHours(quietStart, quietEnd, hour)) {
        skippedQuiet++;
        continue;
      }

      // Slot da pool: sempre múltiplo do intervalo escolhido
      const slot = Math.floor(minutesSinceMidnightUTC / intervalMin);
      // Só envia quando o minuto atual "entra num slot novo" — como o cron roda
      // a cada 10 min, isso naturalmente respeita intervalos de 30/60/120/240
      // (assumindo cron *:00,10,20,...). Um envio por slot é garantido pelo dedup.

      // 1) Métricas ao vivo (cache 5 min por campanha)
      const conn = await loadCampaignConnection(camp.consultant_id);
      const live = conn?.token ? await fetchLiveMetrics(camp.fb_campaign_id, conn.token) : null;

      // 2) Leads reais do CRM — só com prova Meta (AD ID / ctwa_clid)
      const [{ count: leadsCrmToday }, { count: leadsCrm7d }] = await Promise.all([
        supabase.from("customers").select("id", { count: "exact", head: true })
          .eq("source_campaign_id", camp.id)
          .or(META_CAMPAIGN_PROOF_OR)
          .gte("created_at", todayStart),
        supabase.from("customers").select("id", { count: "exact", head: true })
          .eq("source_campaign_id", camp.id)
          .or(META_CAMPAIGN_PROOF_OR)
          .gte("created_at", sevenDaysAgoISO),
      ]);

      // 3) Guard "cold start vazio": campanha < 30min e literalmente 0 em tudo → não envia
      //    MÉTRICAS. O aviso "campanha aprovada" (abaixo) roda ANTES do guard, pois
      //    é um envio único e independente de haver métricas.
      const ageMin = (Date.now() - new Date(camp.created_at).getTime()) / 60_000;
      const allZero = live
        && live.spendTodayCents === 0
        && live.impressionsToday === 0
        && live.reachToday === 0
        && live.conversationsToday === 0
        && (leadsCrmToday || 0) === 0;
      const isColdStartMetrics = allZero && ageMin < 30;
      if (isColdStartMetrics && pool.approval_notified_at) {
        skippedColdStart++;
        continue;
      }

      // 4) Membros elegíveis
      const { data: members } = await supabase
        .from("rodizio_pool_members")
        .select(`
          partner_id, position, lead_count,
          referral_partners!inner(nome, notification_phone, rodizio_metrics_enabled, is_active)
        `)
        .eq("pool_id", pool.id)
        .order("position", { ascending: true });

      const eligible = (members || []).filter((m: any) => {
        const p = m.referral_partners;
        return p?.is_active !== false && p?.rodizio_metrics_enabled !== false && p?.notification_phone;
      });
      const poolSize = eligible.length;

      // 4.1) Aviso ÚNICO de "campanha aprovada pela Meta". Se ainda não
      // enviamos para esta pool E a campanha está active (aprovada), dispara
      // 1× para cada parceiro elegível (mensagem personalizada com posição no
      // rodízio + roster), marca timestamp e pula o card de métricas neste
      // tick (evita 2 mensagens seguidas).
      if (!pool.approval_notified_at && poolSize > 0) {
        // Cidades
        const cityNames: string[] = Array.isArray(camp.cities)
          ? (camp.cities as any[]).map((c) => c?.name).filter((x) => typeof x === "string" && x.length > 0)
          : [];

        // Alcance estimado — 1 chamada Meta por pool, cacheado nesta iteração
        let estimatedReach: { lower: number; upper: number } | null = null;
        try {
          const adsetIds: string[] = Array.isArray(camp.fb_adset_ids) ? (camp.fb_adset_ids as any[]).map(String) : [];
          if (adsetIds.length > 0 && conn?.token) {
            const de = await fbFetch(
              `/${adsetIds[0]}/delivery_estimate?optimization_goal=REACH&access_token=${encodeURIComponent(conn.token)}`,
            ).catch(() => null);
            const est = Array.isArray(de?.data) ? de.data[0] : null;
            const lo = Number(est?.estimate_mau_lower_bound ?? est?.users_lower_bound ?? 0);
            const up = Number(est?.estimate_mau_upper_bound ?? est?.users_upper_bound ?? 0);
            if (up > 0) estimatedReach = { lower: lo, upper: up };
          }
        } catch (e) {
          console.warn("[rodizio-metrics] delivery_estimate falhou:", (e as Error).message);
        }

        // Roster (todos os parceiros elegíveis, com nome + ID)
        const partnerIds = eligible.map((m: any) => m.partner_id);
        const { data: partnerRows } = await supabase
          .from("referral_partners")
          .select("id, nome, partner_igreen_id, short_code")
          .in("id", partnerIds);
        const partnerById = new Map<string, any>(((partnerRows || []) as any[]).map((p) => [p.id, p]));

        const sortedEligible = [...eligible].sort((a: any, b: any) => a.position - b.position);

        let anySent = false;
        for (const m of sortedEligible as any[]) {
          const partner = m.referral_partners;
          const partnerFull = partnerById.get(m.partner_id) || {};
          const partnerIgreen = partnerFull.partner_igreen_id || partnerFull.short_code || null;

          const rosterLines = sortedEligible.map((mm: any, idx: number) => {
            const p = partnerById.get(mm.partner_id) || {};
            const nome = p.nome || "(sem nome)";
            const idLabel = p.partner_igreen_id || p.short_code || null;
            const you = mm.partner_id === m.partner_id ? " ← você" : "";
            return `  ${idx + 1}º ${nome}${idLabel ? ` · ID ${idLabel}` : ""}${you}`;
          });

          const myPosition = sortedEligible.findIndex((mm: any) => mm.partner_id === m.partner_id) + 1;

          const approvedText = formatCampaignApprovedMessage({
            campaignName: camp.name,
            trackingProtocol: camp.tracking_protocol || null,
            fbCampaignId: camp.fb_campaign_id || null,
            dailyBudgetCents: camp.daily_budget_cents ?? null,
            durationDays: camp.duration_days ?? null,
            cities: cityNames,
            estimatedReach,
            partnerName: partner?.nome || partnerFull.nome || null,
            partnerIgreenId: partnerIgreen,
            position: myPosition,
            totalPositions: sortedEligible.length,
            rosterLines,
            intervalMinutes: intervalMin,
          });

          const approvedIdem = `rodizio_approved:${m.partner_id}:${camp.id}`;
          const { error: insErr } = await supabase
            .from("outbound_message_log")
            .insert({
              idempotency_key: approvedIdem,
              consultant_id: pool.consultant_id,
              payload_hash: approvedIdem,
              result_status: "queued_rodizio_approved",
            });
          if (insErr && (insErr as any)?.code === "23505") continue; // já avisado
          try {
            const ok = await sendRawToNumber(pool.consultant_id, partner.notification_phone, approvedText);
            if (ok) { approvedSent++; anySent = true; } else { errors++; }
          } catch (e) {
            errors++;
            console.error("[rodizio-metrics] approved send erro:", (e as Error).message);
          }
        }
        if (anySent) {
          await supabase
            .from("rodizio_pools")
            .update({ approval_notified_at: new Date().toISOString() })
            .eq("id", pool.id);
        }
        // Não manda o card de métricas neste tick — próxima janela cuida.
        continue;
      }


      for (const m of eligible as any[]) {
        const partner = m.referral_partners;
        const idemKey = `rodizio_metrics:${m.partner_id}:${camp.id}:${intervalMin}:${slot}`;

        // Dedup por slot da pool
        const { error: insErr } = await supabase
          .from("outbound_message_log")
          .insert({
            idempotency_key: idemKey,
            consultant_id: pool.consultant_id,
            payload_hash: idemKey,
            result_status: "queued_rodizio_metrics",
          });
        if (insErr) {
          if ((insErr as any)?.code === "23505") { skippedDedup++; continue; }
          console.warn("[rodizio-metrics] insert log fail:", insErr.message);
        }

        // Leads do parceiro nesta campanha (rodízio) — SEM prova Meta; só quantidade.
        const windowAgo = new Date(Date.now() - intervalMin * 60_000).toISOString();
        const [partnerAll, partnerNew] = await Promise.all([
          loadPartnerCampaignLeads(supabase, camp.id, m.partner_id),
          loadPartnerCampaignLeads(supabase, camp.id, m.partner_id, windowAgo),
        ]);
        const partnerTotalLeads = partnerAll.length;
        const partnerNewLeads = partnerNew.length;

        let text: string;
        if (!live) {
          // Meta falhou — mensagem de fallback honesta (nunca zerado sem checar)
          text = formatRodizioFallbackMessage(camp.name, label, intervalMin);
        } else {
          text = formatRodizioMetricsMessage({
            campaignName: camp.name,
            campaignStatus: camp.status,
            spendTodayCents: live.spendTodayCents,
            reachToday: live.reachToday,
            impressionsToday: live.impressionsToday,
            clicksToday: live.clicksToday,
            conversationsStartedToday: live.conversationsToday,
            spend7dCents: live.spend7dCents,
            conversations7d: live.conversations7d,
            clicks7d: live.clicks7d,
            leadsCrmToday: leadsCrmToday || 0,
            leadsCrm7d: leadsCrm7d || 0,
            partnerPosition: (m.position ?? 0) + 1,
            partnerPoolSize: poolSize,
            partnerLeadsTotal: partnerTotalLeads,
            partnerNewLeadsSinceLast: partnerNewLeads,
            nowLabel: label,
            intervalMinutes: intervalMin,
          });
        }

        try {
          const ok = await sendRawToNumber(pool.consultant_id, partner.notification_phone, text);
          if (ok) {
            if (!live) fallbackSent++; else sent++;
          } else {
            errors++;
          }
        } catch (e) {
          errors++;
          console.error("[rodizio-metrics] send erro:", (e as Error).message);
        }
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        sent,
        approvedSent,
        fallbackSent,
        skippedInterval,
        skippedQuiet,
        skippedDedup,
        skippedColdStart,
        errors,
        hour_brt: hour,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[rodizio-metrics] fatal:", (e as Error).message);
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
