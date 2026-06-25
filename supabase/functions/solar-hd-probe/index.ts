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
    if (mode === "fluxdbg") {
      const { downloadTiffDebug } = await import("../_shared/solar/data-layers.ts");
      const dbg = await downloadTiffDebug(layers.annualFluxUrl!, apiKey);
      return json(dbg);
    }
    if (mode === "dims") {
      const { downloadTiff } = await import("../_shared/solar/data-layers.ts");
      const rgb = await downloadTiff(layers.rgbUrl!, apiKey, true);
      const flux = layers.annualFluxUrl ? await downloadTiff(layers.annualFluxUrl, apiKey, false) : null;
      const mask = layers.maskUrl ? await downloadTiff(layers.maskUrl, apiKey, false) : null;
      let fluxMin = Infinity, fluxMax = -Infinity, roofPx = 0;
      if (flux?.values) for (const v of flux.values) { if (Number.isFinite(v) && v > 0) { if (v < fluxMin) fluxMin = v; if (v > fluxMax) fluxMax = v; } }
      if (mask?.values) for (const v of mask.values) if (v > 0.5) roofPx++;
      return json({
        rgb: { w: rgb.width, h: rgb.height },
        flux: flux ? { w: flux.width, h: flux.height, min: Math.round(fluxMin), max: Math.round(fluxMax) } : null,
        mask: mask ? { w: mask.width, h: mask.height, roofPx } : null,
      });
    }
    return new Response(hd.png, {
      status: 200,
      headers: { ...cors, "Content-Type": "image/png", "Cache-Control": "no-store" },
    });
  } catch (e) {
    return json({ error: (e as Error).message, stack: String((e as Error).stack).slice(0, 400) }, 500);
  }
});
