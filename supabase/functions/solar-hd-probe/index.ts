// DIAGNÓSTICO TEMPORÁRIO: valida Data Layers + GeoTIFF no runtime edge.
// Remover após validação.
import { getAdminClient } from "../_shared/admin-client.ts";
import { buildCors } from "../_shared/cors.ts";
import { getGoogleApiKey } from "../_shared/solar/google-solar-client.ts";
import { getDataLayerUrls } from "../_shared/solar/google-solar-client.ts";
import { buildHdRoof } from "../_shared/solar/data-layers.ts";

Deno.serve(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const url = new URL(req.url);
    const lat = Number(url.searchParams.get("lat") ?? "-23.5614");
    const lng = Number(url.searchParams.get("lng") ?? "-46.6559");
    const mode = url.searchParams.get("mode") ?? "info";
    const apiKey = getGoogleApiKey();
    if (!apiKey) return json({ error: "sem key" }, 503);

    const t0 = Date.now();
    const layers = await getDataLayerUrls(lat, lng, 60, apiKey);
    const info = {
      hasRgb: !!layers.rgbUrl,
      hasFlux: !!layers.annualFluxUrl,
      hasMask: !!layers.maskUrl,
      imageryQuality: layers.imageryQuality,
      msList: Date.now() - t0,
    };
    if (mode === "info") return json(info);

    // mode=image → compõe e devolve o PNG HD
    const hd = await buildHdRoof(layers, apiKey, { showFlux: true });
    if (mode === "bounds") {
      return json({ ...info, bounds: hd.bounds, width: hd.width, height: hd.height, ms: Date.now() - t0 });
    }
    return new Response(hd.png, {
      status: 200,
      headers: { ...cors, "Content-Type": "image/png", "Cache-Control": "no-store" },
    });
  } catch (e) {
    return json({ error: (e as Error).message, stack: String((e as Error).stack).slice(0, 400) }, 500);
  }
});
