// voice-dialer-enqueue (Velip)
// Cria campanha PSTN + targets, ou dispara teste de 1 número.
// Autenticado por JWT do consultor. Isolado do WhatsApp/bot.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildCors } from "../_shared/cors.ts";
import { resolveCaller } from "../_shared/caller-auth.ts";
import {
  createDestinationBase,
  createCampaign as velipCreateCampaign,
  playAudioFile,
  toCtid,
  toVelipBRDest,
  uploadAudioFile,
  velipConfigured,
  velipWebhookAuthConfigured,
} from "../_shared/voice-dialer/velip.ts";
import { assertCanContact } from "../_shared/contact-suppression.ts";

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
  /** Velip content id já costurado (teste Sofia personalizado). */
  velip_audio_id?: string | null;
  scheduled_at?: string | null;
  config?: Record<string, unknown>;
  phones?: TargetIn[];
  conversation_step?: string | null;
  cold_hours?: number | null;
  max_targets?: number;
  max_attempts?: number;
  test_phone?: string | null;
  /** Nome do lead no teste (aparece no target / logs). */
  test_name?: string | null;
  velip_mode?: "single" | "batch";
  /** 'audio' (default) ou 'tts' */
  dispatch_kind?: "audio" | "tts";
  tts_text?: string;
  tts_voice?: string;
  caller_id?: string;
  dtmf_questions?: unknown[];
  /** Se informado, usa itens já persistidos de uma base */
  base_id?: string;
  /** Filtros extras aplicados ao seletor "meus clientes" */
  customer_filter?: {
    uf?: string;
    city?: string;
    status?: string;
    min_bill?: number;
  };
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
  // Regra iGreen: ligação = áudio Sofia (ElevenLabs). TTS Velip (robótico) bloqueado.
  if (body.dispatch_kind === "tts") {
    return json(422, {
      error: "sofia_required",
      message:
        "Ligações usam só a voz Sofia (áudio do Estúdio / teste Sofia). TTS Velip foi desativado.",
    });
  }

  // ─── Teste: 1 ligação imediata ───────────────────────────────────────────
  if (action === "test_call") {
    const dest = toVelipBRDest(body.test_phone);
    if (!dest) return json(400, { error: "invalid_test_phone" });

    let audioId: string | undefined;
    let audioUrl: string | null = null;
    const directVelipId = typeof body.velip_audio_id === "string" ? body.velip_audio_id.trim() : "";
    if (directVelipId) {
      audioId = directVelipId;
      audioUrl = typeof body.audio_url === "string" ? body.audio_url : null;
    } else {
      if (!body.audio_clip_id) {
        return json(422, {
          error: "sofia_required",
          message: "Informe um áudio Sofia (clip). TTS Velip não é permitido.",
        });
      }
      const aud = await ensureVelipAudioForClip(admin, body.audio_clip_id, consultantId);
      if ("error" in aud) return json(502, { error: aud.error });
      audioId = aud.audio_id;
      audioUrl = aud.audio_url;
    }

    const { data: campaign, error: campErr } = await admin
      .from("voice_campaigns")
      .insert({
        consultant_id: consultantId,
        name: body.campaign_name?.trim() || "Teste de ligação",
        audio_clip_id: body.audio_clip_id ?? null,
        audio_url: audioUrl,
        dispatch_kind: "audio",
        tts_text: null,
        tts_voice: null,
        caller_id: body.caller_id ?? null,
        dtmf_questions: Array.isArray(body.dtmf_questions) ? body.dtmf_questions : [],
        config: { ...(body.config ?? {}), test: true, weekdaysOnly: false, windowStart: "00:00", windowEnd: "23:59", sofia_only: true },
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
        name: body.test_name?.trim() || "Teste",
        status: "queued",
      })
      .select("id")
      .single();

    if (tgtErr || !target?.id) {
      await admin.from("voice_campaigns").delete().eq("id", campaign.id);
      return json(500, { error: tgtErr?.message ?? "target_insert_failed" });
    }

    if (!audioId) {
      await admin
        .from("voice_campaign_targets")
        .update({ status: "failed", error: "sofia_required", finished_at: new Date().toISOString() })
        .eq("id", target.id);
      await admin
        .from("voice_campaigns")
        .update({ status: "finished", failed: 1, dialed: 1, finished_at: new Date().toISOString() })
        .eq("id", campaign.id);
      return json(422, {
        error: "sofia_required",
        message: "Áudio Sofia obrigatório para discar.",
      });
    }

    const callOpts = {
      to: dest,
      ctid: toCtid(target.id),
      timeLimitSec: 60,
      callerId: body.caller_id,
      // Teste manual: libera Procon (BK_PROCON#250). Campanhas em massa NÃO usam free.
      free: true,
    };
    const call = await playAudioFile({ ...callOpts, audioId });

    if (!call.ok) {
      const detail = call.error ?? "velip_error";
      const friendly =
        /BK_PROCON/i.test(detail)
          ? "Número bloqueado no Procon (lista não-perturbe). No teste já enviamos free=1 — se persistir, confira o número na Velip."
          : /#250\b/.test(detail)
            ? "Velip recusou a ligação (código 250). Pode ser saldo, Procon ou falha do provedor."
            : detail;
      await admin
        .from("voice_campaign_targets")
        .update({ status: "failed", error: detail, finished_at: new Date().toISOString() })
        .eq("id", target.id);
      await admin
        .from("voice_campaigns")
        .update({ status: "finished", failed: 1, dialed: 1, finished_at: new Date().toISOString() })
        .eq("id", campaign.id);
      return json(502, {
        error: "velip_call_failed",
        detail,
        message: friendly,
        raw: call.raw,
      });
    }

    await admin
      .from("voice_campaign_targets")
      .update({ status: "dialing", velip_call_id: call.cd_id ?? null, dialed_at: new Date().toISOString() })
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

  if (!body.audio_clip_id) {
    return json(422, {
      error: "sofia_required",
      message: "Campanha de ligação exige áudio Sofia (clip do Estúdio).",
    });
  }
  const aud = await ensureVelipAudioForClip(admin, body.audio_clip_id, consultantId);
  if ("error" in aud) return json(502, { error: aud.error });
  const campaignAudio = aud;

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

  // Puxa alvos de uma base salva
  if (body.base_id) {
    const { data: base } = await admin
      .from("voice_contact_bases").select("consultant_id, phones").eq("id", body.base_id).maybeSingle();
    if (!base || (base as { consultant_id: string }).consultant_id !== consultantId) {
      return json(404, { error: "base_not_found" });
    }
    const items = Array.isArray((base as { phones?: unknown[] }).phones) ? (base as { phones: unknown[] }).phones : [];
    for (const it of items) {
      if (typeof it === "string") pushPhone(it);
      else if (it && typeof it === "object") {
        const row = it as { phone?: string; name?: string | null };
        if (row.phone) pushPhone(row.phone, row.name ?? null);
      }
    }
  }




  const step = (body.conversation_step ?? "").trim();
  const coldHours = body.cold_hours != null ? Number(body.cold_hours) : null;
  const cf = body.customer_filter ?? {};
  const hasCustomerFilter = !!(cf.uf || cf.city || cf.status || (cf.min_bill && cf.min_bill > 0));
  if (step || (coldHours != null && coldHours > 0) || hasCustomerFilter) {
    let q = admin
      .from("customers")
      .select(
        "id, name, phone_whatsapp, phone_landline, portal2_celular_alt, phone_contact_confirmed, conversation_step, last_bot_interaction_at, updated_at",
      )
      .eq("consultant_id", consultantId)
      .eq("do_not_contact", false)
      .limit(Math.min(body.max_targets ?? MAX_TARGETS, MAX_TARGETS));

    if (step) q = q.eq("conversation_step", step);
    if (cf.uf) q = q.eq("state", cf.uf.toUpperCase());
    if (cf.city) q = q.ilike("city", `%${cf.city}%`);
    if (cf.status) q = q.eq("status", cf.status);
    if (cf.min_bill && cf.min_bill > 0) q = q.gte("electricity_bill_value", cf.min_bill);

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

  // DNC (Não Perturbe) — remove alvos bloqueados pelo consultor
  if (targets.length) {
    const { data: dnc } = await admin
      .from("voice_dnc_list")
      .select("phone")
      .eq("consultant_id", consultantId);
    const blocked = new Set((dnc ?? []).map((r: { phone: string }) => r.phone.replace(/\D/g, "")));

    // Também bloqueia customers.do_not_contact (mesmo phone)
    const { data: dncCust } = await admin
      .from("customers")
      .select("phone_whatsapp, phone_landline, portal2_celular_alt")
      .eq("consultant_id", consultantId)
      .eq("do_not_contact", true)
      .limit(5000);
    for (const row of dncCust || []) {
      for (const field of ["phone_whatsapp", "phone_landline", "portal2_celular_alt"] as const) {
        const d = String((row as Record<string, unknown>)[field] || "").replace(/\D/g, "");
        if (d) blocked.add(d);
      }
    }

    if (blocked.size) {
      const before = targets.length;
      // remove destino se qualquer sufixo bater
      for (let i = targets.length - 1; i >= 0; i--) {
        const digits = String(targets[i].phone).replace(/\D/g, "");
        if (blocked.has(digits) || [...blocked].some((b) => digits.endsWith(b) || b.endsWith(digits))) {
          targets.splice(i, 1);
        }
      }
      if (before !== targets.length) {
        console.log(`[dnc] removidos ${before - targets.length} alvo(s) por Não Perturbe / do_not_contact`);
      }
    }

    // Gate único (fail-closed) — reforça voice_dnc + do_not_contact por telefone/customer.
    for (let i = targets.length - 1; i >= 0; i--) {
      const t = targets[i];
      const gate = await assertCanContact(admin, {
        customerId: (t as { customer_id?: string | null }).customer_id,
        phone: t.phone,
        consultantId,
        channel: "voice",
      });
      if (!gate.allowed) targets.splice(i, 1);
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
    // Agendamento único deve respeitar a data/hora escolhida, inclusive fora
    // da janela padrão. O cron só promove a campanha após scheduled_at.
    ...(scheduled
      ? { scheduledExact: true, windowStart: "00:00", windowEnd: "23:59", weekdaysOnly: false }
      : {}),
  };

  // A API de lote da Velip só é criada no envio imediato. Agendamentos são
  // sempre single para que o cron faça a discagem no horário programado.
  // Personalização por nome também força single (1 áudio costurado por alvo).
  const personalizeName = Boolean(defaultConfig.personalize_name);
  const preferBatch = !scheduled && !personalizeName && (
    body.velip_mode === "batch" ||
    (body.velip_mode !== "single" && targets.length >= 30)
  );
  const velipMode: "single" | "batch" = preferBatch ? "batch" : "single";

  const { data: campaign, error: campErr } = await admin
    .from("voice_campaigns")
    .insert({
      consultant_id: consultantId,
      name: body.campaign_name?.trim() || "Campanha de ligação",
      audio_clip_id: body.audio_clip_id,
      audio_url: campaignAudio.audio_url,
      dispatch_kind: "audio",
      tts_text: null,
      tts_voice: null,
      caller_id: body.caller_id ?? null,
      dtmf_questions: Array.isArray(body.dtmf_questions) ? body.dtmf_questions : [],
      config: { ...defaultConfig, sofia_only: true },
      status: scheduled ? "scheduled" : "running",
      scheduled_at: scheduled,
      started_at: scheduled ? null : new Date().toISOString(),
      total: targets.length,
      velip_mode: velipMode,
      sms_on_no_answer_text: typeof (body as { sms_on_no_answer_text?: unknown }).sms_on_no_answer_text === "string"
        ? String((body as { sms_on_no_answer_text?: string }).sms_on_no_answer_text).trim() || null
        : null,
    })
    .select("id")
    .single();

  if (campErr || !campaign?.id) return json(500, { error: campErr?.message ?? "campaign_insert_failed" });

  const maxAttempts = Math.max(1, Math.min(body.max_attempts ?? 2, 5));
  const rows = targets.map((t) => ({
    campaign_id: campaign.id,
    phone: t.phone,
    name: t.name ?? null,
    customer_id: t.customer_id ?? null,
    status: "queued",
    max_attempts: maxAttempts,
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

  // Modo batch (envio agora; agendamento segue 'single')
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

    // Se a Velip rejeitar a base/campanha (ex.: erro 230 do serviço de listas),
    // degrada para modo `single`: o cron disca alvo a alvo via áudio Sofia.
    const fallbackToSingle = async (why: string | undefined) => {
      await admin
        .from("voice_campaigns")
        .update({ velip_mode: "single" })
        .eq("id", campaign.id);
      console.warn(`[enqueue] batch→single (campanha ${campaign.id}): ${why ?? "?"}`);
      return json(200, {
        ok: true,
        campaign_id: campaign.id,
        total: targets.length,
        status: scheduled ? "scheduled" : "running",
        velip_mode: "single",
        batch_fallback: why ?? "velip_batch_failed",
      });
    };

    const base = await createDestinationBase(items, `base_${campaign.id.slice(0, 8)}`);
    if (!base.ok || !base.base_id) return await fallbackToSingle(base.error);

    const cp = await velipCreateCampaign({
      baseId: base.base_id,
      audioId: campaignAudio.audio_id,
      name: campaign.id.slice(0, 30),
      ctid: toCtid(campaign.id),
    });
    if (!cp.ok || !cp.cp_id) return await fallbackToSingle(cp.error);

    await admin
      .from("voice_campaigns")
      .update({ velip_campaign_id: cp.cp_id, velip_base_id: base.base_id })
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
