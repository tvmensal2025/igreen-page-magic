// Cron 12h: transforma sinais robustos de criativos fracos em recomendações.
// Não pausa anúncios, não altera orçamento e não afirma gerar variações sozinho.
import { adminClient, corsHeaders } from "../_shared/fb-graph.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = adminClient();
    // Pega apenas sinais classificados com amostra robusta pelo learner.
    const { data: losers } = await supabase
      .from("ad_creative_performance")
      .select("id, consultant_id, fb_ad_id, impressions, spend_cents, leads, registrations")
      .eq("is_loser", true)
      .is("paused_by_ai_at", null)
      .gte("impressions", 1500)
      .gte("spend_cents", 3000);

    let recommended = 0;
    const byConsultant = new Map<string, typeof losers>();
    (losers || []).forEach((item: any) => {
      const arr = byConsultant.get(item.consultant_id) || [];
      arr.push(item);
      byConsultant.set(item.consultant_id, arr);
    });

    for (const [consultantId, items] of byConsultant) {
      const title = `${items!.length} criativo${items!.length > 1 ? "s" : ""} precisa${items!.length > 1 ? "m" : ""} de revisão`;
      const { data: existing } = await supabase
        .from("ad_recommendations")
        .select("id")
        .eq("consultant_id", consultantId)
        .eq("type", "creative_review")
        .is("dismissed_at", null)
        .is("applied_at", null)
        .limit(1);
      if (existing?.length) continue;

      const { error } = await supabase.from("ad_recommendations").insert({
        consultant_id: consultantId,
        type: "creative_review",
        title,
        message: "Há gasto e entrega suficientes sem conversão. Revise copy, público e criativo antes de decidir pausar; nada foi alterado automaticamente.",
        severity: "warning",
        action_label: "Revisar no Gerenciador de Anúncios",
        action_payload: {
          kind: "review_creatives",
          fb_ad_ids: items!.map((item: any) => item.fb_ad_id),
        },
      });
      if (!error) recommended++;
    }

    return new Response(JSON.stringify({ ok: true, recommended, paused: 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
