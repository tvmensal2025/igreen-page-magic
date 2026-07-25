// Cron diário: analisa últimos 30 dias de criativos por consultor,
// identifica padrões vencedores/perdedores e gera recomendações.
import { adminClient, authConsultant } from "../_shared/fb-graph.ts";
import {
  assertCronAuthStrict,
  cronAuthUnauthorized,
} from "../_shared/cron-auth.ts";
import { buildCors } from "../_shared/cors.ts";
import { geminiGenerate } from "../_shared/gemini.ts";
import {
  assertSafeAssetUrl,
  resolveAllowedAssetHosts,
} from "../_shared/safe-image-fetch.ts";

interface AdRow {
  id: string;
  fb_ad_id: string;
  consultant_id: string;
  campaign_id: string;
  distribuidora: string | null;
  headline: string | null;
  primary_text: string | null;
  framework: string | null;
  impressions: number;
  clicks: number;
  leads: number;
  conversations: number;
  registrations: number;
  spend_cents: number;
  score: number;
}

function scoreOf(
  m: { spend_cents: number; leads: number; registrations: number },
): number {
  return m.registrations * 100 + m.leads * 10 - m.spend_cents / 100;
}

async function summarizeWithAI(
  samples: { winners: AdRow[]; losers: AdRow[] },
): Promise<
  {
    winning_patterns: string[];
    losing_patterns: string[];
    summary: string;
  } | null
> {
  const w = samples.winners.slice(0, 5).map((s) =>
    `[${
      s.framework || "?"
    }] "${s.headline}" — ${s.primary_text} | leads diretos:${s.leads} cad:${s.registrations} R$:${
      (s.spend_cents / 100).toFixed(2)
    }`
  ).join("\n");
  const l = samples.losers.slice(0, 5).map((s) =>
    `[${
      s.framework || "?"
    }] "${s.headline}" — ${s.primary_text} | leads diretos:${s.leads} cad:${s.registrations} R$:${
      (s.spend_cents / 100).toFixed(2)
    }`
  ).join("\n");
  const prompt =
    `Você é analista sênior de copy de Facebook Ads em pt-BR. Analise somente a copy dos anúncios abaixo e extraia padrões acionáveis. Não infira características de imagem.

VENCEDORES (geraram leads diretos/cadastros):
${w || "(nenhum)"}

PERDEDORES (gastaram sem lead direto/cadastro):
${l || "(nenhum)"}

Retorne JSON ESTRITO:
{
  "winning_patterns": ["padrão curto 1", "padrão curto 2", ...],
  "losing_patterns": ["padrão a evitar 1", ...],
  "summary": "1 frase curta com a principal lição"
}`;

  try {
    const r = await geminiGenerate({
      model: "gemini-2.5-pro",
      fallbackModel: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      temperature: 0.3,
      responseMimeType: "application/json",
      thinkingBudget: 2048,
      functionName: "ad-creative-learner",
    });
    return r.text ? JSON.parse(r.text) : null;
  } catch {
    return null;
  }
}

async function processConsultant(
  supabase: ReturnType<typeof adminClient>,
  consultantId: string,
) {
  // Junta métricas dos últimos 30 dias por ad
  const since = new Date(Date.now() - 30 * 86400_000).toISOString().slice(
    0,
    10,
  );
  const { data: campaigns } = await supabase
    .from("facebook_campaigns")
    .select("id, distribuidora, fb_ad_ids, creative_pack_id")
    .eq("consultant_id", consultantId);

  if (!campaigns || campaigns.length === 0) return { updated: 0 };

  const rows: AdRow[] = [];
  for (const camp of campaigns) {
    const adIds: string[] = Array.isArray(camp.fb_ad_ids)
      ? camp.fb_ad_ids as string[]
      : [];
    if (adIds.length === 0) continue;

    // Pega copy do creative_pack. Métricas de campanha não entram aqui:
    // somente linhas reais por anúncio podem alimentar classificação e score.
    let copyVariations: { text: string; framework: string }[] = [];
    if (camp.creative_pack_id) {
      const { data: pack } = await supabase
        .from("facebook_creative_packs")
        .select("copy_pack, generated_variants")
        .eq("id", camp.creative_pack_id)
        .maybeSingle();
      const variants = (pack?.generated_variants as any)?.headlines || [];
      copyVariations = Array.isArray(variants) ? variants : [];
    }

    // Métricas granulares reais por anúncio. A coluna `leads` desta tabela
    // contém somente ações diretas de lead; conversas permanecem separadas.
    const perAdMetrics: Record<string, {
      spend_cents: number;
      impressions: number;
      clicks: number;
      leads: number;
      conversations: number;
      registrations: number;
    }> = {};
    const { data: adMsAll } = await supabase
      .from("facebook_ad_metrics_daily")
      .select(
        "fb_ad_id, spend_cents, impressions, clicks, leads, messaging_conversations_started, complete_registrations",
      )
      .in("fb_ad_id", adIds)
      .gte("date", since);
    for (const row of adMsAll || []) {
      const k = row.fb_ad_id;
      const prev = perAdMetrics[k] ||
        {
          spend_cents: 0,
          impressions: 0,
          clicks: 0,
          leads: 0,
          conversations: 0,
          registrations: 0,
        };
      perAdMetrics[k] = {
        spend_cents: prev.spend_cents + Number(row.spend_cents || 0),
        impressions: prev.impressions + Number(row.impressions || 0),
        clicks: prev.clicks + Number(row.clicks || 0),
        leads: prev.leads + Number(row.leads || 0),
        conversations: prev.conversations +
          Number(row.messaging_conversations_started || 0),
        registrations: prev.registrations +
          Number(row.complete_registrations || 0),
      };
    }

    // Ausência de linha granular significa ausência de evidência por anúncio;
    // nunca rateamos métricas da campanha entre os anúncios.
    for (let i = 0; i < adIds.length; i++) {
      const adId = adIds[i];
      const m = perAdMetrics[adId];
      if (!m) continue;
      const cv = copyVariations[i % Math.max(copyVariations.length, 1)];
      rows.push({
        id: crypto.randomUUID(),
        fb_ad_id: adId,
        consultant_id: consultantId,
        campaign_id: camp.id,
        distribuidora: camp.distribuidora,
        headline: cv?.text || null,
        primary_text: null,
        framework: cv?.framework || null,
        impressions: m.impressions,
        clicks: m.clicks,
        leads: m.leads,
        conversations: m.conversations,
        registrations: m.registrations,
        spend_cents: m.spend_cents,
        score: 0,
      });
    }
  }

  rows.forEach((r) => {
    r.score = scoreOf(r);
  });
  rows.sort((a, b) => b.score - a.score);

  // Pré-busca copy real (vinda do facebook-sync-ad-creatives) antes de formar
  // vencedores/perdedores e enviar amostras à IA.
  const allAdIds = rows.map((r) => r.fb_ad_id);
  const realCopyMap: Record<
    string,
    {
      headline: string | null;
      primary_text: string | null;
      creative_format: string | null;
    }
  > = {};
  if (allAdIds.length) {
    const { data: existing } = await supabase
      .from("ad_creative_performance")
      .select("fb_ad_id, headline, primary_text, creative_format")
      .in("fb_ad_id", allAdIds);
    for (const e of existing || []) {
      realCopyMap[e.fb_ad_id] = {
        headline: e.headline,
        primary_text: e.primary_text,
        creative_format: e.creative_format,
      };
    }
  }
  for (const row of rows) {
    const real = realCopyMap[row.fb_ad_id];
    if (real?.headline) row.headline = real.headline;
    if (real?.primary_text) row.primary_text = real.primary_text;
  }

  // Não chama clique isolado de vencedor nem condena criativo cedo. As faixas
  // dão tempo para a fase de aprendizado da Meta produzir uma amostra útil.
  const winners = rows.filter((r) =>
    r.impressions >= 1000 && r.spend_cents >= 1500 &&
    (r.leads >= 5 || r.registrations >= 2)
  ).slice(0, 5);
  const losers = rows.filter((r) =>
    r.impressions >= 1500 && r.spend_cents >= 3000 && r.leads === 0 &&
    r.registrations === 0
  ).slice(0, 5);

  // Upsert performance per ad — preserva copy real do Meta quando existir
  for (const r of rows) {
    const real = realCopyMap[r.fb_ad_id];
    await supabase.from("ad_creative_performance").upsert({
      consultant_id: r.consultant_id,
      campaign_id: r.campaign_id,
      fb_ad_id: r.fb_ad_id,
      headline: real?.headline ?? r.headline,
      primary_text: real?.primary_text ?? r.primary_text,
      creative_format: real?.creative_format ?? null,
      framework: r.framework,
      impressions: r.impressions,
      clicks: r.clicks,
      leads: r.leads,
      registrations: r.registrations,
      spend_cents: r.spend_cents,
      score: r.score,
      is_winner: winners.some((w) => w.fb_ad_id === r.fb_ad_id),
      is_loser: losers.some((l) => l.fb_ad_id === r.fb_ad_id),
      evaluated_at: new Date().toISOString(),
    }, { onConflict: "fb_ad_id" });
  }

  // Padrões via IA
  const insights = await summarizeWithAI({ winners, losers }) || {
    winning_patterns: winners.map((w) => w.framework).filter(
      Boolean,
    ) as string[],
    losing_patterns: [],
    summary: "Aprendizado em construção. Roda mais alguns dias.",
  };

  const bestCtr = rows.length
    ? Math.max(
      ...rows.map((r) =>
        r.impressions > 0 ? Math.round(r.clicks * 10000 / r.impressions) : 0
      ),
    )
    : 0;
  const bestCpa = winners.find((w) => w.registrations > 0);

  // Por distribuidora (agrupa)
  const distribs = Array.from(new Set(rows.map((r) => r.distribuidora || "")))
    .filter(Boolean);
  for (const d of distribs.length ? distribs : [null]) {
    await supabase.from("ad_creative_insights").upsert({
      consultant_id: consultantId,
      distribuidora: d,
      winning_patterns: insights.winning_patterns,
      losing_patterns: insights.losing_patterns,
      best_image_traits: [],
      best_ctr_bps: bestCtr,
      best_cpa_cents: bestCpa
        ? Math.round(bestCpa.spend_cents / bestCpa.registrations)
        : null,
      sample_size: rows.length,
      summary: insights.summary,
      updated_at: new Date().toISOString(),
    }, { onConflict: "consultant_id,distribuidora" });
  }

  // Recomendações pró-ativas (1 por dia, deduplicada por título)
  if (insights.winning_patterns.length > 0) {
    const top = insights.winning_patterns[0];
    const title = `Padrão vencedor: ${top}`;
    const { data: existing } = await supabase
      .from("ad_recommendations")
      .select("id")
      .eq("consultant_id", consultantId)
      .eq("title", title)
      .is("dismissed_at", null)
      .is("applied_at", null)
      .limit(1);
    if (!existing || existing.length === 0) {
      await supabase.from("ad_recommendations").insert({
        consultant_id: consultantId,
        type: "winning_pattern",
        title,
        message: insights.summary,
        severity: "success",
        action_label: "Aplicar nas próximas campanhas",
        action_payload: { pattern: top, kind: "winning" },
      });
    }
  }
  if (losers.length >= 3) {
    const title = "Anúncios fracos detectados";
    const { data: existing } = await supabase
      .from("ad_recommendations")
      .select("id").eq("consultant_id", consultantId).eq("title", title)
      .is("dismissed_at", null).is("applied_at", null).limit(1);
    if (!existing || existing.length === 0) {
      await supabase.from("ad_recommendations").insert({
        consultant_id: consultantId,
        type: "losers_detected",
        title,
        message:
          `${losers.length} anúncios têm amostra robusta de gasto e entrega sem conversão. O creative-rotator pode pausar losers elegíveis; revise o painel.`,
        severity: "warning",
        action_label: "Revisar criativos",
        action_payload: {
          kind: "review_creatives",
          fb_ad_ids: losers.map((item) => item.fb_ad_id),
        },
      });
    }
  }

  // Fecha o loop: promove foto do winner para brain_config (sem POST em ad vivo).
  let winnerPromoted: string | null = null;
  if (winners.length > 0) {
    const top = winners[0];
    const { data: camp } = await supabase
      .from("facebook_campaigns")
      .select("id, thumbnail_url, creative_pack_id")
      .eq("id", top.campaign_id)
      .maybeSingle();
    let candidate: string | null = null;
    const thumb = String(camp?.thumbnail_url || "").trim();
    if (thumb.startsWith("https://")) candidate = thumb;
    if (!candidate && camp?.creative_pack_id) {
      const { data: pack } = await supabase
        .from("facebook_creative_packs")
        .select("photos")
        .eq("id", camp.creative_pack_id)
        .maybeSingle();
      const photos = pack?.photos;
      if (Array.isArray(photos)) {
        for (const p of photos) {
          const url = typeof p === "string"
            ? p
            : (p && typeof p === "object"
              ? String((p as { url?: string }).url || "")
              : "");
          if (url.startsWith("https://")) {
            candidate = url;
            break;
          }
        }
      }
    }
    if (candidate) {
      try {
        const safe = assertSafeAssetUrl(
          candidate,
          resolveAllowedAssetHosts(),
        ).toString();
        const { data: settings } = await supabase
          .from("consultant_ad_settings")
          .select("brain_config")
          .eq("consultant_id", consultantId)
          .maybeSingle();
        const prev = (settings?.brain_config &&
            typeof settings.brain_config === "object")
          ? settings.brain_config as Record<string, unknown>
          : {};
        if (String(prev.winner_photo_url || "") !== safe) {
          await supabase.from("consultant_ad_settings").upsert({
            consultant_id: consultantId,
            brain_config: { ...prev, winner_photo_url: safe },
            updated_at: new Date().toISOString(),
          }, { onConflict: "consultant_id" });
          winnerPromoted = safe;
          console.log(JSON.stringify({
            action: "winner_promote",
            consultant_id: consultantId,
            campaign_id: top.campaign_id,
            fb_ad_id: top.fb_ad_id,
          }));
        }
      } catch (e) {
        console.warn(
          "[ad-creative-learner] winner_promote skipped",
          (e as Error).message,
        );
      }
    }
  }

  return { updated: rows.length, winner_promoted: winnerPromoted };
}

Deno.serve(async (req) => {
  const corsHeaders = buildCors(req, "x-service-secret, x-internal-secret");
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const supabase = adminClient();
    // Cron usa credencial de serviço; o botão do consultor na UI (InsightsPanel)
    // chega com JWT — os dois caminhos são válidos, anônimo não.
    const cronAuth = await assertCronAuthStrict(req, supabase);
    if (!cronAuth.ok && !(await authConsultant(req))) {
      return cronAuthUnauthorized(cronAuth.reason, corsHeaders);
    }
    // Lista consultores ativos com campanhas
    const { data: consultants } = await supabase
      .from("facebook_campaigns")
      .select("consultant_id")
      .neq("status", "draft");
    const ids = Array.from(
      new Set((consultants || []).map((c: any) => c.consultant_id)),
    ).filter(Boolean);

    let totalUpdated = 0;
    for (const id of ids) {
      try {
        const r = await processConsultant(supabase, id);
        totalUpdated += r.updated;
      } catch (e) {
        console.error("learner consultor", id, e);
      }
    }

    // Insight global: consolida padrões vencedores/perdedores entre TODOS consultores
    // e grava em ad_playbooks (scope='global') — consumido pelo ad-creative-builder
    // como "prior" do que está funcionando na rede agora.
    try {
      const { data: allInsights } = await supabase
        .from("ad_creative_insights")
        .select("winning_patterns, losing_patterns, sample_size, summary")
        .gte("updated_at", new Date(Date.now() - 7 * 86400_000).toISOString());
      const tally = (key: "winning_patterns" | "losing_patterns") => {
        const m = new Map<string, number>();
        for (const r of allInsights || []) {
          for (const p of (r as any)[key] || []) {
            const k = String(p).trim();
            if (k) m.set(k, (m.get(k) || 0) + ((r as any).sample_size || 1));
          }
        }
        return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10)
          .map(([pattern, weight]) => ({ pattern, weight }));
      };
      const payload = {
        winning_patterns: tally("winning_patterns"),
        losing_patterns: tally("losing_patterns"),
        best_image_traits: [],
        consultants_in_sample: (allInsights || []).length,
      };
      await supabase.from("ad_playbooks").upsert({
        scope: "global",
        consultant_id: null,
        source_metric: "learner_daily_aggregate",
        payload,
        generated_at: new Date().toISOString(),
      }, { onConflict: "scope,source_metric" });
    } catch (e) {
      console.warn("global playbook falhou:", (e as Error).message);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        consultants: ids.length,
        ads_evaluated: totalUpdated,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
