/**
 * Âncoras PT-BR para TTS ElevenLabs — evita nome isolado ser lido em espanhol.
 * Espelha src/lib/ttsEnhanceV3.ts (edge não importa @/src).
 */

export const SOFIA_VOICE = "EJV7H2baGt5ab95tOoSG";
export const SOFIA_MODEL_V3 = "eleven_v3";
/** Só o nome: v2 aceita previous_text/next_text (v3 rejeita com 400). */
export const SOFIA_MODEL_NAME_ONLY = "eleven_multilingual_v2";

function normalizeSpaces(text: string): string {
  return (text || "").replace(/\s+/g, " ").trim();
}

/**
 * “Olá, Maria.” → “Olá, Maria!” — chamada CONTÍNUA (vírgula, não reticências).
 * As reticências ("Olá... Maria!") geravam pausa longa no eleven_v3 e o
 * cliente ouvia como CORTE entre o "Olá" e o nome (feedback 19/07/2026:
 * "foi apenas o olá e depois cortou para o nome — tem que ser junto").
 */
export function formatNameGreetForTts(text: string): string {
  let t = normalizeSpaces(text);
  const m = t.match(/^(olá|então|oi)\s*[,.]?\s*(.+)$/i);
  if (m) {
    const lead = /^olá$/i.test(m[1]) ? "Olá" : /^oi$/i.test(m[1]) ? "Oi" : "Então";
    const nome = m[2].replace(/^[,.\s]+/u, "").replace(/[.!?…,]+$/u, "").trim();
    if (nome) return `${lead}, ${nome}!`;
  }
  t = t.replace(/[.!?…]+$/u, "").trim();
  return t ? `${t}!` : t;
}

/** Passo 2 — Olá + nome (eleven_v3 + language_code pt). */
export function buildOlaGreetTtsText(display: string): string {
  return formatNameGreetForTts(`Olá, ${display}.`);
}

/**
 * Passo 3/4 — só o nome no áudio final, como chamada suave ("Nome,").
 * Vírgula dá cadência de callout PT-BR (entonação descendente natural),
 * evita o corte abrupto do "!" e conecta melhor com o corpo costurado depois.
 * Texto enviado ao ElevenLabs: só o nome; PT-BR via previous_text/next_text no v2.
 */
export function buildNameOnlyTtsText(display: string): string {
  const nome = normalizeSpaces(display).replace(/[.!?…,]+$/u, "").trim();
  return nome ? `${nome},` : "";
}


export const VOICE_SETTINGS_V3_GREET = {
  stability: 0.72,
  similarity_boost: 0.8,
  style: 0.0,
  use_speaker_boost: true,
  speed: 0.92,
} as const;

/**
 * Nome isolado: stability mais baixa dá entonação natural de chamada;
 * similarity alta preserva o timbre da Sofia; style leve humaniza sem robotizar;
 * speed 0.92 evita engolir a última sílaba.
 */
export const VOICE_SETTINGS_V2_NAME_ONLY = {
  stability: 0.55,
  similarity_boost: 0.9,
  style: 0.35,
  use_speaker_boost: true,
  speed: 0.92,
} as const;
