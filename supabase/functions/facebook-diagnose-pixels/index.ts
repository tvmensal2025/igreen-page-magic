// Lista campanhas + adsets ativos da conta principal e mostra o Pixel
// que cada adset está usando (promoted_object.pixel_id + tracking_specs).
// Permissão: apenas admin/super_admin.
import { adminClient, authConsultant, corsHeaders, fbFetch, loadPlatformAccount } from "../_shared/fb-graph.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = await authConsultant(req);
    if (!auth) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const admin = adminClient();
    const { data: isAdmin } = await admin
      .from("user_roles").select("role")
      .eq("user_id", auth.id).in("role", ["admin", "super_admin"]).maybeSingle();
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Apenas admin pode diagnosticar pixels" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const platform = await loadPlatformAccount();
    if (!platform) {
      return new Response(JSON.stringify({ error: "Conta Facebook da plataforma não configurada" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const accId = platform.ad_account_id.startsWith("act_") ? platform.ad_account_id : `act_${platform.ad_account_id}`;
    const tk = platform.token;
    const correctPixelId = platform.pixel_id || "708759256921383";

    // Lista campanhas ativas
    const campRes = await fbFetch(
      `/${accId}/campaigns?fields=id,name,status,effective_status&limit=200&access_token=${tk}`
    );
    const campaigns: any[] = (campRes.data || []).filter((c: any) =>
      ["ACTIVE", "PAUSED"].includes(c.effective_status) || ["ACTIVE", "PAUSED"].includes(c.status)
    );

    // Pixel name cache
    const pixelNameCache = new Map<string, string>();
    async function pixelName(id: string): Promise<string> {
      if (!id) return "—";
      if (pixelNameCache.has(id)) return pixelNameCache.get(id)!;
      try {
        const r = await fetch(`https://graph.facebook.com/v21.0/${id}?fields=name&access_token=${tk}`);
        const j = await r.json();
        const n = j?.name || id;
        pixelNameCache.set(id, n);
        return n;
      } catch {
        return id;
      }
    }

    const rows: any[] = [];
    for (const c of campaigns) {
      try {
        const adsetRes = await fbFetch(
          `/${c.id}/adsets?fields=id,name,status,effective_status,promoted_object,tracking_specs&limit=200&access_token=${tk}`
        );
        for (const a of (adsetRes.data || [])) {
          if (!["ACTIVE", "PAUSED"].includes(a.effective_status) && !["ACTIVE", "PAUSED"].includes(a.status)) continue;
          const promotedPixel = a.promoted_object?.pixel_id || null;
          let trackingPixel: string | null = null;
          for (const s of (a.tracking_specs || [])) {
            if (Array.isArray(s.fb_pixel) && s.fb_pixel.length > 0) {
              trackingPixel = s.fb_pixel[0];
              break;
            }
          }
          const current = promotedPixel || trackingPixel;
          rows.push({
            campaign_id: c.id,
            campaign_name: c.name,
            adset_id: a.id,
            adset_name: a.name,
            status: a.status,
            effective_status: a.effective_status,
            current_pixel_id: current,
            current_pixel_name: current ? await pixelName(current) : null,
            is_correct: current === correctPixelId,
            has_pixel: !!current,
          });
        }
      } catch (e) {
        rows.push({
          campaign_id: c.id,
          campaign_name: c.name,
          error: (e as Error).message,
        });
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      correct_pixel_id: correctPixelId,
      correct_pixel_name: await pixelName(correctPixelId),
      total_adsets: rows.length,
      wrong_count: rows.filter((r) => r.has_pixel === false || r.is_correct === false).length,
      adsets: rows,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[fb-diagnose-pixels]", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
