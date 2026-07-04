// =============================================================================
// solar-roof-hd — imagem PROFISSIONAL do telhado (foto aérea HD + heatmap solar)
// =============================================================================
// Gera (e cacheia no Storage) a imagem de alta qualidade do telhado: foto aérea
// ~10cm/px da Solar API + mapa de calor de irradiação mascarado no telhado.
// A geração é cara (~20s, baixa 3 GeoTIFFs), então cacheamos por análise.
//
// Público controlado: exige consultor com módulo solar habilitado + rate-limit.
// A chave Google nunca vai ao frontend. Retorna { url, bounds }.
// =============================================================================
import { getAdminClient } from "../_shared/admin-client.ts";
import { buildCors } from "../_shared/cors.ts";
import { getGoogleApiKey, getDataLayerUrls, useMockMode } from "../_shared/solar/google-solar-client.ts";
import { buildHdRoof, type PanelDraw } from "../_shared/solar/data-layers.ts";
import { extractPanelPositions } from "../_shared/solar/economics-br.ts";
import { checkPublicRateLimit } from "../_shared/solar/rate-limit.ts";

const BUCKET = "solar-hd";

async function hashIp(value: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

Deno.serve(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const body = await req.json().catch(() => ({}));
    const analysisId = String(body.analysisId ?? "");
    const consultantId = String(body.consultantId ?? "");
    const showFlux = body.showFlux !== false; // default: mostra heatmap
    const panelsCount = body.panelsCount != null ? Number(body.panelsCount) : null;
    const force = body.force === true;
    if (!analysisId) return json({ error: "analysisId obrigatório" }, 400);

    const admin = getAdminClient("solar-roof-hd");

    // Busca a análise (lat/lng + consultor dono + insights p/ desenhar painéis).
    const { data: analysis } = await admin
      .from("solar_roof_analyses")
      .select("id, latitude, longitude, consultant_id, hd_image_path, hd_bounds, building_insights, max_panels")
      .eq("id", analysisId)
      .maybeSingle();
    if (!analysis) return json({ error: "Análise não encontrada" }, 404);

    const ownerId = consultantId || analysis.consultant_id;
    const { data: consultant } = await admin
      .from("consultants")
      .select("solar_3d_enabled, solar_public_widget_enabled")
      .eq("id", ownerId)
      .maybeSingle();
    if (!consultant?.solar_3d_enabled && !consultant?.solar_public_widget_enabled) {
      return json({ error: "Indisponível" }, 403);
    }

    const path = `${analysis.consultant_id}/${analysis.id}.png`;
    const publicUrl = () => {
      const { data } = admin.storage.from(BUCKET).getPublicUrl(path);
      return data.publicUrl;
    };

    // Cache hit: já gerada (a menos que force=true).
    if (!force && analysis.hd_image_path) {
      return json({ url: publicUrl(), cached: true, bounds: analysis.hd_bounds ?? null });
    }

    if (useMockMode()) return json({ error: "Imagem HD indisponível (demo)" }, 503);

    // Rate-limit por IP para a geração (cara).
    const fwd = req.headers.get("x-forwarded-for") ?? "unknown";
    const allowed = await checkPublicRateLimit(admin, await hashIp(fwd));
    if (!allowed) return json({ error: "Limite diário atingido" }, 429);

    const apiKey = getGoogleApiKey();
    if (!apiKey) return json({ error: "API Google não configurada" }, 503);

    const layers = await getDataLayerUrls(Number(analysis.latitude), Number(analysis.longitude), 60, apiKey);

    // Extrai os painéis reais (lat/lng + dimensão + azimute) p/ desenhar na imagem.
    const insights = analysis.building_insights as Record<string, unknown> | null;
    const nPanels = panelsCount ?? Math.min(14, Number(analysis.max_panels) || 14);
    const positions = insights
      ? extractPanelPositions(insights as never, nPanels)
      : [];
    const panels: PanelDraw[] = positions
      .filter((p) => typeof p.lat === "number" && typeof p.lng === "number")
      .map((p) => ({
        lat: p.lat as number,
        lng: p.lng as number,
        widthM: p.widthM ?? 1.05,
        heightM: p.heightM ?? 1.88,
        azimuthDegrees: typeof p.azimuthDegrees === "number" ? p.azimuthDegrees : 0,
      }));

    const hd = await buildHdRoof(layers, apiKey, {
      showFlux,
      fluxOpacity: 0.35,
      fluxMin: 0,
      fluxMax: 1800,
      panels,
    });

    const up = await admin.storage.from(BUCKET).upload(path, hd.png, {
      contentType: "image/png",
      upsert: true,
      cacheControl: "604800",
    });
    if (up.error) return json({ error: `upload falhou: ${up.error.message}` }, 502);

    await admin.from("solar_roof_analyses")
      .update({ hd_image_path: path, hd_bounds: hd.bounds ?? null })
      .eq("id", analysis.id);

    return json({ url: publicUrl(), cached: false, width: hd.width, height: hd.height, bounds: hd.bounds ?? null });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
