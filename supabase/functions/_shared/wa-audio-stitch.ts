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

const SOFIA_VOICE = "EJV7H2baGt5ab95tOoSG";
const SOFIA_MODEL = "eleven_v3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

/** Textos fixos do corpo A2 (espelho do catálogo multicanal). */
export const A2_BODY_TEXT: Record<SpeechGender, string> = {
  feminino: `Seja muito bem-vinda.

Eu sou a Sofia, assistente virtual do Rafael Ferreira Dias, da iGreen Energia.

Para eu montar a simulação, me diga quanto você está gastando por mês na conta de luz.`,
  masculino: `Seja muito bem-vindo.

Eu sou a Sofia, assistente virtual do Rafael Ferreira Dias, da iGreen Energia.

Para eu montar a simulação, me diga quanto você está gastando por mês na conta de luz.`,
};

export const A3_BODY_TEXT = `Deixa eu te explicar de um jeito simples como funciona o benefício.

Nossas fazendas solares geram energia todos os dias e injetam na rede da sua distribuidora — CEMIG, CPFL, Copel e outras.

Você continua com a mesma conta e o mesmo medidor. O que muda é o crédito de energia limpa, sem placa e sem obra na sua casa.

Assim você economiza todo mês e reduz o impacto das bandeiras amarela e vermelha.

Não tem nenhum custo para você. Nenhum consultor pede depósito, Pix ou pagamento para ativar.

É simples.`;

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
    // Passo 2: “Olá, Nome.” juntos + corpo M/F
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
};

export function isPersonalizedWaAudioSlot(slotKey: string | null | undefined): boolean {
  return !!SPECS[String(slotKey || "")];
}

async function synthesizePhraseMp3(
  text: string,
  opts?: { brazilianForced?: boolean },
): Promise<Uint8Array> {
  const key = (Deno.env.get("ELEVENLABS_API_KEY") || "").trim();
  if (!key) throw new Error("ELEVENLABS_API_KEY_missing");

  // Intro curta (Olá+nome / nome): multilingual_v2 + contexto PT-BR.
  // eleven_v3 com frase curta costuma cair em sotaque espanhol.
  const modelId = opts?.brazilianForced ? "eleven_multilingual_v2" : SOFIA_MODEL;
  const voice_settings = opts?.brazilianForced
    ? {
      stability: 0.65,
      similarity_boost: 0.85,
      style: 0.0,
      use_speaker_boost: true,
      speed: 0.95,
    }
    : {
      stability: 0.5,
      similarity_boost: 0.75,
      style: 0.0,
      use_speaker_boost: true,
      speed: 1.0,
    };

  const payload: Record<string, unknown> = {
    text,
    model_id: modelId,
    voice_settings,
  };
  if (opts?.brazilianForced) {
    payload.previous_text = "Bom dia, ";
    payload.next_text = " Tudo bem com você?";
  } else {
    payload.language_code = "pt";
  }

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${SOFIA_VOICE}`, {
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

async function upsertActiveMedia(
  admin: any,
  consultantId: string,
  slotKey: string,
  url: string,
  label: string,
): Promise<void> {
  await admin
    .from("ai_media_library")
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq("consultant_id", consultantId)
    .eq("slot_key", slotKey)
    .eq("active", true);
  await admin.from("ai_media_library").insert({
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
  });
}

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
  const existing = await findActiveUrl(admin, consultantId, bodySlot);
  if (existing) return existing;

  console.log(`[wa-stitch] gerando corpo TTS slot=${bodySlot}`);
  const bytes = await synthesizePhraseMp3(bodyText);
  const slug = `multichannel-${bodySlot}-${Date.now()}`.slice(0, 80);
  const url = await uploadMp3(bytes, consultantId, slug);
  await upsertActiveMedia(admin, consultantId, bodySlot, url, `Sofia corpo · ${bodySlot}`);
  return url;
}

export type WaStitchResult = {
  ok: boolean;
  url?: string;
  gender?: SpeechGender;
  displayName?: string;
  cached?: boolean;
  error?: string;
  /** stitch = Olá+nome+corpo · body_only = só corpo (sem nome) · skipped = não enviar áudio */
  mode?: "stitch" | "body_only" | "skipped";
};

/**
 * Regra de ouro: MP3 da prévia do painel (com Maria/Rodrigo) NUNCA vai ao WhatsApp.
 * Só retorna URL de stitch (nome real) ou corpo fixo sem nome.
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

  const timeoutMs = opts.timeoutMs ?? 10_000;
  const stitched = await Promise.race([
    resolvePersonalizedWaAudio(admin, {
      consultantId: opts.consultantId,
      slotKey: opts.slotKey,
      customerName: opts.customerName,
    }),
    new Promise<WaStitchResult>((resolve) =>
      setTimeout(() => resolve({ ok: false, error: "timeout", mode: "skipped" }), timeoutMs),
    ),
  ]);

  if (stitched.ok && stitched.url) {
    return {
      ...stitched,
      mode: stitched.error?.startsWith("partial_body_only") ? "body_only" : "stitch",
    };
  }

  // Timeout/falha: corpo M/F sem nome — nunca o MP3 da prévia.
  const gender = inferSpeechGender(display);
  const baseSlot = opts.slotKey.startsWith("a2_")
    ? "a2_audio_activate_name"
    : "a3_explain_with_buttons";
  const bodySlot = opts.slotKey.startsWith("a2_")
    ? `${baseSlot}__body_${gender}`
    : `${baseSlot}__body`;

  try {
    const bodyUrl = await ensureBodyUrl(
      admin,
      opts.consultantId,
      baseSlot,
      gender,
      opts.slotKey.startsWith("a2_") ? A2_BODY_TEXT[gender] : A3_BODY_TEXT,
      opts.slotKey.startsWith("a2_"),
    );
    return {
      ok: true,
      url: bodyUrl,
      gender,
      displayName: display,
      cached: true,
      error: `safe_body_only:${stitched.error || "unknown"}`,
      mode: "body_only",
    };
  } catch (e) {
    const existing = await findActiveUrl(admin, opts.consultantId, bodySlot);
    if (existing) {
      return {
        ok: true,
        url: existing,
        gender,
        displayName: display,
        cached: true,
        error: `safe_body_existing:${stitched.error || "unknown"}`,
        mode: "body_only",
      };
    }
    return {
      ok: false,
      error: (e as Error)?.message || stitched.error || "no_safe_audio",
      gender,
      displayName: display,
      mode: "skipped",
    };
  }
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
  const introSlot = `intro:nome:ptbr2:${nameNorm}`;
  const cachedUrl = await findActiveUrl(admin, consultantId, introSlot);
  if (cachedUrl) {
    try {
      return await downloadUrlBytes(cachedUrl);
    } catch { /* regenera */ }
  }

  const bytes = await synthesizePhraseMp3(`${display}.`, { brazilianForced: true });

  try {
    const slug = `intro-nome-ptbr-${nameNorm}-${Date.now()}`.slice(0, 80);
    const url = await uploadMp3(bytes, consultantId, slug);
    await upsertActiveMedia(
      admin,
      consultantId,
      introSlot,
      url,
      `Sofia intro · nome · pt-BR v2 · ${display}`,
    );
  } catch (e) {
    console.warn(`[wa-stitch] cache nome falhou (segue com bytes):`, (e as Error)?.message);
  }
  return bytes;
}

/** “Olá, Nome.” juntos — passo 2. */
async function ensureOlaGreetBytes(
  admin: any,
  consultantId: string,
  display: string,
  nameNorm: string,
): Promise<Uint8Array> {
  const introSlot = `intro:ola:ptbr2:${nameNorm}`;
  const cachedUrl = await findActiveUrl(admin, consultantId, introSlot);
  if (cachedUrl) {
    try {
      return await downloadUrlBytes(cachedUrl);
    } catch { /* regenera */ }
  }

  const bytes = await synthesizePhraseMp3(`Olá, ${display}.`, { brazilianForced: true });

  try {
    const slug = `intro-ola-ptbr-${nameNorm}-${Date.now()}`.slice(0, 80);
    const url = await uploadMp3(bytes, consultantId, slug);
    await upsertActiveMedia(
      admin,
      consultantId,
      introSlot,
      url,
      `Sofia intro · Olá+nome · pt-BR · ${display}`,
    );
  } catch (e) {
    console.warn(`[wa-stitch] cache Olá+nome falhou (segue com bytes):`, (e as Error)?.message);
  }
  return bytes;
}

/**
 * Gera e salva SÓ o MP3 do nome em intro:nome:ptbr2:{norm}.
 * Usado no passo 3 (nome + explicação).
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
  const existing = await findActiveUrl(admin, opts.consultantId, `intro:nome:ptbr2:${nameNorm}`);
  if (existing) {
    return {
      ok: true,
      url: existing,
      gender,
      displayName: display,
      cached: true,
      mode: "stitch",
    };
  }
  try {
    await ensureNameBytes(admin, opts.consultantId, display, nameNorm);
    const url = await findActiveUrl(admin, opts.consultantId, `intro:nome:ptbr2:${nameNorm}`);
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
  resolvePersonalizedWaAudio(admin, {
    consultantId: opts.consultantId,
    slotKey,
    customerName: opts.customerName,
  })
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
 * Resolve URL final personalizada.
 * A2: “Olá, {nome}.” + corpo M/F
 * A3: só o nome + explicação (sem Então)
 * Gera e salva sob demanda quando a pessoa chegar.
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
  // ola3 = Olá+nome juntos; n3 = só nome + corpo (sem Então).
  const stitchVer = spec.introMode === "nome_only" ? "n3" : "ola3";
  const renderSlot = `stitch:${spec.baseSlot}:${stitchVer}:${spec.genderedBody ? gender : "x"}:${nameNorm}`;

  try {
    const cached = await findActiveUrl(admin, opts.consultantId, renderSlot);
    if (cached) {
      return { ok: true, url: cached, gender, displayName: display, cached: true };
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
      const [olaBytes, bodyBytes] = await Promise.all([
        ensureOlaGreetBytes(admin, opts.consultantId, display, nameNorm),
        bodyPromise,
      ]);
      parts = [olaBytes, bodyBytes];
    }

    const merged = await concatMp3Parts(parts);
    const slug = `stitch-${spec.baseSlot}-${stitchVer}-${gender}-${nameNorm}-${Date.now()}`.slice(0, 80);
    const finalUrl = await uploadMp3(merged, opts.consultantId, slug);
    const label = spec.introMode === "nome_only"
      ? `Sofia stitch · ${display} · explicação`
      : `Sofia stitch · Olá+${display} · ${gender}`;
    await upsertActiveMedia(admin, opts.consultantId, renderSlot, finalUrl, label);

    console.log(
      `[wa-stitch] ok slot=${opts.slotKey} name=${display} gender=${gender} mode=${spec.introMode} cached=false`,
    );
    return { ok: true, url: finalUrl, gender, displayName: display, cached: false };
  } catch (e) {
    const msg = (e as Error)?.message || "stitch_failed";
    console.warn(`[wa-stitch] falhou slot=${opts.slotKey}:`, msg);

    if (spec.genderedBody) {
      try {
        const bodyOnly = await ensureBodyUrl(
          admin,
          opts.consultantId,
          spec.baseSlot,
          gender,
          spec.bodyText(gender),
          true,
        );
        console.warn(
          `[wa-stitch] fallback corpo-only slot=${opts.slotKey} gender=${gender} name=${display}`,
        );
        return {
          ok: true,
          url: bodyOnly,
          gender,
          displayName: display,
          cached: true,
          error: `partial_body_only:${msg}`,
        };
      } catch (e2) {
        console.warn(`[wa-stitch] fallback corpo-only falhou:`, (e2 as Error)?.message);
      }
    }

    return { ok: false, error: msg, gender, displayName: display };
  }
}
