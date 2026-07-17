/**
 * Cache TTS Sofia — mesmo esquema do AudioStudio (IDB + bucket tts-cache).
 * Segmentos fixos reutilizam MP3 e não gastam tokens de novo.
 *
 * Nome: padrão profissional “Olá, Nome.” (nunca o nome isolado — corta ataque/release).
 *
 * Multicanal: voz Sofia profissional é OBRIGATÓRIA (nunca Rafael/Diego/outra).
 */
import { supabase } from "@/integrations/supabase/client";
import {
  prepareTtsSegment,
  voiceSettingsForModel,
  voiceSettingsForNameGreet,
  voiceSettingsForEdgePad,
  MODEL_V3,
  MODEL_V2,
  type TtsModelId,
} from "@/lib/ttsEnhanceV3";

/** Sofia (ElevenLabs) — voz profissional padrão do portal (áudio WA + ligação). */
export const VOICE_SOFIA_PROFESSIONAL = "EJV7H2baGt5ab95tOoSG";

/** v13: Olá... Nome... + edge pad em todos os cortes. */
const CACHE_VERSION = 13;
const TTS_BUCKET = "tts-cache";

function resolveTtsModel(id?: string): TtsModelId {
  return id === MODEL_V2 ? MODEL_V2 : MODEL_V3;
}

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || "https://zlzasfhcxcznaprrragl.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsemFzZmhjeGN6bmFwcnJyYWdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzQ1NzAsImV4cCI6MjA4Njg1MDU3MH0.OJzRdi_Z_1TFZjQXmK8rJofBeHVZc27VSo2vMMw9Spo";

const cacheMap = new Map<string, Blob>();

export function hashTtsText(text: string, voiceId: string, modelId: string): string {
  const n = text.trim().toLowerCase();
  let h = 0;
  for (let i = 0; i < n.length; i++) {
    h = (h << 5) - h + n.charCodeAt(i);
    h |= 0;
  }
  const vShort = (voiceId || "novoice").slice(0, 8);
  const mShort = (modelId || "nomodel").replace(/^eleven_/, "").slice(0, 12);
  return `v${CACHE_VERSION}_${vShort}_${mShort}_${Math.abs(h)}_${n.length}`;
}

let idbDb: IDBDatabase | null = null;

async function openIDB(): Promise<IDBDatabase> {
  if (idbDb) return idbDb;
  return new Promise((res, rej) => {
    const req = indexedDB.open("tts-cache-igreen", 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("entries")) {
        db.createObjectStore("entries", { keyPath: "hash" });
      }
    };
    req.onsuccess = () => {
      idbDb = req.result;
      res(req.result);
    };
    req.onerror = () => rej(req.error);
  });
}

async function idbGet(hash: string): Promise<Blob | null> {
  try {
    const db = await openIDB();
    return new Promise((res) => {
      const tx = db.transaction("entries", "readonly");
      const req = tx.objectStore("entries").get(hash);
      req.onsuccess = () => res(req.result?.blob ?? null);
      req.onerror = () => res(null);
    });
  } catch {
    return null;
  }
}

async function idbSet(hash: string, blob: Blob): Promise<void> {
  try {
    const db = await openIDB();
    await new Promise<void>((res, rej) => {
      const tx = db.transaction("entries", "readwrite");
      const req = tx.objectStore("entries").put({ hash, blob });
      req.onsuccess = () => res();
      req.onerror = () => rej(req.error);
    });
  } catch {
    /* ignore */
  }
}

export async function isValidMp3(blob: Blob): Promise<boolean> {
  if (!blob || blob.size < 32) return false;
  try {
    const buf = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
    if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return true;
    if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return true;
    return false;
  } catch {
    return false;
  }
}

async function stripId3(blob: Blob): Promise<Blob> {
  if (blob.size < 10) return blob;
  const head = new Uint8Array(await blob.slice(0, 10).arrayBuffer());
  if (head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) return blob;
  const size = (head[6] << 21) | (head[7] << 14) | (head[8] << 7) | head[9];
  const total = 10 + size;
  if (total >= blob.size) return blob;
  return blob.slice(total);
}

export async function concatMp3Blobs(blobs: Blob[]): Promise<Blob> {
  if (blobs.length === 0) return new Blob([], { type: "audio/mpeg" });
  if (blobs.length === 1) return blobs[0];
  const parts: Blob[] = [blobs[0]];
  for (let i = 1; i < blobs.length; i++) parts.push(await stripId3(blobs[i]));
  return new Blob(parts, { type: "audio/mpeg" });
}

export async function getCachedTTS(
  text: string,
  voiceId: string,
  modelId: string,
): Promise<Blob | null> {
  const hash = hashTtsText(text, voiceId, modelId);
  if (cacheMap.has(hash)) {
    const b = cacheMap.get(hash)!;
    if (await isValidMp3(b)) return b;
    cacheMap.delete(hash);
  }
  const local = await idbGet(hash);
  if (local) {
    if (await isValidMp3(local)) {
      cacheMap.set(hash, local);
      return local;
    }
  }
  try {
    const { data: pub } = supabase.storage.from(TTS_BUCKET).getPublicUrl(`${hash}.mp3`);
    if (pub?.publicUrl) {
      const r = await fetch(pub.publicUrl, { cache: "no-store" });
      if (r.ok) {
        const blob = await r.blob();
        if (await isValidMp3(blob)) {
          cacheMap.set(hash, blob);
          await idbSet(hash, blob);
          return blob;
        }
      }
    }
  } catch {
    /* miss esperado */
  }
  return null;
}

export async function setCachedTTS(
  text: string,
  blob: Blob,
  voiceId: string,
  modelId: string,
): Promise<void> {
  if (!(await isValidMp3(blob))) return;
  const hash = hashTtsText(text, voiceId, modelId);
  cacheMap.set(hash, blob);
  await idbSet(hash, blob);
  void supabase.storage
    .from(TTS_BUCKET)
    .upload(`${hash}.mp3`, blob, { contentType: "audio/mpeg", upsert: true });
}

/** “Olá... Nome...” / “Então... Nome...” — cortes com nome (pausa obrigatória). */
export function isNameGreetPhrase(text: string): boolean {
  const t = text.trim();
  return /^(olá|então)\b/i.test(t) && t.length < 80;
}

export type TtsGenerateResult = {
  blob: Blob;
  fromCache: boolean;
  spoken: string;
};

export async function generateSofiaSegment(opts: {
  text: string;
  voiceId: string;
  accessToken: string;
  modelId?: string;
  /** Só no 1º bloco longo — nunca no “Olá, Nome.” */
  excitedOpen?: boolean;
  /** Cumprimento com nome (Olá... Nome...). */
  namePause?: boolean;
  /** Respiro início/fim em cortes fixos/M/F. */
  edgePad?: boolean;
}): Promise<TtsGenerateResult> {
  const modelId = resolveTtsModel(opts.modelId);
  const isName = opts.namePause ?? isNameGreetPhrase(opts.text);
  const edgePad = isName ? false : (opts.edgePad ?? true);
  const spoken = prepareTtsSegment(opts.text.trim(), modelId, {
    // Nome: sem [excited] — evita ataque cortado / tom estranho
    excitedOpen: isName ? false : (opts.excitedOpen ?? false),
    namePause: isName,
    edgePad,
  }).trim();
  if (!spoken) throw new Error("Segmento vazio");

  const cached = await getCachedTTS(spoken, opts.voiceId, modelId);
  if (cached) return { blob: cached, fromCache: true, spoken };

  const voice_settings = isName
    ? voiceSettingsForNameGreet(modelId)
    : edgePad
      ? voiceSettingsForEdgePad(modelId)
      : voiceSettingsForModel(modelId);

  const res = await fetch(`${SUPABASE_URL}/functions/v1/tts-proxy`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.accessToken}`,
      apikey: SUPABASE_PUBLISHABLE_KEY,
    },
    body: JSON.stringify({
      text: spoken,
      voice_id: opts.voiceId,
      model_id: modelId,
      voice_settings,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.error || `TTS falhou (${res.status})`);
  }
  const blob = await res.blob();
  if (!(await isValidMp3(blob))) throw new Error("Resposta TTS inválida (não é MP3)");
  await setCachedTTS(spoken, blob, opts.voiceId, modelId);
  return { blob, fromCache: false, spoken };
}

export type SegmentedTtsResult = {
  blob: Blob;
  reused: number;
  generated: number;
  total: number;
};

/** Gera por cortes: fixos vêm do cache; “Olá/Então, Nome.” só gasta se o nome for novo.
 * Sempre usa Sofia profissional — ignora qualquer outra voiceId.
 */
export async function generateSofiaSegmented(opts: {
  segments: string[];
  fullTextFallback: string;
  /** Ignorado: multicanal trava em Sofia profissional. */
  voiceId?: string;
  accessToken: string;
}): Promise<SegmentedTtsResult> {
  const voiceId = VOICE_SOFIA_PROFESSIONAL;
  const blobs: Blob[] = [];
  let reused = 0;
  let generated = 0;

  try {
    for (let i = 0; i < opts.segments.length; i++) {
      const raw = opts.segments[i]?.trim();
      if (!raw) continue;
      const isName = isNameGreetPhrase(raw);
      const r = await generateSofiaSegment({
        text: raw,
        voiceId,
        accessToken: opts.accessToken,
        // Nunca [excited] em cortes stitch — prejudica ataque/release
        excitedOpen: false,
        namePause: isName,
        edgePad: !isName,
      });
      blobs.push(r.blob);
      if (r.fromCache) reused++;
      else generated++;
    }
    if (blobs.length === 0) throw new Error("Nenhum segmento gerado");
    const merged = await concatMp3Blobs(blobs);
    if (!(await isValidMp3(merged))) throw new Error("MP3 concatenado inválido");
    return { blob: merged, reused, generated, total: blobs.length };
  } catch (e) {
    console.warn("[sofia-tts] segmentos falharam, chamada única:", e);
    const r = await generateSofiaSegment({
      text: opts.fullTextFallback,
      voiceId,
      accessToken: opts.accessToken,
      excitedOpen: false,
      edgePad: true,
    });
    return {
      blob: r.blob,
      reused: r.fromCache ? 1 : 0,
      generated: r.fromCache ? 0 : 1,
      total: 1,
    };
  }
}
