// Migra um adset para o pixel correto da plataforma.
// Como Meta não permite trocar pixel num adset com entrega ativa,
// duplicamos o adset com /copies (deep_copy=true) e atualizamos
// promoted_object.pixel_id + tracking_specs do novo adset.
// O adset antigo é pausado; o novo nasce pausado e é ativado se o antigo estava ACTIVE.
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
      return new Response(JSON.stringify({ error: "Apenas admin pode migrar pixel" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    if (body?.confirm_learning_reset !== true) {
      return new Response(JSON.stringify({
        error: "Confirmação obrigatória: envie confirm_learning_reset: true para autorizar a duplicação do adset e o reset do aprendizado.",
      }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const adsetId = String(body?.adset_id || "").trim();
    if (!adsetId) {
      return new Response(JSON.stringify({ error: "adset_id obrigatório" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const platform = await loadPlatformAccount();
    if (!platform) {
      return new Response(JSON.stringify({ error: "Conta da plataforma não configurada" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const tk = platform.token;
    const correctPixelId = platform.pixel_id || "1521037349653769";
    const warnings: string[] = [];

    // 1) Lê adset atual
    const adset = await fbFetch(
      `/${adsetId}?fields=id,name,status,effective_status,promoted_object,tracking_specs,campaign_id&access_token=${tk}`
    );
    const currentPixel = adset.promoted_object?.pixel_id
      || (adset.tracking_specs?.find((s: any) => Array.isArray(s.fb_pixel))?.fb_pixel?.[0]);

    if (currentPixel === correctPixelId) {
      return new Response(JSON.stringify({
        ok: true, skipped: true, reason: "already_correct", adset_id: adsetId,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const wasActive = adset.effective_status === "ACTIVE" || adset.status === "ACTIVE";

    // 2) Pausa o adset original (necessário pra duplicar com segurança)
    if (wasActive) {
      await fbFetch(`/${adsetId}?access_token=${tk}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ status: "PAUSED" }),
      });
    }

    // 3) Duplica adset com deep_copy (copia ads/criativos)
    const copyRes = await fbFetch(`/${adsetId}/copies?access_token=${tk}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        deep_copy: "true",
        status_option: "PAUSED",
        rename_options: JSON.stringify({ rename_suffix: " - pixel-fix" }),
      }),
    });
    const newAdsetId = copyRes?.copied_adset_id || copyRes?.ad_object_ids?.[0]?.copied_id;
    if (!newAdsetId) {
      throw new Error("Meta não retornou id do novo adset");
    }

    // 4) Atualiza promoted_object + tracking_specs do novo adset
    const newPromoted = { ...(adset.promoted_object || {}), pixel_id: correctPixelId };
    // tracking_specs precisa ser array de objects com fb_pixel
    const newTracking = [
      { "action.type": ["offsite_conversion"], fb_pixel: [correctPixelId] },
    ];
    try {
      await fbFetch(`/${newAdsetId}?access_token=${tk}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          promoted_object: JSON.stringify(newPromoted),
          tracking_specs: JSON.stringify(newTracking),
        }),
      });
    } catch (e) {
      warnings.push(`Falha ao gravar promoted_object/tracking_specs: ${(e as Error).message}`);
    }

    // 5) Ativa novo adset se o antigo estava ativo
    if (wasActive) {
      try {
        await fbFetch(`/${newAdsetId}?access_token=${tk}`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ status: "ACTIVE" }),
        });
      } catch (e) {
        warnings.push(`Novo adset criado mas não ativado: ${(e as Error).message}. Ative manualmente no Gerenciador.`);
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      old_adset_id: adsetId,
      new_adset_id: newAdsetId,
      old_pixel_id: currentPixel || null,
      new_pixel_id: correctPixelId,
      reactivated: wasActive,
      warnings,
      note: "Adset duplicado com novo pixel. O antigo está pausado. Aprendizado será resetado.",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[fb-migrate-adset-pixel]", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
