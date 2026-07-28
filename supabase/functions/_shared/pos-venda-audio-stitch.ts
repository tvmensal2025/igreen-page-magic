/**
 * Pós-venda = stitch Sofia (igual Grupo A), NÃO TTS do roteiro inteiro.
 *
 * Peças:
 *  1) intro:ola:ptbr4:{nome}  — reaproveita biblioteca (Maria, José, …)
 *  2) pv_saudacao:{manha|tarde|noite} — 3 clips fixos (gera 1×)
 *  3) pv_body:{stage}:v1 — corpo do estágio sem nome/saudação (gera 1×)
 *
 * Só gasta ElevenLabs se faltar intro do nome OU saudação OU corpo.
 */
import {
  concatMp3Parts,
  normalizeCallName,
} from "./voice-dialer/call-stitch.ts";
import { safeFirstNameForAddress } from "./customer-display-name.ts";
import {
  buildOlaTudoBemTtsText,
  SOFIA_MODEL_V3,
  SOFIA_STITCH_PROFILE,
  SOFIA_VOICE,
  VOICE_SETTINGS_V3_GREET,
} from "./tts-ptbr-anchor.ts";
import {
  findSharedFixedClipUrl,
  findSharedOlaIntroUrl,
  upsertPublicIntro,
} from "./ai-media-shared-intro.ts";
import {
  saudacaoBucketBRT,
  type SaudacaoBucket,
} from "./pos-venda-tts.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SOFIA_VOICE_ID = SOFIA_STITCH_PROFILE.voiceId;

const SAUDACAO_TEXT: Record<SaudacaoBucket, string> = {
  manha: "Muito bom dia.",
  tarde: "Muito boa tarde.",
  noite: "Muito boa noite.",
};

export interface PosVendaStitchOpts {
  consultantId: string;
  customerName?: string | null;
  nameSource?: string | null;
  /** aprovado | d30 | … | d210 */
  stage: string;
  /** Template cru com {{nome}} / {{saudacao}} */
  rawTemplate: string;
  now?: Date;
}

export interface PosVendaStitchResult {
  ok: boolean;
  url?: string;
  error?: string;
  /** Quanto TTS novo foi necessário nesta montagem. */
  generated: {
    intro: boolean;
    saudacao: boolean;
    body: boolean;
  };
  displayName: string;
  saudacaoBucket: SaudacaoBucket;
  cachedFull: boolean;
}

function stageKeyNorm(stage: string): string {
  const s = String(stage || "").replace(/^pv_/, "").trim();
  return s || "aprovado";
}

/** Extrai corpo fixo: remove abertura Olá+nome e linha {{saudacao}}. */
export function extractPosVendaBody(rawTemplate: string): string {
  let t = String(rawTemplate || "");
  t = t.replace(/^\s*Ol[áa],\s*\{\{\s*nome\s*\}\}\s*Tudo bem\?\s*/i, "");
  t = t.replace(/\{\{\s*saudacao\s*\}\}\s*/gi, "");
  t = t.replace(/\n{3,}/g, "\n\n").trim();
  return t;
}

function bodySlot(stage: string): string {
  return `pv_body:${stageKeyNorm(stage)}:v1`;
}

function saudacaoSlot(bucket: SaudacaoBucket): string {
  return `pv_saudacao:${bucket}:v1`;
}

function stitchSlot(
  stage: string,
  bucket: SaudacaoBucket,
  nameNorm: string,
): string {
  const n = nameNorm || "_sem_nome";
  return `pv_stitch:${stageKeyNorm(stage)}:${bucket}:${n}:v1`;
}

async function downloadUrlBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`download_${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength < 256) throw new Error("download_empty");
  return bytes;
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

/** Ativo primeiro; se não houver, reativa o mais antigo inativo (reuso). */
async function findUrlPreferActive(
  admin: any,
  consultantId: string,
  slotKey: string,
): Promise<{ url: string; reactivated: boolean } | null> {
  const active = await findActiveUrl(admin, consultantId, slotKey);
  if (active) return { url: active, reactivated: false };
  const { data } = await admin
    .from("ai_media_library")
    .select("id, url")
    .eq("consultant_id", consultantId)
    .eq("slot_key", slotKey)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data?.url) return null;
  try {
    await admin.from("ai_media_library").update({ active: true }).eq("id", data.id);
  } catch { /* best-effort */ }
  return { url: String(data.url), reactivated: true };
}

async function synthesizeSofiaMp3(text: string): Promise<Uint8Array> {
  const key = (Deno.env.get("ELEVENLABS_API_KEY") || "").trim();
  if (!key) throw new Error("ELEVENLABS_API_KEY_missing");
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (clean.length < 2) throw new Error("tts_text_empty");
  // Corpo pode ser longo — limite confortável do v3 (5k).
  if (clean.length > 4500) throw new Error("tts_text_too_long");

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${SOFIA_VOICE_ID}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": key,
      },
      body: JSON.stringify({
        text: clean,
        model_id: SOFIA_STITCH_PROFILE.modelId,
        language_code: SOFIA_STITCH_PROFILE.languageCode,
        voice_settings: { ...VOICE_SETTINGS_V3_GREET },
      }),
      signal: AbortSignal.timeout(90_000),
    },
  );
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`elevenlabs_${res.status}:${err.slice(0, 160)}`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength < 256) throw new Error("elevenlabs_empty");
  return bytes;
}

async function uploadMp3(
  bytes: Uint8Array,
  consultantId: string,
  slug: string,
): Promise<string> {
  if (!SUPABASE_URL || !SERVICE_ROLE) throw new Error("supabase_env_missing");
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
    throw new Error(`upload_failed_${uploadRes.status}`);
  }
  const uploaded = await uploadRes.json();
  const url = uploaded?.url ? String(uploaded.url) : null;
  if (!url) throw new Error("upload_sem_url");
  return url;
}

async function upsertActiveMedia(
  admin: any,
  consultantId: string,
  slotKey: string,
  url: string,
  label: string,
  transcript?: string,
): Promise<void> {
  const sharedPublic =
    slotKey.startsWith("intro:ola:") ||
    slotKey.startsWith("pv_saudacao:") ||
    slotKey.startsWith("pv_body:");
  if (sharedPublic) {
    await upsertPublicIntro(admin, {
      consultantId,
      slotKey,
      url,
      label,
      transcript,
      intentTags: slotKey.startsWith("pv_saudacao:")
        ? ["pos_venda_stitch", "saudacao"]
        : slotKey.startsWith("pv_body:")
        ? ["pos_venda_stitch", "pv_body"]
        : ["wa_intro", "call_intro", "pos_venda_stitch"],
    });
    return;
  }
  try {
    await admin
      .from("ai_media_library")
      .update({ active: false })
      .eq("consultant_id", consultantId)
      .eq("slot_key", slotKey)
      .eq("active", true);
  } catch { /* ok */ }
  await admin.from("ai_media_library").insert({
    consultant_id: consultantId,
    slot_key: slotKey,
    url,
    kind: "audio",
    label: label.slice(0, 120),
    transcript: (transcript || "").slice(0, 500),
    active: true,
    is_public: false,
    is_draft: false,
    step_tags: [],
    intent_tags: ["pos_venda_stitch"],
    priority: 0,
  });
}

async function ensureFixedClip(
  admin: any,
  consultantId: string,
  slotKey: string,
  spoken: string,
  label: string,
): Promise<{ bytes: Uint8Array; generated: boolean }> {
  // Saudação e corpo fixo: reusa público de qualquer consultor.
  if (slotKey.startsWith("pv_saudacao:") || slotKey.startsWith("pv_body:")) {
    const shared = await findSharedFixedClipUrl(admin, consultantId, slotKey);
    if (shared) {
      return { bytes: await downloadUrlBytes(shared.url), generated: false };
    }
  } else {
    const hit = await findUrlPreferActive(admin, consultantId, slotKey);
    if (hit) {
      return { bytes: await downloadUrlBytes(hit.url), generated: false };
    }
  }
  const bytes = await synthesizeSofiaMp3(spoken);
  try {
    const slug = `${slotKey.replace(/:/g, "-")}-${Date.now()}`.slice(0, 80);
    const url = await uploadMp3(bytes, consultantId, slug);
    await upsertActiveMedia(admin, consultantId, slotKey, url, label, spoken);
  } catch (e) {
    console.warn("[pv-stitch] cache clip falhou (segue bytes)", slotKey, (e as Error)?.message);
  }
  return { bytes, generated: true };
}

/**
 * Monta áudio pós-venda reaproveitando intros de nome + clips fixos.
 * Nunca TTS do roteiro completo.
 */
export async function renderPosVendaStitchedAudio(
  admin: any,
  opts: PosVendaStitchOpts,
): Promise<PosVendaStitchResult> {
  const now = opts.now ?? new Date();
  const bucket = saudacaoBucketBRT(now);
  const stage = stageKeyNorm(opts.stage);
  const display =
    safeFirstNameForAddress(opts.customerName, opts.nameSource) || "";
  const nameNorm = display ? normalizeCallName(display) : "";
  const generated = { intro: false, saudacao: false, body: false };

  const fullSlot = stitchSlot(stage, bucket, nameNorm);
  const fullHit = await findUrlPreferActive(admin, opts.consultantId, fullSlot);
  if (fullHit) {
    return {
      ok: true,
      url: fullHit.url,
      generated,
      displayName: display,
      saudacaoBucket: bucket,
      cachedFull: true,
    };
  }

  const bodyText = extractPosVendaBody(opts.rawTemplate);
  if (bodyText.length < 20) {
    return {
      ok: false,
      error: "body_too_short",
      generated,
      displayName: display,
      saudacaoBucket: bucket,
      cachedFull: false,
    };
  }

  try {
    const parts: Uint8Array[] = [];

    // 1) Intro nome — biblioteca pública Sofia (Maria etc.). NUNCA stitch A2 completo.
    if (display) {
      const shared = await findSharedOlaIntroUrl(admin, opts.consultantId, nameNorm);
      if (shared) {
        parts.push(await downloadUrlBytes(shared.url));
        const canonical = `intro:ola:ptbr4:${nameNorm}`;
        if (shared.slotKey !== canonical) {
          try {
            await upsertPublicIntro(admin, {
              consultantId: opts.consultantId,
              slotKey: canonical,
              url: shared.url,
              label: `Sofia intro · Olá+nome+tudo bem · pt-BR · ${display}`,
              transcript: buildOlaTudoBemTtsText(display),
            });
          } catch { /* ok */ }
        }
      } else {
        // Gera SÓ o intro (crédito mínimo) e cacheia público — não usa stitch A2.
        const olaText = buildOlaTudoBemTtsText(display);
        const olaBytes = await synthesizeSofiaMp3(olaText);
        generated.intro = true;
        parts.push(olaBytes);
        try {
          const slot = `intro:ola:ptbr4:${nameNorm}`;
          const slug = `intro-ola-ptbr4-${nameNorm}-${Date.now()}`.slice(0, 80);
          const url = await uploadMp3(olaBytes, opts.consultantId, slug);
          await upsertActiveMedia(
            admin,
            opts.consultantId,
            slot,
            url,
            `Sofia intro · Olá+nome+tudo bem · pt-BR · ${display}`,
            olaText,
          );
        } catch (e) {
          console.warn("[pv-stitch] cache intro falhou", (e as Error)?.message);
        }
      }
    }

    // 2) Saudação fixa (3 clips no máximo no projeto)
    const saud = await ensureFixedClip(
      admin,
      opts.consultantId,
      saudacaoSlot(bucket),
      SAUDACAO_TEXT[bucket],
      `PV saudação · ${bucket}`,
    );
    generated.saudacao = saud.generated;
    parts.push(saud.bytes);

    // 3) Corpo fixo do estágio
    const body = await ensureFixedClip(
      admin,
      opts.consultantId,
      bodySlot(stage),
      bodyText.replace(/\n{2,}/g, ". ").replace(/\n/g, " ").replace(/\s+/g, " ").trim(),
      `PV corpo · ${stage}`,
    );
    generated.body = body.generated;
    parts.push(body.bytes);

    if (parts.length === 0) {
      return {
        ok: false,
        error: "no_parts",
        generated,
        displayName: display,
        saudacaoBucket: bucket,
        cachedFull: false,
      };
    }

    const merged = await concatMp3Parts(parts);
    const slug = `pv-stitch-${stage}-${bucket}-${nameNorm || "x"}-${Date.now()}`.slice(0, 80);
    const url = await uploadMp3(merged, opts.consultantId, slug);
    try {
      await upsertActiveMedia(
        admin,
        opts.consultantId,
        fullSlot,
        url,
        `PV stitch · ${display || "sem nome"} · ${stage} · ${bucket}`,
        `${buildOlaTudoBemTtsText(display)} ${SAUDACAO_TEXT[bucket]} ${bodyText}`.slice(0, 500),
      );
    } catch { /* ok */ }

    console.log(JSON.stringify({
      event: "pos_venda_stitch_ok",
      stage,
      bucket,
      name: display || null,
      generated,
      chars_tts_approx:
        (generated.intro ? (display?.length || 0) + 20 : 0) +
        (generated.saudacao ? SAUDACAO_TEXT[bucket].length : 0) +
        (generated.body ? bodyText.length : 0),
    }));

    return {
      ok: true,
      url,
      generated,
      displayName: display,
      saudacaoBucket: bucket,
      cachedFull: false,
    };
  } catch (e) {
    console.error("[pv-stitch] falhou", (e as Error)?.message);
    return {
      ok: false,
      error: (e as Error)?.message || "stitch_failed",
      generated,
      displayName: display,
      saudacaoBucket: bucket,
      cachedFull: false,
    };
  }
}
