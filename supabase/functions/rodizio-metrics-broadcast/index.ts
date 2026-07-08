// rodizio-metrics-broadcast
// ─────────────────────────
// Roda a cada 10 min via pg_cron. Para cada pool de rodízio ativo (ligado a
// uma campanha do Facebook), envia um resumo formatado com emojis pra cada
// parceiro participante via WhatsApp (Whapi → Evolution fallback).
//
// Guardrails:
//  - Só envia entre 08h e 22h America/Sao_Paulo
//  - Só envia para parceiros com notification_phone + rodizio_metrics_enabled=true
//  - Dedup por parceiro+campanha+slot_10min via outbound_message_log.idempotency_key
//    (se pg_cron duplicar disparo, não manda 2x)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendRawToNumber } from "../_shared/notify-consultant.ts";
import { formatRodizioMetricsMessage } from "../_shared/rodizio-metrics-format.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function nowBRT(): { label: string; hour: number; slot10: number } {
  const d = new Date();
  const brtStr = d.toLocaleString("en-US", { timeZone: "America/Sao_Paulo", hour12: false });
  // "MM/DD/YYYY, HH:mm:ss"
  const [datePart, timePart] = brtStr.split(", ");
  const [mm, dd] = datePart.split("/");
  const [hh, mi] = timePart.split(":");
  const label = `${dd}/${mm} ${hh}:${mi}`;
  const hour = parseInt(hh, 10);
  const slot10 = Math.floor(Date.now() / (10 * 60 * 1000));
  return { label, hour, slot10 };
}

function todayBRTStartISO(): string {
  const d = new Date();
  const brt = new Date(d.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  brt.setHours(0, 0, 0, 0);
  // brt já está em horário local do runtime, mas queremos ISO UTC do início do dia BRT
  // truque: BRT é UTC-3 fixo (sem DST desde 2019)
  const utcMs = brt.getTime() + 3 * 60 * 60 * 1000;
  return new Date(utcMs).toISOString();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { label, hour, slot10 } = nowBRT();

  // Quiet hours: 08h–21h (envia até 21:59 BRT)
  if (hour < 8 || hour >= 22) {
    return new Response(
      JSON.stringify({ ok: true, skipped: "quiet_hours", hour_brt: hour }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const todayStart = todayBRTStartISO();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const sevenDaysAgoDate = sevenDaysAgo.toISOString().slice(0, 10);
  const todayDate = new Date().toISOString().slice(0, 10);

  let sent = 0;
  let skipped = 0;
  let errors = 0;

  try {
    // 1) Pools ativos ligados a campanhas ativas
    const { data: pools } = await supabase
      .from("rodizio_pools")
      .select("id, campaign_id, consultant_id, facebook_campaigns!inner(id, name, status, consultant_id)")
      .eq("facebook_campaigns.status", "active");

    for (const pool of (pools || []) as any[]) {
      const camp = pool.facebook_campaigns;
      if (!camp?.id) continue;

      // 2) Métricas da campanha (hoje via facebook_metrics_daily)
      const { data: metricsToday } = await supabase
        .from("facebook_metrics_daily")
        .select("spend_cents, reach")
        .eq("campaign_id", camp.id)
        .eq("date", todayDate);
      const spendTodayCents = (metricsToday || []).reduce(
        (s: number, r: any) => s + Number(r.spend_cents || 0),
        0,
      );
      const reachToday = (metricsToday || []).reduce(
        (s: number, r: any) => s + Number(r.reach || 0),
        0,
      );

      // 7 dias
      const { data: metrics7d } = await supabase
        .from("facebook_metrics_daily")
        .select("spend_cents")
        .eq("campaign_id", camp.id)
        .gte("date", sevenDaysAgoDate);
      const spend7dCents = (metrics7d || []).reduce(
        (s: number, r: any) => s + Number(r.spend_cents || 0),
        0,
      );

      // Leads hoje/7d + última entrada
      const { count: leadsToday } = await supabase
        .from("customers")
        .select("id", { count: "exact", head: true })
        .eq("source_campaign_id", camp.id)
        .gte("created_at", todayStart);
      const { count: leads7d } = await supabase
        .from("customers")
        .select("id", { count: "exact", head: true })
        .eq("source_campaign_id", camp.id)
        .gte("created_at", sevenDaysAgo.toISOString());
      const { data: lastLead } = await supabase
        .from("customers")
        .select("created_at")
        .eq("source_campaign_id", camp.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const minutesSinceLastLead = lastLead?.created_at
        ? Math.floor((Date.now() - new Date(lastLead.created_at).getTime()) / 60_000)
        : null;

      // 3) Membros do pool com parceiro elegível
      const { data: members } = await supabase
        .from("rodizio_pool_members")
        .select("partner_id, position, lead_count, referral_partners!inner(nome, notification_phone, rodizio_metrics_enabled, is_active)")
        .eq("pool_id", pool.id)
        .order("position", { ascending: true });

      const eligible = (members || []).filter((m: any) => {
        const p = m.referral_partners;
        return p?.is_active !== false
          && p?.rodizio_metrics_enabled !== false
          && p?.notification_phone;
      });
      const poolSize = eligible.length;

      for (const m of eligible as any[]) {
        const partner = m.referral_partners;
        const idemKey = `rodizio_metrics:${m.partner_id}:${camp.id}:${slot10}`;

        // Dedup: tenta inserir; conflito = já enviado neste slot
        const { error: insErr } = await supabase
          .from("outbound_message_log")
          .insert({
            idempotency_key: idemKey,
            consultant_id: pool.consultant_id,
            result_status: "queued_rodizio_metrics",
          });
        if (insErr) {
          if ((insErr as any)?.code === "23505") { skipped++; continue; }
          console.warn("[rodizio-metrics] insert log fail:", insErr.message);
        }

        // Leads novos do parceiro desde o último envio (~10 min)
        const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
        const { count: partnerNewLeads } = await supabase
          .from("customers")
          .select("id", { count: "exact", head: true })
          .eq("source_campaign_id", camp.id)
          .eq("referral_partner_id", m.partner_id)
          .gte("created_at", tenMinAgo);

        const text = formatRodizioMetricsMessage({
          campaignName: camp.name,
          campaignStatus: camp.status,
          spendTodayCents,
          reachToday,
          leadsToday: leadsToday || 0,
          spend7dCents,
          leads7d: leads7d || 0,
          partnerPosition: (m.position ?? 0) + 1,
          partnerPoolSize: poolSize,
          partnerLeadsTotal: Number(m.lead_count || 0),
          partnerNewLeadsSinceLast: partnerNewLeads || 0,
          minutesSinceLastLeadInCampaign: minutesSinceLastLead,
          nowLabel: label,
        });

        try {
          const ok = await sendRawToNumber(pool.consultant_id, partner.notification_phone, text);
          if (ok) sent++; else errors++;
        } catch (e) {
          errors++;
          console.error("[rodizio-metrics] send erro:", (e as Error).message);
        }
      }
    }

    return new Response(
      JSON.stringify({ ok: true, sent, skipped, errors, slot10 }),
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
