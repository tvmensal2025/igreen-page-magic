// lead-research-sweep
// ───────────────────
// Enfileira varredura UF (cidade a cidade) → OSM telefones → captured_leads.
// O worker é lead-research-sweep-cron (pg_cron 1/min). NÃO dispara WhatsApp.
//
// actions:
//   start  { uf, category? }  → cria job + cidades de br_municipios
//   status { sweep_id? }      → progresso do job (ou o running do consultor)
//   cancel { sweep_id }       → pausa (pending ficam; cron para de pegar)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildCors } from "../_shared/cors.ts";
import { resolveCaller } from "../_shared/caller-auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface Body {
  action?: "start" | "status" | "cancel";
  uf?: string;
  category?: string;
  sweep_id?: string;
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

  const action = body.action ?? "status";

  // ── STATUS ──────────────────────────────────────────────────────────────
  if (action === "status") {
    let sweepId = (body.sweep_id || "").trim();
    if (!sweepId) {
      const { data: running } = await admin
        .from("lead_research_sweeps")
        .select("id")
        .eq("consultant_id", consultantId)
        .eq("status", "running")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      sweepId = running?.id || "";
    }
    if (!sweepId) return json(200, { ok: true, sweep: null });

    const { data: sw } = await admin
      .from("lead_research_sweeps")
      .select("*")
      .eq("id", sweepId)
      .eq("consultant_id", consultantId)
      .maybeSingle();
    if (!sw) return json(404, { error: "sweep_not_found" });

    const { data: recent } = await admin
      .from("lead_research_sweep_cities")
      .select("city, uf, status, found, ingested, deduped, error, processed_at")
      .eq("sweep_id", sweepId)
      .in("status", ["done", "empty", "error", "running"])
      .order("processed_at", { ascending: false, nullsFirst: false })
      .limit(30);

    const { count: pending } = await admin
      .from("lead_research_sweep_cities")
      .select("id", { count: "exact", head: true })
      .eq("sweep_id", sweepId)
      .eq("status", "pending");

    return json(200, {
      ok: true,
      sweep: sw,
      pending: pending ?? 0,
      recent: recent || [],
    });
  }

  // ── CANCEL ──────────────────────────────────────────────────────────────
  if (action === "cancel") {
    const sweepId = (body.sweep_id || "").trim();
    if (!sweepId) return json(400, { error: "sweep_id_required" });
    const { data: sw } = await admin
      .from("lead_research_sweeps")
      .select("id, status")
      .eq("id", sweepId)
      .eq("consultant_id", consultantId)
      .maybeSingle();
    if (!sw) return json(404, { error: "sweep_not_found" });
    if (sw.status === "done" || sw.status === "cancelled") {
      return json(200, { ok: true, sweep_id: sweepId, status: sw.status });
    }
    await admin
      .from("lead_research_sweeps")
      .update({ status: "paused", updated_at: new Date().toISOString() })
      .eq("id", sweepId);
    return json(200, { ok: true, sweep_id: sweepId, status: "paused" });
  }

  // ── START ───────────────────────────────────────────────────────────────
  if (action !== "start") return json(400, { error: "unknown_action" });

  const uf = (body.uf || "").trim().toUpperCase();
  if (uf.length !== 2) return json(400, { error: "uf_required" });
  const category = (body.category || "").trim().toLowerCase();

  // Reusa job running da mesma UF+categoria
  const { data: existing } = await admin
    .from("lead_research_sweeps")
    .select("*")
    .eq("consultant_id", consultantId)
    .eq("uf", uf)
    .eq("category", category)
    .eq("status", "running")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) {
    return json(200, {
      ok: true,
      reused: true,
      sweep_id: existing.id,
      total_cities: existing.total_cities,
      done_cities: existing.done_cities,
      status: existing.status,
    });
  }

  // Retoma paused da mesma UF
  const { data: paused } = await admin
    .from("lead_research_sweeps")
    .select("*")
    .eq("consultant_id", consultantId)
    .eq("uf", uf)
    .eq("category", category)
    .eq("status", "paused")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (paused) {
    await admin
      .from("lead_research_sweeps")
      .update({ status: "running", updated_at: new Date().toISOString() })
      .eq("id", paused.id);
    return json(200, {
      ok: true,
      resumed: true,
      sweep_id: paused.id,
      total_cities: paused.total_cities,
      done_cities: paused.done_cities,
      status: "running",
    });
  }

  const cities: { name: string; uf: string }[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("br_municipios")
      .select("name, uf")
      .eq("uf", uf)
      .order("name", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return json(500, { error: "municipios_query_failed", detail: error.message });
    const chunk = (data || []) as { name: string; uf: string }[];
    cities.push(...chunk);
    if (chunk.length < PAGE) break;
  }
  if (cities.length === 0) {
    return json(400, { error: "no_municipios", detail: `Nenhum município IBGE para ${uf}` });
  }

  const { data: sweep, error: swErr } = await admin
    .from("lead_research_sweeps")
    .insert({
      consultant_id: consultantId,
      uf,
      category,
      status: "running",
      total_cities: cities.length,
      done_cities: 0,
      found_phones: 0,
      ingested: 0,
      deduped: 0,
      errors: 0,
    })
    .select("*")
    .single();
  if (swErr || !sweep) {
    return json(500, { error: "sweep_create_failed", detail: swErr?.message });
  }

  // Insert cidades em lotes
  for (let i = 0; i < cities.length; i += 500) {
    const slice = cities.slice(i, i + 500).map((c) => ({
      sweep_id: sweep.id,
      city: c.name,
      uf: c.uf,
      status: "pending",
    }));
    const { error: cErr } = await admin.from("lead_research_sweep_cities").insert(slice);
    if (cErr) {
      await admin
        .from("lead_research_sweeps")
        .update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq("id", sweep.id);
      return json(500, { error: "cities_enqueue_failed", detail: cErr.message });
    }
  }

  return json(200, {
    ok: true,
    sweep_id: sweep.id,
    total_cities: cities.length,
    done_cities: 0,
    status: "running",
    uf,
    category,
  });
});
