// Avalia campanhas CBO maduras e recomenda revisão humana. Não cria, ativa,
// pausa ou migra objetos na Meta automaticamente.
import { adminClient } from "../_shared/fb-graph.ts";
import {
  assertCronAuthStrict,
  cronAuthUnauthorized,
} from "../_shared/cron-auth.ts";
import { buildCors } from "../_shared/cors.ts";
import { ageInDays, evaluateCboToAbo } from "../_shared/cbo-abo.ts";

Deno.serve(async (req) => {
  const corsHeaders = buildCors(req, "x-service-secret, x-internal-secret");
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const admin = adminClient();
    const auth = await assertCronAuthStrict(req, admin);
    if (!auth.ok) return cronAuthUnauthorized(auth.reason, corsHeaders);
    const cutoff = new Date(Date.now() - 7 * 86400_000).toISOString();
    const { data: campaigns, error } = await admin
      .from("facebook_campaigns")
      .select(
        "id, consultant_id, name, cities, leads_count, daily_budget_cents, started_at",
      )
      .eq("status", "active")
      .eq("optimization_strategy", "cbo")
      .is("migrated_to_abo_at", null)
      .lt("started_at", cutoff)
      .gte("leads_count", 20)
      .limit(20);
    if (error) throw error;

    let recommended = 0;
    const now = Date.now();
    for (const campaign of campaigns || []) {
      // Decisão fica no helper puro `_shared/cbo-abo.ts`; aqui só I/O.
      const verdict = evaluateCboToAbo({
        name: String(campaign.name || ""),
        leadsCount: Number(campaign.leads_count || 0),
        cityCount: Array.isArray(campaign.cities) ? campaign.cities.length : 0,
        ageDays: ageInDays(
          (campaign as { started_at?: string }).started_at ?? null,
          now,
        ),
      });
      if (verdict.action !== "recommend_review") continue;

      const { data: existing } = await admin.from("ad_recommendations").select(
        "id",
      )
        .eq("consultant_id", campaign.consultant_id).eq("title", verdict.title)
        .is("dismissed_at", null).is("applied_at", null).limit(1);
      if (existing?.length) continue;
      const { error: insertError } = await admin.from("ad_recommendations")
        .insert({
          consultant_id: campaign.consultant_id,
          type: "cbo_abo_review",
          title: verdict.title,
          message: verdict.message,
          severity: "info",
          action_label: "Analisar distribuição",
          action_payload: {
            kind: "review_cbo_distribution",
            campaign_id: campaign.id,
          },
        });
      if (!insertError) recommended++;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        evaluated: campaigns?.length || 0,
        recommended,
        migrated: 0,
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
