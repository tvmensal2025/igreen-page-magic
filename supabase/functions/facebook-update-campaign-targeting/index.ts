// Atualiza a segmentação (cidades + endereços com raio) de uma campanha
// CTWA já publicada. Faz PATCH em cada AdSet da campanha na Graph API e
// atualiza a coluna `cities` em `facebook_campaigns` para refletir o novo
// snapshot local.
//
// Regras:
// - Apenas o dono da campanha (consultant_id) pode editar.
// - Aceita `cities` (municípios) E/OU `custom_locations` (lat/lng+raio km).
//   Pelo menos um dos dois deve ter itens.
// - Raio válido: 1..50 km. Limites Meta: até 200 custom_locations e ~200 cidades.
// - Erros da Meta são traduzidos e devolvidos em `error` para o UI.
import {
  adminClient,
  authConsultant,
  corsHeaders,
  fbFetch,
  loadPlatformAccount,
} from "../_shared/fb-graph.ts";

interface CityInput { key: string; name?: string }
interface RadiusInput {
  latitude: number;
  longitude: number;
  radius: number; // km
  address_string?: string;
  name?: string;
}
interface Body {
  campaign_id: string; // uuid interno (facebook_campaigns.id)
  cities?: CityInput[];
  custom_locations?: RadiusInput[];
}

function ok<T>(data: T, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function fail(msg: string, status = 400, extra: Record<string, unknown> = {}) {
  return ok({ error: msg, ...extra }, status);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = await authConsultant(req);
    if (!auth) return fail("unauthorized", 401);

    const body = (await req.json().catch(() => null)) as Body | null;
    if (!body?.campaign_id) return fail("campaign_id obrigatório");

    const cities = Array.isArray(body.cities) ? body.cities.filter((c) => c?.key) : [];
    const rawRadii = Array.isArray(body.custom_locations) ? body.custom_locations : [];
    const customLocations = rawRadii
      .filter((p) => Number.isFinite(p?.latitude) && Number.isFinite(p?.longitude))
      .map((p) => ({
        latitude: Number(p.latitude),
        longitude: Number(p.longitude),
        radius: Math.max(1, Math.min(50, Math.round(Number(p.radius) || 1))),
        address_string: p.address_string || undefined,
        name: p.name || undefined,
      }))
      .slice(0, 200);

    if (cities.length === 0 && customLocations.length === 0) {
      return fail("Informe pelo menos 1 cidade ou 1 endereço com raio.");
    }
    if (cities.length > 200) return fail("Máximo 200 cidades por campanha.");

    const admin = adminClient();
    const { data: camp, error: eCamp } = await admin
      .from("facebook_campaigns")
      .select("id, consultant_id, fb_adset_ids, fb_campaign_id, age_min, age_max")
      .eq("id", body.campaign_id)
      .maybeSingle();
    if (eCamp || !camp) return fail("Campanha não encontrada.", 404);
    if ((camp as any).consultant_id !== auth.id) return fail("Sem permissão para editar esta campanha.", 403);
    const adsetIds: string[] = ((camp as any).fb_adset_ids as string[]) || [];
    if (!adsetIds.length) return fail("Campanha sem AdSet publicado ainda.");

    const platform = await loadPlatformAccount();
    if (!platform?.token) return fail("Token da plataforma não disponível.", 500);

    // Monta geo_locations combinando cidades + custom_locations quando ambos.
    const geo: Record<string, unknown> = { location_types: ["home", "recent"] };
    if (cities.length) geo.cities = cities.map((c) => ({ key: c.key }));
    if (customLocations.length) {
      geo.custom_locations = customLocations.map((p) => ({
        latitude: p.latitude,
        longitude: p.longitude,
        radius: p.radius,
        distance_unit: "kilometer",
        ...(p.address_string ? { address_string: p.address_string } : {}),
        ...(p.name ? { name: p.name } : {}),
      }));
    }
    const targeting = {
      geo_locations: geo,
      age_min: (camp as any).age_min ?? 25,
      age_max: (camp as any).age_max ?? 65,
      targeting_automation: { advantage_audience: 1 },
    };

    // PATCH em cada AdSet — Meta aplica o novo targeting sem recriar o anúncio.
    const errors: { adset_id: string; error: string }[] = [];
    for (const adsetId of adsetIds) {
      try {
        await fbFetch(`/${adsetId}`, {
          method: "POST",
          body: new URLSearchParams({
            targeting: JSON.stringify(targeting),
            access_token: platform.token,
          }),
        });
      } catch (e) {
        errors.push({ adset_id: adsetId, error: (e as Error)?.message || String(e) });
      }
    }
    if (errors.length === adsetIds.length) {
      return fail("A Meta rejeitou a atualização em todos os AdSets.", 400, { details: errors });
    }

    // Serializa combinação em `cities` local (mantém compatibilidade com listagem)
    const citiesPersist = [
      ...cities.map((c) => ({ key: c.key, name: c.name || c.key })),
      ...customLocations.map((p) => ({
        key: `radius:${p.latitude.toFixed(5)},${p.longitude.toFixed(5)}:${p.radius}`,
        name: `${p.name || p.address_string || "Endereço"} (${p.radius}km)`,
      })),
    ];
    await admin
      .from("facebook_campaigns")
      .update({ cities: citiesPersist, updated_at: new Date().toISOString() })
      .eq("id", body.campaign_id);

    return ok({
      ok: true,
      updated_adsets: adsetIds.length - errors.length,
      total_adsets: adsetIds.length,
      partial_errors: errors,
      cities_saved: citiesPersist,
    });
  } catch (e) {
    console.error("[fb-update-targeting]", e);
    return fail((e as Error)?.message || "Erro interno", 500);
  }
});
