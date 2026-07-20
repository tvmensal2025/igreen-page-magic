/**
 * Gera áudios Sofia (ElevenLabs) para:
 *   - corpos FAQ (1 por intent — fecha a dúvida, sem pedir foto)
 *   - closers fixos por passo (1 cada — casam com qa-step-close)
 *
 * POST body:
 *   { mode: "bodies"|"closes"|"all", limit?: number, offset?: number, dry_run?: bool }
 *
 * Auth: service role ou JWT admin.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  PRIORITY_FAQ_INTENTS,
  QA_STEP_CLOSERS,
  SOFIA_CONSULTANT_ID,
  SOFIA_FLOW_ID,
  SOFIA_MODEL,
  SOFIA_VOICE_ID,
  VOICE_SETTINGS_BODY,
  cleanFaqBodyForTts,
  intentToBodySlot,
  intentsSharingPadrao,
} from "../_shared/qa-faq-tts-catalog.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function synthesize(text: string): Promise<Uint8Array> {
  const key = (Deno.env.get("ELEVENLABS_API_KEY") || "").trim();
  if (!key) throw new Error("ELEVENLABS_API_KEY_missing");
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length < 8) throw new Error("tts_text_too_short");
  if (clean.length > 2200) throw new Error("tts_text_too_long");

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${SOFIA_VOICE_ID}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "xi-api-key": key,
    },
    body: JSON.stringify({
      text: clean,
      model_id: SOFIA_MODEL,
      voice_settings: { ...VOICE_SETTINGS_BODY },
      language_code: "pt",
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.detail?.message || err?.message || `elevenlabs_${res.status}`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength < 256) throw new Error("elevenlabs_empty_audio");
  return bytes;
}

async function upsertLibrary(
  // deno-lint-ignore no-explicit-any
  sb: any,
  opts: {
    slotKey: string;
    label: string;
    bytes: Uint8Array;
    textContent: string;
    intentTag?: string;
  },
): Promise<string> {
  const path = `${SOFIA_CONSULTANT_ID}/qa-faq/${opts.slotKey.replace(/[^a-z0-9:_-]/gi, "_")}-${Date.now()}.mp3`;
  const { error: upErr } = await sb.storage.from("ai-agent-media").upload(path, opts.bytes, {
    contentType: "audio/mpeg",
    upsert: false,
  });
  if (upErr) throw upErr;
  const { data: pub } = sb.storage.from("ai-agent-media").getPublicUrl(path);
  const url = pub?.publicUrl;
  if (!url) throw new Error("public_url_missing");

  await sb
    .from("ai_media_library")
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq("consultant_id", SOFIA_CONSULTANT_ID)
    .eq("slot_key", opts.slotKey)
    .eq("active", true);

  const { data: row, error } = await sb
    .from("ai_media_library")
    .insert({
      consultant_id: SOFIA_CONSULTANT_ID,
      slot_key: opts.slotKey,
      kind: "audio",
      label: opts.label.slice(0, 120),
      url,
      storage_path: path,
      text_content: opts.textContent.slice(0, 8000),
      transcript: opts.textContent.slice(0, 4000),
      active: true,
      is_public: true,
      // Corpos FAQ ficam draft até aprovação na UI; closers já saem prontos
      is_draft: opts.slotKey.startsWith("qa_body:"),
      send_order: 0,
      delay_before_ms: 0,
      priority: 20,
      intent_tags: opts.intentTag ? [opts.intentTag] : ["qa_close"],
      step_tags: opts.slotKey.startsWith("qa_close:")
        ? [opts.slotKey.replace("qa_close:", "")]
        : [],
    })
    .select("id")
    .single();
  if (error) throw error;
  return String(row.id);
}

async function linkBodyToAllQa(
  // deno-lint-ignore no-explicit-any
  sb: any,
  intentName: string,
  mediaId: string,
): Promise<number> {
  const { data: qas } = await sb
    .from("bot_flow_qa")
    .select("id")
    .eq("intent_name", intentName)
    .eq("is_opening", false)
    .eq("is_closing", false);
  let n = 0;
  for (const q of qas || []) {
    const { data: slots } = await sb
      .from("bot_flow_qa_media")
      .select("id, media_id")
      .eq("qa_id", q.id)
      .eq("media_kind", "audio")
      .order("position")
      .limit(1);
    if (slots?.[0]?.id) {
      await sb.from("bot_flow_qa_media").update({ media_id: mediaId }).eq("id", slots[0].id);
      n++;
    } else {
      await sb.from("bot_flow_qa_media").insert({
        qa_id: q.id,
        position: 0,
        media_kind: "audio",
        media_id: mediaId,
        slot_key: null,
      });
      n++;
    }
  }
  return n;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), {
      status: 405,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const body = await req.json().catch(() => ({}));
  const mode = String(body.mode || "all") as "bodies" | "closes" | "all";
  const limit = Math.min(Math.max(Number(body.limit) || 5, 1), 15);
  const offset = Math.max(Number(body.offset) || 0, 0);
  const dryRun = body.dry_run === true;

  const sb = createClient(
    Deno.env.get("SUPABASE_URL") || "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
  );

  const results: Array<Record<string, unknown>> = [];
  let generated = 0;
  let skipped = 0;
  let failed = 0;
  let linked = 0;

  try {
    if (mode === "closes" || mode === "all") {
      const slice = QA_STEP_CLOSERS.slice(offset, mode === "closes" ? offset + limit : undefined);
      // Se mode=all, closers só no offset 0 (uma vez)
      const closers = mode === "all" ? (offset === 0 ? QA_STEP_CLOSERS : []) : slice;

      for (const c of closers) {
        try {
          if (dryRun) {
            results.push({ kind: "close", slot: c.slotKey, spoken: c.spoken, dry_run: true });
            skipped++;
            continue;
          }
          const { data: existing } = await sb
            .from("ai_media_library")
            .select("id, url")
            .eq("consultant_id", SOFIA_CONSULTANT_ID)
            .eq("slot_key", c.slotKey)
            .eq("active", true)
            .maybeSingle();
          if (existing?.url && body.force !== true) {
            results.push({ kind: "close", slot: c.slotKey, cache: true, id: existing.id });
            skipped++;
            continue;
          }
          const bytes = await synthesize(c.spoken);
          const id = await upsertLibrary(sb, {
            slotKey: c.slotKey,
            label: `Sofia closer · ${c.stepKey}`,
            bytes,
            textContent: c.spoken,
          });
          results.push({ kind: "close", slot: c.slotKey, id, bytes: bytes.byteLength });
          generated++;
          await new Promise((r) => setTimeout(r, 400));
        } catch (e) {
          failed++;
          results.push({ kind: "close", slot: c.slotKey, error: String((e as Error).message || e) });
        }
      }
    }

    if (mode === "bodies" || mode === "all") {
      const intentFilter: string[] = Array.isArray(body.intents)
        ? body.intents.map((x: unknown) => String(x)).filter(Boolean)
        : body.priority_only === true
        ? [...PRIORITY_FAQ_INTENTS]
        : [];

      let qas: Array<{ id: string; intent_name: string; text_response: string }> = [];
      if (intentFilter.length > 0) {
        const { data, error } = await sb
          .from("bot_flow_qa")
          .select("id, intent_name, text_response")
          .eq("flow_id", SOFIA_FLOW_ID)
          .eq("is_opening", false)
          .eq("is_closing", false)
          .in("intent_name", intentFilter);
        if (error) throw error;
        // Ordem do filtro (não a do banco)
        const byIntent = new Map((data || []).map((q) => [String(q.intent_name), q]));
        qas = intentFilter
          .map((name) => byIntent.get(name))
          .filter(Boolean) as typeof qas;
      } else {
        const { data, error } = await sb
          .from("bot_flow_qa")
          .select("id, intent_name, text_response")
          .eq("flow_id", SOFIA_FLOW_ID)
          .eq("is_opening", false)
          .eq("is_closing", false)
          .order("position")
          .range(offset, offset + limit - 1);
        if (error) throw error;
        qas = data || [];
      }

      for (const q of qas || []) {
        const intent = String(q.intent_name || "");
        const slot = intentToBodySlot(intent);
        const spoken = cleanFaqBodyForTts(String(q.text_response || ""));
        try {
          if (spoken.length < 20) throw new Error("body_too_short_after_clean");
          if (dryRun) {
            results.push({
              kind: "body",
              intent,
              slot,
              spoken_preview: spoken.slice(0, 120),
              spoken_len: spoken.length,
              dry_run: true,
            });
            skipped++;
            continue;
          }
          const { data: existing } = await sb
            .from("ai_media_library")
            .select("id, url")
            .eq("consultant_id", SOFIA_CONSULTANT_ID)
            .eq("slot_key", slot)
            .eq("active", true)
            .maybeSingle();
          let mediaId = existing?.id as string | undefined;
          const cluster = intentsSharingPadrao(intent);
          if (mediaId && body.force !== true) {
            let n = 0;
            for (const name of cluster) n += await linkBodyToAllQa(sb, name, mediaId);
            linked += n;
            results.push({ kind: "body", intent, slot, cache: true, id: mediaId, linked: n, cluster: cluster.length });
            skipped++;
            continue;
          }
          const bytes = await synthesize(spoken);
          mediaId = await upsertLibrary(sb, {
            slotKey: slot,
            label: `Sofia FAQ · ${slot.replace("qa_body:", "")}`,
            bytes,
            textContent: spoken,
            intentTag: intent,
          });
          let n = 0;
          for (const name of cluster) n += await linkBodyToAllQa(sb, name, mediaId);
          linked += n;
          results.push({
            kind: "body",
            intent,
            slot,
            id: mediaId,
            bytes: bytes.byteLength,
            linked: n,
            cluster: cluster.length,
          });
          generated++;
          await new Promise((r) => setTimeout(r, 500));
        } catch (e) {
          failed++;
          results.push({
            kind: "body",
            intent,
            slot,
            error: String((e as Error).message || e),
            spoken_preview: spoken.slice(0, 80),
          });
        }
      }

      const filtered = intentFilter.length > 0;
      const hasMore = filtered ? false : (qas || []).length >= limit;
      return new Response(
        JSON.stringify({
          ok: failed === 0,
          mode,
          offset,
          limit,
          generated,
          skipped,
          failed,
          linked,
          filtered_intents: filtered ? intentFilter.length : 0,
          has_more: mode === "bodies" || mode === "all" ? hasMore : false,
          next_offset: offset + limit,
          sofia_flow: SOFIA_FLOW_ID,
          results,
        }),
        { headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        ok: failed === 0,
        mode,
        offset,
        limit,
        generated,
        skipped,
        failed,
        linked,
        has_more: mode === "closes" ? offset + limit < QA_STEP_CLOSERS.length : false,
        next_offset: offset + limit,
        results,
      }),
      { headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String((e as Error).message || e) }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
