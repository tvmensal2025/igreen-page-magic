// Proxy da imagem de satélite REAL do telhado (Google Static Maps).
// A chave Google fica 100% no servidor; o frontend só recebe a imagem.
// Público (sem JWT): valida que o consultor tem o módulo solar habilitado e
// aplica rate-limit por IP para evitar abuso/custo.
import { getAdminClient } from "../_shared/admin-client.ts";
import { buildCors } from "../_shared/cors.ts";
import { getGoogleApiKey, useMockMode } from "../_shared/solar/google-solar-client.ts";
import { buildStaticMapUrl, type ImageryView } from "../_shared/solar/imagery.ts";
import { checkPublicRateLimit } from "../_shared/solar/rate-limit.ts";

async function hashIp(value: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

Deno.serve(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const url = new URL(req.url);
  const q = url.searchParams;

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const consultantId = String(q.get("consultantId") ?? "");
    if (!consultantId) return json({ error: "consultantId obrigatório" }, 400);

    const admin = getAdminClient("solar-roof-image");

    // Só serve imagem se o consultor tem o módulo habilitado.
    const { data: consultant } = await admin
      .from("consultants")
      .select("solar_3d_enabled, solar_public_widget_enabled")
      .eq("id", consultantId)
      .maybeSingle();
    if (!consultant?.solar_3d_enabled && !consultant?.solar_public_widget_enabled) {
      return json({ error: "Indisponível" }, 403);
    }

    // Rate-limit por IP (mesma trava da prévia pública).
    const fwd = req.headers.get("x-forwarded-for") ?? req.headers.get("cf-connecting-ip") ?? "unknown";
    const allowed = await checkPublicRateLimit(admin, await hashIp(fwd));
    if (!allowed) return json({ error: "Limite diário atingido" }, 429);

    const view: ImageryView = {
      centerLat: clampNum(q.get("lat"), -90, 90, 0),
      centerLng: clampNum(q.get("lng"), -180, 180, 0),
      zoom: clampNum(q.get("zoom"), 16, 21, 20),
      sizePx: clampNum(q.get("size"), 256, 640, 640),
      scale: 2,
    };

    if (useMockMode()) {
      // Sem chave: redireciona para um placeholder (não quebra a UI).
      return json({ error: "Imagem real indisponível (modo demonstração)" }, 503);
    }

    const apiKey = getGoogleApiKey();
    if (!apiKey) return json({ error: "API Google não configurada" }, 503);

    const mapUrl = buildStaticMapUrl(view, apiKey);
    const res = await fetch(mapUrl);
    if (!res.ok) {
      const txt = await res.text();
      return json({ error: "Falha ao obter imagem", detail: txt.slice(0, 400) }, 502);
    }

    const bytes = new Uint8Array(await res.arrayBuffer());
    return new Response(bytes, {
      status: 200,
      headers: {
        ...cors,
        "Content-Type": res.headers.get("content-type") ?? "image/png",
        // Cache agressivo: o telhado não muda. 7 dias no browser/CDN.
        "Cache-Control": "public, max-age=604800, immutable",
      },
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
