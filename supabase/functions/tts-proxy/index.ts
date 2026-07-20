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

  // Regra de ouro: PT-BR + texto válido. Texto vazio/lixo → 400 (nunca ElevenLabs 400 opaco).
  const text = (body.text || "").replace(/\s+/g, " ").trim();
  if (text.length < 2) {
    return new Response(JSON.stringify({ error: "Campo 'text' obrigatório (mín. 2 caracteres)" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (text.length > 2500) {
    return new Response(JSON.stringify({ error: "Texto TTS longo demais (máx. 2500)" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Multicanal / WhatsApp / ligação: default Sofia profissional. Outras vozes só se o
  // cliente pedir explicitamente (Estúdio). Idioma SEMPRE pt (Brasil) — ignora override.
  const voiceId = (body.voice_id || "").trim() || DEFAULT_VOICE;
  const modelId = body.model_id === MODEL_V2 ? MODEL_V2 : (body.model_id || DEFAULT_MODEL);
  const voiceSettings = body.voice_settings ?? defaultVoiceSettings(modelId);
  const languageCode = "pt";

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

    const audioData = await elRes.arrayBuffer();
    // MP3 válido começa com ID3 ou frame 0xFFEx — evita devolver JSON/erro mascarado.
    const head = new Uint8Array(audioData.slice(0, 3));
    const looksMp3 =
      audioData.byteLength >= 100 &&
      ((head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) || head[0] === 0xff);
    if (!looksMp3) {
      return new Response(JSON.stringify({ error: "Resposta ElevenLabs inválida (não é MP3)" }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(audioData, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "audio/mpeg",
        "Content-Length": String(audioData.byteLength),
        "Cache-Control": "no-store",
        "X-Sofia-Voice": voiceId === DEFAULT_VOICE ? "1" : "0",
        "X-Tts-Lang": languageCode,
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Erro interno";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
