/**
 * Costura áudio WhatsApp personalizado: intro com nome + corpo (M/F).
 * Evita enviar MP3 estático com nome da prévia (ex.: "Rodrigo").
 */

import {
  concatMp3Parts,
  firstNameFrom,
  normalizeCallName,
} from "./voice-dialer/call-stitch.ts";
import {
  firstNameDisplay,
  inferSpeechGender,
  type SpeechGender,
} from "./speech-gender.ts";
import {
  SOFIA_MODEL_NAME_ONLY,
  SOFIA_MODEL_V3,
  SOFIA_VOICE,
  VOICE_SETTINGS_V2_NAME_ONLY,
  VOICE_SETTINGS_V3_GREET,
  buildNameOnlyTtsText,
  buildOlaGreetTtsText,
} from "./tts-ptbr-anchor.ts";

const SOFIA_VOICE_ID = SOFIA_VOICE;
const SOFIA_MODEL = SOFIA_MODEL_V3;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

/** Textos fixos do corpo A2 (espelho do catálogo multicanal). Sem “Seja bem-vindo(a)” — isso fica no Olá+nome. */
export const A2_BODY_TEXT: Record<SpeechGender, string> = {
  feminino: `Eu sou a Sofia, assistente virtual do Rafael Ferreira Dias, gestor da iGreen Energia.

Para eu montar a simulação, me diga quanto você está gastando por mês na conta de luz.`,
  masculino: `Eu sou a Sofia, assistente virtual do Rafael Ferreira Dias, gestor da iGreen Energia.

Para eu montar a simulação, me diga quanto você está gastando por mês na conta de luz.`,
};

export const A3_BODY_TEXT = `Deixa eu te explicar de um jeito simples como funciona o benefício.

Nossas fazendas solares geram energia todos os dias e injetam na rede da sua distribuidora — CEMIG, CPFL, Copel e outras.

Você continua com a mesma conta e o mesmo medidor. O que muda é o crédito de energia limpa, sem placa e sem obra na sua casa.

Assim você economiza todo mês e reduz o impacto das bandeiras amarela e vermelha.

Não tem nenhum custo para você. Nenhum consultor pede depósito, Pix ou pagamento para ativar.

É simples.`;

export const A5_BODY_TEXT = `Eu sempre gosto de lembrar que o benefício vai muito além da economia na conta de energia.

Ao ativar, você também passa a ter acesso a um clube de benefícios com mais de 30 mil estabelecimentos parceiros em todo o Brasil.

Um dos benefícios mais utilizados é o desconto em farmácias, que pode chegar a até 70% em medicamentos. Você também pode encontrar até 60% de desconto em cinemas, além de vantagens em restaurantes, lojas e diversos serviços.

Ou seja: você economiza na energia e ainda pode economizar em várias despesas do dia a dia.`;

type PersonalizeSpec = {
  /** Prefixo de cache / slot base */
  baseSlot: string;
  /**
   * ola_greet = “Olá, Nome.” (um corte) + corpo
   * nome_only = só o nome + corpo (sem Então)
   */
  introMode: "ola_greet" | "nome_only";
  /** Se true, corpo muda com gênero (bem-vindo/bem-vinda). */
  genderedBody: boolean;
  bodyText: (gender: SpeechGender) => string;
};

const SPECS: Record<string, PersonalizeSpec> = {
  a2_audio_activate_name: {
    baseSlot: "a2_audio_activate_name",
    // Passo 2: “Olá, Nome.” (PT-BR) + corpo FIXO M/F (2 cortes).
    introMode: "ola_greet",
    genderedBody: true,
    bodyText: (g) => A2_BODY_TEXT[g],
  },
  a3_explain_with_buttons: {
    baseSlot: "a3_explain_with_buttons",
    // Passo 3: só o nome + explicação (sem Então)
    introMode: "nome_only",
    genderedBody: false,
    bodyText: () => A3_BODY_TEXT,
  },
  a3_audio_explain: {
    baseSlot: "a3_explain_with_buttons",
    introMode: "nome_only",
    genderedBody: false,
    bodyText: () => A3_BODY_TEXT,
  },
  a5_audio_club_benefits: {
    baseSlot: "a5_audio_club_benefits",
    // Passo 4a: só o nome + corpo do clube (sem Olá de novo)
    introMode: "nome_only",
    genderedBody: false,
    bodyText: () => A5_BODY_TEXT,
  },
};

export function isPersonalizedWaAudioSlot(slotKey: string | null | undefined): boolean {
  return !!SPECS[String(slotKey || "")];
}

async function synthesizePhraseMp3(
  text: string,
  opts?: { clip?: "ola_greet" | "name_only" },
): Promise<Uint8Array> {
  const key = (Deno.env.get("ELEVENLABS_API_KEY") || "").trim();
  if (!key) throw new Error("ELEVENLABS_API_KEY_missing");

  const clip = opts?.clip || "ola_greet";
  const modelId = clip === "name_only" ? SOFIA_MODEL_NAME_ONLY : SOFIA_MODEL;
  const voice_settings = clip === "name_only"
    ? { ...VOICE_SETTINGS_V2_NAME_ONLY }
    : { ...VOICE_SETTINGS_V3_GREET };

  const payload: Record<string, unknown> = {
    text,
    model_id: modelId,
    voice_settings,
    language_code: "pt",
  };

  // Nome isolado (“Fernandinho.”) sem contexto → eleven_v3 infere espanhol.
  // v2 + previous/next_text ancora PT-BR sem falar palavras extras no MP3.
  if (clip === "name_only") {
    payload.previous_text = "Olá, ";
    payload.next_text = ", tudo bem com você?";
  }

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${SOFIA_VOICE_ID}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "xi-api-key": key,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.detail?.message || err?.message || `elevenlabs_${res.status}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

async function uploadMp3(
  bytes: Uint8Array,
  consultantId: string,
  slug: string,
): Promise<string> {
  const fd = new FormData();
  fd.append("file", new Blob([bytes as BlobPart], { type: "audio/mpeg" }), `${slug}.mp3`);
  fd.append("scope", "admin");
  fd.append("consultant_id", consultantId);
  fd.append("kind", "audio");
  fd.append("slug", slug.slice(0, 80));
  const uploadRes = await fetch(`${SUPABASE_URL}/functions/v1/upload-media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SERVICE_ROLE}`, apikey: SERVICE_ROLE },
    body: fd,
    signal: AbortSignal.timeout(60_000),
  });
  if (!uploadRes.ok) {
    const t = await uploadRes.text().catch(() => "");
    throw new Error(`upload_failed_${uploadRes.status}:${t.slice(0, 120)}`);
  }
  const uploaded = await uploadRes.json();
  const url = uploaded?.url;
  if (!url) throw new Error("upload_sem_url");
  return String(url);
}

async function findActiveUrl(
  admin: any,
  consultantId: string,
  slotKey: string,
): Promise<string | null> {
  const { data } = await admin
    .from("ai_media_library")
    .select("url")
    .eq("consultant_id", consultantId)
    .eq("slot_key", slotKey)
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.url ? String(data.url) : null;
}

/**
 * Busca URL em cache respeitando a ordem dos candidatos.
 * Por candidato: ativo → inativo. Assim o lote Sofia (mesmo inativo)
 * ganha de um ptbr2 TTS ativo gerado depois.
 */
async function findCachedMediaUrl(
  admin: any,
  consultantId: string,
  slotCandidates: string[],
): Promise<{ url: string; slotKey: string } | null> {
  const seen = new Set<string>();
  for (const slotKey of slotCandidates) {
    if (seen.has(slotKey)) continue;
    seen.add(slotKey);
    if (isForbiddenNomeIntroSlot(slotKey)) continue;
    const activeUrl = await findActiveUrl(admin, consultantId, slotKey);
    if (activeUrl) return { url: activeUrl, slotKey };
    const { data } = await admin
      .from("ai_media_library")
      .select("url")
      .eq("consultant_id", consultantId)
      .eq("slot_key", slotKey)
      .eq("active", false)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (data?.url && !isForbiddenNomeIntroSlot(slotKey)) {
      return { url: String(data.url), slotKey };
    }
  }
  return null;
}

/**
 * Intros Olá: legado → ptbr → ptbr2.
 * Intros nome: APENAS ptbr3 (v2 + âncora PT-BR).
 */
export const FORBIDDEN_NOME_INTRO_SLOT =
  /^intro:nome:(?:ptbr2|ptbr):|^intro:nome:[^:]+$/;

export function isForbiddenNomeIntroSlot(slotKey: string): boolean {
  return FORBIDDEN_NOME_INTRO_SLOT.test(String(slotKey || ""));
}

export function buildIntroSlotCandidates(
  kind: "nome" | "ola",
  nameNorm: string,
): string[] {
  if (kind === "ola") {
    return [
      `intro:ola:ptbr2:${nameNorm}`,
      `intro:ola:ptbr:${nameNorm}`,
      `intro:ola:${nameNorm}`,
    ];
  }
  // Só ptbr3 — motor regera se faltar; nunca ptbr/ptbr2/legado.
  return [`intro:nome:ptbr3:${nameNorm}`];
}

/** Versão do stitch A2: Olá+nome (PT-BR) + corpo FIXO M/F (ola6 = 2 cortes, sem nome no meio). */
function a2StitchVersion(spec: PersonalizeSpec): string {
  if (spec.baseSlot === "a2_audio_activate_name" && spec.introMode === "ola_greet") {
    return "ola6";
  }
  // A3/A5: n5 = nome PT-BR ancorado (v2 + contexto); ptbr2 bare-name ignorado.
  return spec.introMode === "nome_only" ? "n5" : "ola3";
}

/** Slots de stitch a tentar. A2 ola_greet: só ola6 (2 cortes). */
export function buildStitchSlotCandidates(
  spec: PersonalizeSpec,
  gender: SpeechGender,
  nameNorm: string,
): string[] {
  const stitchVer = a2StitchVersion(spec);
  const canonical =
    `stitch:${spec.baseSlot}:${stitchVer}:${spec.genderedBody ? gender : "x"}:${nameNorm}`;

  // Nunca reutiliza lote antigo (3 cortes / voz mista) — só a versão canônica.
  return [canonical];
}

async function findCachedStitchUrl(
  admin: any,
  consultantId: string,
  slotCandidates: string[],
): Promise<{ url: string; slotKey: string; fromLegacy: boolean } | null> {
  const hit = await findCachedMediaUrl(admin, consultantId, slotCandidates);
  if (!hit) return null;
  // Lote 16/07 / ola3/n3/ola4 = legado; ola5/n4 = canônico (voz unificada + texto oficial).
  const fromLegacy = !/:ola5:|:n4:/.test(hit.slotKey);
  return {
    url: hit.url,
    slotKey: hit.slotKey,
    fromLegacy,
  };
}

/**
 * Probe rápido (só DB) — usado antes de enviar texto cedo no WhatsApp.
 * true = stitch já existe; áudio deve vir primeiro (media_order).
 */
export async function probePersonalizedWaAudioCache(
  admin: any,
  opts: {
    consultantId: string;
    slotKey: string;
    customerName: string | null | undefined;
  },
): Promise<boolean> {
  const spec = SPECS[opts.slotKey];
  if (!spec) return false;
  const display = firstNameDisplay(opts.customerName) || firstNameFrom(opts.customerName);
  if (!display) return false;
  const gender = inferSpeechGender(display);
  const nameNorm = normalizeCallName(display);
  const candidates = buildStitchSlotCandidates(spec, gender, nameNorm);
  const stitchHit = await findCachedStitchUrl(admin, opts.consultantId, candidates);
  if (stitchHit) return true;

  const bodySlot = spec.genderedBody
    ? `${spec.baseSlot}__body_${gender}`
    : `${spec.baseSlot}__body`;
  const bodyUrl = await findActiveUrl(admin, opts.consultantId, bodySlot);
  if (!bodyUrl) return false;

  // A2 ola_greet: Olá+nome (variável) + corpo FIXO M/F. Sem “só o nome” no meio.
  if (spec.baseSlot === "a2_audio_activate_name" && spec.introMode === "ola_greet") {
    const olaHit = await findCachedMediaUrl(
      admin,
      opts.consultantId,
      buildIntroSlotCandidates("ola", nameNorm),
    );
    const bodySlot = `${spec.baseSlot}__body_${gender}`;
    const bodyUrl = await findActiveUrl(admin, opts.consultantId, bodySlot);
    return !!(olaHit && bodyUrl);
  }

  // A2/A3 nome_only: intro:nome (sem Olá). ola_greet legado: intro:ola.
  if (spec.introMode === "nome_only") {
    const nomeHit = await findCachedMediaUrl(
      admin,
      opts.consultantId,
      buildIntroSlotCandidates("nome", nameNorm),
    );
    return !!nomeHit;
  }

  const olaHit = await findCachedMediaUrl(
    admin,
    opts.consultantId,
    buildIntroSlotCandidates("ola", nameNorm),
  );
  return !!olaHit;
}

async function upsertActiveMedia(
  admin: any,
  consultantId: string,
  slotKey: string,
  url: string,
  label: string,
  textContent?: string | null,
): Promise<void> {
  if (isForbiddenNomeIntroSlot(slotKey)) {
    throw new Error(`forbidden_nome_slot:${slotKey}`);
  }
  const existing = await findActiveUrl(admin, consultantId, slotKey);
  if (existing === url) return;

  await admin
    .from("ai_media_library")
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq("consultant_id", consultantId)
    .eq("slot_key", slotKey)
    .eq("active", true);
  const row: Record<string, unknown> = {
    consultant_id: consultantId,
    slot_key: slotKey,
    kind: "audio",
    label: label.slice(0, 120),
    url,
    active: true,
    send_order: 0,
    is_draft: false,
    is_public: false,
    delay_before_ms: 0,
    priority: 10,
  };
  if (textContent != null && String(textContent).trim()) {
    row.text_content = String(textContent).trim().slice(0, 8000);
  }
  await admin.from("ai_media_library").insert(row);
}

/**
 * Corpo FIXO da biblioteca (já gravado no painel / lote Sofia).
 * NUNCA regenera TTS aqui — só Olá+nome e Nome são gerados sob demanda.
 */
async function ensureBodyUrl(
  admin: any,
  consultantId: string,
  baseSlot: string,
  gender: SpeechGender,
  bodyText: string,
  gendered: boolean,
): Promise<string> {
  const bodySlot = gendered
    ? `${baseSlot}__body_${gender}`
    : `${baseSlot}__body`;
  const expected = String(bodyText || "").trim();

  const { data: rows, error } = await admin
    .from("ai_media_library")
    .select("id, url, text_content")
    .eq("consultant_id", consultantId)
    .eq("slot_key", bodySlot)
    .eq("active", true)
    .limit(1);
  if (error) throw new Error(`body_lookup_failed:${bodySlot}`);

  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row?.url) {
    throw new Error(`fixed_body_missing:${bodySlot}`);
  }

  const stored = String(row?.text_content || "").trim();
  // Backfill de texto só no registro — NÃO mexe no MP3.
  if (!stored && expected) {
    try {
      await admin
        .from("ai_media_library")
        .update({ text_content: expected.slice(0, 8000), updated_at: new Date().toISOString() })
        .eq("id", row.id);
    } catch { /* best-effort */ }
  }

  console.log(`[wa-stitch] corpo FIXO reutilizado slot=${bodySlot}`);
  return String(row.url);
}

export type WaStitchResult = {
  ok: boolean;
  url?: string;
  gender?: SpeechGender;
  displayName?: string;
  cached?: boolean;
  error?: string;
  /** stitch = nome+corpo · body_only = só corpo (sem nome) · skipped = não enviar áudio */
  mode?: "stitch" | "body_only" | "skipped";
};

/**
 * Regra de ouro: MP3 da prévia do painel (com Maria/Rodrigo) NUNCA vai ao WhatsApp.
 * Só stitch Sofia completo (nome+corpo) — nunca corpo-only / TTS genérico.
 */
export async function pickSafePersonalizedWaAudio(
  admin: any,
  opts: {
    consultantId: string;
    slotKey: string;
    customerName: string | null | undefined;
    timeoutMs?: number;
  },
): Promise<WaStitchResult> {
  if (!isPersonalizedWaAudioSlot(opts.slotKey)) {
    return { ok: false, error: "not_personalized_slot", mode: "skipped" };
  }
  const display = firstNameDisplay(opts.customerName) || firstNameFrom(opts.customerName);
  if (!display) {
    return { ok: false, error: "no_name", mode: "skipped" };
  }

  const spec = SPECS[opts.slotKey];
  const gender = inferSpeechGender(display);
  const nameNorm = normalizeCallName(display);
  const resolveOpts = {
    consultantId: opts.consultantId,
    slotKey: opts.slotKey,
    customerName: opts.customerName,
  };

  // Olá+nome + só nome na biblioteca antes de montar stitch (A2/A3/A5).
  await ensureNameIntroPairCache(admin, {
    consultantId: opts.consultantId,
    customerName: opts.customerName,
  });

  // 1) Stitch completo já na biblioteca (245+ MP3 Sofia) — URL direta, zero assembly/TTS.
  const directStitch = await findCachedStitchUrl(
    admin,
    opts.consultantId,
    buildStitchSlotCandidates(spec, gender, nameNorm),
  );
  if (directStitch) {
    // Usa URL do lote Sofia direto — NÃO promove para ola3 (evita recriar slot TTS).
    console.log(
      `[wa-stitch] pickSafe DIRECT stitch=${directStitch.slotKey} name=${display} cached=true legacy=${directStitch.fromLegacy}`,
    );
    return {
      ok: true,
      url: directStitch.url,
      gender,
      displayName: display,
      cached: true,
      mode: "stitch",
    };
  }

  const hasParts = await probePersonalizedWaAudioCache(admin, {
    consultantId: opts.consultantId,
    slotKey: opts.slotKey,
    customerName: opts.customerName,
  });

  // 2) Partes Sofia (olá/nome + corpo) — monta stitch uma vez e salva em cache.
  if (hasParts) {
    const stitched = await resolvePersonalizedWaAudio(admin, resolveOpts);
    if (stitched.ok && stitched.url) {
      return { ...stitched, mode: "stitch" };
    }
    console.warn(
      `[wa-stitch] pickSafe parts_resolve falhou name=${display} err=${stitched.error} — retry 1x`,
    );
  }

  // 3) Sem biblioteca (ou parts falhou): gera Sofia completo com retry.
  // Timeout generoso: Olá + corpo em paralelo ainda pode levar ~20–40s no 1º nome.
  // Se a 1ª tentativa estourar timeout, NÃO tenta de novo (respeita wall-clock da edge).
  const genTimeoutMs = opts.timeoutMs ?? 90_000;
  let lastErr = "unknown";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const stitched = await Promise.race([
      resolvePersonalizedWaAudio(admin, resolveOpts),
      new Promise<WaStitchResult>((resolve) =>
        setTimeout(() => resolve({ ok: false, error: "timeout", mode: "skipped" }), genTimeoutMs),
      ),
    ]);
    if (stitched.ok && stitched.url) {
      return { ...stitched, mode: "stitch" };
    }
    lastErr = stitched.error || "no_sofia_stitch";
    console.warn(
      `[wa-stitch] pickSafe gen attempt=${attempt}/2 name=${display} err=${lastErr}`,
    );
    if (lastErr === "timeout") break;
  }

  console.warn(
    `[wa-stitch] pickSafe SKIP slot=${opts.slotKey} name=${display} err=${lastErr} — sem TTS genérico, só texto`,
  );
  return {
    ok: false,
    error: lastErr,
    gender,
    displayName: display,
    mode: "skipped",
  };
}

async function downloadUrlBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { signal: AbortSignal.timeout(45_000) });
  if (!res.ok) throw new Error(`download_${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Só o nome — passo 3 (e cache compartilhado). */
async function ensureNameBytes(
  admin: any,
  consultantId: string,
  display: string,
  nameNorm: string,
): Promise<Uint8Array> {
  const canonicalSlot = `intro:nome:ptbr3:${nameNorm}`;
  const cached = await findCachedMediaUrl(
    admin,
    consultantId,
    buildIntroSlotCandidates("nome", nameNorm),
  );
  if (cached) {
    try {
      const bytes = await downloadUrlBytes(cached.url);
      if (cached.slotKey !== canonicalSlot) {
        await upsertActiveMedia(
          admin,
          consultantId,
          canonicalSlot,
          cached.url,
          `Sofia intro · nome · pt-BR v3 · ${display}`,
        );
      }
      return bytes;
    } catch { /* regenera */ }
  }

  const ttsText = buildNameOnlyTtsText(display);
  if (!ttsText) throw new Error("tts_nome_empty");

  let bytes: Uint8Array | null = null;
  let lastErr = "tts_nome_failed";
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      bytes = await synthesizePhraseMp3(ttsText, { clip: "name_only" });
      break;
    } catch (e) {
      lastErr = (e as Error)?.message || "tts_nome_failed";
      console.warn(`[wa-stitch] TTS nome=${display} attempt=${attempt}/2 falhou: ${lastErr}`);
      if (attempt < 2) await new Promise((r) => setTimeout(r, 800));
    }
  }
  if (!bytes) throw new Error(lastErr);

  try {
    const slug = `intro-nome-ptbr3-${nameNorm}-${Date.now()}`.slice(0, 80);
    const url = await uploadMp3(bytes, consultantId, slug);
    await upsertActiveMedia(
      admin,
      consultantId,
      canonicalSlot,
      url,
      `Sofia intro · nome · pt-BR v3 · ${display}`,
    );
  } catch (e) {
    console.warn(`[wa-stitch] cache nome falhou (segue com bytes):`, (e as Error)?.message);
  }
  return bytes;
}

/** “Olá, Nome.” juntos — passo 2. Nunca TTS se já existe Olá/stitch Sofia. */
async function ensureOlaGreetBytes(
  admin: any,
  consultantId: string,
  display: string,
  nameNorm: string,
): Promise<Uint8Array> {
  const canonicalSlot = `intro:ola:ptbr2:${nameNorm}`;
  const cached = await findCachedMediaUrl(
    admin,
    consultantId,
    buildIntroSlotCandidates("ola", nameNorm),
  );
  if (cached) {
    try {
      const bytes = await downloadUrlBytes(cached.url);
      if (cached.slotKey !== canonicalSlot && cached.slotKey.startsWith("intro:ola:")) {
        await upsertActiveMedia(
          admin,
          consultantId,
          cached.slotKey.includes(":ptbr") ? cached.slotKey : `intro:ola:${nameNorm}`,
          cached.url,
          `Sofia intro · Olá+nome · ${display}`,
        );
      }
      return bytes;
    } catch { /* regenera só se download falhar */ }
  }

  const gender = inferSpeechGender(display);
  const stitchHit = await findCachedStitchUrl(
    admin,
    consultantId,
    buildStitchSlotCandidates(SPECS.a2_audio_activate_name, gender, nameNorm),
  );
  if (stitchHit) {
    throw new Error(`sofia_stitch_exists_skip_tts:${stitchHit.slotKey}`);
  }

  let bytes: Uint8Array | null = null;
  let lastErr = "tts_ola_failed";
  const ttsText = buildOlaGreetTtsText(display);
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      bytes = await synthesizePhraseMp3(ttsText, { clip: "ola_greet" });
      break;
    } catch (e) {
      lastErr = (e as Error)?.message || "tts_ola_failed";
      console.warn(`[wa-stitch] TTS Olá+${display} attempt=${attempt}/2 falhou: ${lastErr}`);
      if (attempt < 2) await new Promise((r) => setTimeout(r, 800));
    }
  }
  if (!bytes) throw new Error(lastErr);

  try {
    const slug = `intro-ola-ptbr-${nameNorm}-${Date.now()}`.slice(0, 80);
    const url = await uploadMp3(bytes, consultantId, slug);
    await upsertActiveMedia(
      admin,
      consultantId,
      canonicalSlot,
      url,
      `Sofia intro · Olá+nome · pt-BR · ${display}`,
    );
  } catch (e) {
    console.warn(`[wa-stitch] cache Olá+nome falhou (segue com bytes):`, (e as Error)?.message);
  }
  return bytes;
}

/**
 * Gera e salva “Olá, {nome}.” só se NÃO houver intro Sofia nem stitch A2.
 * Passo 2 (A2) — NUNCA Olá fixo nem só o nome.
 */
export async function ensureOlaGreetIntroMp3(
  admin: any,
  opts: {
    consultantId: string;
    customerName: string | null | undefined;
  },
): Promise<WaStitchResult> {
  const display = firstNameDisplay(opts.customerName) || firstNameFrom(opts.customerName);
  if (!display) return { ok: false, error: "no_name", mode: "skipped" };
  const nameNorm = normalizeCallName(display);
  const gender = inferSpeechGender(display);

  // 1) Stitch A2 já pronto (lote Sofia) → zero TTS.
  const stitchHit = await findCachedStitchUrl(
    admin,
    opts.consultantId,
    buildStitchSlotCandidates(SPECS.a2_audio_activate_name, gender, nameNorm),
  );
  if (stitchHit) {
    console.log(`[wa-stitch] ensureOla SKIP TTS — stitch existe ${stitchHit.slotKey}`);
    return {
      ok: true,
      url: stitchHit.url,
      gender,
      displayName: display,
      cached: true,
      mode: "stitch",
    };
  }

  const olaCandidates = buildIntroSlotCandidates("ola", nameNorm);
  const existing = await findCachedMediaUrl(admin, opts.consultantId, olaCandidates);
  if (existing) {
    return {
      ok: true,
      url: existing.url,
      gender,
      displayName: display,
      cached: true,
      mode: "stitch",
    };
  }
  try {
    await ensureOlaGreetBytes(admin, opts.consultantId, display, nameNorm);
    const url = await findCachedMediaUrl(admin, opts.consultantId, olaCandidates);
    return {
      ok: !!url,
      url: url?.url || undefined,
      gender,
      displayName: display,
      cached: false,
      mode: url ? "stitch" : "skipped",
    };
  } catch (e) {
    return {
      ok: false,
      error: (e as Error)?.message || "ola_greet_failed",
      gender,
      displayName: display,
      mode: "skipped",
    };
  }
}

export type NameIntroPairResult = {
  ola: WaStitchResult;
  nome: WaStitchResult;
  /** Olá+nome e só nome prontos (cache ou ElevenLabs). */
  complete: boolean;
};

/**
 * Nome fora da base: ElevenLabs gera Olá+Nome e só Nome; salva intro:ola + intro:nome
 * para os próximos atendimentos (A2 usa Olá; A3/A5 usam só nome).
 */
export async function ensureNameIntroPairCache(
  admin: any,
  opts: {
    consultantId: string;
    customerName: string | null | undefined;
  },
): Promise<NameIntroPairResult> {
  const display = firstNameDisplay(opts.customerName) || firstNameFrom(opts.customerName);
  if (!display || !opts.consultantId) {
    const miss: WaStitchResult = { ok: false, error: "no_name", mode: "skipped" };
    return { ola: miss, nome: miss, complete: false };
  }

  const nameNorm = normalizeCallName(display);
  const [olaHit, nomeHit] = await Promise.all([
    findCachedMediaUrl(admin, opts.consultantId, buildIntroSlotCandidates("ola", nameNorm)),
    findCachedMediaUrl(admin, opts.consultantId, buildIntroSlotCandidates("nome", nameNorm)),
  ]);

  if (olaHit && nomeHit) {
    const base: WaStitchResult = {
      ok: true,
      cached: true,
      displayName: display,
      mode: "stitch",
    };
    return {
      ola: { ...base, url: olaHit.url },
      nome: { ...base, url: nomeHit.url },
      complete: true,
    };
  }

  const [ola, nome] = await Promise.all([
    olaHit
      ? ({
          ok: true,
          url: olaHit.url,
          displayName: display,
          cached: true,
          mode: "stitch" as const,
        } satisfies WaStitchResult)
      : ensureOlaGreetIntroMp3(admin, opts),
    nomeHit
      ? ({
          ok: true,
          url: nomeHit.url,
          displayName: display,
          cached: true,
          mode: "stitch" as const,
        } satisfies WaStitchResult)
      : ensureNameOnlyIntroMp3(admin, opts),
  ]);

  const complete = !!(ola.ok && nome.ok);
  console.log(
    `[wa-stitch] intro pair name=${display} ola=${ola.ok}${ola.cached ? "(cache)" : "(gen)"} nome=${nome.ok}${nome.cached ? "(cache)" : "(gen)"} complete=${complete}`,
  );
  return { ola, nome, complete };
}

/**
 * Gera e salva SÓ o MP3 do nome em intro:nome:ptbr3:{norm}.
 * Usado no passo 3 (nome + explicação) — sem “Olá”.
 */
export async function ensureNameOnlyIntroMp3(
  admin: any,
  opts: {
    consultantId: string;
    customerName: string | null | undefined;
  },
): Promise<WaStitchResult> {
  const display = firstNameDisplay(opts.customerName) || firstNameFrom(opts.customerName);
  if (!display) return { ok: false, error: "no_name", mode: "skipped" };
  const nameNorm = normalizeCallName(display);
  const gender = inferSpeechGender(display);
  const nomeCandidates = buildIntroSlotCandidates("nome", nameNorm);
  const existing = await findCachedMediaUrl(admin, opts.consultantId, nomeCandidates);
  if (existing) {
    return {
      ok: true,
      url: existing.url,
      gender,
      displayName: display,
      cached: true,
      mode: "stitch",
    };
  }
  try {
    await ensureNameBytes(admin, opts.consultantId, display, nameNorm);
    const url = await findActiveUrl(admin, opts.consultantId, `intro:nome:ptbr3:${nameNorm}`);
    return {
      ok: !!url,
      url: url || undefined,
      gender,
      displayName: display,
      cached: false,
      mode: url ? "stitch" : "skipped",
    };
  } catch (e) {
    return {
      ok: false,
      error: (e as Error)?.message || "name_intro_failed",
      gender,
      displayName: display,
      mode: "skipped",
    };
  }
}

/**
 * Pré-aquece stitch A2 em background assim que o nome é salvo.
 * Não bloqueia o turno — na hora do passo 2 o MP3 já pode estar em cache.
 */
export function prefetchPersonalizedWaAudio(
  admin: any,
  opts: {
    consultantId: string;
    slotKey?: string;
    customerName: string | null | undefined;
  },
): void {
  const slotKey = opts.slotKey || "a2_audio_activate_name";
  if (!opts.customerName || !opts.consultantId) return;
  warmPersonalizedWaAudio(admin, { ...opts, slotKey })
    .then((r) => {
      console.log(
        `[wa-stitch] prefetch slot=${slotKey} name=${r.displayName} ok=${r.ok} cached=${r.cached} err=${r.error || ""}`,
      );
    })
    .catch((e) => {
      console.warn(`[wa-stitch] prefetch erro:`, (e as Error)?.message || e);
    });
}

/**
 * Aguarda stitch Sofia na biblioteca (stitch direto ou monta olá/nome + corpo).
 * Chamar assim que o nome chega — antes de emitir o passo A2.
 * Usa pickSafe (retry + timeout generoso) para não falhar no 1º nome fora do lote.
 */
export async function warmPersonalizedWaAudio(
  admin: any,
  opts: {
    consultantId: string;
    slotKey?: string;
    customerName: string | null | undefined;
  },
): Promise<WaStitchResult> {
  const slotKey = opts.slotKey || "a2_audio_activate_name";
  if (!opts.customerName || !opts.consultantId) {
    return { ok: false, error: "missing_params", mode: "skipped" };
  }
  // Sempre Olá+nome + só nome na biblioteca antes do stitch A2/A3.
  await ensureNameIntroPairCache(admin, opts);
  return pickSafePersonalizedWaAudio(admin, {
    consultantId: opts.consultantId,
    slotKey,
    customerName: opts.customerName,
    timeoutMs: 90_000,
  });
}

/**
 * Resolve URL final personalizada.
 * A2: “Olá, Nome.” (PT-BR) + corpo FIXO M/F (2 cortes)
 * A3/A5: só o nome (PT-BR) + corpo FIXO
 * Em runtime SÓ gera Olá+nome e/ou Nome — nunca regenera o corpo fixo.
 */
export async function resolvePersonalizedWaAudio(
  admin: any,
  opts: {
    consultantId: string;
    slotKey: string;
    customerName: string | null | undefined;
  },
): Promise<WaStitchResult> {
  const spec = SPECS[opts.slotKey];
  if (!spec) return { ok: false, error: "not_personalized_slot" };

  const display = firstNameDisplay(opts.customerName) || firstNameFrom(opts.customerName);
  if (!display) return { ok: false, error: "no_name" };

  const gender = inferSpeechGender(display);
  const nameNorm = normalizeCallName(display);
  const stitchVer = a2StitchVersion(spec);
  const renderSlot = `stitch:${spec.baseSlot}:${stitchVer}:${spec.genderedBody ? gender : "x"}:${nameNorm}`;
  const slotCandidates = buildStitchSlotCandidates(spec, gender, nameNorm);

  try {
    const cachedHit = await findCachedStitchUrl(admin, opts.consultantId, slotCandidates);
    if (cachedHit) {
      console.log(
        `[wa-stitch] cache hit slot=${cachedHit.slotKey} name=${display} legacy=${cachedHit.fromLegacy}`,
      );
      return {
        ok: true,
        url: cachedHit.url,
        gender,
        displayName: display,
        cached: true,
      };
    }

    const bodyPromise = (async () => {
      const bodyUrl = await ensureBodyUrl(
        admin,
        opts.consultantId,
        spec.baseSlot,
        gender,
        spec.bodyText(gender),
        spec.genderedBody,
      );
      return downloadUrlBytes(bodyUrl);
    })();

    let parts: Uint8Array[];
    if (spec.introMode === "nome_only") {
      const [nameBytes, bodyBytes] = await Promise.all([
        ensureNameBytes(admin, opts.consultantId, display, nameNorm),
        bodyPromise,
      ]);
      parts = [nameBytes, bodyBytes];
    } else {
      // A2: só Olá+Nome (PT-BR) + corpo FIXO — em paralelo. Sem “só o nome” no meio.
      const introPromise = (async () => {
        const olaHit = await findCachedMediaUrl(
          admin,
          opts.consultantId,
          buildIntroSlotCandidates("ola", nameNorm),
        );
        if (olaHit) {
          const bytes = await downloadUrlBytes(olaHit.url);
          const canonicalOla = `intro:ola:ptbr2:${nameNorm}`;
          if (olaHit.slotKey !== canonicalOla) {
            await upsertActiveMedia(
              admin,
              opts.consultantId,
              canonicalOla,
              olaHit.url,
              `Sofia intro · Olá+nome · pt-BR · ${display}`,
            );
          }
          return bytes;
        }
        return ensureOlaGreetBytes(admin, opts.consultantId, display, nameNorm);
      })();

      const [bodyBytes, introBytes] = await Promise.all([
        bodyPromise,
        introPromise,
      ]);
      parts = [introBytes, bodyBytes];
    }

    const merged = await concatMp3Parts(parts);
    const slug = `stitch-${spec.baseSlot}-${stitchVer}-${gender}-${nameNorm}-${Date.now()}`.slice(0, 80);
    const finalUrl = await uploadMp3(merged, opts.consultantId, slug);
    const label = spec.introMode === "nome_only"
      ? (spec.baseSlot.startsWith("a3")
        ? `Sofia stitch · ${display} · explicação`
        : `Sofia stitch · ${display} · ${gender}`)
      : `Sofia stitch · Olá+${display}+corpo · ${gender}`;
    await upsertActiveMedia(admin, opts.consultantId, renderSlot, finalUrl, label);

    console.log(
      `[wa-stitch] ok slot=${opts.slotKey} name=${display} gender=${gender} mode=${spec.introMode} cached=false`,
    );
    return { ok: true, url: finalUrl, gender, displayName: display, cached: false };
  } catch (e) {
    const msg = (e as Error)?.message || "stitch_failed";
    console.warn(`[wa-stitch] falhou slot=${opts.slotKey} name=${display}:`, msg);
    return { ok: false, error: msg, gender, displayName: display, mode: "skipped" };
  }
}
