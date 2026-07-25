// QA visual de criativo gerado via Google Gemini 2.5 Pro (vision direct).
// Fail-closed: qualquer erro reprova e nenhuma URL fora da allowlist é buscada.

import { authConsultant } from "../_shared/fb-graph.ts";
import { buildCors } from "../_shared/cors.ts";
import { geminiMultimodal } from "../_shared/gemini.ts";
import {
  bytesToBase64,
  fetchImageSafely,
} from "../_shared/safe-image-fetch.ts";

type QaReport = {
  approved: boolean;
  has_text: boolean;
  has_panel: boolean;
  looks_stock: boolean;
  has_deformed_face_or_hand: boolean;
  notes?: string;
};

const QA_SCHEMA = {
  type: "object",
  properties: {
    has_text: { type: "boolean" },
    has_panel: { type: "boolean" },
    looks_stock: { type: "boolean" },
    has_deformed_face_or_hand: { type: "boolean" },
    notes: { type: "string" },
  },
  required: [
    "has_text",
    "has_panel",
    "looks_stock",
    "has_deformed_face_or_hand",
  ],
};

const SYSTEM = `Você é auditor visual de anúncios iGreen Energy no Meta Ads.
- has_text=true SOMENTE se houver texto/letras GRANDES, LEGÍVEIS e em DESTAQUE (headline, watermark grande, logo com nome, infográfico, selo com %).
- IGNORE texto pequeno em props (papel, calendário, conta de luz, embalagens, livros).
- has_panel=true se aparece painel solar em telhado/paisagem (proibido).
- looks_stock=true se parece banco de imagem genérico americano.
- has_deformed_face_or_hand=true se há mão/dedo/rosto/olho anatomicamente errado.
Responda APENAS com JSON estrito conforme o schema.`;

async function analyze(imageUrl: string): Promise<QaReport> {
  // Download com allowlist, bloqueio de rede interna, sem redirect e com corte
  // por streaming — ver `_shared/safe-image-fetch.ts`.
  const image = await fetchImageSafely(imageUrl);

  const result = await geminiMultimodal({
    model: "gemini-2.5-pro",
    fallbackModel: "gemini-2.5-flash",
    system: SYSTEM,
    prompt:
      "Audite esta imagem destinada a anúncio iGreen Energy. Responda só o JSON.",
    base64: bytesToBase64(image.bytes),
    mimeType: image.mimeType,
    temperature: 0.1,
    responseMimeType: "application/json",
    responseSchema: QA_SCHEMA,
    functionName: "ad-creative-qa",
  });

  const parsed = JSON.parse(result.text || "");
  const booleanKeys = [
    "has_text",
    "has_panel",
    "looks_stock",
    "has_deformed_face_or_hand",
  ] as const;
  if (booleanKeys.some((key) => typeof parsed?.[key] !== "boolean")) {
    throw new Error("resposta de QA inválida");
  }
  return {
    approved: !parsed.has_text && !parsed.has_panel &&
      !parsed.has_deformed_face_or_hand,
    has_text: parsed.has_text,
    has_panel: parsed.has_panel,
    looks_stock: parsed.looks_stock,
    has_deformed_face_or_hand: parsed.has_deformed_face_or_hand,
    notes: typeof parsed.notes === "string" ? parsed.notes : "",
  };
}

Deno.serve(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "method_not_allowed", approved: false }),
      {
        status: 405,
        headers: { ...cors, "Content-Type": "application/json" },
      },
    );
  }

  const auth = await authConsultant(req);
  if (!auth) {
    return new Response(
      JSON.stringify({ error: "unauthorized", approved: false }),
      {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      },
    );
  }

  try {
    const body = await req.json();
    const imageUrl = typeof body?.image_url === "string"
      ? body.image_url.trim()
      : "";
    if (!imageUrl) {
      return new Response(
        JSON.stringify({ error: "image_url ausente", approved: false }),
        {
          status: 400,
          headers: { ...cors, "Content-Type": "application/json" },
        },
      );
    }
    const report = await analyze(imageUrl);
    return new Response(JSON.stringify(report), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[ad-creative-qa] error", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
        approved: false,
        has_text: false,
        has_panel: false,
        looks_stock: false,
        has_deformed_face_or_hand: false,
      }),
      {
        status: 502,
        headers: { ...cors, "Content-Type": "application/json" },
      },
    );
  }
});
