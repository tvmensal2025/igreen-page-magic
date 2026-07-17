/**
 * Preprocessamento determinístico para ElevenLabs eleven_v3.
 * Espelha o "Enhance" da UI com pausas leves — sem exagerar (reticências
 * empilhadas / [short pause] geram silêncio longo demais).
 *
 * Regras (doc ElevenLabs):
 * - pontuação normal já controla ritmo; tags no máx. 1 por geração
 * - não saturar [pause] nem converter "." em "...."
 *
 * Qualidade em cortes (stitch MP3):
 * - namePause: “Olá... Nome...” (espaço após Olá + final calmo)
 * - edgePad: respiro leve no início e no fim de todo corte
 */
export const MODEL_V2 = "eleven_multilingual_v2";
export const MODEL_V3 = "eleven_v3";

export type TtsModelId = typeof MODEL_V2 | typeof MODEL_V3;

export const VOICE_SETTINGS_V2 = {
  stability: 0.9,
  similarity_boost: 1.0,
  style: 0.45,
  use_speaker_boost: true,
  speed: 1.0,
} as const;

/** Natural (~0.5): tags e pontuação respondem melhor no v3. */
export const VOICE_SETTINGS_V3 = {
  stability: 0.5,
  similarity_boost: 0.75,
  style: 0.0,
  use_speaker_boost: true,
  speed: 1.0,
} as const;

/**
 * Cumprimento com nome: mais estável e um pouco mais lento,
 * para o final do nome não “morrer” cortado.
 */
export const VOICE_SETTINGS_V3_NAME = {
  stability: 0.72,
  similarity_boost: 0.8,
  style: 0.0,
  use_speaker_boost: true,
  speed: 0.92,
} as const;

/** Cortes fixos: um pouco mais estáveis no stitch (ataque/release). */
export const VOICE_SETTINGS_V3_EDGE = {
  stability: 0.62,
  similarity_boost: 0.78,
  style: 0.0,
  use_speaker_boost: true,
  speed: 0.96,
} as const;

export function voiceSettingsForModel(modelId: TtsModelId) {
  return modelId === MODEL_V3 ? { ...VOICE_SETTINGS_V3 } : { ...VOICE_SETTINGS_V2 };
}

export function voiceSettingsForNameGreet(modelId: TtsModelId) {
  return modelId === MODEL_V3 ? { ...VOICE_SETTINGS_V3_NAME } : { ...VOICE_SETTINGS_V2, speed: 0.95 };
}

export function voiceSettingsForEdgePad(modelId: TtsModelId) {
  return modelId === MODEL_V3 ? { ...VOICE_SETTINGS_V3_EDGE } : { ...VOICE_SETTINGS_V2 };
}

export type EnhanceV3Options = {
  /**
   * Chamada com nome: separa a palavra-guia do nome e fecha calmo.
   * Ex.: “Olá, Maria.” → “Olá... Maria...”
   *      “Então, Maria.” → “Então... Maria...”
   */
  namePause?: boolean;
  /**
   * Todo corte: respiro leve no início e no fim para não cortar
   * a primeira/última sílaba ao costurar MP3s.
   */
  edgePad?: boolean;
  /** Prefixa [excited] se o trecho ainda não tiver tag */
  excitedOpen?: boolean;
};

function normalizeSpaces(text: string): string {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, " ")
    .trim();
}

/** Colapsa reticências excessivas (.... / ......) em pontuação normal + no máx. uma pausa curta. */
function softenOverPauses(text: string): string {
  return text
    // "frase...." / "frase......" → "frase."
    .replace(/([.!?])\.{2,}/g, "$1")
    // reticências soltas demais → uma só
    .replace(/\.{4,}/g, "...")
    .replace(/\s{2,}/g, " ");
}

function hasAudioTag(text: string): boolean {
  return /\[[^\]]+\]/.test(text);
}

/** Extrai tag inicial [foo] se houver, para reaplicar depois do pad. */
function splitLeadingTag(text: string): { tag: string; body: string } {
  const m = text.match(/^(\[[^\]]+\])\s*(.*)$/);
  if (!m) return { tag: "", body: text };
  return { tag: m[1], body: m[2] || "" };
}

/**
 * Respiro leve no início e no fim (sem [short pause] / ....).
 * Perguntas (?) mantêm o ponto de interrogação no fim.
 */
export function ensureSoftEdges(text: string): string {
  let t = normalizeSpaces(text);
  if (!t) return t;

  const { tag, body } = splitLeadingTag(t);
  let core = softenOverPauses(body || t);

  // Início: reticências curtas = ataque suave (não cola no corte anterior)
  core = core.replace(/^\.{2,3}\s*/u, "").trim();
  if (core && !/^[.…]/.test(core)) {
    core = `... ${core}`;
  }

  // Fim: pergunta mantém ? ; demais fecham com ... (release calmo)
  if (/\?$/u.test(core)) {
    // ok
  } else {
    core = core.replace(/[.!?…]+$/u, "").trim();
    if (core) core = `${core}...`;
  }

  const out = tag ? `${tag} ${core}` : core;
  return normalizeSpaces(out);
}

/**
 * Cumprimento / chamada com nome: espaço após a palavra-guia + final calmo.
 * “Olá, Maria.” → “Olá... Maria...”
 * “Então, Maria.” → “Então... Maria...”
 * Nunca cola o nome no início/fim do corte (evita cortar sílaba).
 */
export function formatNameGreetForTts(text: string): string {
  let t = softenOverPauses(normalizeSpaces(text));
  const m = t.match(/^(olá|então)\s*[,.]?\s*(.+)$/i);
  if (m) {
    const lead = /^olá$/i.test(m[1]) ? "Olá" : "Então";
    const nome = m[2].replace(/^[,.\s]+/u, "").replace(/[.!?…,]+$/u, "").trim();
    if (nome) return `${lead}... ${nome}...`;
  }
  t = t.replace(/[.!?…]+$/u, "").trim();
  return t ? `${t}...` : t;
}

/**
 * Aprimora um segmento de texto para síntese com eleven_v3.
 * Mantém ritmo natural: espaços limpos + no máx. 1 tag leve.
 */
export function enhanceScriptForV3(raw: string, opts: EnhanceV3Options = {}): string {
  let text = normalizeSpaces(raw || "");
  if (!text) return text;

  text = softenOverPauses(text);

  if (opts.namePause) {
    text = formatNameGreetForTts(text);
  } else if (opts.edgePad) {
    text = ensureSoftEdges(text);
  }

  if (opts.excitedOpen && !hasAudioTag(text)) {
    text = `[excited] ${text}`;
  }

  return normalizeSpaces(text);
}

/** Aplica enhance só se model for v3; v2 devolve o texto limpo (espaços). */
export function prepareTtsSegment(
  raw: string,
  modelId: TtsModelId,
  opts: EnhanceV3Options = {},
): string {
  const cleaned = normalizeSpaces(raw || "");
  if (!cleaned) return cleaned;
  if (modelId !== MODEL_V3) {
    if (opts.namePause) return formatNameGreetForTts(cleaned);
    if (opts.edgePad) return ensureSoftEdges(cleaned);
    return cleaned;
  }
  return enhanceScriptForV3(cleaned, opts);
}
