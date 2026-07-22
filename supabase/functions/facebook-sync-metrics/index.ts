// Sincroniza métricas das campanhas ativas. Roda via cron a cada 30 min.
// Também aceita { consultant_id } no body pra sync on-demand de UM consultor
// (botão "Sincronizar agora" na aba Performance).
import { adminClient, authConsultant, FB_GRAPH, fbFetch, loadCampaignConnection } from "../_shared/fb-graph.ts";
import { notifyConsultant } from "../_shared/notify-consultant.ts";
import { notifyRodizioOnCampaignPaused } from "../_shared/rodizio-pause-notify.ts";
import { resolveCampaignEffectiveStatus } from "../_shared/campaign-effective-status.ts";
import { isConsultantLocked } from "../_shared/campaign-pause.ts";
import { isServiceRoleAuth } from "../_shared/service-role-auth.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Meta retorna conversas CTWA em vários action_types dependendo da versão da campanha
// (legado vs nova messaging objective). Somamos todos os candidatos relevantes.
const CONV_ACTIONS = [
  "onsite_conversion.messaging_conversation_started_7d",
  "onsite_conversion.messaging_first_reply",
  "onsite_conversion.total_messaging_connection",
  "messaging_conversation_started_7d",
  "messaging_first_reply",
  "total_messaging_connection",
];
const LEAD_ACTIONS = ["lead", "onsite_conversion.lead_grouped"];

function sumActions(actions: any[] | undefined, types: string[]): number {
  if (!Array.isArray(actions)) return 0;
  let total = 0;
  for (const a of actions) {
    if (types.includes(a?.action_type)) total += Number(a?.value || 0);
  }
  return total;
}



Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    // Sync on-demand pode passar { consultant_id } pra filtrar só as campanhas
    // daquele consultor. Sem body = sync global (cron).
    let consultantFilter: string | null = null;
    try {
      const body = await req.json().catch(() => ({}));
      if (body && typeof body.consultant_id === "string" && body.consultant_id.length > 0) {
        consultantFilter = body.consultant_id;
      }
    } catch (_) { /* sem body, segue global */ }

    // Auth: aceita SERVICE_ROLE (cron), chamada pg_cron com só `apikey` (mesmo
    // padrão de facebook-sync-ad-creatives), OU consultor autenticado pedindo
    // sync das próprias campanhas. Sem isso o cron 6h enfileira HTTP mas a
    // função responde 401 e a carteira/métricas ficam congeladas.
    // Cron: JWT service_role (role no payload OU chave exata) OU só `apikey`.
    const authHeader = req.headers.get("Authorization") || "";
    const isCron =
      isServiceRoleAuth(req) ||
      (!authHeader && !!req.headers.get("apikey"));
    if (!isCron) {
      const auth = await authConsultant(req);
      if (!auth) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      // Força filtro pelo próprio consultor (a menos que seja super admin)
      const adminCheck = adminClient();
      const { data: role } = await adminCheck
        .from("user_roles").select("role").eq("user_id", auth.id).eq("role", "admin").maybeSingle();
      if (!role) {
        consultantFilter = auth.id;
      }
    }

    const admin = adminClient();
    // Carrega config da plataforma (markup + min auto-pause)
    const { data: pSettings } = await admin
      .from("platform_settings").select("*").eq("id", true).maybeSingle();
    const feePct = Number(pSettings?.platform_fee_percent ?? 20) / 100; // 20% padrão
    const lowAlertCents = Number(pSettings?.low_balance_alert_cents ?? 2000);
    let campaignsQuery = admin
      .from("facebook_campaigns")
      .select("id, consultant_id, fb_campaign_id, fb_adset_ids, fb_ad_ids, daily_budget_cents, status, started_at, end_time_utc, rejection_reason")
      .in("status", ["active", "paused", "pending_review"]);
    if (consultantFilter) campaignsQuery = campaignsQuery.eq("consultant_id", consultantFilter);
    const { data: campaigns } = await campaignsQuery;
    if (!campaigns?.length) return new Response(JSON.stringify({ synced: 0, errors: [], scope: consultantFilter ? "consultant" : "all" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // cache de tokens por consultor (agora vem da plataforma compartilhada)
    const tokenCache: Record<string, string> = {};
    // cache de saldo da carteira por consultor (cents) — pra auto-pause por saldo zerado
    const walletCache: Record<string, { balance: number; auto_pause_at: number; debt: number } | null> = {};
    async function getWallet(consultantId: string) {
      if (walletCache[consultantId] !== undefined) return walletCache[consultantId];
      const { data } = await admin.from("consultant_wallet").select("balance_cents,auto_pause_at_cents,debt_cents").eq("consultant_id", consultantId).maybeSingle();
      walletCache[consultantId] = data ? { balance: Number(data.balance_cents), auto_pause_at: Number(data.auto_pause_at_cents), debt: Number((data as any).debt_cents || 0) } : null;
      return walletCache[consultantId];
    }
    // cache de CPL médio do consultor (centavos) — pra auto-pause adaptativo
    const cplAvgCache: Record<string, number | null> = {};
    async function getConsultantAvgCpl(consultantId: string): Promise<number | null> {
      if (cplAvgCache[consultantId] !== undefined) return cplAvgCache[consultantId];
      const since = new Date(Date.now() - 30 * 86400_000).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
      const { data } = await admin
        .from("facebook_metrics_daily")
        .select("spend_cents,meta_lead_actions,campaign_id,facebook_campaigns!inner(consultant_id)")
        .eq("facebook_campaigns.consultant_id", consultantId)
        .gte("date", since);
      let totSpend = 0; let totLeads = 0;
      for (const r of (data as any[]) || []) { totSpend += r.spend_cents || 0; totLeads += r.meta_lead_actions || 0; }
      const avg = totLeads >= 5 ? Math.round(totSpend / totLeads) : null; // exige amostra mínima
      cplAvgCache[consultantId] = avg;
      return avg;
    }
    let synced = 0;
    let autoPaused = 0;
    const errors: Array<{ campaign_id: string; fb_campaign_id: string | null; error: string }> = [];

    for (const c of campaigns) {
      try {
        if (!tokenCache[c.consultant_id]) {
          const conn = await loadCampaignConnection(c.consultant_id);
          if (!conn) {
            errors.push({ campaign_id: c.id, fb_campaign_id: c.fb_campaign_id, error: "Sem conexão Facebook ativa para a plataforma — reconecte em Super Admin." });
            continue;
          }
          tokenCache[c.consultant_id] = conn.token;
        }
        const token = tokenCache[c.consultant_id];

        // Auto-pause se passou do end_time_utc (campanha de prazo fixo terminou)
        if (c.status === "active" && (c as any).end_time_utc) {
          const endMs = new Date((c as any).end_time_utc).getTime();
          if (Number.isFinite(endMs) && endMs < Date.now()) {
            try {
              await fbFetch(`${FB_GRAPH}/${c.fb_campaign_id}?status=PAUSED&access_token=${token}`, { method: "POST" });
              await admin.from("facebook_campaigns").update({ status: "completed", rejection_reason: "Prazo da campanha encerrado" }).eq("id", c.id);
              autoPaused++;
              try { await notifyConsultant(c.consultant_id, "info", "Campanha finalizada 🏁", "O prazo definido terminou e a campanha foi pausada automaticamente."); } catch (_) {}
              try { await notifyRodizioOnCampaignPaused(admin, c.id, "ended"); } catch (_) {}
              continue;
            } catch (pe) { console.error("[fb-sync] end-time pause failed", c.fb_campaign_id, (pe as Error).message); }

          }
        }

        // Pré-checa saldo: se já está em débito ou zerou, pausa AGORA antes de buscar insights
        if (c.status === "active") {
          const wPre = await getWallet(c.consultant_id);
          if (wPre && (wPre.balance <= 0 || wPre.debt > 0)) {
            try {
              await fbFetch(`${FB_GRAPH}/${c.fb_campaign_id}?status=PAUSED&access_token=${token}`, { method: "POST" });
              const reason = wPre.debt > 0
                ? `Auto-pausada: carteira em débito de R$ ${(wPre.debt/100).toFixed(2)} — recarregue para reativar`
                : `Auto-pausada: saldo zerado — recarregue para reativar`;
              await admin.from("facebook_campaigns").update({ status: "paused", rejection_reason: reason }).eq("id", c.id);
              autoPaused++;
              try { await notifyConsultant(c.consultant_id, "warning", "Campanha pausada — saldo zerado 💳", reason); } catch (_) {}
              try { await notifyRodizioOnCampaignPaused(admin, c.id, "low_balance"); } catch (_) {}
              continue;
            } catch (pe) { console.error("[fb-sync] pre-pause failed", c.fb_campaign_id, (pe as Error).message); }

          }
        }

        const since = new Date(Date.now() - 7 * 86400_000).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
        const until = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
        const url = `${FB_GRAPH}/${c.fb_campaign_id}/insights?fields=impressions,reach,clicks,ctr,cpm,spend,actions,frequency&time_range={"since":"${since}","until":"${until}"}&time_increment=1&access_token=${token}`;
        const json = await fbFetch(url);

        // Breakdown analítico por placement: lead direto e conversa ficam separados.
        let cplByPlacement: Record<string, {
          spend: number;
          leads: number;
          conversations: number;
          cpl: number;
          cost_per_conversation: number;
        }> = {};
        try {
          const urlBp = `${FB_GRAPH}/${c.fb_campaign_id}/insights?fields=spend,actions&breakdowns=publisher_platform,platform_position&date_preset=last_7d&access_token=${token}`;
          const bp = await fbFetch(urlBp);
          for (const row of bp?.data || []) {
            const key = `${row.publisher_platform || "?"}:${row.platform_position || "?"}`;
            const spend = Math.round(parseFloat(row.spend || "0") * 100);
            const leadsDirect = sumActions(row.actions, LEAD_ACTIONS);
            const conversations = sumActions(row.actions, CONV_ACTIONS);
            cplByPlacement[key] = {
              spend,
              leads: leadsDirect,
              conversations,
              cpl: leadsDirect > 0 ? Math.round(spend / leadsDirect) : 0,
              cost_per_conversation: conversations > 0 ? Math.round(spend / conversations) : 0,
            };
          }
        } catch (be) {
          console.warn("[fb-sync] breakdown placement falhou", c.fb_campaign_id, (be as Error).message);
        }

        let totalSpend = 0; let totalLeads = 0; let totalConv = 0; let maxFreq = 0;
        // Log dos action_types crus na primeira linha para diagnóstico (1ª iteração apenas).
        let loggedActions = false;
        for (const row of json.data || []) {
          const date = row.date_start;
          if (!loggedActions && Array.isArray(row.actions) && row.actions.length) {
            console.info(`[fb-sync] ${c.fb_campaign_id} actions raw types:`,
              Array.from(new Set(row.actions.map((a: any) => a.action_type))).join(","));
            loggedActions = true;
          }
          const leadsDirect = sumActions(row.actions, LEAD_ACTIONS);
          const conv = sumActions(row.actions, CONV_ACTIONS);
          const regs = (row.actions || []).find((a: any) => a.action_type === "complete_registration")?.value || 0;
          const spend = Math.round(parseFloat(row.spend || "0") * 100);
          // `leads` permanece híbrido apenas para compatibilidade legada.
          const hybridLeads = leadsDirect > 0 ? leadsDirect : conv;
          // CPL operacional: lead form se existir; senão conversa CTWA (padrão WhatsApp).
          const cplDenom = leadsDirect > 0 ? leadsDirect : conv;
          const cpl = cplDenom > 0 ? Math.round(spend / cplDenom) : 0;
          // Totais preservam os sinais crus, sem misturar conversa com lead.
          totalSpend += spend; totalLeads += Number(leadsDirect); totalConv += Number(conv);
          maxFreq = Math.max(maxFreq, parseFloat(row.frequency || "0"));

          // Lê linha existente pra calcular delta de gasto + atividade incremental no período
          const { data: prev } = await admin
            .from("facebook_metrics_daily")
            .select("spend_cents,synced_to_wallet_cents,impressions,clicks,meta_lead_actions,platform_fee_cents")
            .eq("campaign_id", c.id)
            .eq("date", date)
            .maybeSingle();
          const alreadyDebited = Number((prev as any)?.synced_to_wallet_cents ?? 0);
          const deltaSpend = Math.max(0, spend - alreadyDebited);
          const impressionsNow = parseInt(row.impressions || "0");
          const clicksNow = parseInt(row.clicks || "0");
          const leadsNow = Number(leadsDirect);
          const dImpressions = Math.max(0, impressionsNow - Number((prev as any)?.impressions || 0));
          const dClicks = Math.max(0, clicksNow - Number((prev as any)?.clicks || 0));
          const dLeads = Math.max(0, leadsNow - Number((prev as any)?.meta_lead_actions || 0));
          // Por padrão, mantém o synced anterior. Só avança quando o débito der OK
          // (evita "perder" cobrança em caso de falha do RPC).
          let syncedToWalletCents = alreadyDebited;
          let feeCharged = 0;
          if (deltaSpend > 0) {
            const chargeCents = Math.round(deltaSpend * (1 + feePct));
            feeCharged = chargeCents - deltaSpend;
            try {
              const time = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
              const dateBr = date.split("-").reverse().slice(0, 2).join("/");
              const activity = [
                dImpressions > 0 ? `${dImpressions} impr.` : null,
                dClicks > 0 ? `${dClicks} clique${dClicks > 1 ? "s" : ""}` : null,
                dLeads > 0 ? `${dLeads} lead${dLeads > 1 ? "s" : ""}` : null,
              ].filter(Boolean).join(", ") || "sem novas interações";
              // Descrição transparente: gasto Meta + taxa = total cobrado
              const description = `Campanha • ${dateBr} ${time} • Meta R$ ${(deltaSpend/100).toFixed(2)} + taxa R$ ${(feeCharged/100).toFixed(2)} = R$ ${(chargeCents/100).toFixed(2)} • ${activity}`;
              await admin.rpc("debit_consultant_wallet", {
                _consultant_id: c.consultant_id,
                _amount_cents: chargeCents,
                _campaign_id: c.id,
                _description: description,
                _metadata: {
                  date, fb_campaign_id: c.fb_campaign_id,
                  gross_meta_cents: deltaSpend,
                  platform_fee_cents: feeCharged,
                  fee_percent: feePct,
                  delta_impressions: dImpressions, delta_clicks: dClicks, delta_leads: dLeads,
                  synced_at: new Date().toISOString(),
                },
                _gross_spend_cents: deltaSpend,
              });
              walletCache[c.consultant_id] = undefined as any;
              syncedToWalletCents = spend; // só avança após sucesso
            } catch (de) {
              console.error("[fb-sync] debit failed", c.id, (de as Error).message);
              // mantém syncedToWalletCents = alreadyDebited pra retry no próximo ciclo
            }
          } else {
            syncedToWalletCents = spend; // sem delta, alinha pra não reprocessar
          }
          // Acumula fee pago no dia (somando ao que já estava registrado)
          const prevFee = Number((prev as any)?.platform_fee_cents ?? 0);
          await admin.from("facebook_metrics_daily").upsert({
            campaign_id: c.id,
            date,
            impressions: parseInt(row.impressions || "0"),
            reach: parseInt(row.reach || "0"),
            clicks: parseInt(row.clicks || "0"),
            ctr_bps: Math.round(parseFloat(row.ctr || "0") * 100),
            cpm_cents: Math.round(parseFloat(row.cpm || "0") * 100),
            spend_cents: spend,
            gross_spend_cents: spend,
            synced_to_wallet_cents: syncedToWalletCents,
            platform_fee_cents: prevFee + feeCharged,
            leads: Number(hybridLeads),
            meta_lead_actions: Number(leadsDirect),
            meta_conversations: Number(conv),
            messaging_conversations_started: Number(conv),
            complete_registrations: Number(regs),
            cost_per_lead_cents: cpl,
            frequency_x100: Math.round(parseFloat(row.frequency || "0") * 100),
            cpl_by_placement: cplByPlacement,
            updated_at: new Date().toISOString(),
          }, { onConflict: "campaign_id,date" });
        }
        synced++;

        // Métricas POR ANÚNCIO (level=ad) — necessárias para o learner
        // avaliar cada criativo somente quando houver evidência granular real.
        try {
          const urlAd = `${FB_GRAPH}/${c.fb_campaign_id}/insights?level=ad&fields=ad_id,impressions,reach,clicks,spend,actions,frequency&time_range={"since":"${since}","until":"${until}"}&time_increment=1&access_token=${token}`;
          const adJson = await fbFetch(urlAd);
          for (const row of adJson?.data || []) {
            if (!row.ad_id) continue;
            const leadsAd = sumActions(row.actions, LEAD_ACTIONS);
            const convAd = sumActions(row.actions, CONV_ACTIONS);
            const regsAd = (row.actions || []).find((a: any) => a.action_type === "complete_registration")?.value || 0;
            await admin.from("facebook_ad_metrics_daily").upsert({
              fb_ad_id: row.ad_id,
              campaign_id: c.id,
              date: row.date_start,
              impressions: parseInt(row.impressions || "0"),
              reach: parseInt(row.reach || "0"),
              clicks: parseInt(row.clicks || "0"),
              spend_cents: Math.round(parseFloat(row.spend || "0") * 100),
              leads: Number(leadsAd),
              messaging_conversations_started: Number(convAd),
              complete_registrations: Number(regsAd),
              frequency_x100: Math.round(parseFloat(row.frequency || "0") * 100),
              updated_at: new Date().toISOString(),
            }, { onConflict: "fb_ad_id,date" });
          }
        } catch (ae) {
          console.warn("[fb-sync] ad-level insights falhou", c.fb_campaign_id, (ae as Error).message);
        }

        // Reconcilia somente customers_acquired por campanha com prova Meta.
        // Leads diretos e conversas permanecem exclusivamente nas métricas Meta.
        try {
          const sinceIso = new Date(Date.now() - 7 * 86400_000).toISOString();
          // Clientes aprovados desta campanha (filtra prova Meta em memória —
          // PostgREST .or em join embutido é frágil).
          const { data: deals } = await admin
            .from("crm_deals")
            .select("created_at, customers!inner(source_campaign_id, source_ad_id, ctwa_clid, source_ctwa_clid)")
            .eq("stage", "aprovado")
            .eq("customers.source_campaign_id", c.id)
            .gte("created_at", sinceIso);
          const customersByDate: Record<string, number> = {};
          for (const d of (deals || []) as any[]) {
            const cust = d.customers || {};
            const proven = !!(cust.source_ad_id || cust.ctwa_clid || cust.source_ctwa_clid);
            if (!proven) continue;
            const dt = String(d.created_at).slice(0, 10);
            customersByDate[dt] = (customersByDate[dt] || 0) + 1;
          }
          // Reconcile do CRM não altera métricas de lead Meta. Mantém apenas
          // customers_acquired; `leads` continua híbrido por compatibilidade e
          // análises usam `meta_lead_actions`.
          for (const dt of new Set(Object.keys(customersByDate))) {
            await admin.from("facebook_metrics_daily")
              .update({
                customers_acquired: customersByDate[dt] || 0,
                updated_at: new Date().toISOString(),
              })
              .eq("campaign_id", c.id)
              .eq("date", dt);
          }
        } catch (re) { console.error("[fb-sync] attribution reconcile failed", c.id, (re as Error).message); }

        // `leads_count` é uma coluna híbrida legada usada por automações antigas.
        // Métricas analíticas acima e abaixo mantêm leads diretos e conversas separados.
        try {
          await admin.from("facebook_campaigns")
            .update({ leads_count: Math.max(totalLeads, totalConv), updated_at: new Date().toISOString() })
            .eq("id", c.id);
        } catch (ue) { console.error("[fb-sync] leads_count update failed", c.id, (ue as Error).message); }

        // Sincroniza daily_budget REAL vindo da Meta (soma dos adsets).
        // Sem isso, o card mostra o valor gravado na criação — desatualizado
        // se o usuário editou no Meta ou se o creative-rotator bumpou o budget.
        try {
          const adsetIds: string[] = Array.isArray((c as any).fb_adset_ids)
            ? ((c as any).fb_adset_ids as string[])
            : [];
          if (adsetIds.length > 0) {
            let sumDailyCents = 0;
            let anyDaily = false;
            for (const adsetId of adsetIds) {
              try {
                const adsetInfo = await fbFetch(
                  `${FB_GRAPH}/${adsetId}?fields=daily_budget,lifetime_budget&access_token=${token}`,
                );
                const daily = Number(adsetInfo?.daily_budget || 0); // já em cents
                if (daily > 0) { sumDailyCents += daily; anyDaily = true; }
              } catch (adErr) {
                console.warn("[fb-sync] adset budget fetch failed", adsetId, (adErr as Error).message);
              }
            }
            const currentCents = Number((c as any).daily_budget_cents || 0);
            if (anyDaily && sumDailyCents > 0 && sumDailyCents !== currentCents) {
              await admin.from("facebook_campaigns")
                .update({ daily_budget_cents: sumDailyCents, updated_at: new Date().toISOString() })
                .eq("id", c.id);
              console.info(`[fb-sync] budget updated ${c.fb_campaign_id}: ${currentCents} → ${sumDailyCents} cents`);
            }
          }
        } catch (be) { console.error("[fb-sync] budget sync failed", c.id, (be as Error).message); }

        // Reconcilia status local ← Meta (só leitura). Não sobrescreve pausa/stop manual.
        // Permite pending_review → active quando há ≥1 ad ACTIVE (ads pausados de propósito ok).
        try {
          if (
            c.status === "pending_review" &&
            !isConsultantLocked((c as any).rejection_reason) &&
            c.fb_campaign_id
          ) {
            const adsetIds = Array.isArray((c as any).fb_adset_ids) ? ((c as any).fb_adset_ids as string[]) : [];
            const adIds = Array.isArray((c as any).fb_ad_ids) ? ((c as any).fb_ad_ids as string[]) : [];
            const [campaignState, ...children] = await Promise.all([
              fbFetch(`${FB_GRAPH}/${c.fb_campaign_id}?fields=effective_status,configured_status,issues_info&access_token=${token}`),
              ...adsetIds.map((id) =>
                fbFetch(`${FB_GRAPH}/${id}?fields=effective_status,configured_status,issues_info&access_token=${token}`).catch(() => null)
              ),
              ...adIds.map((id) =>
                fbFetch(`${FB_GRAPH}/${id}?fields=effective_status,configured_status,issues_info&access_token=${token}`).catch(() => null)
              ),
            ]);
            const resolved = resolveCampaignEffectiveStatus(
              campaignState,
              children.slice(0, adsetIds.length).map((item) => item || { effective_status: "UNKNOWN" }),
              children.slice(adsetIds.length).map((item) => item || { effective_status: "UNKNOWN" }),
            );
            if (resolved.localStatus === "active" || resolved.localStatus === "rejected") {
              await admin.from("facebook_campaigns").update({
                status: resolved.localStatus,
                rejection_reason: resolved.localStatus === "rejected"
                  ? (resolved.issues.join(" • ") || "Meta sinalizou problema na campanha")
                  : null,
                updated_at: new Date().toISOString(),
              }).eq("id", c.id);
              console.info(`[fb-sync] status reconciled ${c.fb_campaign_id}: pending_review → ${resolved.localStatus}`);
            }
          }
        } catch (se) {
          console.warn("[fb-sync] status reconcile failed", c.id, (se as Error).message);
        }

        // Sinais analíticos mantêm leads diretos e conversas separados.
        // Nenhum deles causa pausa por desempenho.
        const cplAvg = await getConsultantAvgCpl(c.consultant_id);
        const cplNow = totalLeads > 0 ? Math.round(totalSpend / totalLeads) : null;
        const daily = (json.data || []).slice().sort((a: any, b: any) => (a.date_start > b.date_start ? -1 : 1));
        let zeroLeadStreak = 0;
        for (const row of daily) {
          const directLeads = sumActions(row.actions, LEAD_ACTIONS);
          if (directLeads === 0) zeroLeadStreak++; else break;
        }

        const performanceSignals: string[] = [];
        if (maxFreq > 3) performanceSignals.push(`frequência ${maxFreq.toFixed(1)}`);
        if (totalSpend >= 3000 && totalLeads === 0) {
          performanceSignals.push(`R$ ${(totalSpend / 100).toFixed(2)} sem lead direto nos últimos 7 dias`);
        }
        if (cplNow != null && cplAvg != null && totalLeads >= 10 && cplNow > cplAvg * 2) {
          performanceSignals.push(`CPL direto R$ ${(cplNow / 100).toFixed(2)} acima do histórico R$ ${(cplAvg / 100).toFixed(2)}`);
        }
        if (zeroLeadStreak >= 5) performanceSignals.push(`${zeroLeadStreak} dias sem lead direto`);

        if (performanceSignals.length > 0) {
          try {
            const title = `Revisar desempenho: ${c.fb_campaign_id}`;
            const { data: existing } = await admin
              .from("ad_recommendations")
              .select("id")
              .eq("consultant_id", c.consultant_id)
              .eq("type", "campaign_performance_review")
              .eq("title", title)
              .is("dismissed_at", null)
              .is("applied_at", null)
              .limit(1);
            if (!existing?.length) {
              await admin.from("ad_recommendations").insert({
                consultant_id: c.consultant_id,
                type: "campaign_performance_review",
                title,
                message: `${performanceSignals.join("; ")}. A campanha não foi pausada: aguarde amostra suficiente e revise criativo, público e oferta.`,
                severity: "warning",
                action_label: "Revisar campanha",
                action_payload: { kind: "review_campaign", campaign_id: c.id },
              });
            }
          } catch (re) {
            console.warn("[fb-sync] performance recommendation failed", c.id, (re as Error).message);
          }
        }

        const wallet = await getWallet(c.consultant_id);
        const lowBalance = Boolean(wallet && wallet.balance <= wallet.auto_pause_at);
        if (c.status === "active" && lowBalance) {
          try {
            const reason = `Auto-pausada: saldo da carteira abaixo do limite (R$ ${((wallet?.balance || 0) / 100).toFixed(2)}) — recarregue para reativar`;
            await fbFetch(`${FB_GRAPH}/${c.fb_campaign_id}?status=PAUSED&access_token=${token}`, { method: "POST" });
            await admin.from("facebook_campaigns")
              .update({ status: "paused", rejection_reason: reason })
              .eq("id", c.id);
            autoPaused++;
            try {
              await notifyConsultant(c.consultant_id, "warning", "Campanha pausada — saldo baixo 💳", reason);
            } catch (_) {}
            try {
              await notifyRodizioOnCampaignPaused(admin, c.id, "low_balance");
            } catch (_) {}
          } catch (pe) { console.error("[fb-sync] balance auto-pause failed", c.fb_campaign_id, (pe as Error).message); }
        }
      } catch (e) {
        const msg = (e as Error).message;
        console.error("[fb-sync]", c.fb_campaign_id, msg);
        errors.push({ campaign_id: c.id, fb_campaign_id: c.fb_campaign_id, error: msg });
      }
    }

    return new Response(
      JSON.stringify({
        synced,
        auto_paused: autoPaused,
        total_campaigns: campaigns.length,
        errors,
        scope: consultantFilter ? "consultant" : "all",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
