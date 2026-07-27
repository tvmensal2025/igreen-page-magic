/**
 * consultant-identity-bootstrap
 *
 * Quando o consultor completa nome + IA + telefone, gera:
 * - corpos A2 (M/F) em ai_media_library com a identidade dele
 * - call bodies da cadência A/B/C em voice_audio_clips + override em cadence_stage_config
 * - sobe clips no Velip (admin-call-audio-bootstrap)
 *
 * NÃO altera config global (consultant_id null).
 *
 * POST { consultant_id?: string, force?: boolean }
 * Auth: JWT do próprio consultor, ou service role.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  resolvePublicConsultantLabel,
  resolveAssistantDisplayName,
  resolveConsultantRoleGender,
} from "../_shared/consultant-public-label.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SOFIA_VOICE = "EJV7H2baGt5ab95tOoSG";
const MODEL_V3 = "eleven_v3";
const VOICE_SETTINGS_V3 = {
  stability: 0.55,
  similarity_boost: 0.8,
  style: 0.15,
  use_speaker_boost: true,
  speed: 0.98,
};

const CALL_STAGES = [
  "A_CALL",
  "A_CALL_RETRY",
  "CALL_1",
  "CALL_2",
  "CALL_3",
  "RECALL_60D_CALL",
  "RECALL_90D_CALL",
  "RECALL_5M_CALL",
  "RECALL_8M_CALL",
  "RECALL_12M_CALL",
  "RECALL_YEARLY_CALL",
] as const;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function firstName(label: string): string {
  const t = String(label || "").trim();
  if (!t) return "consultor";
  return t.split(/\s+/)[0] || t;
}

function fingerprintOf(assistente: string, gender: string, consultor: string): string {
  return `${assistente}|${gender}|${consultor}`.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function extractCallBody(messageText: string): string {
  let t = String(messageText || "").replace(/\r\n/g, "\n").trim();
  t = t.replace(/^Olá,\s*\{\{nome\}\}[!.,]?\s*(Tudo bem\?)?\s*\n+/i, "");
  t = t.replace(/^Olá[!.,]?\s*\n+/i, "");
  return t.trim();
}

function renderIdentity(
  text: string,
  assistente: string,
  consultor: string,
  gender: "consultor" | "consultora",
): string {
  const doDa = gender === "consultora" ? "da" : "do";
  const oA = gender === "consultora" ? "a" : "o";
  return text
    .replace(/\{\{\s*assistente\s*\}\}/gi, assistente)
    .replace(/\{\{\s*consultor\s*\}\}/gi, consultor)
    .replace(/\{\{\s*representante\s*\}\}/gi, consultor)
    .replace(/\{\{\s*do_da_consultor\s*\}\}/gi, doDa)
    .replace(/\{\{\s*o_a_consultor\s*\}\}/gi, oA)
    .replace(/\{\{\s*gestor_a\s*\}\}/gi, "")
    .replace(/\{\{\s*nome\s*\}\}/gi, "")
    .replace(/\{\{\s*consultor_phone\s*\}\}/gi, "")
    .replace(/,\s+da iGreen/gi, " da iGreen")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function a2BodyText(
  genderLead: "masculino" | "feminino",
  assistente: string,
  consultor: string,
  roleGender: "consultor" | "consultora",
): string {
  const bem = genderLead === "feminino" ? "bem-vinda" : "bem-vindo";
  const doDa = roleGender === "consultora" ? "da" : "do";
  return `Seja muito ${bem}.

Eu sou a ${assistente}, assistente virtual ${doDa} ${consultor} da iGreen.

Para eu te mostrar o quanto você pode economizar, me diga quanto você está gastando por mês na conta de luz.`;
}

async function ttsMp3(text: string, apiKey: string): Promise<Uint8Array> {
  const elRes = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${SOFIA_VOICE}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": apiKey,
      },
      body: JSON.stringify({
        text,
        model_id: MODEL_V3,
        language_code: "pt",
        voice_settings: VOICE_SETTINGS_V3,
      }),
    },
  );
  if (!elRes.ok) {
    const errBody = await elRes.text();
    throw new Error(`elevenlabs_${elRes.status}:${errBody.slice(0, 200)}`);
  }
  return new Uint8Array(await elRes.arrayBuffer());
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const ELEVENLABS_KEY = Deno.env.get("ELEVENLABS_API_KEY") || "";
  if (!SUPABASE_URL || !SERVICE_ROLE) return json(503, { error: "supabase_env_missing" });
  if (!ELEVENLABS_KEY) return json(503, { error: "ELEVENLABS_API_KEY_missing" });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const payload = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const force = Boolean(payload.force);

  const auth = req.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  let callerId = "";
  let isService = false;
  if (token && SERVICE_ROLE && token === SERVICE_ROLE) {
    isService = true;
  } else if (token) {
    try {
      const payloadJwt = JSON.parse(atob(token.split(".")[1] || ""));
      if (payloadJwt?.role === "service_role") isService = true;
      callerId = String(payloadJwt?.sub || "").trim();
    } catch { /* ignore */ }
  }

  const consultantId = String(payload.consultant_id || callerId || "").trim();
  if (!consultantId) return json(400, { error: "consultant_id_required" });
  if (!isService && callerId && callerId !== consultantId) {
    return json(403, { error: "forbidden_other_consultant" });
  }
  if (!isService && !callerId) return json(401, { error: "unauthorized" });

  const { data: cons, error: consErr } = await admin
    .from("consultants")
    .select(
      "id, name, display_name, assistant_name, gender, phone, identity_media_bootstrapped_at, identity_media_fingerprint",
    )
    .eq("id", consultantId)
    .maybeSingle();
  if (consErr || !cons) return json(404, { error: "consultant_not_found" });

  const assistente = resolveAssistantDisplayName(cons.assistant_name);
  if (!String(cons.assistant_name || "").trim() || assistente === "Assistente") {
    return json(400, { error: "assistant_name_required" });
  }
  const nameOk = String(cons.name || "").trim().length >= 3;
  if (!nameOk) return json(400, { error: "name_required" });
  const phoneDigits = String(cons.phone || "").replace(/\D/g, "");
  if (phoneDigits.length < 10) return json(400, { error: "phone_required" });

  // Só gera mídia com WhatsApp conectado (não bootstrap em massa / cadastro seco).
  const { data: waRows } = await admin
    .from("whatsapp_instances")
    .select("connected_phone, instance_name")
    .eq("consultant_id", consultantId)
    .limit(5);
  const waConnected = (Array.isArray(waRows) ? waRows : []).some((r) => {
    const p = String(r?.connected_phone || "").replace(/\D/g, "");
    const n = String(r?.instance_name || "").toLowerCase();
    return p.length >= 10 || n.startsWith("whapi");
  });
  if (!waConnected) {
    return json(200, {
      ok: true,
      skipped: true,
      reason: "whatsapp_not_connected",
      consultant_id: consultantId,
    });
  }

  const roleGender = resolveConsultantRoleGender(cons.gender, cons.name || cons.display_name);
  const consultor = firstName(
    resolvePublicConsultantLabel(cons.name, cons.display_name, roleGender === "consultora" ? "consultora" : "consultor"),
  );
  const fp = fingerprintOf(assistente, roleGender, consultor);

  if (!force && cons.identity_media_fingerprint === fp && cons.identity_media_bootstrapped_at) {
    return json(200, {
      ok: true,
      skipped: true,
      reason: "fingerprint_unchanged",
      consultant_id: consultantId,
      fingerprint: fp,
      assistente,
      consultor,
      gender: roleGender,
    });
  }

  // Bucket
  const { data: buckets } = await admin.storage.listBuckets();
  if (!buckets?.some((b) => b.id === "tts-cache")) {
    await admin.storage.createBucket("tts-cache", {
      public: true,
      fileSizeLimit: 10 * 1024 * 1024,
      allowedMimeTypes: ["audio/mpeg", "audio/mp3"],
    });
  }

  const report: Record<string, unknown>[] = [];

  // ── A2 corpos M/F ──────────────────────────────────────────────
  for (const leadGender of ["masculino", "feminino"] as const) {
    const slot = `a2_audio_activate_name__body_${leadGender}`;
    try {
      const text = a2BodyText(leadGender, assistente, consultor, roleGender);
      const audioBuf = await ttsMp3(text, ELEVENLABS_KEY);
      const path = `identity/${consultantId}/a2-body-${leadGender}-${Date.now()}.mp3`;
      const { error: upErr } = await admin.storage.from("tts-cache").upload(path, audioBuf, {
        contentType: "audio/mpeg",
        upsert: true,
      });
      if (upErr) throw new Error(`upload_${upErr.message}`);
      const { data: pub } = admin.storage.from("tts-cache").getPublicUrl(path);
      const url = pub.publicUrl;

      await admin
        .from("ai_media_library")
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq("consultant_id", consultantId)
        .eq("slot_key", slot)
        .eq("active", true);

      const { error: insErr } = await admin.from("ai_media_library").insert({
        consultant_id: consultantId,
        kind: "audio",
        label: `A2 corpo ${leadGender} · ${assistente}`.slice(0, 120),
        slot_key: slot,
        url,
        text_content: text.slice(0, 8000),
        active: true,
        is_public: false,
        is_draft: false,
        send_order: 0,
        priority: 10,
      });
      if (insErr) throw new Error(`media_insert_${insErr.message}`);
      report.push({ kind: "a2_body", slot, ok: true, url, bytes: audioBuf.byteLength });
    } catch (e) {
      report.push({ kind: "a2_body", slot, ok: false, error: (e as Error).message });
    }
  }

  // ── Call bodies (só override do consultor — nunca global) ──────
  for (const stage of CALL_STAGES) {
    try {
      const { data: globalRow } = await admin
        .from("cadence_stage_config")
        .select("message_text, enabled, delay_hours, media_type, personalize_name, buttons")
        .eq("stage", stage)
        .is("consultant_id", null)
        .maybeSingle();
      if (!globalRow?.message_text) {
        report.push({ kind: "call", stage, ok: false, error: "no_global_message_text" });
        continue;
      }
      const bodyText = renderIdentity(
        extractCallBody(globalRow.message_text),
        assistente,
        consultor,
        roleGender,
      );
      if (bodyText.length < 20) {
        report.push({ kind: "call", stage, ok: false, error: "body_too_short" });
        continue;
      }
      const audioBuf = await ttsMp3(bodyText, ELEVENLABS_KEY);
      const path = `identity/${consultantId}/call-${stage.toLowerCase()}-${Date.now()}.mp3`;
      const { error: upErr } = await admin.storage.from("tts-cache").upload(path, audioBuf, {
        contentType: "audio/mpeg",
        upsert: true,
      });
      if (upErr) throw new Error(`upload_${upErr.message}`);
      const { data: pub } = admin.storage.from("tts-cache").getPublicUrl(path);

      const { data: clip, error: clipErr } = await admin
        .from("voice_audio_clips")
        .insert({
          consultant_id: consultantId,
          name: `[Identidade] ${stage} · ${assistente}`.slice(0, 120),
          audio_url: pub.publicUrl,
          voice_id: SOFIA_VOICE,
          model_id: MODEL_V3,
          is_call_body: true,
        })
        .select("id")
        .single();
      if (clipErr || !clip?.id) throw new Error(`clip_${clipErr?.message || "no_id"}`);

      const { data: existing } = await admin
        .from("cadence_stage_config")
        .select("id")
        .eq("stage", stage)
        .eq("consultant_id", consultantId)
        .maybeSingle();

      if (existing?.id) {
        await admin
          .from("cadence_stage_config")
          .update({
            voice_audio_clip_id: clip.id,
            personalize_name: true,
            message_text: globalRow.message_text,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);
      } else {
        await admin.from("cadence_stage_config").insert({
          consultant_id: consultantId,
          stage,
          enabled: globalRow.enabled ?? true,
          delay_hours: globalRow.delay_hours ?? 24,
          message_text: globalRow.message_text,
          media_type: globalRow.media_type || "text",
          voice_audio_clip_id: clip.id,
          personalize_name: true,
          buttons: globalRow.buttons ?? null,
        });
      }

      report.push({
        kind: "call",
        stage,
        ok: true,
        clip_id: clip.id,
        preview: bodyText.slice(0, 120),
      });
    } catch (e) {
      report.push({ kind: "call", stage, ok: false, error: (e as Error).message });
    }
  }

  // Velip (best-effort)
  let velip: unknown = null;
  try {
    const velipRes = await fetch(`${SUPABASE_URL}/functions/v1/admin-call-audio-bootstrap`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SERVICE_ROLE}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        consultant_id: consultantId,
        names: ["Maria"],
        limit_per_clip: 1,
      }),
    });
    velip = await velipRes.json().catch(() => ({ status: velipRes.status }));
  } catch (e) {
    velip = { error: (e as Error).message };
  }

  const okCount = report.filter((r) => (r as { ok?: boolean }).ok).length;
  await admin
    .from("consultants")
    .update({
      identity_media_bootstrapped_at: new Date().toISOString(),
      identity_media_fingerprint: fp,
    })
    .eq("id", consultantId);

  return json(200, {
    ok: okCount > 0,
    consultant_id: consultantId,
    assistente,
    consultor,
    gender: roleGender,
    fingerprint: fp,
    generated: okCount,
    total: report.length,
    report,
    velip,
  });
});
