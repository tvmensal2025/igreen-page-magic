/**
 * notify-partner-leads-batch
 *
 * Envia notificação bonita e detalhada aos parceiros do rodízio para uma
 * lista de customer_ids (leads). Mensagem inclui:
 *   - Dados do lead (nome, WhatsApp, hora)
 *   - Dados da campanha (nome, orçamento diário, status, total investido, leads)
 *   - Posição do parceiro no pool + próximo parceiro do giro
 *
 * Autenticação: exige JWT admin (usa mesma checagem de assign-lead-manual).
 * Reusa sendRawToNumber do _shared/notify-consultant.
 */

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";
import { sendRawToNumber } from "../_shared/notify-consultant.ts";

const BodySchema = z.object({
  customer_ids: z.array(z.string().uuid()).min(1).max(50),
  force: z.boolean().optional().default(false),
});

function formatPhoneBR(raw?: string | null): string {
  if (!raw) return "(sem número)";
  const d = String(raw).replace(/\D/g, "").replace(/^55/, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return raw;
}
function nowBRT(): string {
  return new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
}
function money(cents?: number | null): string {
  if (cents == null) return "—";
  return `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;
}
function shortDateBR(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) {
      return new Response(JSON.stringify({ error: "missing auth" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "invalid auth" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: parsed.error.flatten().fieldErrors }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { customer_ids, force } = parsed.data;

    const admin = createClient(supabaseUrl, serviceKey);

    // Consultor do admin logado
    const { data: consultant } = await admin
      .from("consultants").select("id").eq("user_id", userData.user.id).maybeSingle();
    if (!consultant) {
      return new Response(JSON.stringify({ error: "consultant not found" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const ownerConsultantId = (consultant as any).id as string;

    const results: any[] = [];

    for (const customer_id of customer_ids) {
      const { data: customer } = await admin
        .from("customers")
        .select("id, name, phone_whatsapp, referral_partner_id, source_campaign_id, consultant_id, created_at, last_partner_notified_at, is_sandbox")
        .eq("id", customer_id).maybeSingle();

      if (!customer) { results.push({ customer_id, skipped: "not_found" }); continue; }
      if ((customer as any).consultant_id !== ownerConsultantId) {
        results.push({ customer_id, skipped: "not_your_consultant" }); continue;
      }
      const partnerId = (customer as any).referral_partner_id as string | null;
      if (!partnerId) { results.push({ customer_id, skipped: "no_partner" }); continue; }
      if (!force && (customer as any).last_partner_notified_at) {
        results.push({ customer_id, skipped: "already_notified" }); continue;
      }

      // Parceiro
      const { data: partner } = await admin
        .from("referral_partners")
        .select("id, nome, notification_phone, phone, is_active")
        .eq("id", partnerId).maybeSingle();
      if (!partner || (partner as any).is_active === false) {
        results.push({ customer_id, skipped: "partner_inactive" }); continue;
      }
      const partnerPhone = (partner as any).notification_phone || (partner as any).phone;
      if (!partnerPhone) { results.push({ customer_id, skipped: "partner_no_phone" }); continue; }

      // Campanha: usa source_campaign_id ou descobre pelo pool onde o parceiro está
      let campaignId: string | null = (customer as any).source_campaign_id ?? null;
      let poolId: string | null = null;
      let poolLabel = "";
      let poolCounter = 0;
      let members: any[] = [];

      // Pool via parceiro (pega o primeiro pool ativo que contém o parceiro)
      const { data: memberships } = await admin
        .from("rodizio_pool_members")
        .select("pool_id, position, lead_count")
        .eq("partner_id", partnerId);

      if (memberships && memberships.length > 0) {
        // se tem campaignId, tenta casar pool com essa campanha
        let chosen = memberships[0];
        if (campaignId) {
          const { data: p } = await admin
            .from("rodizio_pools")
            .select("id, label, counter, campaign_id")
            .in("id", memberships.map((m: any) => m.pool_id));
          const match = (p || []).find((x: any) => x.campaign_id === campaignId);
          if (match) chosen = memberships.find((m: any) => m.pool_id === match.id) || chosen;
        }
        poolId = chosen.pool_id;

        const { data: pool } = await admin
          .from("rodizio_pools").select("id, label, counter, campaign_id")
          .eq("id", poolId).maybeSingle();
        poolLabel = (pool as any)?.label || "";
        poolCounter = (pool as any)?.counter ?? 0;
        if (!campaignId) campaignId = (pool as any)?.campaign_id || null;

        const { data: allMembers } = await admin
          .from("rodizio_pool_members")
          .select("partner_id, position, lead_count")
          .eq("pool_id", poolId!).order("position");
        members = allMembers || [];
      }

      // Campanha detalhes
      let campaignName = "—";
      let campaignStarted: string | null = null;
      let campaignStatus = "—";
      let dailyBudgetCents: number | null = null;
      let spendCents: number | null = null;
      let campaignLeads: number | null = null;
      if (campaignId) {
        const { data: camp } = await admin
          .from("facebook_campaigns")
          .select("name, started_at, status, daily_budget_cents, leads_count, fb_campaign_id")
          .eq("id", campaignId).maybeSingle();
        if (camp) {
          const raw = (camp as any).name as string;
          campaignName = raw.replace(/^\[CONS-[^\]]+\]\s*/, "").replace(/·.*$/, "").trim();
          campaignStarted = (camp as any).started_at;
          campaignStatus = (camp as any).status;
          dailyBudgetCents = (camp as any).daily_budget_cents;
          campaignLeads = (camp as any).leads_count;
          const { data: metrics } = await admin
            .from("facebook_metrics_daily")
            .select("spend_cents, leads")
            .eq("campaign_id", campaignId);
          if (metrics && metrics.length > 0) {
            spendCents = metrics.reduce((s: number, m: any) => s + (m.spend_cents || 0), 0);
            const leadsSum = metrics.reduce((s: number, m: any) => s + (m.leads || 0), 0);
            if (leadsSum) campaignLeads = leadsSum;
          }
        }
      }

      // Posição no rodízio
      const myMember = members.find((m: any) => m.partner_id === partnerId);
      const myPosition = myMember ? myMember.position + 1 : null;
      const totalPositions = members.length || null;
      const nextIdx = totalPositions ? poolCounter % totalPositions : null;
      const nextMember = nextIdx != null ? members.find((m: any) => m.position === nextIdx) : null;
      let nextPartnerName = "—";
      if (nextMember) {
        const { data: np } = await admin
          .from("referral_partners").select("nome").eq("id", nextMember.partner_id).maybeSingle();
        nextPartnerName = (np as any)?.nome || "—";
      }
      const myLeads = myMember?.lead_count ?? 0;

      const hi = (partner as any).nome ? `Olá, ${(partner as any).nome.split(" ")[0]}! 👋\n\n` : "";
      const text =
        `${hi}🎉 *NOVO LEAD DA CAMPANHA*\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `👤 *Nome:* ${(customer as any).name?.trim() || "(coletando…)"}\n` +
        `📱 *WhatsApp:* ${formatPhoneBR((customer as any).phone_whatsapp)}\n` +
        `🕐 *Chegou:* ${nowBRT()}\n` +
        `🤖 *Sofia (IA) já está atendendo*\n\n` +
        `📢 *CAMPANHA*\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `🏷️  ${campaignName}\n` +
        `📅 Ativa desde: ${shortDateBR(campaignStarted)}\n` +
        `⚡ Status: ${campaignStatus}\n` +
        `💰 Orçamento/dia: ${money(dailyBudgetCents)}\n` +
        `📊 Total investido: ${money(spendCents)}\n` +
        `🎯 Leads gerados: ${campaignLeads ?? "—"}\n\n` +
        `🔄 *SEU RODÍZIO*\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        (poolLabel ? `📍 Pool: ${poolLabel.replace(/^\[CONS-[^\]]+\]\s*/, "").replace(/·.*$/, "").trim()}\n` : "") +
        (myPosition ? `🎖️  Sua posição: ${myPosition}º de ${totalPositions}\n` : "") +
        `📈 Leads recebidos por você: ${myLeads}\n` +
        `➡️  Próximo do giro: ${nextPartnerName}\n\n` +
        `_Automático · iGreen 🌱_`;

      const ok = await sendRawToNumber(ownerConsultantId, partnerPhone, text);
      if (ok) {
        await admin.from("customers")
          .update({ last_partner_notified_at: new Date().toISOString() } as any)
          .eq("id", customer_id);
      }
      results.push({
        customer_id,
        partner: (partner as any).nome,
        phone: partnerPhone,
        sent: ok,
        campaign: campaignName,
        spend: money(spendCents),
        position: myPosition,
      });
    }

    return new Response(JSON.stringify({ ok: true, results }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[notify-partner-leads-batch] erro:", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
