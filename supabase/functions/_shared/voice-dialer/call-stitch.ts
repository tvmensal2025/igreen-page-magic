/**
 * Costura intro "Olá, {Nome}." (ElevenLabs) + corpo MP3 → upload Velip.
 * Usado por voice-call-stitch e voice-dialer-cron.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { uploadAudioFile } from "./velip.ts";

export type AdminClient = ReturnType<typeof createClient>;

const DEFAULT_VOICE = "EJV7H2baGt5ab95tOoSG";
const DEFAULT_MODEL = "eleven_v3";

export function normalizeCallName(input: string): string {
  return (input || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

export function firstNameFrom(raw: string | null | undefined): string {
  const n = String(raw || "").trim();
  if (!n) return "";
  return n.split(/\s+/)[0] || "";
}

function concatMp3Bytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** Remove ID3v2 do início (exceto o 1º trecho) para concat MP3 limpa. */
async function stripId3(bytes: Uint8Array): Promise<Uint8Array> {
  if (bytes.length < 10) return bytes;
  if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return bytes;
  const size = (bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9];
  const total = 10 + size;
  if (total >= bytes.length) return bytes;
  return bytes.slice(total);
}

export async function concatMp3Parts(parts: Uint8Array[]): Promise<Uint8Array> {
  if (parts.length === 0) return new Uint8Array();
  if (parts.length === 1) return parts[0];
  const cleaned: Uint8Array[] = [parts[0]];
  for (let i = 1; i < parts.length; i++) cleaned.push(await stripId3(parts[i]));
  return concatMp3Bytes(cleaned);
}

function voiceSettingsForModel(modelId: string): Record<string, unknown> {
  if (modelId === "eleven_v3") {
    return {
      stability: 0.5,
      similarity_boost: 0.75,
      style: 0.0,
      use_speaker_boost: true,
      speed: 1.0,
    };
  }
  return {
    stability: 0.9,
    similarity_boost: 1.0,
    style: 0.45,
    use_speaker_boost: true,
    speed: 1.0,
  };
}

export async function synthesizeIntroMp3(opts: {
  displayName: string;
  voiceId: string;
  modelId: string;
}): Promise<Uint8Array> {
  const key = (Deno.env.get("ELEVENLABS_API_KEY") || "").trim();
  if (!key) throw new Error("ELEVENLABS_API_KEY_missing");
  const text = `Olá, ${opts.displayName}.`;
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${opts.voiceId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "xi-api-key": key,
    },
    body: JSON.stringify({
      text,
      model_id: opts.modelId,
      language_code: "pt",
      voice_settings: voiceSettingsForModel(opts.modelId),
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    const msg = err?.detail?.message || err?.message || `elevenlabs_${res.status}`;
    throw new Error(msg);
  }
  return new Uint8Array(await res.arrayBuffer());
}

export interface StitchResult {
  ok: boolean;
  velip_audio_id?: string;
  cached?: boolean;
  fallback_body?: boolean;
  error?: string;
  render_id?: string;
}

/**
 * Resolve áudio final personalizado (nome + corpo) ou fallback no corpo puro.
 */
export async function resolvePersonalizedCallAudio(
  admin: AdminClient,
  opts: {
    consultantId: string;
    bodyClipId: string;
    rawName: string | null | undefined;
    /** Se true e falhar stitch, devolve velip do corpo. */
    fallbackToBody?: boolean;
  },
): Promise<StitchResult> {
  const fallback = opts.fallbackToBody !== false;
  const display = firstNameFrom(opts.rawName);
  const nameNorm = normalizeCallName(display);

  const { data: clip } = await admin
    .from("voice_audio_clips")
    .select("id, audio_url, name, velip_audio_id, voice_id, model_id, consultant_id")
    .eq("id", opts.bodyClipId)
    .eq("consultant_id", opts.consultantId)
    .maybeSingle();

  if (!clip?.audio_url) return { ok: false, error: "body_clip_not_found" };

  const voiceId = String(clip.voice_id || DEFAULT_VOICE);
  const modelId = String(clip.model_id || DEFAULT_MODEL);
  const bodyVelip = clip.velip_audio_id ? String(clip.velip_audio_id) : null;

  // Sem nome → só o corpo
  if (!display || !nameNorm) {
    if (bodyVelip) return { ok: true, velip_audio_id: bodyVelip, fallback_body: true, cached: true };
    return { ok: false, error: "no_name_and_no_body_velip" };
  }

  const { data: existing } = await admin
    .from("voice_call_renders")
    .select("id, velip_audio_id")
    .eq("body_clip_id", opts.bodyClipId)
    .eq("name_normalized", nameNorm)
    .eq("voice_id", voiceId)
    .eq("model_id", modelId)
    .maybeSingle();

  if (existing?.velip_audio_id) {
    return {
      ok: true,
      velip_audio_id: existing.velip_audio_id,
      cached: true,
      render_id: existing.id,
    };
  }

  try {
    const bodyRes = await fetch(clip.audio_url, { signal: AbortSignal.timeout(45_000) });
    if (!bodyRes.ok) throw new Error(`body_download_${bodyRes.status}`);
    const bodyBytes = new Uint8Array(await bodyRes.arrayBuffer());

    const introBytes = await synthesizeIntroMp3({
      displayName: display,
      voiceId,
      modelId,
    });

    const merged = await concatMp3Parts([introBytes, bodyBytes]);
    const slug = `call-${opts.bodyClipId.slice(0, 8)}-${nameNorm}`.slice(0, 60);
    const up = await uploadAudioFile(merged, slug, "audio/mpeg");
    if (!up.ok || !up.audio_id) throw new Error(up.error || "velip_upload_failed");

    const { data: upserted, error: upErr } = await admin
      .from("voice_call_renders")
      .upsert(
        {
          consultant_id: opts.consultantId,
          body_clip_id: opts.bodyClipId,
          name_normalized: nameNorm,
          display_name: display,
          voice_id: voiceId,
          model_id: modelId,
          velip_audio_id: up.audio_id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "body_clip_id,name_normalized,voice_id,model_id" },
      )
      .select("id, velip_audio_id")
      .maybeSingle();

    if (upErr) console.warn("[call-stitch] upsert warn:", upErr.message);

    return {
      ok: true,
      velip_audio_id: up.audio_id,
      cached: false,
      render_id: upserted?.id,
    };
  } catch (e) {
    const msg = (e as Error)?.message || "stitch_failed";
    if (fallback && bodyVelip) {
      return { ok: true, velip_audio_id: bodyVelip, fallback_body: true, error: msg };
    }
    return { ok: false, error: msg };
  }
}

export async function ensureBodyClipOnVelip(
  admin: AdminClient,
  clipId: string,
  consultantId: string,
): Promise<{ ok: true; audio_id: string } | { ok: false; error: string }> {
  const { data: clip } = await admin
    .from("voice_audio_clips")
    .select("id, audio_url, name, velip_audio_id")
    .eq("id", clipId)
    .eq("consultant_id", consultantId)
    .maybeSingle();
  if (!clip?.audio_url) return { ok: false, error: "clip_not_found" };
  if (clip.velip_audio_id) return { ok: true, audio_id: clip.velip_audio_id };
  try {
    const r = await fetch(clip.audio_url, { signal: AbortSignal.timeout(45_000) });
    if (!r.ok) return { ok: false, error: `download_${r.status}` };
    const bytes = new Uint8Array(await r.arrayBuffer());
    const up = await uploadAudioFile(bytes, clip.name || `clip_${clipId}`);
    if (!up.ok || !up.audio_id) return { ok: false, error: up.error || "velip_upload_failed" };
    await admin
      .from("voice_audio_clips")
      .update({ velip_audio_id: up.audio_id, velip_uploaded_at: new Date().toISOString() })
      .eq("id", clipId);
    return { ok: true, audio_id: up.audio_id };
  } catch (e) {
    return { ok: false, error: (e as Error).message || "upload_error" };
  }
}
