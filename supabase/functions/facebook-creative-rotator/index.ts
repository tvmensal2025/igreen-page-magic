// Cron 12h: pausa ads losers com amostra robusta (creative_rotate) + recomenda.
// Não altera orçamento nem campanha inteira; não reativa losers.
import { adminClient, loadPlatformAccount, FB_GRAPH } from "../_shared/fb-graph.ts";
import {
  assertCronAuthStrict,
  cronAuthUnauthorized,
} from "../_shared/cron-auth.ts";
import { buildCors } from "../_shared/cors.ts";
import { isAdsActionAllowedForConfig } from "../_shared/brain-config.ts";

async function pauseAd(fbAdId: string, token: string) {
  const r = await fetch(`${FB_GRAPH}/${fbAdId}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      status: "PAUSED",
      access_token: token,
    }),
  });
  const body = await r.text();
  if (!r.ok) {
    throw new Error(`pause ad ${fbAdId}: ${r.status} ${body.slice(0, 200)}`);
  }
}

Deno.serve(async (req) => {
  const corsHeaders = buildCors(req, "x-service-secret, x-internal-secret");
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const supabase = adminClient();
    const auth = await assertCronAuthStrict(req, supabase);
    if (!auth.ok) return cronAuthUnauthorized(auth.reason, corsHeaders);

    const { data: losers } = await supabase
      .from("ad_creative_performance")
      .select(
        "id, consultant_id, fb_ad_id, impressions, spend_cents, leads, registrations",
      )
      .eq("is_loser", true)
      .is("paused_by_ai_at", null)
      .gte("impressions", 1500)
      .gte("spend_cents", 3000);

    let recommended = 0;
    let paused = 0;
    const errors: Array<Record<string, unknown>> = [];
    const byConsultant = new Map<string, NonNullable<typeof losers>>();
    (losers || []).forEach((item: any) => {
      const arr = byConsultant.get(item.consultant_id) || [];
      arr.push(item);
      byConsultant.set(item.consultant_id, arr);
    });

    const platform = await loadPlatformAccount();
    const token = platform?.token || "";

    for (const [consultantId, items] of byConsultant) {
      const title = `${items!.length} criativo${
        items!.length > 1 ? "s" : ""
      } precisa${items!.length > 1 ? "m" : ""} de revisão`;
      const { data: existing } = await supabase
        .from("ad_recommendations")
        .select("id")
        .eq("consultant_id", consultantId)
        .eq("type", "creative_review")
        .is("dismissed_at", null)
        .is("applied_at", null)
        .limit(1);
      if (!existing?.length) {
        const { error } = await supabase.from("ad_recommendations").insert({
          consultant_id: consultantId,
          type: "creative_review",
          title,
          message:
            "Há gasto e entrega suficientes sem conversão. Losers elegíveis podem ser pausados automaticamente no ad (não na campanha).",
          severity: "warning",
          action_label: "Revisar no Gerenciador de Anúncios",
          action_payload: {
            kind: "review_creatives",
            fb_ad_ids: items!.map((item: any) => item.fb_ad_id),
          },
        });
        if (!error) recommended++;
      }

      const { data: settings } = await supabase
        .from("consultant_ad_settings")
        .select("brain_config")
        .eq("consultant_id", consultantId)
        .maybeSingle();
      if (
        !isAdsActionAllowedForConfig(settings?.brain_config, "creative_rotate")
      ) {
        continue;
      }
      if (!token) {
        errors.push({ consultant_id: consultantId, error: "no_meta_token" });
        continue;
      }

      // Cap: no máximo 3 ads pausados por consultor por tick.
      for (const item of (items || []).slice(0, 3)) {
        try {
          await pauseAd(String(item.fb_ad_id), token);
          await supabase.from("ad_creative_performance").update({
            paused_by_ai_at: new Date().toISOString(),
          }).eq("id", item.id);
          paused++;
          console.log(JSON.stringify({
            action: "creative_pause",
            consultant_id: consultantId,
            fb_ad_id: item.fb_ad_id,
          }));
        } catch (e) {
          errors.push({
            consultant_id: consultantId,
            fb_ad_id: item.fb_ad_id,
            error: (e as Error).message,
          });
        }
      }
    }

    return new Response(
      JSON.stringify({ ok: true, recommended, paused, errors }),
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
