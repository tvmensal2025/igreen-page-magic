// lead-research
// ─────────────
// Pesquisa B2B de EMPRESAS por cidade + ramo, rodada pelo próprio consultor.
// Os resultados viram leads PJ dele (captured_leads, channel='research').
//
// Fonte padrão: OpenStreetMap / Overpass API — gratuita, sem chave, dado
// público de estabelecimentos comerciais (nome, telefone, endereço). É legal
// porque é dado público de pessoa jurídica/estabelecimento.
//
// Upgrade opcional: se GOOGLE_PLACES_API_KEY estiver configurada, dá pra
// trocar a fonte por Google Places (mais completa). Deixamos OSM como default
// pra funcionar sem custo nem credencial.
//
// Autenticada (verify_jwt=true): o consultor logado é o dono dos resultados.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildCors } from "../_shared/cors.ts";
import { resolveCaller } from "../_shared/caller-auth.ts";
import { ingestLead } from "../_shared/captation/lead-ingest.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

interface Body {
  /** Cidade alvo, ex: "Campinas". */
  city?: string;
  /** UF, ex: "SP". */
  uf?: string;
  /**
   * Ramo/categoria OSM (chave amenity/shop/office). Ex.: "restaurant",
   * "supermarket", "bakery". Default: todos os "shop".
   */
  category?: string;
  /** Limite de resultados a gravar (default 100, máx 500). */
  limit?: number;
}

const MAX_LIMIT = 500;

/**
 * Monta a query Overpass: busca nós/áreas com telefone dentro da área da
 * cidade. Usa `area[name=...]` para delimitar pela cidade.
 */
function buildOverpassQuery(city: string, category: string | null, limit: number): string {
  // Filtro de categoria: se vier, casa shop/amenity/office com o valor; senão
  // pega qualquer "shop" que tenha telefone.
  const catFilter = category
    ? `(
        node["name"]["phone"]["shop"="${category}"](area.a);
        node["name"]["phone"]["amenity"="${category}"](area.a);
        node["name"]["phone"]["office"="${category}"](area.a);
      )`
    : `(
        node["name"]["phone"]["shop"](area.a);
        node["name"]["phone"]["amenity"~"restaurant|cafe|pharmacy|bank|fuel"](area.a);
      )`;
  return `
    [out:json][timeout:25];
    area["name"="${city}"]["boundary"="administrative"]->.a;
    ${catFilter};
    out body ${limit};
  `;
}

interface OsmElement {
  tags?: Record<string, string>;
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

  const city = (body.city ?? "").trim();
  if (!city) return json(400, { error: "city_required" });
  const uf = (body.uf ?? "").trim().toUpperCase() || null;
  const category = (body.category ?? "").trim() || null;
  const limit = Math.min(Math.max(Number(body.limit) || 100, 1), MAX_LIMIT);

  // Consulta Overpass (OSM).
  let elements: OsmElement[] = [];
  try {
    const q = buildOverpassQuery(city, category, limit);
    const resp = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(q)}`,
    });
    if (!resp.ok) {
      return json(502, { error: "overpass_failed", status: resp.status });
    }
    const data = await resp.json();
    elements = Array.isArray(data?.elements) ? data.elements : [];
  } catch (e) {
    return json(502, { error: "overpass_error", detail: (e as Error)?.message });
  }

  let ingested = 0;
  let deduped = 0;
  let skipped = 0;

  for (const el of elements) {
    const t = el.tags ?? {};
    const phone = t.phone || t["contact:phone"] || t.mobile || null;
    const name = t.name || null;
    if (!phone || !name) {
      skipped++;
      continue;
    }
    const ramo = t.shop || t.amenity || t.office || category || "comercio";
    const r = await ingestLead(admin, {
      consultantId,
      channel: "research",
      personType: "pj",
      companyName: name,
      phone,
      city,
      uf,
      productInterest: body.category ?? null,
      pjData: {
        ramo,
        source: "openstreetmap",
        street: t["addr:street"] ?? null,
        housenumber: t["addr:housenumber"] ?? null,
        website: t.website ?? t["contact:website"] ?? null,
      },
      // Dado público de PJ; abordagem B2B. Sem consent_text (não é PF opt-in).
      rawPayload: { osm_tags: t },
    });
    if (r.ok && r.deduped) deduped++;
    else if (r.ok) ingested++;
    else skipped++;
  }

  return json(200, {
    ok: true,
    city,
    uf,
    category,
    found: elements.length,
    ingested,
    deduped,
    skipped,
    source: "openstreetmap",
  });
});
