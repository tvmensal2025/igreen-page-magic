import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildCors } from "../_shared/cors.ts";
import {
  assertSafeAssetUrl,
  resolveAllowedAssetHosts,
  UnsafeAssetUrlError,
} from "../_shared/safe-image-fetch.ts";

const FORMAT_SPECS: Record<string, { ratio: string; safeArea: string }> = {
  square: {
    ratio: "1:1 (1080x1080)",
    safeArea:
      "Bordas externas: ~14% podem ser cortadas em alguns placements. Centralize tudo importante.",
  },
  vertical: {
    ratio: "4:5 (1080x1350)",
    safeArea:
      "Mantenha CTA, rosto e logo dentro do retângulo central de 4:5 — bordas superior/inferior podem ser cortadas no Reels/Stories.",
  },
  story: {
    ratio: "9:16 (1080x1920)",
    safeArea:
      "Topo 250px e rodapé 250px ficam cobertos por nome do criador, CTA e barra de progresso. Tudo crítico tem que ficar entre 14% e 80% da altura.",
  },
};

Deno.serve(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const auth = req.headers.get("Authorization") || "";
    if (!auth) return json({ error: "no auth", ok: false }, 401, cors);

    const supa = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      {
        global: { headers: { Authorization: auth } },
      },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "unauth", ok: false }, 401, cors);

    const { url, format } = await req.json();
    if (!url || !format || !FORMAT_SPECS[format]) {
      return json({ error: "url and format required", ok: false }, 400, cors);
    }
    // A URL é repassada a um gateway de IA externo, que vai buscá-la. Mesmo
    // sem download local, validamos host/protocolo pela mesma allowlist para
    // não transformar este endpoint num proxy de SSRF por terceiro.
    let parsedUrl: URL;
    try {
      parsedUrl = assertSafeAssetUrl(String(url), resolveAllowedAssetHosts());
    } catch (urlError) {
      const reason = urlError instanceof UnsafeAssetUrlError
        ? urlError.reason
        : "invalid_url";
      return json({ error: reason, ok: false }, 400, cors);
    }

    // Cache legado não é usado durante a contenção: registros fail-open antigos
    // não têm marcador que permita distingui-los de uma validação real.
    const apiKey = Deno.env.get("LOVABLE_API_KEY") ||
      Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) return json({ error: "no AI key", ok: false }, 500, cors);

    const spec = FORMAT_SPECS[format];
    const prompt =
      `Você é especialista em Meta Ads. Analise esta imagem para um anúncio em formato ${spec.ratio}.

Regras de safe-area: ${spec.safeArea}
Regras Meta:
- Texto cobrindo mais de 20% da imagem reduz alcance.
- Rosto, CTA, logo e oferta devem estar dentro da safe-area.
- Imagem com baixa resolução, desfocada, com marca d'água ou logos de terceiros é reprovada.

Retorne APENAS JSON válido:
{
  "ok": boolean,
  "score": 0-100,
  "text_coverage_pct": number,
  "has_face": boolean,
  "face_in_safe_area": boolean,
  "issues": [{"type": "text_overflow|face_cropped|low_quality|logo_outside|no_focus", "severity": "warning|error", "suggestion": "string em PT-BR"}],
  "summary": "string curta em PT-BR"
}`;

    const aiRes = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [{
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: parsedUrl.toString() } },
            ],
          }],
          response_format: { type: "json_object" },
        }),
      },
    );
    if (!aiRes.ok) {
      const txt = await aiRes.text();
      return json(
        { error: "ai_failed", detail: txt.slice(0, 500), ok: false },
        502,
        cors,
      );
    }
    const aiData = await aiRes.json();
    const raw = aiData.choices?.[0]?.message?.content || "";
    let validation: Record<string, unknown>;
    try {
      validation = JSON.parse(raw);
    } catch {
      return json({ error: "invalid_ai_json", ok: false }, 502, cors);
    }
    if (
      typeof validation.ok !== "boolean" || typeof validation.score !== "number"
    ) {
      return json({ error: "invalid_ai_schema", ok: false }, 502, cors);
    }

    await supa.from("ad_image_validations").upsert(
      { image_url: parsedUrl.toString(), format, validation },
      { onConflict: "image_url,format" },
    );

    return json({ ...validation, cached: false }, 200, cors);
  } catch (error) {
    return json(
      {
        error: error instanceof Error ? error.message : String(error),
        ok: false,
      },
      500,
      cors,
    );
  }
});

function json(body: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
