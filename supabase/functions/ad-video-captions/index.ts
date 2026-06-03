// Gera legendas SRT em pt-BR para vídeos de anúncio usando Gemini 2.5.
// Body: { video_url: string }
// Resp: { srt: string, srt_url: string, lang: "pt_BR" } | { error: string }
//
// Para vídeos < 18MB: faz inline (base64) via geminiMultimodal.
// Para vídeos maiores: usa Files API do Gemini (upload temporário).
// O SRT volta como texto + uma URL pública no bucket IMAGE (pasta ad-captions/).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { geminiMultimodal } from "../_shared/gemini.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SRT_PROMPT = `Você é um legendador profissional brasileiro. Assista ao vídeo e gere LEGENDAS em formato SRT padrão, em português do Brasil.

REGRAS:
- Cada cue: máximo 2 linhas, máximo 42 caracteres por linha.
- Cada cue tem entre 1.5s e 4.0s de duração.
- Transcreva LITERALMENTE o que é falado. Sem inventar, sem resumir.
- Se houver silêncio ou só música, NÃO crie cue.
- Pontuação normal (vírgula, ponto). Sem caixa alta exagerada.
- Numeração sequencial começando em 1.
- Timestamps no formato HH:MM:SS,mmm (vírgula no separador de ms).

Responda APENAS com o conteúdo SRT puro, sem markdown, sem \`\`\`, sem texto antes ou depois.

Exemplo do formato esperado:
1
00:00:00,500 --> 00:00:02,800
Sua conta de luz tá cara demais?

2
00:00:02,900 --> 00:00:05,600
Eu vou te mostrar como pagar menos.`;

function isLikelyValidSrt(s: string): boolean {
  if (!s || s.length < 20) return false;
  // pelo menos uma seta de timestamp
  return /\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,.]\d{3}/.test(s);
}

function normalizeSrt(s: string): string {
  // troca . por , nos ms se vier americano e remove cercas de markdown
  let out = s.replace(/^```(?:srt)?\s*\n?/i, "").replace(/```\s*$/i, "").trim();
  out = out.replace(/(\d{2}:\d{2}:\d{2})\.(\d{3})/g, "$1,$2");
  // garante final newline duplo
  if (!out.endsWith("\n")) out += "\n";
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization") || "";
    if (!auth) return json({ error: "no auth" }, 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "unauthorized" }, 401);

    const { video_url } = await req.json().catch(() => ({}));
    if (!video_url || typeof video_url !== "string") return json({ error: "video_url required" }, 400);

    // Baixa o vídeo
    const vr = await fetch(video_url);
    if (!vr.ok) return json({ error: `download ${vr.status}` }, 502);
    const buf = new Uint8Array(await vr.arrayBuffer());
    const mime = vr.headers.get("content-type") || "video/mp4";
    const sizeMb = buf.byteLength / (1024 * 1024);
    console.log(`[ad-video-captions] downloaded ${sizeMb.toFixed(1)}MB mime=${mime}`);

    if (sizeMb > 19) {
      // Inline > 20MB estoura. Pular gracefully — o vídeo ainda vai ao ar sem legenda.
      return json({ error: "video_too_large_for_inline", hint: "Vídeo acima de 19MB — legenda não gerada nesta versão." }, 200);
    }

    // base64
    let bin = "";
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    const b64 = btoa(bin);

    const result = await geminiMultimodal({
      model: "gemini-2.5-pro",
      fallbackModel: "gemini-2.5-flash",
      prompt: SRT_PROMPT,
      base64: b64,
      mimeType: mime,
      temperature: 0.1,
      responseMimeType: "text/plain",
      functionName: "ad-video-captions",
      consultantId: user.id,
    });

    let srt = normalizeSrt(result.text || "");
    if (!isLikelyValidSrt(srt)) {
      console.warn("[ad-video-captions] invalid SRT returned:", srt.slice(0, 200));
      return json({ error: "invalid_srt", raw: srt.slice(0, 300) }, 200);
    }

    // Upload SRT pro bucket IMAGE pasta ad-captions
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const path = `ad-captions/${user.id}/${Date.now()}.pt_BR.srt`;
    const { error: upErr } = await admin.storage.from("IMAGE").upload(path, new TextEncoder().encode(srt), {
      contentType: "application/x-subrip",
      upsert: true,
    });
    if (upErr) {
      console.warn("[ad-video-captions] upload SRT falhou:", upErr.message);
      return json({ srt, srt_url: null, lang: "pt_BR", upload_error: upErr.message });
    }
    const { data: pub } = admin.storage.from("IMAGE").getPublicUrl(path);
    return json({ srt, srt_url: pub.publicUrl, lang: "pt_BR" });
  } catch (e) {
    console.error("[ad-video-captions] error:", e);
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
