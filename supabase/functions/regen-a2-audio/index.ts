/**
 * regen-a2-audio — Regera o áudio A2 (corpo) via ElevenLabs para um gênero
 * e faz upload no bucket público `tts-cache`. Retorna a URL pública.
 *
 * POST body: { gender: "masculino" | "feminino" }
 * Não exige JWT (usa service role internamente e a ELEVENLABS_API_KEY do servidor).
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SOFIA_VOICE = "EJV7H2baGt5ab95tOoSG";
const MODEL_V3 = "eleven_v3";

// Ajustes fonéticos para PT-BR no ElevenLabs v3:
// - "iGreen" -> "iGrín" (evita leitura em inglês "ai-grín")
// - masculino: "díga" força a pronúncia correta da palavra "diga" no TTS
const BODY_TEXT_BY_GENDER: Record<"masculino" | "feminino", string> = {
  feminino: `Eu sou a Sofia, assistente virtual do Rafael Ferreira Dias, gestor da iGreen Energia.

Para eu montar a simulação, me diga quanto você está gastando por mês na conta de luz.`,
  masculino: `Eu sou a Sofia, assistente virtual do Rafael Ferreira Dias, gestor da iGrín Energia.

Para eu montar a simulação, me díga quanto você está gastando por mês na conta de luz.`,
};

// Voice settings v3 alinhado ao corpo A2 (mesmo perfil natural PT-BR).
const VOICE_SETTINGS_V3 = {
  stability: 0.55,
  similarity_boost: 0.8,
  style: 0.15,
  use_speaker_boost: true,
  speed: 0.98,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const ELEVENLABS_KEY = Deno.env.get("ELEVENLABS_API_KEY") || "";
  if (!ELEVENLABS_KEY) {
    return new Response(JSON.stringify({ error: "ELEVENLABS_API_KEY não configurada" }), {
      status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: { gender?: string };
  try { body = await req.json(); } catch { body = {}; }
  const gender = body.gender === "feminino" ? "feminino" : "masculino";
  const ttsText = BODY_TEXT_BY_GENDER[gender];

  try {
    const elRes = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${SOFIA_VOICE}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": ELEVENLABS_KEY,
        },
        body: JSON.stringify({
          text: ttsText,
          model_id: MODEL_V3,
          language_code: "pt",
          voice_settings: VOICE_SETTINGS_V3,
        }),
      },
    );

    if (!elRes.ok) {
      const errBody = await elRes.text();
      return new Response(JSON.stringify({ error: `ElevenLabs ${elRes.status}: ${errBody}` }), {
        status: elRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const audioBuf = new Uint8Array(await elRes.arrayBuffer());

    const supaUrl = Deno.env.get("SUPABASE_URL")!;
    const supaKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supaUrl, supaKey);

    // Garante bucket
    const { data: buckets } = await admin.storage.listBuckets();
    if (!buckets?.some((b) => b.id === "tts-cache")) {
      await admin.storage.createBucket("tts-cache", {
        public: true,
        fileSizeLimit: 10 * 1024 * 1024,
        allowedMimeTypes: ["audio/mpeg", "audio/mp3"],
      });
    }

    const ts = Date.now();
    const path = `multichannel-a2/${gender}-${ts}.mp3`;
    const { error: upErr } = await admin.storage.from("tts-cache").upload(path, audioBuf, {
      contentType: "audio/mpeg",
      upsert: true,
    });
    if (upErr) throw upErr;

    const { data: pub } = admin.storage.from("tts-cache").getPublicUrl(path);
    return new Response(JSON.stringify({ ok: true, gender, url: pub.publicUrl, bytes: audioBuf.byteLength, text: ttsText }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
