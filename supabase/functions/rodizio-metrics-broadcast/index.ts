// rodizio-metrics-broadcast
// ─────────────────────────
// Roda a cada 10 min via pg_cron. Para cada pool de rodízio ativo (ligado a
// campanha ativa), pega métricas AO VIVO da Meta Graph API (não usa a tabela
// facebook_metrics_daily que é atualizada só 1x/dia), monta uma mensagem
// formatada com emojis e envia para cada parceiro do pool via WhatsApp
// (Whapi → Evolution fallback).
//
// Guardrails principais:
//  - Só envia entre 08h e 22h America/Sao_Paulo
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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
  conversationsToday: number;
  spend7dCents: number;
  conversations7d: number;
}

function parseInsightRow(row: any): { spendCents: number; reach: number; impressions: number; conversations: number } {
  const spendCents = Math.round(Number(row?.spend || 0) * 100);
  const reach = Number(row?.reach || 0);
  const impressions = Number(row?.impressions || 0);
  let conversations = 0;
  for (const a of (row?.actions || []) as any[]) {
    // CTWA: Meta reporta como onsite_conversion.messaging_conversation_started_7d
    if (typeof a?.action_type === "string" && a.action_type.includes("messaging_conversation_started")) {
      conversations += Number(a.value || 0);
    }
  }
  return { spendCents, reach, impressions, conversations };
}

// Cache em memória por 5 min para não bater na Meta por cada parceiro do pool
const liveCache = new Map<string, { at: number; data: LiveMetrics | null }>();
async function fetchLiveMetrics(fbCampaignId: string, token: string): Promise<LiveMetrics | null> {
  const cached = liveCache.get(fbCampaignId);
  if (cached && Date.now() - cached.at < 5 * 60_000) return cached.data;

  try {
    const fields = "spend,reach,impressions,actions";
    const [today, week] = await Promise.all([
      fbFetch(`/${fbCampaignId}/insights?fields=${fields}&date_preset=today&access_token=${encodeURIComponent(token)}`),
      fbFetch(`/${fbCampaignId}/insights?fields=${fields}&date_preset=last_7d&access_token=${encodeURIComponent(token)}`),
    ]);
    const t = parseInsightRow(today?.data?.[0] || {});
    const w = parseInsightRow(week?.data?.[0] || {});
    const data: LiveMetrics = {
      spendTodayCents: t.spendCents,
      reachToday: t.reach,
      impressionsToday: t.impressions,
      conversationsToday: t.conversations,
      spend7dCents: w.spendCents,
      conversations7d: w.conversations,
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

  // Quiet hours: 08h–21h BRT (envia até 21:59)
  if (hour < 8 || hour >= 22) {
    return new Response(
      JSON.stringify({ ok: true, skipped: "quiet_hours", hour_brt: hour }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const todayStart = todayBRTStartISO();
  const sevenDaysAgoISO = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

  let sent = 0;
  let skippedInterval = 0;
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
        facebook_campaigns!inner(id, name, status, fb_campaign_id, consultant_id, created_at)
      `)
      .eq("facebook_campaigns.status", "active");

    for (const pool of (pools || []) as any[]) {
      const camp = pool.facebook_campaigns;
      const intervalMin: number = Number(pool.metrics_broadcast_interval_minutes ?? 60);
      if (!camp?.id || !camp.fb_campaign_id) continue;
      if (intervalMin <= 0) { skippedInterval++; continue; }

      // Slot da pool: sempre múltiplo do intervalo escolhido
      const slot = Math.floor(minutesSinceMidnightUTC / intervalMin);
      // Só envia quando o minuto atual "entra num slot novo" — como o cron roda
      // a cada 10 min, isso naturalmente respeita intervalos de 30/60/120/240
      // (assumindo cron *:00,10,20,...). Um envio por slot é garantido pelo dedup.

      // 1) Métricas ao vivo (cache 5 min por campanha)
      const conn = await loadCampaignConnection(camp.consultant_id);
      const live = conn?.token ? await fetchLiveMetrics(camp.fb_campaign_id, conn.token) : null;

      // 2) Leads reais do CRM
      const [{ count: leadsCrmToday }, { count: leadsCrm7d }] = await Promise.all([
        supabase.from("customers").select("id", { count: "exact", head: true })
          .eq("source_campaign_id", camp.id).gte("created_at", todayStart),
        supabase.from("customers").select("id", { count: "exact", head: true })
          .eq("source_campaign_id", camp.id).gte("created_at", sevenDaysAgoISO),
      ]);

      // 3) Guard "cold start vazio": campanha < 30min e literalmente 0 em tudo → não envia
      const ageMin = (Date.now() - new Date(camp.created_at).getTime()) / 60_000;
      const allZero = live
        && live.spendTodayCents === 0
        && live.impressionsToday === 0
        && live.reachToday === 0
        && live.conversationsToday === 0
        && (leadsCrmToday || 0) === 0;
      if (allZero && ageMin < 30) {
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
      // 1× para cada parceiro elegível, marca timestamp e pula o card de
      // métricas neste tick (evita 2 mensagens seguidas).
      if (!pool.approval_notified_at && poolSize > 0) {
        const approvedText = formatCampaignApprovedMessage(camp.name, intervalMin);
        let anySent = false;
        for (const m of eligible as any[]) {
          const partner = m.referral_partners;
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

        // Leads novos do parceiro desde a janela anterior
        const windowAgo = new Date(Date.now() - intervalMin * 60_000).toISOString();
        const { count: partnerNewLeads } = await supabase
          .from("customers")
          .select("id", { count: "exact", head: true })
          .eq("source_campaign_id", camp.id)
          .eq("referral_partner_id", m.partner_id)
          .gte("created_at", windowAgo);

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
            conversationsStartedToday: live.conversationsToday,
            spend7dCents: live.spend7dCents,
            conversations7d: live.conversations7d,
            leadsCrmToday: leadsCrmToday || 0,
            leadsCrm7d: leadsCrm7d || 0,
            partnerPosition: (m.position ?? 0) + 1,
            partnerPoolSize: poolSize,
            partnerLeadsTotal: Number(m.lead_count || 0),
            partnerNewLeadsSinceLast: partnerNewLeads || 0,
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
        skippedDedup,
        skippedColdStart,
        errors,
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
