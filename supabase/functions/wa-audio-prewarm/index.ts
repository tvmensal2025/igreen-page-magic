/**
 * wa-audio-prewarm
 * Pré-gera e salva áudios personalizados (Olá/Então + nome + corpo A2/A3)
 * para nomes comuns (100M+100F) + nomes já existentes na base do consultor.
 *
 * Na hora do WhatsApp: cache hit = instantâneo; só gera o que faltar.
 *
 * POST JSON:
 * {
 *   consultant_id: uuid,
 *   slots?: ["a2_audio_activate_name","a3_explain_with_buttons"],
 *   include_platform?: true,
 *   include_common?: true,
 *   names?: string[],
 *   limit?: number,   // default 20 (timeout edge)
 *   offset?: number,
 *   dry_run?: boolean
 * }
 *
 * Auth: JWT consultor ou service_role.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildCors } from "../_shared/cors.ts";
import { resolveCaller } from "../_shared/caller-auth.ts";
import {
  COMMON_FEMININE_FIRST_NAMES,
  COMMON_MASCULINE_FIRST_NAMES,
  NAME_PREWARM_STOPWORDS,
} from "../_shared/brazilian-common-names.ts";
import { resolvePersonalizedWaAudio, ensureNameOnlyIntroMp3 } from "../_shared/wa-audio-stitch.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const DEFAULT_SLOTS = ["a2_audio_activate_name", "a3_explain_with_buttons"] as const;

function buildNameList(withCommon: boolean, extras: string[]): string[] {
  const src = [
    ...(withCommon ? COMMON_MASCULINE_FIRST_NAMES : []),
    ...(withCommon ? COMMON_FEMININE_FIRST_NAMES : []),
    ...extras,
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of src) {
    const part = String(raw || "").trim().split(/\s+/)[0] || "";
    if (part.length < 2 || part.length > 20) continue;
    const key = part
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z]/g, "");
    if (!key || NAME_PREWARM_STOPWORDS.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(part.charAt(0).toUpperCase() + part.slice(1).toLowerCase());
  }
  return out;
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

  // Aceita JWT service_role (batch) além de x-service-secret / JWT de usuário.
  const authHeader = req.headers.get("Authorization") ?? "";
  const bearer = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";
  let isServiceJwt = false;
  if (bearer) {
    try {
      const payload = JSON.parse(atob(bearer.split(".")[1] || ""));
      isServiceJwt = payload?.role === "service_role";
    } catch { /* ignore */ }
  }
  let caller: Awaited<ReturnType<typeof resolveCaller>> | { mode: "service" };
  if (isServiceJwt || (bearer && bearer === SERVICE_ROLE)) {
    caller = { mode: "service" };
  } else {
    caller = await resolveCaller(req, admin);
  }
  if (caller instanceof Response) return caller;

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_json" });
  }

  let consultantId: string | null = null;
  if (caller.mode === "jwt") {
    consultantId = caller.consultantId;
  } else if (caller.mode === "service") {
    consultantId = String(body.consultant_id || "").trim() || null;
  }
  if (!consultantId) return json(400, { error: "consultant_id_required" });

  const includeCommon = body.include_common !== false;
  const dryRun = body.dry_run === true;
  /** name_only = só MP3 do nome (sem Olá) · full = stitch A2/A3 */
  const mode = String(body.mode || "name_only") === "full" ? "full" : "name_only";
  // name_only: por padrão SÓ nomes comuns BR (evita CRM estranho tipo Rosterlane).
  // full / stitch: mantém plataforma se não desligar.
  const includePlatform = mode === "name_only"
    ? body.include_platform === true
    : body.include_platform !== false;
  const limit = Math.max(1, Math.min(mode === "name_only" ? 40 : 30, Number(body.limit) || (mode === "name_only" ? 25 : 20)));
  const offset = Math.max(0, Number(body.offset) || 0);
  const slots = (Array.isArray(body.slots) && body.slots.length
    ? body.slots.map((s) => String(s))
    : mode === "name_only"
    ? ["intro:nome"]
    : [...DEFAULT_SLOTS]) as string[];
  const extraNames = Array.isArray(body.names)
    ? body.names.map((n) => String(n))
    : [];

  const platformNames: string[] = [];
  if (includePlatform) {
    const { data: rows } = await admin
      .from("customers")
      .select("name")
      .eq("consultant_id", consultantId)
      .not("name", "is", null)
      .limit(8000);
    for (const r of rows || []) {
      const n = String((r as { name?: string }).name || "").trim();
      if (n) platformNames.push(n);
    }
  }

  const nameList = buildNameList(includeCommon, [...platformNames, ...extraNames]);
  const slice = nameList.slice(offset, offset + limit);
  const total = nameList.length;
  const hasMore = offset + limit < total;

  if (dryRun) {
    return json(200, {
      ok: true,
      dry_run: true,
      mode,
      consultant_id: consultantId,
      total_names: total,
      offset,
      limit,
      has_more: hasMore,
      next_offset: hasMore ? offset + limit : null,
      slots,
      sample: slice.slice(0, 40),
      masculine_common: COMMON_MASCULINE_FIRST_NAMES.length,
      feminine_common: COMMON_FEMININE_FIRST_NAMES.length,
      platform_raw: platformNames.length,
    });
  }

  const results: Array<{
    name: string;
    slot: string;
    ok: boolean;
    cached?: boolean;
    error?: string;
    mode?: string;
  }> = [];

  for (const name of slice) {
    if (mode === "name_only") {
      try {
        const r = await ensureNameOnlyIntroMp3(admin, {
          consultantId,
          customerName: name,
        });
        results.push({
          name,
          slot: "intro:nome",
          ok: !!r.ok,
          cached: r.cached,
          error: r.error,
          mode: r.ok ? (r.cached ? "cache_hit" : "generated") : "failed",
        });
      } catch (e) {
        results.push({
          name,
          slot: "intro:nome",
          ok: false,
          error: (e as Error)?.message || "error",
          mode: "failed",
        });
      }
      await new Promise((r) => setTimeout(r, 200));
      continue;
    }

    for (const slot of slots) {
      try {
        const r = await resolvePersonalizedWaAudio(admin, {
          consultantId,
          slotKey: slot,
          customerName: name,
        });
        results.push({
          name,
          slot,
          ok: !!r.ok,
          cached: r.cached,
          error: r.error,
          mode: r.ok ? (r.cached ? "cache_hit" : "generated") : "failed",
        });
      } catch (e) {
        results.push({
          name,
          slot,
          ok: false,
          error: (e as Error)?.message || "error",
          mode: "failed",
        });
      }
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  return json(200, {
    ok: true,
    mode,
    consultant_id: consultantId,
    total_names: total,
    offset,
    limit,
    processed_names: slice.length,
    has_more: hasMore,
    next_offset: hasMore ? offset + limit : null,
    slots,
    generated: results.filter((r) => r.mode === "generated").length,
    cache_hits: results.filter((r) => r.mode === "cache_hit").length,
    failed: results.filter((r) => !r.ok).length,
    results,
  });
});
