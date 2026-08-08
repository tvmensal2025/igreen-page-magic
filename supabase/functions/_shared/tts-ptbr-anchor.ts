/**
 * Âncoras PT-BR para TTS ElevenLabs — evita nome isolado ser lido em espanhol.
 * Espelha src/lib/ttsEnhanceV3.ts (edge não importa @/src).
 */

export const SOFIA_VOICE = "EJV7H2baGt5ab95tOoSG";
export const SOFIA_MODEL_V3 = "eleven_v3";
/** Só o nome: v2 aceita previous_text/next_text (v3 rejeita com 400). */
export const SOFIA_MODEL_NAME_ONLY = "eleven_multilingual_v2";

/**
 * Perfil ÚNICO para peças que serão costuradas (intro + saudação + corpo).
 * Zap A2 Olá, ligação PSTN intro, pós-venda — MESMA voz/modelo/settings
 * senão o áudio final fica estranho ao juntar.
 */
export const SOFIA_STITCH_PROFILE = {
  voiceId: SOFIA_VOICE,
  modelId: SOFIA_MODEL_V3,
  languageCode: "pt" as const,
} as const;

export const VOICE_SETTINGS_V3_GREET = {
  stability: 0.72,
  similarity_boost: 0.8,
  style: 0.0,
  use_speaker_boost: true,
  speed: 0.92,
} as const;

function normalizeSpaces(text: string): string {
  return (text || "").replace(/\s+/g, " ").trim();
}

function nameKeyForTts(display: string): string {
  return normalizeSpaces(display)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.!?…,]+$/u, "")
    .trim();
}

/**
 * Grafia falada p/ ElevenLabs PT-BR — só quando a escrita normal sai torta.
 * Slot/cache continua pelo nome normalizado (ex.: valdeir); só o texto TTS muda.
 * Feedback 2026-08-08: "Valdeir" saía ilegível no intro pós-venda.
 */
const PTBR_TTS_NAME_SPOKEN: Record<string, string> = {
  // Val-dê-ir (ê fecha o /e/; hífen evita "Valdier"/espanhol)
  valdeir: "Val-dêir",
};

/** Nome como a Sofia deve falar (display humano → grafia TTS). */
export function spokenNameForPtBrTts(display: string): string {
  const raw = normalizeSpaces(display).replace(/[.!?…,]+$/u, "").trim();
  if (!raw) return "";
  return PTBR_TTS_NAME_SPOKEN[nameKeyForTts(raw)] || raw;
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
    const nome = spokenNameForPtBrTts(
      m[2].replace(/^[,.\s]+/u, "").replace(/[.!?…,]+$/u, "").trim(),
    );
    if (nome) return `${lead}, ${nome}!`;
  }
  t = t.replace(/[.!?…]+$/u, "").trim();
  return t ? `${t}!` : t;
}

/**
 * Cumprimento profissional — WhatsApp A2 e ligação PSTN (mesma frase).
 * “Olá, Maria! Tudo bem?”
 */
export function buildOlaTudoBemTtsText(display: string): string {
  const nome = spokenNameForPtBrTts(display);
  if (!nome) return "";
  return `Olá, ${nome}! Tudo bem?`;
}

/** @deprecated Preferir buildOlaTudoBemTtsText — mesmo texto. */
export function buildOlaGreetTtsText(display: string): string {
  return buildOlaTudoBemTtsText(display);
}

/**
 * Passo 3/4 legado — só o nome no áudio final, como chamada suave ("Nome,").
 * Vírgula dá cadência de callout PT-BR (entonação descendente natural),
 * evita o corte abrupto do "!" e conecta melhor com o corpo costurado depois.
 * Texto enviado ao ElevenLabs: só o nome; PT-BR via previous_text/next_text no v2.
 */
export function buildNameOnlyTtsText(display: string): string {
  const nome = spokenNameForPtBrTts(display);
  return nome ? `${nome},` : "";
}

/** Passo 3 — “Nome, não tem segredo.” (frase + nome; sem nome → string vazia). */
export function buildNomeNaoTemSegredoTtsText(display: string): string {
  const nome = spokenNameForPtBrTts(display);
  if (!nome) return "";
  return formatNameGreetForTts(`${nome}, não tem segredo.`);
}

/** Passo 4a — “Então, Nome.” (sem nome → string vazia). */
export function buildEntaoNomeTtsText(display: string): string {
  const nome = spokenNameForPtBrTts(display);
  if (!nome) return "";
  return formatNameGreetForTts(`Então, ${nome}.`);
}

/**
 * Ligação gravada — mesmo texto do Zap/PV: “Olá, Nome! Tudo bem?”.
 * @deprecated Preferir buildOlaTudoBemTtsText (alias).
 */
export function buildCallNameGreetTtsText(display: string): string {
  return buildOlaTudoBemTtsText(display);
}

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
