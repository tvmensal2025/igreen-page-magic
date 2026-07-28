/**
 * TTS ElevenLabs personalizado do pós-venda (Opus).
 * Cache em ai_media_library por hash do texto falado.
 */
import { hourBRT } from "./quiet-hours.ts";

const SOFIA_VOICE_ID = "EJV7H2baGt5ab95tOoSG";

export type SaudacaoBucket = "manha" | "tarde" | "noite";

export function saudacaoBucketBRT(now: Date = new Date()): SaudacaoBucket {
  const h = hourBRT(now);
  if (h < 12) return "manha";
  if (h < 18) return "tarde";
  return "noite";
}

export function textForTts(raw: string): string {
  return String(raw || "")
    .replace(/\*+/g, "")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, " ")
    // Abertura canônica pós-venda: "Olá, Nome Tudo bem?" → pausa natural no TTS.
    .replace(/Ol[áa],\s+([A-Za-zÀ-ÿ'’-]+)\s+Tudo bem\?/gi, "Olá, $1! Tudo bem?")
    .replace(/\s+/g, " ")
    .trim();
}

/** Roteiro com {{nome}}/{{saudacao}} exige TTS — áudio estático legado não serve. */
export function templateNeedsPersonalizedTts(raw: string | null | undefined): boolean {
  return /\{\{\s*(nome|saudacao)\s*\}\}/i.test(String(raw || ""));
}

async function sha16(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * TTS ElevenLabs (Opus) do texto já personalizado ({{nome}}/{{saudacao}}).
 * Cache em ai_media_library por hash do texto — evita re-gerar no retry/prep.
 */
export async function renderPersonalizedTtsAudio(
  supabase: any,
  consultantId: string,
  personalizedText: string,
): Promise<string | null> {
  const spoken = textForTts(personalizedText);
  if (spoken.length < 8) return null;

  const key = Deno.env.get("ELEVENLABS_API_KEY") || "";
  if (!key) {
    console.warn("[pos-venda-tts] ELEVENLABS_API_KEY ausente — sem TTS personalizado");
    return null;
  }

  const hash = await sha16(spoken);
  const slotKey = `pv_tts_${hash}`;

  try {
    const { data: cached } = await supabase
      .from("ai_media_library")
      .select("url")
      .eq("consultant_id", consultantId)
      .eq("slot_key", slotKey)
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (cached?.url) return String(cached.url);
  } catch {
    /* cache miss ok */
  }

  // Sofia canônica = eleven_v3 + SOFIA_VOICE_ID (a mesma voz do restante do produto).
  // Fallback só multilingual_v2 com a MESMA voice id — nunca Flash (timbre diferente).
  const models = ["eleven_v3", "eleven_multilingual_v2"] as const;
  let bytes: Uint8Array | null = null;
  let lastErr = "";

  for (const modelId of models) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const body: Record<string, unknown> = {
          text: spoken,
          model_id: modelId,
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.0,
            use_speaker_boost: true,
            speed: 1.0,
          },
        };
        if (modelId === "eleven_v3") body.language_code = "pt";

        const elRes = await fetch(
          `https://api.elevenlabs.io/v1/text-to-speech/${SOFIA_VOICE_ID}?output_format=opus_48000_64`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "xi-api-key": key,
              Accept: "audio/ogg",
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(90_000),
          },
        );
        if (elRes.ok) {
          const buf = new Uint8Array(await elRes.arrayBuffer());
          if (buf.byteLength >= 256) {
            bytes = buf;
            break;
          }
          lastErr = `${modelId}:empty`;
          console.warn("[pos-venda-tts] elevenlabs áudio vazio", modelId, attempt);
        } else {
          const err = await elRes.text().catch(() => "");
          lastErr = `${modelId}:${elRes.status}`;
          console.error(
            "[pos-venda-tts] elevenlabs falhou",
            modelId,
            elRes.status,
            `attempt=${attempt}`,
            err.slice(0, 200),
          );
          if (elRes.status === 401 || elRes.status === 403) {
            console.error("[pos-venda-tts] chave/plano bloqueado — abort");
            return null;
          }
          if (elRes.status === 429 || elRes.status >= 500) {
            await new Promise((r) => setTimeout(r, 800 * attempt));
            continue;
          }
          break;
        }
      } catch (e) {
        lastErr = `${modelId}:exc:${(e as Error)?.message || "err"}`;
        console.error(
          "[pos-venda-tts] exception",
          modelId,
          `attempt=${attempt}`,
          (e as Error)?.message,
        );
        await new Promise((r) => setTimeout(r, 600 * attempt));
      }
    }
    if (bytes) break;
  }

  if (!bytes) {
    console.error("[pos-venda-tts] Sofia falhou", lastErr, `chars=${spoken.length}`);
    return null;
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!supabaseUrl || !serviceRole) return null;

    let uploadRes: Response | null = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const fd = new FormData();
      fd.append("file", new Blob([bytes as BlobPart], { type: "audio/ogg" }), `${slotKey}.ogg`);
      fd.append("scope", "admin");
      fd.append("consultant_id", consultantId);
      fd.append("kind", "audio");
      fd.append("slug", slotKey.slice(0, 80));
      uploadRes = await fetch(`${supabaseUrl}/functions/v1/upload-media`, {
        method: "POST",
        headers: { Authorization: `Bearer ${serviceRole}`, apikey: serviceRole },
        body: fd,
        signal: AbortSignal.timeout(60_000),
      });
      if (uploadRes.ok) break;
      console.error("[pos-venda-tts] upload falhou", uploadRes.status, `attempt=${attempt}`);
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1000));
    }
    if (!uploadRes?.ok) return null;
    const uploaded = await uploadRes.json();
    const url = uploaded?.url ? String(uploaded.url) : null;
    if (!url) return null;

    try {
      await supabase.from("ai_media_library").insert({
        consultant_id: consultantId,
        slot_key: slotKey,
        url,
        kind: "audio",
        label: `pv_tts_${hash}`,
        transcript: spoken.slice(0, 500),
        active: true,
        is_public: false,
        is_draft: false,
        step_tags: [],
        intent_tags: ["pos_venda_tts"],
        priority: 0,
      });
    } catch {
      /* cache write best-effort */
    }
    return url;
  } catch (e) {
    console.error("[pos-venda-tts] upload exception", (e as Error)?.message);
    return null;
  }
}
