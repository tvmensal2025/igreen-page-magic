// lead-research-sweep-cron
// ────────────────────────
// Processa a fila lead_research_sweep_cities: 1 cidade por tick.
// Busca TODOS os telefones públicos (OSM) + nome da empresa e grava em captured_leads.
// NÃO dispara WhatsApp. pg_cron / worker (verify_jwt=false).

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { ingestLead } from "../_shared/captation/lead-ingest.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const UA = "iGreen-LeadResearchSweep/1.0 (suporte@igreen.cloud)";
// Orçamento de wall-clock por invocação (edge ~150s). Deixa margem.
const TICK_BUDGET_MS = Math.max(30_000, Math.min(120_000, Number(Deno.env.get("SWEEP_TICK_BUDGET_MS") || "100000")));
const STUCK_MINUTES = Math.max(3, Number(Deno.env.get("SWEEP_STUCK_MINUTES") || "5"));
const MAX_CITIES_PER_INVOKE = Math.max(1, Math.min(40, Number(Deno.env.get("SWEEP_MAX_CITIES_PER_INVOKE") || "20")));
const SELF_CHAIN = (Deno.env.get("SWEEP_SELF_CHAIN") || "1") !== "0";

const OVERPASS_MIRRORS = [
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

const PHONE_KEYS = [
  "phone", "contact:phone", "contact:mobile", "mobile",
  "contact:whatsapp", "whatsapp", "contact:cellphone", "operator:phone",
] as const;

const CATEGORY_MAP: Record<string, string[]> = {
  restaurante: ['amenity"="restaurant', 'amenity"="fast_food'],
  bar: ['amenity"="bar', 'amenity"="pub'],
  cafe: ['amenity"="cafe'],
  padaria: ['shop"="bakery'],
  mercado: ['shop"="supermarket', 'shop"="convenience'],
  farmacia: ['amenity"="pharmacy'],
  academia: ['leisure"="fitness_centre', 'sport"="fitness'],
  salao: ['shop"="hairdresser', 'shop"="beauty'],
  oficina: ['shop"="car_repair'],
  loja: ['shop"="clothes', 'shop"="shoes', 'shop"="electronics'],
  hotel: ['tourism"="hotel', 'tourism"="motel'],
  escritorio: ['office'],
  posto: ['amenity"="fuel'],
};

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...cors, "Content-Type": "application/json" },
  });

interface BBox { south: number; west: number; north: number; east: number }
interface OsmElement {
  type: string; id: number;
  lat?: number; lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}
interface PhoneHit {
  name: string;
  phone: string;
  email: string | null;
  category: string | null;
  street: string | null;
  housenumber: string | null;
  neighbourhood: string | null;
  city: string | null;
  uf: string | null;
  postcode: string | null;
  website: string | null;
  opening_hours: string | null;
  full_address: string | null;
  lat: number | null;
  lon: number | null;
  osm_id: string;
}

function withPhoneKeys(baseSelector: string, areaExpr: string): string {
  return PHONE_KEYS
    .map((k) => `nwr["name"]${baseSelector}["${k}"](${areaExpr});`)
    .join("\n        ");
}

function buildFilterBlock(category: string, areaExpr: string): string {
  const filters = CATEGORY_MAP[category] ?? null;
  if (filters) {
    return filters.map((f) => withPhoneKeys(`["${f}"]`, areaExpr)).join("\n        ");
  }
  const bases = ['["shop"]', '["amenity"]', '["office"]', '["tourism"]', '["craft"]', '["leisure"]', '["healthcare"]'];
  return bases.map((b) => withPhoneKeys(b, areaExpr)).join("\n        ");
}

async function geocodeCity(city: string, uf: string): Promise<{ name: string; bbox: BBox } | null> {
  const url =
    `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1` +
    `&countrycodes=br&limit=5&q=${encodeURIComponent(`${city}, ${uf}, Brazil`)}`;
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!resp.ok) return null;
    const rows = await resp.json() as Array<{ name?: string; boundingbox?: string[] }>;
    if (!Array.isArray(rows) || !rows[0]?.boundingbox) return null;
    const bb = rows[0].boundingbox;
    const south = Number(bb[0]), north = Number(bb[1]), west = Number(bb[2]), east = Number(bb[3]);
    if (![south, north, west, east].every(Number.isFinite)) return null;
    return { name: rows[0].name || city, bbox: { south, west, north, east } };
  } catch {
    return null;
  }
}

async function queryOverpass(query: string): Promise<OsmElement[]> {
  const controllers = OVERPASS_MIRRORS.map(() => new AbortController());
  const timer = setTimeout(() => controllers.forEach((c) => c.abort()), 50_000);
  try {
    return await Promise.any(
      OVERPASS_MIRRORS.map(async (url, i) => {
        const resp = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": UA,
            Accept: "application/json",
          },
          body: `data=${encodeURIComponent(query)}`,
          signal: controllers[i].signal,
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json() as { elements?: OsmElement[] };
        if (!Array.isArray(data.elements)) throw new Error("sem elements");
        controllers.forEach((c, j) => { if (j !== i) c.abort(); });
        return data.elements;
      }),
    );
  } finally {
    clearTimeout(timer);
  }
}

function extractAllPhones(tags: Record<string, string>): string[] {
  const chunks: string[] = [];
  for (const k of PHONE_KEYS) {
    const raw = tags[k];
    if (!raw) continue;
    for (const part of String(raw).split(/[;|/,\n]+/)) {
      const p = part.trim();
      if (p) chunks.push(p);
    }
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of chunks) {
    const digits = p.replace(/\D/g, "");
    if (digits.length < 10) continue;
    const key = digits.slice(-11);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

function mapElements(els: OsmElement[], city: string, uf: string): PhoneHit[] {
  const items: PhoneHit[] = [];
  const seen = new Set<string>();
  for (const el of els) {
    const t = el.tags ?? {};
    const name = t.name || t.brand || t.operator;
    if (!name) continue;
    const phones = extractAllPhones(t);
    if (!phones.length) continue;
    const street = t["addr:street"] || null;
    const num = t["addr:housenumber"] || null;
    const bairro = t["addr:suburb"] || t["addr:neighbourhood"] || t["addr:district"] || null;
    const cidade = t["addr:city"] || t["addr:municipality"] || city;
    const cep = t["addr:postcode"] || null;
    const cat = t.shop || t.amenity || t.office || t.leisure || t.tourism || t.craft || t.healthcare || null;
    const full = [street ? `${street}${num ? `, ${num}` : ""}` : null, bairro, cidade, uf, cep].filter(Boolean).join(" · ");
    const lat = el.lat ?? el.center?.lat ?? null;
    const lon = el.lon ?? el.center?.lon ?? null;
    const baseOsm = `${el.type}/${el.id}`;
    phones.forEach((phone, idx) => {
      const digits = phone.replace(/\D/g, "").slice(-11);
      const key = `${name.toLowerCase()}|${digits}`;
      if (seen.has(key)) return;
      seen.add(key);
      items.push({
        name,
        phone,
        email: t.email || t["contact:email"] || null,
        category: cat,
        street,
        housenumber: num,
        neighbourhood: bairro,
        city: cidade,
        uf,
        postcode: cep,
        website: t.website || t["contact:website"] || null,
        opening_hours: t.opening_hours || null,
        full_address: full || null,
        lat,
        lon,
        osm_id: phones.length > 1 ? `${baseOsm}#${idx + 1}` : baseOsm,
      });
    });
  }
  return items;
}

async function harvestCity(
  admin: SupabaseClient,
  consultantId: string,
  city: string,
  uf: string,
  category: string,
): Promise<{ found: number; ingested: number; deduped: number; skipped: number }> {
  const geo = await geocodeCity(city, uf);
  let elements: OsmElement[] = [];
  if (geo) {
    const areaExpr = `${geo.bbox.south},${geo.bbox.west},${geo.bbox.north},${geo.bbox.east}`;
    const q = `[out:json][timeout:50];(${buildFilterBlock(category, areaExpr)});out center;`;
    try { elements = await queryOverpass(q); } catch { elements = []; }
  }
  if (elements.length === 0) {
    const safeCity = city.replace(/["\\]/g, "");
    const q = `[out:json][timeout:50];area["name"="${safeCity}"]["admin_level"="8"]->.b;(${buildFilterBlock(category, "area.b")});out center;`;
    try { elements = await queryOverpass(q); } catch { elements = []; }
  }

  const hits = mapElements(elements, city, uf);
  let ingested = 0, deduped = 0, skipped = 0;
  for (let i = 0; i < hits.length; i += 25) {
    const slice = hits.slice(i, i + 25);
    const outcomes = await Promise.all(slice.map(async (it) => {
      const r = await ingestLead(admin, {
        consultantId,
        channel: "research",
        personType: "pj",
        companyName: it.name,
        phone: it.phone,
        email: it.email,
        city: it.city,
        uf: it.uf,
        productInterest: it.category,
        pjData: {
          ramo: it.category,
          source: "openstreetmap",
          osm_id: it.osm_id,
          street: it.street,
          housenumber: it.housenumber,
          neighbourhood: it.neighbourhood,
          postcode: it.postcode,
          full_address: it.full_address,
          website: it.website,
          opening_hours: it.opening_hours,
          lat: it.lat,
          lon: it.lon,
          sweep: true,
        },
        rawPayload: { research_item: it, sweep: true },
      });
      if (r.ok && r.deduped) return "deduped" as const;
      if (r.ok) return "ingested" as const;
      return "skipped" as const;
    }));
    for (const o of outcomes) {
      if (o === "ingested") ingested++;
      else if (o === "deduped") deduped++;
      else skipped++;
    }
  }
  return { found: hits.length, ingested, deduped, skipped };
}

async function bumpSweep(
  admin: SupabaseClient,
  sweepId: string,
  delta: { found: number; ingested: number; deduped: number; errors: number; incDone?: boolean },
) {
  const incDone = delta.incDone !== false;
  // Incremento atômico — evita corrida se houver self-chain paralelo.
  const { data: sw, error: rpcErr } = await admin.rpc("lead_research_sweep_bump", {
    p_sweep_id: sweepId,
    p_found: delta.found,
    p_ingested: delta.ingested,
    p_deduped: delta.deduped,
    p_errors: delta.errors,
    p_inc_done: incDone,
  }).maybeSingle();

  if (rpcErr || !sw) {
    // Fallback se a RPC ainda não existir no ambiente.
    const { data: cur } = await admin.from("lead_research_sweeps").select("*").eq("id", sweepId).maybeSingle();
    if (!cur) return;
    const done = Number(cur.done_cities || 0) + (incDone ? 1 : 0);
    const patch: Record<string, unknown> = {
      done_cities: done,
      found_phones: Number(cur.found_phones || 0) + delta.found,
      ingested: Number(cur.ingested || 0) + delta.ingested,
      deduped: Number(cur.deduped || 0) + delta.deduped,
      errors: Number(cur.errors || 0) + delta.errors,
      updated_at: new Date().toISOString(),
    };
    if (done >= Number(cur.total_cities || 0)) patch.status = "done";
    await admin.from("lead_research_sweeps").update(patch).eq("id", sweepId);
  }
}

async function claimNextCity(admin: SupabaseClient): Promise<{
  id: string; city: string; uf: string; sweep_id: string; consultant_id: string; category: string;
} | null> {
  const { data: pending } = await admin
    .from("lead_research_sweep_cities")
    .select("id, city, uf, sweep_id")
    .eq("status", "pending")
    .order("city", { ascending: true })
    .limit(30);

  const candidates = (pending || []) as Array<{ id: string; city: string; uf: string; sweep_id: string }>;
  for (const c of candidates) {
    const { data: sw } = await admin
      .from("lead_research_sweeps")
      .select("consultant_id, category, status")
      .eq("id", c.sweep_id)
      .maybeSingle();
    if (!sw || sw.status !== "running") continue;
    const { data: locked } = await admin
      .from("lead_research_sweep_cities")
      .update({
        status: "running",
        processed_at: new Date().toISOString(),
        error: null,
      })
      .eq("id", c.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (!locked) continue;
    return {
      id: c.id,
      city: c.city,
      uf: c.uf,
      sweep_id: c.sweep_id,
      consultant_id: sw.consultant_id as string,
      category: String(sw.category || ""),
    };
  }
  return null;
}

async function countPending(admin: SupabaseClient): Promise<number> {
  const { count } = await admin
    .from("lead_research_sweep_cities")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  return count ?? 0;
}

async function selfChainIfNeeded(pendingLeft: number, processed: number): Promise<void> {
  if (!SELF_CHAIN || pendingLeft <= 0 || processed <= 0) return;
  const url = `${SUPABASE_URL}/functions/v1/lead-research-sweep-cron`;
  // Fire-and-forget: continua a fila sem esperar o próximo minuto do pg_cron.
  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_ROLE}`,
        apikey: SERVICE_ROLE,
      },
      body: JSON.stringify({ source: "self_chain", at: new Date().toISOString() }),
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    /* próximo pg_cron (1min) retoma */
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const results: unknown[] = [];
  const started = Date.now();

  // Recovery: cidade travada em "running" volta pra pending.
  const stuckBefore = new Date(Date.now() - STUCK_MINUTES * 60_000).toISOString();
  await admin
    .from("lead_research_sweep_cities")
    .update({ status: "pending", error: "requeued_stuck_running", processed_at: null })
    .eq("status", "running")
    .lt("processed_at", stuckBefore);

  // Erros transitórios: refila para tentar de novo (não abandona cidade).
  await admin
    .from("lead_research_sweep_cities")
    .update({ status: "pending", error: null, processed_at: null })
    .eq("status", "error");

  // Reativa paused incompletos — não para no meio das 853.
  const { data: paused } = await admin
    .from("lead_research_sweeps")
    .select("id, total_cities, done_cities")
    .eq("status", "paused");
  for (const p of paused || []) {
    if (Number(p.done_cities) < Number(p.total_cities)) {
      await admin.from("lead_research_sweeps")
        .update({ status: "running", updated_at: new Date().toISOString() })
        .eq("id", p.id);
    }
  }

  while (results.length < MAX_CITIES_PER_INVOKE && (Date.now() - started) < TICK_BUDGET_MS) {
    const row = await claimNextCity(admin);
    if (!row) break;

    try {
      const r = await harvestCity(admin, row.consultant_id, row.city, row.uf, row.category);
      const status = r.found === 0 ? "empty" : "done";
      await admin.from("lead_research_sweep_cities").update({
        status,
        found: r.found,
        ingested: r.ingested,
        deduped: r.deduped,
        skipped: r.skipped,
        processed_at: new Date().toISOString(),
        error: null,
      }).eq("id", row.id);
      await bumpSweep(admin, row.sweep_id, {
        found: r.found, ingested: r.ingested, deduped: r.deduped, errors: 0, incDone: true,
      });
      results.push({ city: row.city, uf: row.uf, ...r, status });
    } catch (e) {
      // Não conta como done — volta pra pending e tenta de novo depois.
      await admin.from("lead_research_sweep_cities").update({
        status: "pending",
        error: (e as Error)?.message || "error",
        processed_at: null,
      }).eq("id", row.id);
      await bumpSweep(admin, row.sweep_id, {
        found: 0, ingested: 0, deduped: 0, errors: 1, incDone: false,
      });
      results.push({ city: row.city, error: (e as Error)?.message, requeued: true });
    }
  }

  const pendingLeft = await countPending(admin);
  // Encadeia outra invocação se ainda houver fila (não para até zerar as 853).
  const chain = selfChainIfNeeded(pendingLeft, results.length);
  const ER = (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (ER?.waitUntil) ER.waitUntil(chain);
  else await chain;

  return json({
    ok: true,
    processed: results.length,
    pending_left: pendingLeft,
    elapsed_ms: Date.now() - started,
    results,
    ts: new Date().toISOString(),
  });
});
