/**
 * tts-proxy — Edge Function que proxifica chamadas à API ElevenLabs.
 *
 * A chave ELEVENLABS_API_KEY fica APENAS no servidor (Supabase Secrets),
 * nunca exposta no frontend.
 *
 * POST /tts-proxy
 * Body: { text: string, voice_id?: string, model_id?: string, voice_settings?: object }
 * Retorna: audio/mpeg (stream)
 *
 * Requer: usuário autenticado (JWT válido no header Authorization).
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ELEVENLABS_KEY = Deno.env.get("ELEVENLABS_API_KEY") || "";
const DEFAULT_VOICE   = "EJV7H2baGt5ab95tOoSG"; // Voz oficial iGreen (áudio + ligação)
const DEFAULT_MODEL   = "eleven_v3";
const MODEL_V3 = "eleven_v3";
const MODEL_V2 = "eleven_multilingual_v2";

const VOICE_SETTINGS_V2: Record<string, unknown> = {
  stability: 0.9,
  similarity_boost: 1.0,
  style: 0.45,
  use_speaker_boost: true,
  speed: 1.0,
};

/** Natural (~0.5): pontuação e audio tags respondem melhor no v3. */
const VOICE_SETTINGS_V3: Record<string, unknown> = {
  stability: 0.5,
  similarity_boost: 0.75,
  style: 0.0,
  use_speaker_boost: true,
  speed: 1.0,
};

function defaultVoiceSettings(modelId: string): Record<string, unknown> {
  return modelId === MODEL_V3 || modelId === "eleven_v3"
    ? { ...VOICE_SETTINGS_V3 }
    : { ...VOICE_SETTINGS_V2 };
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Método não permitido" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Verificar autenticação — exige JWT válido
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Não autenticado" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!ELEVENLABS_KEY) {
    return new Response(
      JSON.stringify({ error: "ELEVENLABS_API_KEY não configurada no servidor. Acesse o painel do Supabase → Settings → Edge Functions → Secrets e adicione ELEVENLABS_API_KEY." }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  let body: {
    text?: string;
    voice_id?: string;
    model_id?: string;
    voice_settings?: Record<string, unknown>;
    language_code?: string;
  };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Body inválido" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const text = (body.text || "").trim();
  if (!text) {
    return new Response(JSON.stringify({ error: "Campo 'text' obrigatório" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const voiceId = body.voice_id || DEFAULT_VOICE;
  const modelId = body.model_id || DEFAULT_MODEL;
  const voiceSettings = body.voice_settings ?? defaultVoiceSettings(modelId);
  // Default PT-BR — nomes isolados sem isso saem com sotaque espanhol.
  const languageCode = (body.language_code || "pt").trim() || "pt";

  try {
    const elRes = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": ELEVENLABS_KEY,
        },
        body: JSON.stringify({
          text,
          model_id: modelId,
          language_code: languageCode,
          voice_settings: voiceSettings,
        }),
      },
    );

    if (!elRes.ok) {
      const errBody = await elRes.json().catch(() => null);
      const msg = errBody?.detail?.message || errBody?.message || `Erro ElevenLabs ${elRes.status}`;
      return new Response(JSON.stringify({ error: msg }), {
        status: elRes.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Retorna o áudio direto ao cliente
    const audioData = await elRes.arrayBuffer();
    return new Response(audioData, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "audio/mpeg",
        "Content-Length": String(audioData.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Erro interno";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
