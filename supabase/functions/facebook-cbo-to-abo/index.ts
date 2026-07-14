// Avalia campanhas CBO maduras e recomenda revisão humana. Não cria, ativa,
// pausa ou migra objetos na Meta automaticamente.
import { adminClient, corsHeaders } from "../_shared/fb-graph.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const admin = adminClient();
    const cutoff = new Date(Date.now() - 7 * 86400_000).toISOString();
    const { data: campaigns, error } = await admin
      .from("facebook_campaigns")
      .select("id, consultant_id, name, cities, leads_count, daily_budget_cents")
      .eq("status", "active")
      .eq("optimization_strategy", "cbo")
      .is("migrated_to_abo_at", null)
      .lt("started_at", cutoff)
      .gte("leads_count", 20)
      .limit(20);
    if (error) throw error;

    let recommended = 0;
    for (const campaign of campaigns || []) {
      const cityCount = Array.isArray(campaign.cities) ? campaign.cities.length : 0;
      if (cityCount < 2) continue;
      const title = `Avaliar divisão por região: ${campaign.name}`;
      const { data: existing } = await admin.from("ad_recommendations").select("id")
        .eq("consultant_id", campaign.consultant_id).eq("title", title)
        .is("dismissed_at", null).is("applied_at", null).limit(1);
      if (existing?.length) continue;
      const { error: insertError } = await admin.from("ad_recommendations").insert({
        consultant_id: campaign.consultant_id,
        type: "cbo_abo_review",
        title,
        message: `A campanha tem ${campaign.leads_count} resultados em ${cityCount} cidades. Avalie a distribuição por região no Gerenciador; nenhuma campanha nova foi criada.`,
        severity: "info",
        action_label: "Analisar distribuição",
        action_payload: { kind: "review_cbo_distribution", campaign_id: campaign.id },
      });
      if (!insertError) recommended++;
    }

    return new Response(JSON.stringify({ ok: true, evaluated: campaigns?.length || 0, recommended, migrated: 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});