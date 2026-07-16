/**
 * notify-partner-leads-batch
 *
 * Envia notificação ao parceiro do rodízio para uma lista de customer_ids.
 * Regra guia: NUNCA enviar dado que pode estar errado — se não dá para calcular
 * com certeza, a linha é omitida da mensagem.
 *
 * Suporta dry_run=true (retorna o texto sem enviar).
 */

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";
import { sendRawToNumber } from "../_shared/notify-consultant.ts";
import { META_CAMPAIGN_PROOF_OR } from "../_shared/meta-campaign-proof.ts";
import { isAutomationEnabled, logSkipped } from "../_shared/automation-gate.ts";

const BodySchema = z.object({
  customer_ids: z.array(z.string().uuid()).min(1).max(50),
  force: z.boolean().optional().default(false),
  dry_run: z.boolean().optional().default(false),
  owner_consultant_id: z.string().uuid().optional(),
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
function money(cents: number): string {
  return `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;
}
function shortDateBR(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });
}
function cleanLabel(s: string): string {
  return s.replace(/^\[CONS-[^\]]+\]\s*/, "").replace(/·.*$/, "").trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");

    const admin = createClient(supabaseUrl, serviceKey);

    let ownerConsultantId: string | null = null;

    if (token && token === serviceKey) {
      // chamada interna
    } else if (token) {
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data: userData } = await userClient.auth.getUser();
      if (userData?.user) {
        const { data: c } = await admin.from("consultants").select("id").eq("user_id", userData.user.id).maybeSingle();
        if (c) ownerConsultantId = (c as any).id;
      }
    }

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: parsed.error.flatten().fieldErrors }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { customer_ids, force, dry_run, owner_consultant_id } = parsed.data;

    // Kill switch: bloqueia envio real; dry_run passa para permitir preview.
    if (!dry_run && !(await isAutomationEnabled(admin, "notify_partner_leads_batch"))) {
      await logSkipped(admin, "notify_partner_leads_batch", { customer_ids });
      return new Response(JSON.stringify({ skipped: "automation_disabled", key: "notify_partner_leads_batch" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!ownerConsultantId) ownerConsultantId = owner_consultant_id || null;
    if (!ownerConsultantId) {
      const { data: c0 } = await admin.from("customers").select("consultant_id").eq("id", customer_ids[0]).maybeSingle();
      ownerConsultantId = (c0 as any)?.consultant_id || null;
    }
    if (!ownerConsultantId) {
      return new Response(JSON.stringify({ error: "cannot resolve owner_consultant_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: any[] = [];

    for (const customer_id of customer_ids) {
      const { data: customer } = await admin
        .from("customers")
        .select("id, name, phone_whatsapp, referral_partner_id, source_campaign_id, consultant_id, last_partner_notified_at, do_not_contact")
        .eq("id", customer_id).maybeSingle();

      if (!customer) { results.push({ customer_id, skipped: "not_found" }); continue; }
      if ((customer as any).do_not_contact) {
        results.push({ customer_id, skipped: "do_not_contact" }); continue;
      }
      if ((customer as any).consultant_id !== ownerConsultantId) {
        results.push({ customer_id, skipped: "not_your_consultant" }); continue;
      }
      const partnerId = (customer as any).referral_partner_id as string | null;
      if (!partnerId) { results.push({ customer_id, skipped: "no_partner" }); continue; }
      if (!force && !dry_run && (customer as any).last_partner_notified_at) {
        results.push({ customer_id, skipped: "already_notified" }); continue;
      }

      const { data: partner } = await admin
        .from("referral_partners")
        .select("id, nome, notification_phone, is_active, partner_igreen_id, short_code")
        .eq("id", partnerId).maybeSingle();
      if (!partner || (partner as any).is_active === false) {
        results.push({ customer_id, skipped: "partner_inactive" }); continue;
      }
      const partnerPhone = (partner as any).notification_phone;
      if (!partnerPhone) { results.push({ customer_id, skipped: "partner_no_phone" }); continue; }
      const partnerCode = (partner as any).partner_igreen_id || (partner as any).short_code || null;

      const campaignId: string | null = (customer as any).source_campaign_id ?? null;

      // -------- Resolução do pool (só se tiver certeza) --------
      let poolResolved: { id: string; label: string; counter: number; campaign_id: string | null } | null = null;
      let members: Array<{ partner_id: string; position: number }> = [];

      const { data: memberships } = await admin
        .from("rodizio_pool_members")
        .select("pool_id, position")
        .eq("partner_id", partnerId);

      if (memberships && memberships.length > 0) {
        const poolIds = memberships.map((m: any) => m.pool_id);
        const { data: pools } = await admin
          .from("rodizio_pools")
          .select("id, label, counter, campaign_id, is_active")
          .in("id", poolIds);
        const activePools = (pools || []).filter((p: any) => p.is_active !== false);

        if (campaignId) {
          const match = activePools.find((p: any) => p.campaign_id === campaignId);
          if (match) poolResolved = match as any;
          // se campaign_id existe mas não bate com nenhum pool: mantém null (omite bloco)
        } else if (activePools.length === 1) {
          poolResolved = activePools[0] as any;
        }
        // se ambíguo (>1 pool ativo sem campaignId): poolResolved fica null

        if (poolResolved) {
          const { data: allMembers } = await admin
            .from("rodizio_pool_members")
            .select("partner_id, position")
            .eq("pool_id", poolResolved.id).order("position");
          members = (allMembers || []) as any;
        }
      }

      // -------- Dados da campanha (só com fallback confiável) --------
      let campaignName: string | null = null;
      let campaignStarted: string | null = null;
      let campaignStatus: string | null = null;
      let dailyBudgetCents: number | null = null;
      let spendCents: number | null = null;
      let campaignLeads: number | null = null;
      let durationDays: number | null = null;
      let campaignFbId: string | null = null;

      if (campaignId) {
        const { data: camp } = await admin
          .from("facebook_campaigns")
          .select("name, started_at, status, daily_budget_cents, leads_count, duration_days, fb_campaign_id")
          .eq("id", campaignId).maybeSingle();
        if (camp) {
          campaignName = cleanLabel((camp as any).name || "");
          campaignStarted = (camp as any).started_at || null;
          campaignStatus = (camp as any).status || null;
          dailyBudgetCents = (camp as any).daily_budget_cents ?? null;
          campaignLeads = (camp as any).leads_count ?? null;
          durationDays = (camp as any).duration_days ?? null;
          campaignFbId = (camp as any).fb_campaign_id ?? null;
        }

        // spend: fb_metrics_daily → ad_spend_daily
        const { data: fbm } = await admin
          .from("facebook_metrics_daily")
          .select("spend_cents, leads")
          .eq("campaign_id", campaignId);
        if (fbm && fbm.length > 0) {
          const s = fbm.reduce((a: number, m: any) => a + (m.spend_cents || 0), 0);
          if (s > 0) spendCents = s;
          const l = fbm.reduce((a: number, m: any) => a + (m.leads || 0), 0);
          if (l > 0) campaignLeads = l;
        }
        if (spendCents == null) {
          const { data: asd } = await admin
            .from("ad_spend_daily").select("spend_cents").eq("campaign_id", campaignId);
          if (asd && asd.length > 0) {
            const s = asd.reduce((a: number, m: any) => a + (m.spend_cents || 0), 0);
            if (s > 0) spendCents = s;
          }
        }
        // leads: fallback via customers com prova Meta (nunca misturar manual)
        if (!campaignLeads) {
          const { count } = await admin
            .from("customers").select("id", { count: "exact", head: true })
            .eq("source_campaign_id", campaignId)
            .or(META_CAMPAIGN_PROOF_OR);
          if (count && count > 0) campaignLeads = count;
        }
      }

      // -------- Posição no rodízio + lista de integrantes --------
      let myPosition: number | null = null;
      let totalPositions: number | null = null;
      let nextPartnerLabel: string | null = null;
      let nextPartnerName: string | null = null;
      let rosterLines: string[] = [];

      if (poolResolved && members.length > 0) {
        const myMember = members.find((m) => m.partner_id === partnerId);
        totalPositions = members.length;
        if (myMember) myPosition = myMember.position + 1;

        const nextIdx = poolResolved.counter % totalPositions;
        let nextMember = members.find((m) => m.position === nextIdx);
        let label = "Próximo do giro";
        if (nextMember && nextMember.partner_id === partnerId) {
          const afterIdx = (poolResolved.counter + 1) % totalPositions;
          nextMember = members.find((m) => m.position === afterIdx) || null as any;
          label = "Depois de você";
        }

        // Buscar dados de todos integrantes de uma vez
        const allIds = members.map((m) => m.partner_id);
        const { data: allPartnerRows } = await admin
          .from("referral_partners")
          .select("id, nome, partner_igreen_id, short_code")
          .in("id", allIds);
        const byId = new Map<string, any>((allPartnerRows || []).map((p: any) => [p.id, p]));

        if (nextMember) {
          const np = byId.get(nextMember.partner_id);
          if (np?.nome) { nextPartnerName = np.nome; nextPartnerLabel = label; }
        }

        // Monta roster (nome + ID) — apenas se tiver >1 participante
        if (totalPositions > 1) {
          rosterLines = members
            .slice()
            .sort((a, b) => a.position - b.position)
            .map((m) => {
              const p = byId.get(m.partner_id);
              const nome = p?.nome || "(sem nome)";
              const idLabel = p?.partner_igreen_id || p?.short_code || null;
              const you = m.partner_id === partnerId ? " ← você" : "";
              return `  ${m.position + 1}º ${nome}${idLabel ? ` · ID ${idLabel}` : ""}${you}`;
            });
        }
      }

      // -------- Total de leads recebidos por este parceiro (só campanhas vivas) --------
      // Antes somava tudo do parceiro (misturava campanhas antigas/pausadas).
      // Agora escopa por source_campaign_id ∈ campanhas active/pending_review do consultor.
      const { data: liveCamps } = await admin
        .from("facebook_campaigns")
        .select("id")
        .eq("consultant_id", ownerConsultantId)
        .in("status", ["active", "pending_review"]);
      const liveIds = (liveCamps || []).map((c: any) => c.id);
      let myLeadsCount: number | null = null;
      if (liveIds.length > 0) {
        const { count } = await admin
          .from("customers").select("id", { count: "exact", head: true })
          .eq("referral_partner_id", partnerId)
          .eq("consultant_id", ownerConsultantId)
          .in("source_campaign_id", liveIds);
        myLeadsCount = count ?? 0;
      }

      // -------- Montagem da mensagem --------
      const leadPhone = (customer as any).phone_whatsapp as string | null;
      const phoneDigits = String(leadPhone || "").replace(/\D/g, "").replace(/^55/, "");
      const waLink = phoneDigits.length >= 10 ? `https://wa.me/55${phoneDigits}` : null;

      // Bloco de campanha SÓ aparece se a campanha está no ar.
      // Nunca mostrar dados (invested/leads/orçamento) de campanha pausada.
      const isCampaignLive = campaignStatus === "active" || campaignStatus === "pending_review";
      const statusLabel = isCampaignLive
        ? (campaignStatus === "active" ? "🟢 no ar" : "⚡ em revisão")
        : null;

      const hi = (partner as any).nome ? `Olá, ${(partner as any).nome.split(" ")[0]}! 👋\n\n` : "";
      const lines: string[] = [];
      lines.push(`${hi}🎉 *Novo lead pra você!*`);
      lines.push(``);
      lines.push(`👤 *Nome:* ${(customer as any).name?.trim() || "(ainda coletando…)"}`);
      lines.push(`📱 *WhatsApp:* ${formatPhoneBR(leadPhone)}`);
      if (waLink) lines.push(`🔗 *Abrir conversa:* ${waLink}`);
      lines.push(`🕐 *Chegou:* ${nowBRT()}`);
      lines.push(`🤖 Sofia (IA) já está atendendo`);
      lines.push(``);

      const hasCampFields = isCampaignLive && !!(campaignName || campaignStarted || statusLabel || dailyBudgetCents != null || spendCents != null || campaignLeads != null || durationDays != null);
      if (hasCampFields) {
        lines.push(`📢 *Campanha*`);
        if (campaignName) lines.push(`🎯 *${campaignName}*`);
        if (campaignFbId) lines.push(`🆔 ID Meta: \`${campaignFbId}\``);
        if (statusLabel) lines.push(`📡 Status: ${statusLabel}`);
        if (campaignStarted) lines.push(`📅 No ar desde: ${shortDateBR(campaignStarted)}`);
        if (durationDays != null && durationDays > 0) lines.push(`⏳ Duração: *${durationDays} ${durationDays === 1 ? "dia" : "dias"}*`);
        if (dailyBudgetCents != null) {
          lines.push(`💵 Orçamento/dia: *${money(dailyBudgetCents)}*`);
          if (durationDays != null && durationDays > 0) {
            lines.push(`💼 Investimento total previsto: *${money(dailyBudgetCents * durationDays)}*`);
          }
        }
        if (spendCents != null) lines.push(`💰 Já investido: *${money(spendCents)}*`);
        if (campaignLeads != null) lines.push(`📥 Leads desta campanha: *${campaignLeads}*`);
        lines.push(``);
      }

      // Bloco "Seu cadastro" — sempre útil para o parceiro confirmar
      lines.push(`🪪 *Seu cadastro*`);
      lines.push(`   Nome: *${(partner as any).nome}*`);
      if (partnerCode) lines.push(`   ID iGreen: *${partnerCode}*`);
      lines.push(``);

      if (poolResolved) {
        lines.push(`👥 *Rodízio: ${cleanLabel(poolResolved.label) || "seu grupo"}*`);
        if (myPosition && totalPositions) lines.push(`🏅 Sua posição: *${myPosition}º* de *${totalPositions}*`);
        if (myLeadsCount != null) lines.push(`📈 Seus leads (campanhas ativas): *${myLeadsCount}*`);
        if (nextPartnerName && nextPartnerLabel) lines.push(`➡️ ${nextPartnerLabel}: *${nextPartnerName}*`);
        if (rosterLines.length > 0) {
          lines.push(``);
          lines.push(`📋 *Integrantes do rodízio:*`);
          lines.push(...rosterLines);
        }
        lines.push(``);
      } else if (myLeadsCount != null) {
        lines.push(`📈 *Seus leads totais:* ${myLeadsCount}`);
        lines.push(``);
      }

      lines.push(`✨ _iGreen Ads · automático_`);
      const text = lines.join("\n");

      if (dry_run) {
        results.push({
          customer_id, partner: (partner as any).nome, phone: partnerPhone,
          dry_run: true, text, pool_resolved: !!poolResolved,
        });
        continue;
      }

      const ok = await sendRawToNumber(ownerConsultantId, partnerPhone, text);
      if (ok) {
        await admin.from("customers")
          .update({ last_partner_notified_at: new Date().toISOString() } as any)
          .eq("id", customer_id);
        await admin.from("campaign_match_log").insert({
          customer_id, campaign_id: campaignId, partner_id: partnerId,
          method: "partner_notify", payload: { text } as any,
        } as any);
      }
      results.push({
        customer_id, partner: (partner as any).nome, phone: partnerPhone,
        sent: ok, pool_resolved: !!poolResolved,
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