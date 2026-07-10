// voice-dialer-enqueue (Velip)
// Cria campanha PSTN + targets, ou dispara teste de 1 número.
// Autenticado por JWT do consultor. Isolado do WhatsApp/bot.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildCors } from "../_shared/cors.ts";
import { resolveCaller } from "../_shared/caller-auth.ts";
import {
  createDestinationBase,
  createCampaign as velipCreateCampaign,
  getVelipWebhookAuth,
  playAudioFile,
  toCtid,
  toVelipBRDest,
  uploadAudioFile,
  velipConfigured,
  velipWebhookAuthConfigured,
} from "../_shared/voice-dialer/velip.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface TargetIn {
  phone: string;
  name?: string | null;
  customer_id?: string | null;
}

interface Body {
  action?: "create_campaign" | "test_call";
  campaign_name?: string;
  audio_clip_id?: string | null;
  audio_url?: string | null;
  scheduled_at?: string | null;
  config?: Record<string, unknown>;
  phones?: TargetIn[];
  conversation_step?: string | null;
  cold_hours?: number | null;
  max_targets?: number;
  test_phone?: string | null;
  /** 'single' (default, cron dispara 1-a-1) ou 'batch' (usa CreateCampaign Velip). */
  velip_mode?: "single" | "batch";
}

const MAX_TARGETS = 5000;

/** Garante que o clipe tem velip_audio_id — sobe on-demand se preciso. */
async function ensureVelipAudioForClip(
  admin: ReturnType<typeof createClient>,
  clipId: string,
  consultantId: string,
): Promise<{ audio_id: string; audio_url: string } | { error: string }> {
  const { data: clip } = await admin
    .from("voice_audio_clips")
    .select("id, audio_url, name, velip_audio_id")
    .eq("id", clipId)
    .eq("consultant_id", consultantId)
    .maybeSingle();
  if (!clip?.audio_url) return { error: "clip_not_found" };
  if (clip.velip_audio_id) {
    return { audio_id: clip.velip_audio_id, audio_url: clip.audio_url };
  }
  // Baixa e sobe p/ Velip
  try {
    const r = await fetch(clip.audio_url, { signal: AbortSignal.timeout(30_000) });
    if (!r.ok) return { error: `download_failed_${r.status}` };
    const bytes = new Uint8Array(await r.arrayBuffer());
    const up = await uploadAudioFile(bytes, clip.name || `clip_${clipId}`);
    if (!up.ok || !up.audio_id) {
      return { error: up.error || "velip_upload_failed" };
    }
    await admin
      .from("voice_audio_clips")
      .update({ velip_audio_id: up.audio_id, velip_uploaded_at: new Date().toISOString() })
      .eq("id", clipId);
    return { audio_id: up.audio_id, audio_url: clip.audio_url };
  } catch (e) {
    return { error: (e as Error).message || "upload_error" };
  }
}

Deno.serve(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const caller = await resolveCaller(req, admin);
  if (caller instanceof Response) return caller;
  if (caller.mode !== "jwt") return json(403, { error: "forbidden" });
  const consultantId = caller.consultantId;

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_json" });
  }

  if (!velipConfigured()) {
    return json(422, {
      error: "velip_not_configured",
      message: "Configure VELIP_API_TOKEN nos secrets antes de discar.",
    });
  }
  if (!velipWebhookAuthConfigured()) {
    return json(422, {
      error: "velip_webhook_auth_missing",
      message: "Configure VELIP_WEBHOOK_AUTH (token aleatório) e cadastre no painel Velip → Integrações → URLs para Retorno.",
    });
  }

  const action = body.action ?? "create_campaign";

  // ─── Teste: 1 ligação imediata ───────────────────────────────────────────
  if (action === "test_call") {
    const dest = toVelipBRDest(body.test_phone);
    if (!dest) return json(400, { error: "invalid_test_phone" });
    if (!body.audio_clip_id) return json(400, { error: "missing_audio_clip_id" });

    const aud = await ensureVelipAudioForClip(admin, body.audio_clip_id, consultantId);
    if ("error" in aud) return json(502, { error: aud.error });

    const { data: campaign, error: campErr } = await admin
      .from("voice_campaigns")
      .insert({
        consultant_id: consultantId,
        name: body.campaign_name?.trim() || "Teste de ligação",
        audio_clip_id: body.audio_clip_id,
        audio_url: aud.audio_url,
        config: { ...(body.config ?? {}), test: true, weekdaysOnly: false, windowStart: "00:00", windowEnd: "23:59" },
        status: "running",
        total: 1,
        started_at: new Date().toISOString(),
        velip_mode: "single",
      })
      .select("id")
      .single();

    if (campErr || !campaign?.id) return json(500, { error: campErr?.message ?? "campaign_insert_failed" });

    const { data: target, error: tgtErr } = await admin
      .from("voice_campaign_targets")
      .insert({
        campaign_id: campaign.id,
        phone: dest,
        name: "Teste",
        status: "queued",
      })
      .select("id")
      .single();

    if (tgtErr || !target?.id) {
      await admin.from("voice_campaigns").delete().eq("id", campaign.id);
      return json(500, { error: tgtErr?.message ?? "target_insert_failed" });
    }

    const call = await playAudioFile({
      to: dest,
      audioId: aud.audio_id,
      ctid: toCtid(target.id),
      timeLimitSec: 40,
    });

    if (!call.ok) {
      await admin
        .from("voice_campaign_targets")
        .update({
          status: "failed",
          error: call.error ?? "velip_error",
          finished_at: new Date().toISOString(),
        })
        .eq("id", target.id);
      await admin
        .from("voice_campaigns")
        .update({ status: "finished", failed: 1, dialed: 1, finished_at: new Date().toISOString() })
        .eq("id", campaign.id);
      return json(502, { error: "velip_call_failed", detail: call.error, raw: call.raw });
    }

    await admin
      .from("voice_campaign_targets")
      .update({
        status: "dialing",
        velip_call_id: call.cd_id ?? null,
        dialed_at: new Date().toISOString(),
      })
      .eq("id", target.id);

    await admin.from("voice_call_logs").insert({
      campaign_id: campaign.id,
      target_id: target.id,
      consultant_id: consultantId,
      velip_call_id: call.cd_id ?? null,
      to_phone: dest,
      status: "dialing",
      raw: call.raw ?? {},
      velip_raw: call.raw ?? {},
    });

    await admin.from("voice_campaigns").update({ dialed: 1 }).eq("id", campaign.id);

    return json(200, { ok: true, campaign_id: campaign.id, target_id: target.id, velip_call_id: call.cd_id });
  }

  // ─── create_campaign ─────────────────────────────────────────────────────

  if (!body.audio_clip_id) return json(400, { error: "missing_audio_clip_id" });

  const aud = await ensureVelipAudioForClip(admin, body.audio_clip_id, consultantId);
  if ("error" in aud) return json(502, { error: aud.error });

  const targets: TargetIn[] = [];
  const seen = new Set<string>();

  const pushPhone = (raw: string, name?: string | null, customerId?: string | null) => {
    const dest = toVelipBRDest(raw);
    if (!dest || seen.has(dest)) return;
    seen.add(dest);
    targets.push({ phone: dest, name: name ?? null, customer_id: customerId ?? null });
  };

  if (Array.isArray(body.phones)) {
    for (const p of body.phones) {
      if (p?.phone) pushPhone(p.phone, p.name, p.customer_id);
    }
  }

  const step = (body.conversation_step ?? "").trim();
  const coldHours = body.cold_hours != null ? Number(body.cold_hours) : null;
  if (step || (coldHours != null && coldHours > 0)) {
    let q = admin
      .from("customers")
      .select(
        "id, name, phone_whatsapp, phone_landline, portal2_celular_alt, phone_contact_confirmed, conversation_step, last_bot_interaction_at, updated_at",
      )
      .eq("consultant_id", consultantId)
      .limit(Math.min(body.max_targets ?? MAX_TARGETS, MAX_TARGETS));

    if (step) q = q.eq("conversation_step", step);

    if (coldHours != null && coldHours > 0) {
      const cutoff = new Date(Date.now() - coldHours * 3600_000).toISOString();
      q = q.or(
        `last_bot_interaction_at.lt.${cutoff},and(last_bot_interaction_at.is.null,updated_at.lt.${cutoff})`,
      );
    }

    const { data: customers, error: cErr } = await q;
    if (cErr) return json(500, { error: cErr.message });

    for (const c of customers ?? []) {
      const row = c as Record<string, unknown>;
      const alt = String(row.portal2_celular_alt ?? "");
      const land = String(row.phone_landline ?? "");
      const wa = String(row.phone_whatsapp ?? "");
      const confirmed = row.phone_contact_confirmed === true;
      const phone =
        (alt && toVelipBRDest(alt)) ||
        (confirmed && land && toVelipBRDest(land)) ||
        toVelipBRDest(wa);
      if (phone) pushPhone(phone, (row.name as string) ?? null, row.id as string);
    }
  }

  if (targets.length === 0) return json(422, { error: "no_valid_targets" });
  if (targets.length > MAX_TARGETS) return json(400, { error: "too_many_targets", max: MAX_TARGETS });

  const scheduled = body.scheduled_at ?? null;
  const defaultConfig = {
    windowStart: "09:00",
    windowEnd: "18:00",
    weekdaysOnly: true,
    leaveVoicemail: false,
    conversation_step: step || null,
    cold_hours: coldHours,
    ...(body.config ?? {}),
  };

  const preferBatch = body.velip_mode === "batch" ||
    (body.velip_mode !== "single" && targets.length >= 30);
  const velipMode: "single" | "batch" = preferBatch ? "batch" : "single";

  const { data: campaign, error: campErr } = await admin
    .from("voice_campaigns")
    .insert({
      consultant_id: consultantId,
      name: body.campaign_name?.trim() || "Campanha de ligação",
      audio_clip_id: body.audio_clip_id,
      audio_url: aud.audio_url,
      config: defaultConfig,
      status: scheduled ? "scheduled" : "running",
      scheduled_at: scheduled,
      started_at: scheduled ? null : new Date().toISOString(),
      total: targets.length,
      velip_mode: velipMode,
    })
    .select("id")
    .single();

  if (campErr || !campaign?.id) return json(500, { error: campErr?.message ?? "campaign_insert_failed" });

  const rows = targets.map((t) => ({
    campaign_id: campaign.id,
    phone: t.phone,
    name: t.name ?? null,
    customer_id: t.customer_id ?? null,
    status: "queued",
  }));

  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error: tgtErr } = await admin
      .from("voice_campaign_targets")
      .insert(rows.slice(i, i + CHUNK));
    if (tgtErr) {
      await admin.from("voice_campaigns").delete().eq("id", campaign.id);
      return json(500, { error: tgtErr.message });
    }
  }

  // Modo batch: cria base + campanha na Velip agora
  if (velipMode === "batch" && !scheduled) {
    const { data: created } = await admin
      .from("voice_campaign_targets")
      .select("id, phone, name")
      .eq("campaign_id", campaign.id);

    const items = (created || []).map((t) => ({
      dest: t.phone,
      ctid: toCtid(t.id),
      name: t.name ?? undefined,
    }));

    const base = await createDestinationBase(items, `base_${campaign.id.slice(0, 8)}`);
    if (!base.ok || !base.base_id) {
      return json(502, {
        error: "velip_base_failed",
        detail: base.error,
        message: "Base de destinos rejeitada pela Velip. Alvos criados no banco — pode reprocessar em modo single.",
      });
    }
    const cp = await velipCreateCampaign({
      baseId: base.base_id,
      audioId: aud.audio_id,
      name: campaign.id.slice(0, 30),
      ctid: toCtid(campaign.id),
    });
    if (!cp.ok || !cp.cp_id) {
      return json(502, {
        error: "velip_campaign_failed",
        detail: cp.error,
        message: "Falha ao criar campanha Velip — targets ficam em queued para o cron.",
      });
    }
    await admin
      .from("voice_campaigns")
      .update({ velip_campaign_id: cp.cp_id })
      .eq("id", campaign.id);
  }

  return json(200, {
    ok: true,
    campaign_id: campaign.id,
    total: targets.length,
    status: scheduled ? "scheduled" : "running",
    velip_mode: velipMode,
  });
});
