// Captação Intel — IA cruza funil + criativos + concorrentes e gera
// diagnóstico acionável para o SuperAdmin.
//
// Roda manual (botão "Atualizar agora") ou via cron diário.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

const HANDOFF_REASON_LABELS: Record<string, string> = {
  flow_d_ocr_failed_doc: "Documento ilegível (OCR falhou)",
  flow_d_ocr_failed_bill: "Conta de luz ilegível (OCR falhou)",
  flow_d_invalid_doc: "Documento inválido enviado",
  flow_d_invalid_bill: "Conta de luz inválida enviada",
  flow_d_user_request: "Lead pediu falar com humano",
  flow_d_timeout: "Lead parou de responder",
  flow_d_unknown_intent: "Bot não entendeu a mensagem",
  manual: "Consultor assumiu manualmente",
  unknown: "Motivo não classificado",
};

function humanizeReason(slug: string) {
  return HANDOFF_REASON_LABELS[slug] || slug.replace(/_/g, " ");
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface FunnelStage { stage: string; count: number; pct: number }

function pct(num: number, den: number) {
  if (!den) return 0;
  return Math.round((num / den) * 1000) / 10;
}

async function collectFunnel(sb: any, sinceIso: string) {
  const [viewsRes, customersRes, dealsRes, handoffRes] = await Promise.all([
    sb.from("page_views").select("id", { count: "exact", head: true }).gte("created_at", sinceIso),
    sb.from("customers").select("id, status, customer_origin, created_at").gte("created_at", sinceIso),
    sb.from("crm_deals").select("id, stage, created_at"),
    sb.from("bot_handoff_alerts").select("reason, created_at").gte("created_at", sinceIso),
  ]);

  const views = viewsRes.count || 0;
  const customers = (customersRes.data || []).filter((c: any) => c.customer_origin !== "igreen_sync");
  const leads = customers.length;
  const approved = customers.filter((c: any) => c.status === "approved").length;
  const deals = dealsRes.data || [];
  const dealsOpenCount = deals.filter((d: any) => d.stage !== "venda_perdida" && d.stage !== "fechado" && d.stage !== "reprovado").length;
  const dealsWonCount = deals.filter((d: any) => d.stage === "fechado").length;

  const handoffReasonsRaw: Record<string, number> = {};
  for (const h of (handoffRes.data || [])) {
    handoffReasonsRaw[h.reason || "unknown"] = (handoffReasonsRaw[h.reason || "unknown"] || 0) + 1;
  }
  const handoffReasons: Record<string, number> = {};
  for (const [slug, n] of Object.entries(handoffReasonsRaw)) {
    handoffReasons[humanizeReason(slug)] = n;
  }

  const stageCounts: Record<string, number> = {};
  for (const d of deals) {
    stageCounts[d.stage] = (stageCounts[d.stage] || 0) + 1;
  }

  const funnel: FunnelStage[] = [
    { stage: "Visitas LP", count: views, pct: 100 },
    { stage: "Leads (WhatsApp)", count: leads, pct: pct(leads, views) },
    { stage: "Em negociação", count: deals.length, pct: pct(deals.length, views) },
    { stage: "Aprovados", count: approved, pct: pct(approved, views) },
  ];

  return {
    funnel,
    leads,
    views,
    approved,
    deals_count: deals.length,
    deals_open_count: dealsOpenCount,
    deals_won_count: dealsWonCount,
    handoff_reasons: handoffReasons,
    deals_by_stage: stageCounts,
  };
}

async function collectAds(sb: any) {
  const [insightsRes, perfRes, competitorRes] = await Promise.all([
    sb.from("ad_creative_insights").select("winning_patterns, losing_patterns, best_image_traits, best_ctr_bps, best_cpa_cents, summary, sample_size").order("updated_at", { ascending: false }).limit(20),
    sb.from("ad_creative_performance").select("headline, framework, angle, creative_format, score, is_winner, is_loser, spend_cents, leads, clicks, impressions").order("score", { ascending: false }).limit(40),
    sb.from("ad_competitor_creatives").select("advertiser, headline, angle, creative_format, active_days").order("active_days", { ascending: false }).limit(20),
  ]);

  const insights = insightsRes.data || [];
  const perf = perfRes.data || [];
  const competitors = competitorRes.data || [];

  const totalSpend = perf.reduce((s: number, p: any) => s + (p.spend_cents || 0), 0);
  const totalLeads = perf.reduce((s: number, p: any) => s + (p.leads || 0), 0);
  const totalImpr = perf.reduce((s: number, p: any) => s + (p.impressions || 0), 0);
  const totalClicks = perf.reduce((s: number, p: any) => s + (p.clicks || 0), 0);

  return {
    insights,
    winners: perf.filter((p: any) => p.is_winner).slice(0, 10),
    losers: perf.filter((p: any) => p.is_loser).slice(0, 10),
    competitors,
    totals: {
      spend_cents: totalSpend,
      leads: totalLeads,
      impressions: totalImpr,
      clicks: totalClicks,
      cpl_cents: totalLeads > 0 ? Math.round(totalSpend / totalLeads) : null,
      ctr_bps: totalImpr > 0 ? Math.round((totalClicks / totalImpr) * 10000) : 0,
    },
  };
}

async function collectVariants(sb: any, sinceIso: string) {
  // A/B/C — converte por variante
  const { data } = await sb
    .from("customers")
    .select("flow_variant, status")
    .gte("created_at", sinceIso)
    .neq("customer_origin", "igreen_sync");

  const byVariant: Record<string, { total: number; approved: number }> = {};
  for (const c of (data || [])) {
    const v = c.flow_variant || "A";
    if (!byVariant[v]) byVariant[v] = { total: 0, approved: 0 };
    byVariant[v].total++;
    if (c.status === "approved") byVariant[v].approved++;
  }
  return byVariant;
}

async function runDiagnostic() {
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);
  const sinceIso = new Date(Date.now() - 30 * 86400_000).toISOString();

  const [funnelData, adsData, variants] = await Promise.all([
    collectFunnel(sb, sinceIso),
    collectAds(sb),
    collectVariants(sb, sinceIso),
  ]);

  // Filtra variantes fantasma (sample < 5) — evita IA inventar análise sobre 0-1 leads
  const variantsForAI: Record<string, { total: number; approved: number }> = {};
  for (const [k, v] of Object.entries(variants)) {
    if ((v as any).total >= 5) variantsForAI[k] = v as any;
  }

  const kpis = {
    spend_cents: adsData.totals.spend_cents,
    leads: funnelData.leads,
    cpl_cents: funnelData.leads > 0 && adsData.totals.spend_cents > 0
      ? Math.round(adsData.totals.spend_cents / funnelData.leads)
      : adsData.totals.cpl_cents,
    deals_open_count: funnelData.deals_open_count,
    deals_won_count: funnelData.deals_won_count,
    conversion_lp_lead_pct: Math.min(100, pct(funnelData.leads, funnelData.views)),
    conversion_lead_approved_pct: pct(funnelData.approved, funnelData.leads),
    deals_count: funnelData.deals_count,
    handoff_count_30d: Object.values(funnelData.handoff_reasons).reduce((s, n) => s + n, 0),
    variants,
  };

  // ===== IA =====
  const prompt = `Você é um analista de captação de leads da iGreen Energy (energia solar por assinatura no Brasil).
Analise os dados abaixo e produza um diagnóstico ACIONÁVEL focado em PARAR DE PERDER LEADS.

# Funil (últimos 30 dias)
${JSON.stringify(funnelData.funnel, null, 2)}

# Conversão por variante de fluxo (apenas variantes com ≥5 leads — ignore o resto)
${JSON.stringify(variantsForAI, null, 2)}

# Motivos de handoff (bot pediu humano)
${JSON.stringify(funnelData.handoff_reasons, null, 2)}

# Deals por estágio do CRM
${JSON.stringify(funnelData.deals_by_stage, null, 2)}

# Anúncios — totais
${JSON.stringify(adsData.totals, null, 2)}

# Anúncios vencedores (top 10 por score)
${JSON.stringify(adsData.winners.slice(0, 5).map((w: any) => ({ headline: w.headline, framework: w.framework, angle: w.angle, format: w.creative_format, leads: w.leads, score: w.score })), null, 2)}

# Anúncios perdedores
${JSON.stringify(adsData.losers.slice(0, 5).map((w: any) => ({ headline: w.headline, leads: w.leads, score: w.score })), null, 2)}

# Anúncios de concorrentes mais duradouros (sinal de que convertem)
${JSON.stringify(adsData.competitors.slice(0, 8).map((c: any) => ({ advertiser: c.advertiser, headline: c.headline, angle: c.angle, format: c.creative_format, dias: c.active_days })), null, 2)}

Retorne JSON estrito com:
{
  "summary": "Frase curta (≤140 chars) com o diagnóstico mais importante",
  "bottlenecks": [
    { "title": "...", "detail": "...", "metric": "...", "severity": "high|medium|low" }
  ],
  "winners": [
    { "title": "...", "detail": "..." }
  ],
  "actions": [
    { "label": "Botão de ação curto", "detail": "...", "impact": "high|medium|low", "type": "pause_variant|replicate_creative|reactivate_leads|adjust_targeting|tune_handoff|other" }
  ]
}

Regras:
- Máximo 5 itens por lista
- Linguagem direta, sem jargão
- Cite NÚMEROS reais dos dados (ex.: "38% dos leads param em X")
- Foque em AÇÕES executáveis hoje, não estratégia abstrata`;

  let aiOut: any = { summary: null, bottlenecks: [], winners: [], actions: [] };
  let modelUsed = "fallback";
  try {
    const res = await openaiChat({
      model: "gpt-5-mini",
      responseFormat: "json_object",
      maxTokens: 2000,
      messages: [
        { role: "system", content: "Você responde EXCLUSIVAMENTE com JSON válido." },
        { role: "user", content: prompt },
      ],
    });
    if (res.json) {
      aiOut = res.json;
      modelUsed = "gpt-5-mini";
    }
  } catch (e) {
    console.error("[captacao-intel] OpenAI failed, using heuristic fallback:", String(e));
    // Fallback heurístico
    const bottlenecks: any[] = [];
    if (kpis.conversion_lp_lead_pct < 5) {
      bottlenecks.push({ title: "LP convertendo pouco", detail: `Apenas ${kpis.conversion_lp_lead_pct}% das visitas viram lead. Meta: >5%.`, metric: `${kpis.conversion_lp_lead_pct}%`, severity: "high" });
    }
    const variantEntries = Object.entries(variants);
    if (variantEntries.length > 1) {
      const sorted = variantEntries.sort((a, b) => (b[1].approved / Math.max(1, b[1].total)) - (a[1].approved / Math.max(1, a[1].total)));
      const best = sorted[0]; const worst = sorted[sorted.length - 1];
      const bestRate = pct(best[1].approved, best[1].total);
      const worstRate = pct(worst[1].approved, worst[1].total);
      if (bestRate > worstRate * 1.3 && worst[1].total > 5) {
        bottlenecks.push({ title: `Variante ${worst[0]} está perdendo`, detail: `${worstRate}% vs ${bestRate}% da variante ${best[0]}.`, metric: `${worstRate}%`, severity: "medium" });
      }
    }
    aiOut = {
      summary: bottlenecks[0]?.detail || "Sistema operando dentro do esperado.",
      bottlenecks,
      winners: [],
      actions: bottlenecks.map((b) => ({ label: "Investigar", detail: b.detail, impact: b.severity, type: "other" })),
    };
  }

  const sample = funnelData.leads + adsData.winners.length + adsData.losers.length;

  const { error } = await sb.from("capture_diagnostics").insert({
    scope: "global",
    kpis,
    bottlenecks: aiOut.bottlenecks || [],
    winners: aiOut.winners || [],
    actions: aiOut.actions || [],
    summary: aiOut.summary || null,
    sample_size: sample,
    model_used: modelUsed,
  });

  if (error) {
    console.error("[captacao-intel] insert error:", error);
    throw error;
  }

  return { ok: true, kpis, sample, model: modelUsed };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const out = await runDiagnostic();
    return new Response(JSON.stringify(out), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[captacao-intel] error:", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
