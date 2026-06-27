// Sincroniza métricas das campanhas ativas. Roda via cron a cada 30 min.
// Também aceita { consultant_id } no body pra sync on-demand de UM consultor
// (botão "Sincronizar agora" na aba Performance).
import { adminClient, authConsultant, FB_GRAPH, fbFetch, loadCampaignConnection } from "../_shared/fb-graph.ts";
import { notifyConsultant } from "../_shared/notify-consultant.ts";

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

    // Auth: aceita SERVICE_ROLE (cron) OU consultor autenticado pedindo sync das próprias campanhas.
    const authHeader = req.headers.get("Authorization") || "";
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const isCron = authHeader === `Bearer ${serviceRole}`;
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
      .select("id, consultant_id, fb_campaign_id, status, started_at, end_time_utc")
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
      const since = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
      const { data } = await admin
        .from("facebook_metrics_daily")
        .select("spend_cents,leads,campaign_id,facebook_campaigns!inner(consultant_id)")
        .eq("facebook_campaigns.consultant_id", consultantId)
        .gte("date", since);
      let totSpend = 0; let totLeads = 0;
      for (const r of (data as any[]) || []) { totSpend += r.spend_cents || 0; totLeads += r.leads || 0; }
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
              continue;
            } catch (pe) { console.error("[fb-sync] pre-pause failed", c.fb_campaign_id, (pe as Error).message); }
          }
        }

        const since = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
        const until = new Date().toISOString().slice(0, 10);
        const url = `${FB_GRAPH}/${c.fb_campaign_id}/insights?fields=impressions,reach,clicks,ctr,cpm,spend,actions,frequency&time_range={"since":"${since}","until":"${until}"}&time_increment=1&access_token=${token}`;
        const json = await fbFetch(url);

        // Breakdown por placement (publisher_platform + platform_position) nos últimos 7d
        // — sem time_increment pra agregar e dar custo/lead por placement.
        let cplByPlacement: Record<string, { spend: number; leads: number; cpl: number }> = {};
        try {
          const urlBp = `${FB_GRAPH}/${c.fb_campaign_id}/insights?fields=spend,actions&breakdowns=publisher_platform,platform_position&date_preset=last_7d&access_token=${token}`;
          const bp = await fbFetch(urlBp);
          for (const row of bp?.data || []) {
            const key = `${row.publisher_platform || "?"}:${row.platform_position || "?"}`;
            const spend = Math.round(parseFloat(row.spend || "0") * 100);
            const leadsDirect = sumActions(row.actions, LEAD_ACTIONS);
            const convs = sumActions(row.actions, CONV_ACTIONS);
            const leads = leadsDirect > 0 ? leadsDirect : convs;
            const cpl = leads > 0 ? Math.round(spend / leads) : 0;
            cplByPlacement[key] = { spend, leads, cpl };

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
          // CTWA: a maioria das campanhas WhatsApp NÃO reporta action_type="lead",
          // só "messaging_conversation_started". Sem isso, leads ficava sempre 0 e
          // o CPL/painéis apareciam zerados. Tratamos conversa iniciada como lead
          // quando não há lead direto (fallback), pra popular o número.
          const leads = leadsDirect > 0 ? leadsDirect : conv;
          // Denominador do CPL = leads (já inclui o fallback de conversa).
          const cplBase = leads;
          const cpl = cplBase > 0 ? Math.round(spend / cplBase) : 0;
          // Totais usam os sinais CRUS (leadsDirect e conv separados) pra não
          // duplicar conversas no leads_count / auto-pause. A coluna persistida
          // "leads" é que recebe o fallback de conversa.
          totalSpend += spend; totalLeads += Number(leadsDirect); totalConv += Number(conv);
          maxFreq = Math.max(maxFreq, parseFloat(row.frequency || "0"));

          // Lê linha existente pra calcular delta de gasto + atividade incremental no período
          const { data: prev } = await admin
            .from("facebook_metrics_daily")
            .select("spend_cents,synced_to_wallet_cents,impressions,clicks,leads")
            .eq("campaign_id", c.id)
            .eq("date", date)
            .maybeSingle();
          const alreadyDebited = Number((prev as any)?.synced_to_wallet_cents ?? 0);
          const deltaSpend = Math.max(0, spend - alreadyDebited);
          const impressionsNow = parseInt(row.impressions || "0");
          const clicksNow = parseInt(row.clicks || "0");
          const leadsNow = Number(leads);
          const dImpressions = Math.max(0, impressionsNow - Number((prev as any)?.impressions || 0));
          const dClicks = Math.max(0, clicksNow - Number((prev as any)?.clicks || 0));
          const dLeads = Math.max(0, leadsNow - Number((prev as any)?.leads || 0));
          if (deltaSpend > 0) {
            const chargeCents = Math.round(deltaSpend * (1 + feePct));
            try {
              const time = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
              const dateBr = date.split("-").reverse().slice(0, 2).join("/");
              const activity = [
                dImpressions > 0 ? `${dImpressions} impr.` : null,
                dClicks > 0 ? `${dClicks} clique${dClicks > 1 ? "s" : ""}` : null,
                dLeads > 0 ? `${dLeads} lead${dLeads > 1 ? "s" : ""}` : null,
              ].filter(Boolean).join(", ") || "sem novas interações";
              const description = `${c.fb_campaign_id ? "Campanha" : "Anúncio"} • ${dateBr} ${time} • ${activity}`;
              await admin.rpc("debit_consultant_wallet", {
                _consultant_id: c.consultant_id,
                _amount_cents: chargeCents,
                _campaign_id: c.id,
                _description: description,
                _metadata: {
                  date, fb_campaign_id: c.fb_campaign_id,
                  gross_meta_cents: deltaSpend, fee_percent: feePct,
                  delta_impressions: dImpressions, delta_clicks: dClicks, delta_leads: dLeads,
                  synced_at: new Date().toISOString(),
                },
                _gross_spend_cents: deltaSpend,
              });
              walletCache[c.consultant_id] = undefined as any;
            } catch (de) { console.error("[fb-sync] debit failed", c.id, (de as Error).message); }
          }
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
            synced_to_wallet_cents: spend,
            leads: Number(leads),
            messaging_conversations_started: Number(conv),
            complete_registrations: Number(regs),
            cost_per_lead_cents: cpl,
            frequency_x100: Math.round(parseFloat(row.frequency || "0") * 100),
            cpl_by_placement: cplByPlacement,
            updated_at: new Date().toISOString(),
          }, { onConflict: "campaign_id,date" });
        }
        synced++;

        // Métricas POR ANÚNCIO (level=ad) — necessário para o ad-creative-learner identificar
        // qual criativo individual converte mais. Sem isso, o learner divide tudo por igual.
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

        // Reconcilia leads + customers_acquired POR CAMPANHA baseado no CRM real,
        // usando customers.source_campaign_id (preenchido por lead-attribution).
        // Antes o filtro era só lead_source='meta_ads' → todas as campanhas
        // recebiam o total (resultado: customers_acquired sempre 0 ou inflado).
        try {
          const sinceIso = new Date(Date.now() - 7 * 86400_000).toISOString();
          // Leads atribuídos a esta campanha (qualquer estágio)
          const { data: attributedLeads } = await admin
            .from("customers")
            .select("created_at")
            .eq("source_campaign_id", c.id)
            .gte("created_at", sinceIso);
          const leadsByDate: Record<string, number> = {};
          for (const l of (attributedLeads || []) as any[]) {
            const dt = String(l.created_at).slice(0, 10);
            leadsByDate[dt] = (leadsByDate[dt] || 0) + 1;
          }
          // Clientes aprovados desta campanha
          const { data: deals } = await admin
            .from("crm_deals")
            .select("created_at, customers!inner(source_campaign_id)")
            .eq("stage", "aprovado")
            .eq("customers.source_campaign_id", c.id)
            .gte("created_at", sinceIso);
          const customersByDate: Record<string, number> = {};
          for (const d of (deals || []) as any[]) {
            const dt = String(d.created_at).slice(0, 10);
            customersByDate[dt] = (customersByDate[dt] || 0) + 1;
          }
          const allDates = new Set([...Object.keys(leadsByDate), ...Object.keys(customersByDate)]);
          for (const dt of allDates) {
            const attrLeads = leadsByDate[dt] || 0;
            const acquired = customersByDate[dt] || 0;
            // Pega o que a Meta reporta e usa o MAIOR (atribuição CRM costuma ser mais confiável
            // pra CTWA, mas se Meta reporta mais leads diretos, mantemos)
            const { data: existing } = await admin
              .from("facebook_metrics_daily")
              .select("leads")
              .eq("campaign_id", c.id).eq("date", dt).maybeSingle();
            const metaLeads = Number((existing as any)?.leads || 0);
            await admin.from("facebook_metrics_daily")
              .update({
                leads: Math.max(metaLeads, attrLeads),
                customers_acquired: acquired,
                updated_at: new Date().toISOString(),
              })
              .eq("campaign_id", c.id)
              .eq("date", dt);
          }
        } catch (re) { console.error("[fb-sync] attribution reconcile failed", c.id, (re as Error).message); }

        // Persiste leads_count agregado (necessário pro CBO→ABO disparar)
        // Conta leads + conversas iniciadas como "sinal de lead" — ABO precisa de >=20.
        try {
          await admin.from("facebook_campaigns")
            .update({ leads_count: totalLeads + totalConv, updated_at: new Date().toISOString() })
            .eq("id", c.id);
        } catch (ue) { console.error("[fb-sync] leads_count update failed", c.id, (ue as Error).message); }

        // Auto-pause adaptativo (2026):
        // 1) Frequência cap 3.0 (cold messaging cansa rápido)
        // 2) R$30+ sem nenhuma conversa/lead
        // 3) CPL atual > 2.5x do CPL médio dos últimos 30d do consultor
        // 4) 5 dias seguidos com zero leads (consome verba à toa)
        const reachedActions = totalLeads + totalConv;
        const cplAvg = await getConsultantAvgCpl(c.consultant_id);
        const cplNow = reachedActions > 0 ? Math.round(totalSpend / reachedActions) : null;
        const cplBlown = cplAvg && cplNow && cplNow > cplAvg * 2.5 && totalSpend >= 1500;
        // Conta dias seguidos sem leads no fim da janela
        const daily = (json.data || []).slice().sort((a: any, b: any) => (a.date_start > b.date_start ? -1 : 1));
        let zeroStreak = 0;
        for (const row of daily) {
          const l = sumActions(row.actions, LEAD_ACTIONS);
          const c2 = sumActions(row.actions, CONV_ACTIONS);
          if (l + c2 === 0) zeroStreak++; else break;
        }

        // Auto-pause também por saldo da wallet abaixo do limite
        const wallet = await getWallet(c.consultant_id);
        const lowBalance = wallet && wallet.balance <= wallet.auto_pause_at;
        const shouldPause = c.status === "active" && (
          maxFreq > 3 ||
          (totalSpend >= 3000 && reachedActions === 0) ||
          cplBlown ||
          zeroStreak >= 5 ||
          lowBalance
        );
        if (shouldPause) {
          try {
            let reason: string;
            if (lowBalance) reason = `Auto-pausada: saldo da carteira baixo (R$ ${((wallet?.balance||0)/100).toFixed(2)}) — recarregue para reativar`;
            else if (maxFreq > 3) reason = `Auto-pausada: frequência ${maxFreq.toFixed(1)} > 3 — criativo cansado`;
            else if (cplBlown) reason = `Auto-pausada: CPL R$${(cplNow!/100).toFixed(2)} > 2.5x da média da conta (R$${(cplAvg!/100).toFixed(2)})`;
            else if (zeroStreak >= 5) reason = `Auto-pausada: ${zeroStreak} dias seguidos sem leads`;
            else reason = `Auto-pausada: gastou R$ ${(totalSpend/100).toFixed(2)} sem leads (últimos 7 dias)`;
            await fbFetch(`${FB_GRAPH}/${c.fb_campaign_id}?status=PAUSED&access_token=${token}`, { method: "POST" });
            await admin.from("facebook_campaigns")
              .update({ status: "paused", rejection_reason: reason })
              .eq("id", c.id);
            autoPaused++;
            try {
              await notifyConsultant(c.consultant_id, lowBalance ? "warning" : "info",
                lowBalance ? "Campanha pausada — saldo baixo 💳" : "Campanha pausada automaticamente",
                reason);
            } catch (_) {}
          } catch (pe) { console.error("[fb-sync] auto-pause failed", c.fb_campaign_id, (pe as Error).message); }
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
