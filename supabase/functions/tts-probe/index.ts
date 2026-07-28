/**
 * Ops seed pós-venda (Sofia):
 *  - seed_pv_saudacao
 *  - seed_pv_missing  → corpos d60/d90/d150 (+outro se faltar) + intros Olá faltantes
 * Auth: assertCronAuth
 */
import { assertCronAuth, cronAuthUnauthorized } from "../_shared/cron-auth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  SOFIA_MODEL_V3,
  SOFIA_STITCH_PROFILE,
  SOFIA_VOICE,
  VOICE_SETTINGS_V3_GREET,
  buildOlaTudoBemTtsText,
} from "../_shared/tts-ptbr-anchor.ts";
import { extractPosVendaBody } from "../_shared/pos-venda-audio-stitch.ts";
import { upsertPublicIntro } from "../_shared/ai-media-shared-intro.ts";

const DEFAULT_CONSULTANT = "0c2711ad-4836-41e6-afba-edd94f698ae3";

const SAUDACOES = [
  { bucket: "manha", text: "Muito bom dia.", slot: "pv_saudacao:manha:v1" },
  { bucket: "tarde", text: "Muito boa tarde.", slot: "pv_saudacao:tarde:v1" },
  { bucket: "noite", text: "Muito boa noite.", slot: "pv_saudacao:noite:v1" },
] as const;

const BODY_STAGES = ["aprovado", "d60", "d90", "d120", "d150"] as const;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-internal-secret, x-service-secret",
};

function normalizeName(input: string): string {
  return (input || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

async function synthesizeSofiaMp3(text: string): Promise<Uint8Array> {
  const key = (Deno.env.get("ELEVENLABS_API_KEY") || "").trim();
  if (!key) throw new Error("ELEVENLABS_API_KEY_missing");
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (clean.length < 2) throw new Error("tts_text_empty");
  if (clean.length > 4500) throw new Error("tts_text_too_long");
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${SOFIA_STITCH_PROFILE.voiceId}`,
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
    const err = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error(`elevenlabs_${res.status}:${err}`);
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
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceRole) throw new Error("supabase_env_missing");
  const fd = new FormData();
  fd.append(
    "file",
    new Blob([bytes as BlobPart], { type: "audio/mpeg" }),
    `${slug}.mp3`,
  );
  fd.append("scope", "admin");
  fd.append("consultant_id", consultantId);
  fd.append("kind", "audio");
  fd.append("slug", slug.slice(0, 80));
  const up = await fetch(`${supabaseUrl}/functions/v1/upload-media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${serviceRole}`, apikey: serviceRole },
    body: fd,
    signal: AbortSignal.timeout(60_000),
  });
  if (!up.ok) throw new Error(`upload_failed_${up.status}`);
  const json = await up.json();
  const url = json?.url ? String(json.url) : "";
  if (!url) throw new Error("upload_sem_url");
  return url;
}

async function hasActiveSlot(
  admin: ReturnType<typeof createClient>,
  consultantId: string,
  slot: string,
): Promise<boolean> {
  const { data } = await admin
    .from("ai_media_library")
    .select("id")
    .eq("consultant_id", consultantId)
    .eq("slot_key", slot)
    .eq("active", true)
    .limit(1)
    .maybeSingle();
  return !!data?.id;
}

async function hasPublicOla(
  admin: ReturnType<typeof createClient>,
  nameNorm: string,
): Promise<boolean> {
  for (const slot of [`intro:ola:ptbr4:${nameNorm}`, `intro:ola:${nameNorm}`]) {
    const { data } = await admin
      .from("ai_media_library")
      .select("id")
      .eq("slot_key", slot)
      .eq("active", true)
      .limit(1)
      .maybeSingle();
    if (data?.id) return true;
  }
  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const auth = await assertCronAuth(req, supabase as any);
  if (!auth.ok) return cronAuthUnauthorized(auth.reason, cors);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch { /* ok */ }

  const action = String(body.action || "seed_pv_missing");
  const consultantId = String(body.consultant_id || DEFAULT_CONSULTANT).trim() ||
    DEFAULT_CONSULTANT;
  const limitNames = Math.max(1, Math.min(80, Number(body.limit_names) || 80));

  if (action === "seed_pv_saudacao") {
    const report: unknown[] = [];
    for (const s of SAUDACOES) {
      if (await hasActiveSlot(supabase, consultantId, s.slot)) {
        report.push({ slot: s.slot, ok: true, skipped: true });
        continue;
      }
      try {
        const bytes = await synthesizeSofiaMp3(s.text);
        const url = await uploadMp3(
          bytes,
          consultantId,
          `pv-saudacao-${s.bucket}-v1-${Date.now()}`,
        );
        await upsertPublicIntro(supabase, {
          consultantId,
          slotKey: s.slot,
          url,
          label: `PV saudação · ${s.bucket} · Sofia`,
          transcript: s.text,
          intentTags: ["pos_venda_stitch", "saudacao"],
        });
        report.push({ slot: s.slot, ok: true, skipped: false, bytes: bytes.byteLength });
      } catch (e) {
        report.push({ slot: s.slot, ok: false, error: (e as Error).message });
      }
    }
    return Response.json({ ok: report.every((r: any) => r.ok), report }, { headers: cors });
  }

  if (action !== "seed_pv_missing") {
    return Response.json({ ok: false, error: "unknown_action" }, { headers: cors });
  }

  const bodies: unknown[] = [];
  const { data: mediaRows } = await supabase
    .from("pos_venda_default_media")
    .select("stage, message_text")
    .in("stage", [...BODY_STAGES]);
  const byStage: Record<string, string> = {};
  for (const r of mediaRows || []) {
    byStage[String((r as any).stage)] = String((r as any).message_text || "");
  }

  for (const stage of BODY_STAGES) {
    const slot = `pv_body:${stage}:v1`;
    if (await hasActiveSlot(supabase, consultantId, slot)) {
      bodies.push({ stage, slot, ok: true, skipped: true });
      continue;
    }
    const raw = byStage[stage] || "";
    const bodyText = extractPosVendaBody(raw)
      .replace(/\n{2,}/g, ". ")
      .replace(/\n/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (bodyText.length < 20) {
      bodies.push({ stage, slot, ok: false, error: "body_too_short" });
      continue;
    }
    try {
      const bytes = await synthesizeSofiaMp3(bodyText);
      const url = await uploadMp3(bytes, consultantId, `pv-body-${stage}-v1-${Date.now()}`);
      // Corpo fixo idêntico p/ todos → público (próximos consultores reusam).
      await upsertPublicIntro(supabase, {
        consultantId,
        slotKey: slot,
        url,
        label: `PV corpo · ${stage}`,
        transcript: bodyText.slice(0, 500),
        intentTags: ["pos_venda_stitch", "pv_body"],
      });
      bodies.push({
        stage,
        slot,
        ok: true,
        skipped: false,
        bytes: bytes.byteLength,
        chars: bodyText.length,
      });
    } catch (e) {
      bodies.push({ stage, slot, ok: false, error: (e as Error).message });
    }
  }

  // Nomes faltantes da fila due (sem sent)
  const { data: customers } = await supabase
    .from("customers")
    .select("id, name, pos_venda_approved_at, pos_venda_stage")
    .eq("consultant_id", consultantId)
    .eq("customer_origin", "igreen_sync")
    .eq("pos_venda_manual", true)
    .in("pos_venda_stage", ["aprovado", "d30", "d60", "d90", "d120", "d150", "d180", "d210"])
    .not("pos_venda_approved_at", "is", null);

  const ids = (customers || []).map((c: any) => String(c.id));
  const sentKeys = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const { data: logs } = await supabase
      .from("customer_auto_message_log")
      .select("customer_id, stage_key, status")
      .in("customer_id", chunk)
      .like("stage_key", "pv_%");
    for (const l of logs || []) {
      const st = String((l as any).status || "");
      if (st === "sent" || st.startsWith("sent") || st === "skipped_prior" || st === "disabled_no_send") {
        sentKeys.add(`${(l as any).customer_id}:${(l as any).stage_key}`);
      }
    }
  }

  const nowMs = Date.now();
  const MS_DAY = 86400000;
  function dueStage(days: number): string {
    if (days < 30) return "aprovado";
    if (days >= 210) return "d210";
    if (days >= 180) return "d180";
    if (days >= 150) return "d150";
    if (days >= 120) return "d120";
    if (days >= 90) return "d90";
    if (days >= 60) return "d60";
    return "d30";
  }

  const missingMap = new Map<string, string>();
  for (const c of customers || []) {
    const approved = new Date((c as any).pos_venda_approved_at).getTime();
    if (!Number.isFinite(approved)) continue;
    const days = Math.floor((nowMs - approved) / MS_DAY);
    const stage = dueStage(days);
    const stageKey = stage === "aprovado" ? "pv_aprovado" : `pv_${stage}`;
    if (sentKeys.has(`${(c as any).id}:${stageKey}`)) continue;
    const rawName = String((c as any).name || "").trim();
    if (!rawName) continue;
    const display = rawName.split(/\s+/)[0] || "";
    const nameNorm = normalizeName(display);
    if (!nameNorm || missingMap.has(nameNorm)) continue;
    missingMap.set(nameNorm, display);
  }

  const intros: unknown[] = [];
  let generated = 0;
  let skipped = 0;
  let failed = 0;
  for (const [nameNorm, display] of missingMap) {
    if (generated + skipped + failed >= limitNames && generated >= limitNames) break;
    if (await hasPublicOla(supabase, nameNorm)) {
      skipped++;
      intros.push({ name: display, nameNorm, ok: true, skipped: true });
      continue;
    }
    if (generated >= limitNames) break;
    try {
      const text = buildOlaTudoBemTtsText(display);
      const bytes = await synthesizeSofiaMp3(text);
      const url = await uploadMp3(
        bytes,
        consultantId,
        `intro-ola-ptbr4-${nameNorm}-${Date.now()}`,
      );
      await upsertPublicIntro(supabase, {
        consultantId,
        slotKey: `intro:ola:ptbr4:${nameNorm}`,
        url,
        label: `Sofia intro · Olá+nome+tudo bem · pt-BR · ${display}`,
        transcript: text,
        intentTags: ["wa_intro", "call_intro"],
      });
      generated++;
      intros.push({
        name: display,
        nameNorm,
        ok: true,
        skipped: false,
        bytes: bytes.byteLength,
      });
    } catch (e) {
      failed++;
      intros.push({ name: display, nameNorm, ok: false, error: (e as Error).message });
    }
  }

  const okBodies = bodies.every((b: any) => b.ok);
  const okIntros = failed === 0;
  return Response.json(
    {
      ok: okBodies && okIntros,
      consultant_id: consultantId,
      voice: SOFIA_VOICE,
      model: SOFIA_MODEL_V3,
      bodies,
      intros_summary: {
        missing_candidates: missingMap.size,
        generated,
        skipped_already_had: skipped,
        failed,
        processed: intros.length,
      },
      intros: intros.filter((i: any) => !i.skipped).slice(0, 80),
      saved_public: true,
      note: "Intros e corpos gravados is_public=true — próximos envios/consultores reusam sem TTS",
    },
    { headers: cors },
  );
});
