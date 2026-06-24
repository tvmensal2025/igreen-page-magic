#!/usr/bin/env node
/**
 * Gera payload JSON para deploy MCP das edge functions solar-*.
 * Uso: node scripts/bundle-solar-edge.mjs solar-roof-analyze > /tmp/payload.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const fn = process.argv[2];
if (!fn) {
  console.error("Informe o slug: node scripts/bundle-solar-edge.mjs solar-roof-analyze");
  process.exit(1);
}

const SHARED_CORE = ["admin-client.ts", "caller-auth.ts", "cors.ts"];
const SOLAR_DIR = path.join(root, "supabase/functions/_shared/solar");
const solarFiles = fs.readdirSync(SOLAR_DIR).filter((f) => f.endsWith(".ts"));

const relPaths = new Set([
  `supabase/functions/${fn}/index.ts`,
  ...SHARED_CORE.map((f) => `supabase/functions/_shared/${f}`),
  ...solarFiles.map((f) => `supabase/functions/_shared/solar/${f}`),
]);

const files = [...relPaths].map((absRel) => {
  const abs = path.join(root, absRel);
  let name;
  if (absRel.includes(`/${fn}/index.ts`)) name = "index.ts";
  else if (absRel.includes("_shared/")) name = `../${path.relative(path.join(root, "supabase/functions"), abs).replace(/\\/g, "/")}`;
  else name = path.basename(absRel);
  return { name, content: fs.readFileSync(abs, "utf8") };
});

const payload = {
  name: fn,
  entrypoint_path: "index.ts",
  verify_jwt: false,
  files,
};

process.stdout.write(JSON.stringify(payload));
