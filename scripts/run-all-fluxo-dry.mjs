#!/usr/bin/env node
/**
 * Agregador: valida TODO o fluxo dry (0→final) sem portal / WhatsApp.
 *
 *   node scripts/run-all-fluxo-dry.mjs
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const jobs = [
  {
    name: "node: passos separados + replay F01–F15",
    cmd: "node",
    args: [
      "--test",
      "scripts/validate-passos-separados.mjs",
      "scripts/validate-cadastro-fixes-replay.mjs",
    ],
  },
  {
    name: "deno: Fluxo D+M Simular/Cadastrar/Ativar (matriz)",
    cmd: "deno",
    args: [
      "test",
      "--allow-read",
      "--no-check",
      "supabase/functions/_shared/bot/fluxo-dm-simular-ativar_test.ts",
    ],
  },
  {
    name: "deno: jornada completa 0→final (dry)",
    cmd: "deno",
    args: [
      "test",
      "--allow-read",
      "supabase/functions/_shared/bot/jornada-completa-dry_test.ts",
    ],
  },
  {
    name: "deno: sequência passo-a-passo D+M (sem pulos)",
    cmd: "deno",
    args: [
      "test",
      "--allow-read",
      "--no-check",
      "supabase/functions/_shared/bot/fluxo-dm-passos-sequencia_test.ts",
    ],
  },
  {
    name: "deno: invariantes p/ fluxos FUTUROS (keys genéricas)",
    cmd: "deno",
    args: [
      "test",
      "--allow-read",
      "--no-check",
      "supabase/functions/_shared/bot/flow-future-invariants_test.ts",
    ],
  },
  {
    name: "deno: cadastro-fixes + activate + intent + step-goal",
    cmd: "deno",
    args: [
      "test",
      "--allow-read",
      "supabase/functions/_shared/bot/cadastro-fixes_test.ts",
      "supabase/functions/_shared/bot/flow-activate-routing_test.ts",
      "supabase/functions/_shared/bot/cadastro-intent_test.ts",
      "supabase/functions/_shared/bot/step-goal_test.ts",
    ],
  },
  {
    name: "deno: state-machine conversacional (evo+whapi)",
    cmd: "deno",
    args: [
      "test",
      "--allow-read",
      "supabase/functions/evolution-webhook/handlers/conversational/state-machine_test.ts",
      "supabase/functions/whapi-webhook/handlers/conversational/state-machine_test.ts",
    ],
  },
  {
    name: "deno: flow-router + classifier + registry",
    cmd: "deno",
    args: [
      "test",
      "--allow-read",
      "supabase/functions/_shared/flow-router_test.ts",
      "supabase/functions/_shared/cadastro-input-classifier_test.ts",
      "supabase/functions/_shared/pipeline-cadastro/__tests__/registry_test.ts",
    ],
  },
  {
    name: "deno: formatação de respostas (FAQ elegante, sem push)",
    cmd: "deno",
    args: [
      "test",
      "--allow-read",
      "--no-check",
      "supabase/functions/_shared/format-reply_test.ts",
      "supabase/functions/_shared/bot/post-bill-capture_test.ts",
    ],
  },
  {
    name: "deno: cérebro E2E conversa completa (offline)",
    cmd: "deno",
    args: [
      "test",
      "--no-check",
      "--allow-read",
      "supabase/functions/_shared/cerebro/__tests__/e2e-conversa-completa.test.ts",
    ],
  },
];

const results = [];
for (const job of jobs) {
  process.stdout.write(`\n═══ ${job.name} ═══\n`);
  const r = spawnSync(job.cmd, job.args, {
    cwd: root,
    encoding: "utf8",
    stdio: "inherit",
    env: process.env,
  });
  results.push({ name: job.name, code: r.status ?? 1 });
}

console.log("\n════════ RESUMO ════════");
let failed = 0;
for (const r of results) {
  const ok = r.code === 0;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${r.name} (exit ${r.code})`);
}
console.log(
  failed === 0
    ? `\nOK — ${results.length}/${results.length} suites dry (sem portal).`
    : `\nFALHOU — ${failed}/${results.length} suites.`,
);
process.exit(failed === 0 ? 0 : 1);
