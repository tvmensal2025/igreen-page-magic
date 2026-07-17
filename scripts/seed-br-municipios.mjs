#!/usr/bin/env node
/**
 * Regenera supabase/migrations/*_seed_br_municipios.sql a partir da API IBGE.
 * Uso: node scripts/seed-br-municipios.mjs
 *
 * Não mistura com fb_city_cache (Meta) nem CITY_HINT (cobertura comercial).
 */
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(
  __dirname,
  "../supabase/migrations/20260715150100_seed_br_municipios.sql",
);
const IBGE_URL =
  "https://servicodados.ibge.gov.br/api/v1/localidades/municipios";

function normalize(s) {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function esc(s) {
  return String(s).replace(/'/g, "''");
}

function ufOf(m) {
  try {
    return m.microrregiao.mesorregiao.UF.sigla;
  } catch {
    return m["regiao-imediata"]["regiao-intermediaria"].UF.sigla;
  }
}

const data = await (await fetch(IBGE_URL)).json();
const rows = data
  .map((m) => {
    const name = m.nome;
    return [m.id, name, normalize(name), ufOf(m)];
  })
  .sort((a, b) => a[3].localeCompare(b[3]) || a[1].localeCompare(b[1], "pt-BR"));

const batches = [];
const SIZE = 200;
for (let i = 0; i < rows.length; i += SIZE) {
  const slice = rows.slice(i, i + SIZE);
  const vals = slice
    .map(([c, n, nn, uf]) => `(${c}, '${esc(n)}', '${esc(nn)}', '${uf}')`)
    .join(",\n");
  batches.push(
    `INSERT INTO public.br_municipios (ibge_code, name, name_normalized, uf) VALUES\n${vals}\nON CONFLICT (ibge_code) DO UPDATE SET name = EXCLUDED.name, name_normalized = EXCLUDED.name_normalized, uf = EXCLUDED.uf;`,
  );
}

const header = `-- Seed único: dump IBGE Localidades GET /api/v1/localidades/municipios (${rows.length} municípios).
-- Fonte: ${IBGE_URL}
-- Idempotente via ON CONFLICT (ibge_code).
-- Regenerar: node scripts/seed-br-municipios.mjs

`;

writeFileSync(OUT, header + batches.join("\n\n") + "\n");
console.log(`Wrote ${rows.length} rows → ${OUT}`);
