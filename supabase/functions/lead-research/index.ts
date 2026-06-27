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
// Autenticada (verify_jwt=true): o consultor logado é o dono dos resultados.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildCors } from "../_shared/cors.ts";
import { resolveCaller } from "../_shared/caller-auth.ts";
import { ingestLead } from "../_shared/captation/lead-ingest.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Espelhos públicos do Overpass. A instância principal cai/throttle com
// frequência, então tentamos vários em ordem antes de desistir.
const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

const MAX_LIMIT = 5000;

// Categorias amigáveis → filtros OSM. "" = comércio variado.
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

interface SearchBody {
  action?: "search" | "import";
  city?: string;
  uf?: string;
  neighbourhood?: string;
  category?: string;
  limit?: number;
  // para import:
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

function buildOverpassQuery(city: string, category: string, limit: number): string {
  const filters = CATEGORY_MAP[category] ?? null;
  let block: string;
  if (filters) {
    // Filtra pela categoria escolhida, em nós, vias e relações.
    block = filters
      .map((f) => `nwr["name"]["${f}"](area.b);`)
      .join("\n        ");
  } else {
    // "Tudo": pega O MÁXIMO possível — tudo que é local público nomeado e tem
    // telefone (empresa, igreja, escola, órgão público, clínica, etc.).
    block = `nwr["name"]["phone"](area.b);
        nwr["name"]["contact:phone"](area.b);
        nwr["name"]["contact:mobile"](area.b);`;
  }
  const safeCity = city.replace(/["\\]/g, "");
  // Varre a CIDADE INTEIRA. Como o limite agora é alto (5000) e o universo real
  // de uma cidade grande é ~1-2 mil, pega tudo sem deixar nada de fora. O filtro
  // por bairro é aplicado depois, sobre o endereço de cada resultado.
  return `
    [out:json][timeout:60];
    area["name"="${safeCity}"]["admin_level"]->.b;
    (
        ${block}
    );
    out center ${limit};
  `;
}

interface OsmElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

/**
 * Consulta o Overpass tentando vários espelhos. Cada tentativa tem timeout
 * próprio. Retorna os elementos ou lança com o último erro.
 */
async function queryOverpass(query: string): Promise<OsmElement[]> {
  let lastErr = "";
  for (const url of OVERPASS_MIRRORS) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 28_000);
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          // Overpass público exige User-Agent identificável; sem ele devolve
          // 406/429 (que virava 502 pra nós).
          "User-Agent": "iGreen-LeadResearch/1.0 (suporte@igreen.cloud)",
          "Accept": "application/json",
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!resp.ok) {
        lastErr = `${url} → HTTP ${resp.status}`;
        continue;
      }
      const text = await resp.text();
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        // Overpass às vezes devolve HTML de erro mesmo com 200.
        lastErr = `${url} → resposta não-JSON`;
        continue;
      }
      const els = (data as { elements?: unknown })?.elements;
      if (Array.isArray(els)) return els as OsmElement[];
      lastErr = `${url} → resposta sem elements`;
    } catch (e) {
      lastErr = `${url} → ${(e as Error)?.message || "erro"}`;
    }
  }
  throw new Error(lastErr || "todos os espelhos Overpass falharam");
}

function translateCategory(raw: string | null, tags: Record<string, string>): string | null {
  // place_of_worship → tenta a religião/denominação
  if (tags.amenity === "place_of_worship") {
    const r = tags.religion === "christian" ? "Igreja" : (tags.religion || "Templo");
    return tags.denomination ? `${r} (${tags.denomination})` : r;
  }
  const MAP: Record<string, string> = {
    restaurant: "Restaurante", fast_food: "Lanchonete", cafe: "Café",
    bar: "Bar", pub: "Bar", pharmacy: "Farmácia", fuel: "Posto",
    bank: "Banco", school: "Escola", kindergarten: "Creche",
    university: "Universidade", college: "Faculdade", hospital: "Hospital",
    clinic: "Clínica", dentist: "Dentista", doctors: "Consultório",
    veterinary: "Veterinário", supermarket: "Mercado", convenience: "Mercearia",
    bakery: "Padaria", butcher: "Açougue", hairdresser: "Salão",
    beauty: "Estética", car_repair: "Oficina", clothes: "Loja de roupas",
    shoes: "Calçados", electronics: "Eletrônicos", furniture: "Móveis",
    hardware: "Material de construção", florist: "Floricultura",
    hotel: "Hotel", motel: "Motel", guest_house: "Pousada",
    fitness_centre: "Academia", sports_centre: "Centro esportivo",
    government: "Órgão público", townhall: "Prefeitura", library: "Biblioteca",
    police: "Polícia", fire_station: "Bombeiros", post_office: "Correios",
    car_dealer: "Concessionária", car: "Loja de carros", optician: "Ótica",
    jewelry: "Joalheria", mobile_phone: "Celulares", computer: "Informática",
  };
  if (!raw) return null;
  return MAP[raw] || raw.replace(/_/g, " ");
}

function mapElement(el: OsmElement, fallbackCity: string, fallbackUf: string | null): ResearchItem | null {
  const t = el.tags ?? {};
  const name = t.name || null;
  const phone = t.phone || t["contact:phone"] || t.mobile || t["contact:mobile"] || null;
  if (!name) return null;

  const street = t["addr:street"] || null;
  const num = t["addr:housenumber"] || null;
  const bairro = t["addr:suburb"] || t["addr:neighbourhood"] || null;
  const cidade = t["addr:city"] || fallbackCity;
  const cep = t["addr:postcode"] || null;
  // Identifica o tipo do local cobrindo todas as chaves OSM relevantes
  // (inclui igreja, escola, saúde, ofício, governo).
  const rawCategory = t.shop || t.amenity || t.office || t.leisure || t.tourism
    || t.sport || t.craft || t.healthcare || t.club || t.government
    || (t.building && t.building !== "yes" ? t.building : null) || null;
  const category = translateCategory(rawCategory, t);

  const fullAddress = [
    street ? `${street}${num ? `, ${num}` : ""}` : null,
    bairro,
    cidade,
    cep,
  ].filter(Boolean).join(" · ");

  const lat = el.lat ?? el.center?.lat ?? null;
  const lon = el.lon ?? el.center?.lon ?? null;

  return {
    osm_id: `${el.type}/${el.id}`,
    name,
    phone,
    email: t.email || t["contact:email"] || null,
    category,
    street,
    housenumber: num,
    neighbourhood: bairro,
    city: cidade,
    uf: (t["addr:state"] || fallbackUf || null) as string | null,
    postcode: cep,
    website: t.website || t["contact:website"] || t.url || null,
    opening_hours: t.opening_hours || null,
    full_address: fullAddress || null,
    lat,
    lon,
  };
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
    for (const it of items) {
      if (!it?.phone || !it?.name) { skipped++; continue; }
      const r = await ingestLead(admin, {
        consultantId,
        channel: "research",
        personType: "pj",
        companyName: it.name,
        phone: it.phone,
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
      if (r.ok && r.deduped) deduped++;
      else if (r.ok) ingested++;
      else skipped++;
    }
    return json(200, { ok: true, ingested, deduped, skipped, total: items.length });
  }

  // ── SEARCH: prévia rica, sem gravar ──────────────────────────────────────
  const city = (body.city ?? "").trim();
  if (!city) return json(400, { error: "city_required" });
  const uf = (body.uf ?? "").trim().toUpperCase() || null;
  const neighbourhood = (body.neighbourhood ?? "").trim() || undefined;
  const category = (body.category ?? "").trim().toLowerCase();
  const limit = Math.min(Math.max(Number(body.limit) || 2000, 1), MAX_LIMIT);

  let elements: OsmElement[] = [];
  try {
    const q = buildOverpassQuery(city, category, limit);
    elements = await queryOverpass(q);
  } catch (e) {
    return json(502, { error: "overpass_indisponivel", detail: (e as Error)?.message });
  }

  const items: ResearchItem[] = [];
  const seen = new Set<string>();
  // Filtro de bairro (texto): casa contra bairro OU endereço completo.
  const bairroFilter = (neighbourhood || "").trim().toLowerCase();
  for (const el of elements) {
    const m = mapElement(el, city, uf);
    if (!m) continue;
    if (bairroFilter) {
      const hay = `${m.neighbourhood || ""} ${m.full_address || ""}`.toLowerCase();
      if (!hay.includes(bairroFilter)) continue;
    }
    // dedup local por nome+telefone
    const key = `${(m.name || "").toLowerCase()}|${(m.phone || "").replace(/\D/g, "")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(m);
  }

  // ordena: com telefone primeiro, depois alfabético
  items.sort((a, b) => {
    if (!!a.phone !== !!b.phone) return a.phone ? -1 : 1;
    return (a.name || "").localeCompare(b.name || "");
  });

  const withPhone = items.filter((i) => i.phone).length;

  return json(200, {
    ok: true,
    city,
    uf,
    neighbourhood: neighbourhood || null,
    category: category || null,
    found: items.length,
    with_phone: withPhone,
    items,
    source: "openstreetmap",
  });
});
