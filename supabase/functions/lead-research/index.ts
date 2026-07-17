// lead-research
// ─────────────
// Pesquisa B2B de EMPRESAS por cidade + ramo, rodada pelo próprio consultor.
//
// Dois modos:
//   - action "search"  → PRÉVIA: busca no OpenStreetMap e devolve a lista rica
//                        (nome, telefone, endereço completo, site, horário,
//                        categoria) SEM gravar. O consultor escolhe quais quer.
//   - action "import"  → grava os itens escolhidos como leads PJ do consultor
//                        (captured_leads, channel='research'), com dedup.
//
// Fonte: OpenStreetMap / Overpass — gratuito, sem chave, dado público de PJ.
// Estratégia: Nominatim resolve cidade+UF → bbox; Overpass consulta o bbox
// (mais rápido/estável que area["name"=…]). Espelhos em corrida paralela.
// Autenticada (verify_jwt=true): o consultor logado é o dono dos resultados.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildCors } from "../_shared/cors.ts";
import { resolveCaller } from "../_shared/caller-auth.ts";
import { ingestLead } from "../_shared/captation/lead-ingest.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const UA = "iGreen-LeadResearch/1.0 (suporte@igreen.cloud)";

// Espelhos públicos do Overpass. mail.ru costuma responder quando os
// europeus estão em fila/throttle — fica primeiro na corrida paralela.
const OVERPASS_MIRRORS = [
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

// Sem teto artificial de quantidade: o consultor pode puxar/salvar tudo
// que a fonte devolver. Overpass sem número em `out center` = todos os matches.
// (A própria fonte / wall-clock da edge ainda podem cortar queries gigantes.)
const IMPORT_CONCURRENCY = 25;

// Categorias amigáveis → filtros OSM. Toda busca exige telefone/WhatsApp público.
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

/** Chaves OSM onde o telefone/WhatsApp costuma aparecer. */
const PHONE_KEYS = [
  "phone",
  "contact:phone",
  "contact:mobile",
  "mobile",
  "contact:whatsapp",
  "whatsapp",
  "contact:cellphone",
  "operator:phone",
] as const;

interface SearchBody {
  action?: "search" | "import";
  city?: string;
  uf?: string;
  neighbourhood?: string;
  category?: string;
  limit?: number;
  state_scope?: boolean;
  items?: ResearchItem[];
}

interface ResearchItem {
  osm_id?: string;
  name: string;
  phone: string | null;
  email?: string | null;
  category?: string | null;
  street?: string | null;
  housenumber?: string | null;
  neighbourhood?: string | null;
  city?: string | null;
  uf?: string | null;
  postcode?: string | null;
  website?: string | null;
  opening_hours?: string | null;
  full_address?: string | null;
  lat?: number | null;
  lon?: number | null;
}

interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

interface GeoCity {
  name: string;
  uf: string | null;
  bbox: BBox;
  displayName: string;
}

interface OsmElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

/**
 * Para cada seletor de categoria, gera union com TODAS as chaves de telefone.
 * Assim a Overpass só devolve locais que têm número público (não “sem telefone”).
 */
function withPhoneKeys(baseSelector: string, areaExpr: string): string {
  return PHONE_KEYS
    .map((k) => `nwr["name"]${baseSelector}["${k}"](${areaExpr});`)
    .join("\n        ");
}

function buildFilterBlock(category: string, areaExpr: string): string {
  const filters = CATEGORY_MAP[category] ?? null;
  if (filters) {
    return filters
      .map((f) => withPhoneKeys(`["${f}"]`, areaExpr))
      .join("\n        ");
  }
  // "Tudo": comércio/serviços nomeados COM telefone (shop, amenity, office…).
  const bases = [
    '["shop"]',
    '["amenity"]',
    '["office"]',
    '["tourism"]',
    '["craft"]',
    '["leisure"]',
    '["healthcare"]',
  ];
  return bases.map((b) => withPhoneKeys(b, areaExpr)).join("\n        ");
}

/** `out center` sem número = todos os matches (sem teto 800/1000/5000). */
function outClause(limit?: number | null): string {
  if (limit == null || !Number.isFinite(limit) || limit <= 0) return "out center;";
  return `out center ${Math.floor(limit)};`;
}

function buildOverpassQueryBbox(bbox: BBox, category: string, limit?: number | null): string {
  const areaExpr = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  const block = buildFilterBlock(category, areaExpr);
  return `
    [out:json][timeout:55];
    (
        ${block}
    );
    ${outClause(limit)}
  `;
}

function buildOverpassQueryArea(city: string, category: string, limit?: number | null): string {
  const safeCity = city.replace(/["\\]/g, "");
  const block = buildFilterBlock(category, "area.b");
  return `
    [out:json][timeout:55];
    area["name"="${safeCity}"]["admin_level"="8"]->.b;
    (
        ${block}
    );
    ${outClause(limit)}
  `;
}

function buildOverpassQueryState(uf: string, category: string, limit?: number | null): string {
  const safeUf = uf.replace(/[^A-Z]/g, "");
  const block = buildFilterBlock(category, "area.b");
  return `
    [out:json][timeout:90];
    area["ISO3166-2"="BR-${safeUf}"]["admin_level"="4"]->.b;
    (
        ${block}
    );
    ${outClause(limit)}
  `;
}

/**
 * Resolve cidade+UF via Nominatim → bounding box.
 * Preferência: município no UF pedido (ISO3166-2).
 */
async function geocodeCity(city: string, uf: string | null): Promise<GeoCity | null> {
  const q = uf ? `${city}, ${uf}, Brazil` : `${city}, Brazil`;
  const url =
    `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1` +
    `&countrycodes=br&limit=8&q=${encodeURIComponent(q)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: ctrl.signal,
    });
    if (!resp.ok) return null;
    const rows = await resp.json() as Array<{
      name?: string;
      display_name?: string;
      addresstype?: string;
      class?: string;
      type?: string;
      boundingbox?: string[];
      address?: Record<string, string>;
    }>;
    if (!Array.isArray(rows) || rows.length === 0) return null;

    const wantUf = uf?.toUpperCase() || null;
    const scored = rows
      .map((r, idx) => {
        const iso = (r.address?.["ISO3166-2-lvl4"] || "").toUpperCase();
        const stateCode = iso.startsWith("BR-") ? iso.slice(3) : "";
        const bb = r.boundingbox;
        if (!bb || bb.length < 4) return null;
        const south = Number(bb[0]);
        const north = Number(bb[1]);
        const west = Number(bb[2]);
        const east = Number(bb[3]);
        if (![south, north, west, east].every(Number.isFinite)) return null;

        let score = 0;
        if (wantUf && stateCode === wantUf) score += 100;
        if (wantUf && !stateCode) score -= 20;
        const at = (r.addresstype || r.type || "").toLowerCase();
        if (["municipality", "city", "town", "village", "suburb"].includes(at)) score += 40;
        if (r.class === "boundary" && r.type === "administrative") score += 20;
        if (fold(r.name || "") === fold(city)) score += 30;
        score -= idx; // Nominatim já ordena por relevância
        return {
          score,
          geo: {
            name: r.name || city,
            uf: stateCode || wantUf,
            bbox: { south, west, north, east },
            displayName: r.display_name || r.name || city,
          } satisfies GeoCity,
        };
      })
      .filter(Boolean) as Array<{ score: number; geo: GeoCity }>;

    if (!scored.length) return null;
    scored.sort((a, b) => b.score - a.score);
    return scored[0].geo;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Corrida paralela nos espelhos: o primeiro JSON válido vence.
 * Timeout único (não soma 3×), evitando estourar o wall-clock da edge.
 */
async function queryOverpass(query: string, timeoutMs = 50_000): Promise<OsmElement[]> {
  const errors: string[] = [];
  const controllers = OVERPASS_MIRRORS.map(() => new AbortController());
  const timer = setTimeout(() => controllers.forEach((c) => c.abort()), timeoutMs);

  try {
    return await Promise.any(
      OVERPASS_MIRRORS.map(async (url, i) => {
        try {
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
          if (!resp.ok) {
            const msg = `${url} → HTTP ${resp.status}`;
            errors.push(msg);
            throw new Error(msg);
          }
          const text = await resp.text();
          let data: unknown;
          try {
            data = JSON.parse(text);
          } catch {
            const msg = `${url} → resposta não-JSON`;
            errors.push(msg);
            throw new Error(msg);
          }
          const els = (data as { elements?: unknown })?.elements;
          if (!Array.isArray(els)) {
            const msg = `${url} → resposta sem elements`;
            errors.push(msg);
            throw new Error(msg);
          }
          // Cancela os outros espelhos.
          controllers.forEach((c, j) => {
            if (j !== i) c.abort();
          });
          return els as OsmElement[];
        } catch (e) {
          const msg = `${url} → ${(e as Error)?.message || "erro"}`;
          if (!errors.includes(msg)) errors.push(msg);
          throw e;
        }
      }),
    );
  } catch {
    throw new Error(errors.slice(0, 6).join("; ") || "todos os espelhos Overpass falharam");
  } finally {
    clearTimeout(timer);
  }
}

function translateCategory(raw: string | null, tags: Record<string, string>): string | null {
  if (tags.amenity === "place_of_worship") {
    const r = tags.religion === "christian" ? "Igreja" : (tags.religion || "Templo");
    return tags.denomination ? `${r} (${tags.denomination})` : r;
  }
  const MAP: Record<string, string> = {
    restaurant: "Restaurante",
    fast_food: "Lanchonete",
    cafe: "Café",
    bar: "Bar",
    pub: "Bar",
    pharmacy: "Farmácia",
    fuel: "Posto",
    bank: "Banco",
    school: "Escola",
    kindergarten: "Creche",
    university: "Universidade",
    college: "Faculdade",
    hospital: "Hospital",
    clinic: "Clínica",
    dentist: "Dentista",
    doctors: "Consultório",
    veterinary: "Veterinário",
    supermarket: "Mercado",
    convenience: "Mercearia",
    bakery: "Padaria",
    butcher: "Açougue",
    hairdresser: "Salão",
    beauty: "Estética",
    car_repair: "Oficina",
    clothes: "Loja de roupas",
    shoes: "Calçados",
    electronics: "Eletrônicos",
    furniture: "Móveis",
    hardware: "Material de construção",
    florist: "Floricultura",
    hotel: "Hotel",
    motel: "Motel",
    guest_house: "Pousada",
    fitness_centre: "Academia",
    sports_centre: "Centro esportivo",
    government: "Órgão público",
    townhall: "Prefeitura",
    library: "Biblioteca",
    police: "Polícia",
    fire_station: "Bombeiros",
    post_office: "Correios",
    car_dealer: "Concessionária",
    car: "Loja de carros",
    optician: "Ótica",
    jewelry: "Joalheria",
    mobile_phone: "Celulares",
    computer: "Informática",
  };
  if (!raw) return null;
  return MAP[raw] || raw.replace(/_/g, " ");
}

/**
 * Extrai TODOS os telefones das tags (não só o primeiro).
 * OSM junta vários com `;` `/` `|` `,` — cada um vira um lead potencial.
 */
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
    // BR: DDD+número (10–11) ou com 55 (12–13). Descarta lixo curto.
    if (digits.length < 10) continue;
    const key = digits.slice(-11);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

/** Um item por telefone — se o local tem 3 números, saem 3 linhas. */
function mapElement(
  el: OsmElement,
  fallbackCity: string,
  fallbackUf: string | null,
): ResearchItem[] {
  const t = el.tags ?? {};
  const name = t.name || t.brand || t.operator || null;
  if (!name) return [];
  const phones = extractAllPhones(t);
  if (phones.length === 0) return [];

  const street = t["addr:street"] || null;
  const num = t["addr:housenumber"] || null;
  const bairro =
    t["addr:suburb"] ||
    t["addr:neighbourhood"] ||
    t["addr:district"] ||
    t["addr:quarter"] ||
    t["addr:hamlet"] ||
    null;
  const cidade = t["addr:city"] || t["addr:municipality"] || fallbackCity;
  const cep = t["addr:postcode"] || null;
  const rawState = t["addr:state"] || null;
  let ufOut: string | null = fallbackUf;
  if (rawState) {
    const s = rawState.trim().toUpperCase();
    ufOut = s.length === 2 ? s : (fallbackUf || rawState);
  }

  const rawCategory = t.shop || t.amenity || t.office || t.leisure || t.tourism ||
    t.sport || t.craft || t.healthcare || t.club || t.government ||
    (t.building && t.building !== "yes" ? t.building : null) || null;
  const category = translateCategory(rawCategory, t);

  const fullAddress = [
    street ? `${street}${num ? `, ${num}` : ""}` : null,
    bairro,
    cidade,
    ufOut,
    cep,
  ].filter(Boolean).join(" · ");

  const lat = el.lat ?? el.center?.lat ?? null;
  const lon = el.lon ?? el.center?.lon ?? null;
  const baseOsm = `${el.type}/${el.id}`;

  return phones.map((phone, idx) => ({
    osm_id: phones.length > 1 ? `${baseOsm}#${idx + 1}` : baseOsm,
    name,
    phone,
    email: t.email || t["contact:email"] || null,
    category,
    street,
    housenumber: num,
    neighbourhood: bairro,
    city: cidade,
    uf: ufOut,
    postcode: cep,
    website: t.website || t["contact:website"] || t.url || null,
    opening_hours: t.opening_hours || null,
    full_address: fullAddress || null,
    lat,
    lon,
  }));
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

  let body: SearchBody;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_json" });
  }

  const action = body.action ?? "search";

  // ── IMPORT: grava os itens escolhidos como leads PJ ──────────────────────
  if (action === "import") {
    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) return json(400, { error: "no_items" });

    let ingested = 0, deduped = 0, skipped = 0;

    const ingestOne = async (it: ResearchItem): Promise<"ingested" | "deduped" | "skipped"> => {
      if (!it?.phone || !it?.name) return "skipped";
      const r = await ingestLead(admin, {
        consultantId,
        channel: "research",
        personType: "pj",
        companyName: it.name,
        phone: it.phone,
        email: it.email ?? null,
        city: it.city ?? null,
        uf: it.uf ?? null,
        productInterest: it.category ?? null,
        pjData: {
          ramo: it.category ?? null,
          source: "openstreetmap",
          osm_id: it.osm_id ?? null,
          street: it.street ?? null,
          housenumber: it.housenumber ?? null,
          neighbourhood: it.neighbourhood ?? null,
          postcode: it.postcode ?? null,
          full_address: it.full_address ?? null,
          website: it.website ?? null,
          email: it.email ?? null,
          opening_hours: it.opening_hours ?? null,
          lat: it.lat ?? null,
          lon: it.lon ?? null,
        },
        rawPayload: { research_item: it },
      });
      if (r.ok && r.deduped) return "deduped";
      if (r.ok) return "ingested";
      return "skipped";
    };

    // Concorrência limitada: lotes grandes não estouram o wall-clock da edge.
    for (let i = 0; i < items.length; i += IMPORT_CONCURRENCY) {
      const slice = items.slice(i, i + IMPORT_CONCURRENCY);
      const outcomes = await Promise.all(slice.map((it) => ingestOne(it)));
      for (const o of outcomes) {
        if (o === "ingested") ingested++;
        else if (o === "deduped") deduped++;
        else skipped++;
      }
    }
    return json(200, { ok: true, ingested, deduped, skipped, total: items.length });
  }

  // ── SEARCH: prévia rica, sem gravar ──────────────────────────────────────
  const city = (body.city ?? "").trim();
  const uf = (body.uf ?? "").trim().toUpperCase() || null;
  const stateScope = Boolean(body.state_scope);
  if (!stateScope && !city) return json(400, { error: "city_required" });
  if (stateScope && !uf) return json(400, { error: "uf_required_for_state_scope" });
  const neighbourhood = (body.neighbourhood ?? "").trim() || undefined;
  const category = (body.category ?? "").trim().toLowerCase();
  // limit opcional: omitido / 0 / negativo = sem teto (todos os matches).
  const rawLimit = Number(body.limit);
  const limit = !Number.isFinite(rawLimit) || rawLimit <= 0 ? null : Math.floor(rawLimit);

  let elements: OsmElement[] = [];
  let resolvedCity = city;
  let resolvedUf = uf;
  let strategy = "area";
  let lastErr: Error | null = null;

  try {
    if (stateScope) {
      const q = buildOverpassQueryState(uf!, category, limit);
      elements = await queryOverpass(q, 95_000);
      strategy = "state";
    } else {
      // 1) Nominatim → bbox (caminho principal, estável).
      const geo = await geocodeCity(city, uf);
      if (geo) {
        resolvedCity = geo.name || city;
        resolvedUf = geo.uf || uf;
        try {
          elements = await queryOverpass(
            buildOverpassQueryBbox(geo.bbox, category, limit),
            55_000,
          );
          strategy = "bbox";
        } catch (e) {
          lastErr = e as Error;
        }
      }

      // 2) Fallback: area admin_level=8 pelo nome (Nominatim falhou / bbox vazio / bbox erro).
      if (elements.length === 0) {
        try {
          elements = await queryOverpass(
            buildOverpassQueryArea(resolvedCity || city, category, limit),
            55_000,
          );
          strategy = geo ? "area_fallback" : "area";
          lastErr = null;
        } catch (e) {
          lastErr = e as Error;
        }
      }

      if (!geo && elements.length === 0) {
        return json(404, {
          ok: false,
          error: "city_not_found",
          detail:
            `Não achei "${city}"${uf ? `/${uf}` : ""} no mapa. Escolha a cidade na lista de sugestões.`,
        });
      }
      if (elements.length === 0 && lastErr) throw lastErr;
    }
  } catch (e) {
    return json(502, {
      ok: false,
      error: "overpass_indisponivel",
      detail: (e as Error)?.message || "fonte temporariamente indisponível",
    });
  }

  const items: ResearchItem[] = [];
  const seen = new Set<string>();
  const bairroFilter = fold(neighbourhood || "");
  let droppedByBairro = 0;

  const pushMapped = (
    el: OsmElement,
    cityFb: string,
    applyBairro: boolean,
  ): void => {
    const mapped = mapElement(el, cityFb, resolvedUf);
    for (const m of mapped) {
      if (applyBairro && bairroFilter) {
        const hay = fold(
          `${m.neighbourhood || ""} ${m.full_address || ""} ${m.street || ""} ${m.name || ""}`,
        );
        if (!hay.includes(bairroFilter)) {
          droppedByBairro++;
          continue;
        }
      }
      const phoneDigits = (m.phone || "").replace(/\D/g, "");
      const key = `${fold(m.name || "")}|${phoneDigits || m.osm_id || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(m);
    }
  };

  for (const el of elements) {
    pushMapped(
      el,
      resolvedCity || city || (el.tags?.["addr:city"] ?? ""),
      true,
    );
  }

  // Se o filtro de bairro zerou tudo mas havia resultados brutos, devolve sem
  // filtro + aviso (OSM costuma não ter addr:suburb preenchido).
  let neighbourhoodNote: string | null = null;
  if (bairroFilter && items.length === 0 && elements.length > 0 && droppedByBairro > 0) {
    for (const el of elements) {
      pushMapped(el, resolvedCity || city, false);
    }
    neighbourhoodNote =
      "Poucos endereços no mapa têm bairro preenchido; mostrei a cidade inteira. Refine pela lista.";
  }

  items.sort((a, b) => {
    if (!!a.phone !== !!b.phone) return a.phone ? -1 : 1;
    return (a.name || "").localeCompare(b.name || "", "pt-BR");
  });

  const withPhone = items.filter((i) => i.phone).length;

  return json(200, {
    ok: true,
    city: resolvedCity,
    uf: resolvedUf,
    neighbourhood: neighbourhood || null,
    neighbourhood_note: neighbourhoodNote,
    category: category || null,
    found: items.length,
    with_phone: withPhone,
    items,
    source: "openstreetmap",
    strategy,
  });
});
