#!/usr/bin/env node
/**
 * Validação local da auditoria de agendamentos.
 * Uso: node scripts/validate-agendamentos.mjs
 * Não envia mensagens — só lint de testes e build.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const steps = [
  {
    name: "Deno: postpone-intent",
    cmd: "deno",
    args: ["test", "supabase/functions/_shared/postpone-intent.test.ts", "--allow-read"],
  },
  {
    name: "Deno: cadastro-fixes",
    cmd: "deno",
    args: ["test", "supabase/functions/_shared/bot/cadastro-fixes_test.ts", "--allow-read"],
  },
  {
    name: "Vitest: agendamentosHub",
    cmd: "bun",
    args: ["run", "test", "src/lib/agendamentosHub.test.ts"],
  },
  {
    name: "Typecheck",
    cmd: "bun",
    args: ["run", "typecheck"],
  },
  {
    name: "Build",
    cmd: "bun",
    args: ["run", "build"],
  },
];

let failed = 0;

console.log("═══════════════════════════════════════════");
console.log("  Validação — Auditoria de Agendamentos");
console.log("═══════════════════════════════════════════\n");

for (const step of steps) {
  process.stdout.write(`▶ ${step.name}... `);
  const r = spawnSync(step.cmd, step.args, { cwd: root, stdio: "pipe", encoding: "utf8" });
  if (r.status === 0) {
    console.log("✅ OK");
  } else {
    console.log("❌ FALHOU");
    if (r.stdout) console.log(r.stdout.slice(-800));
    if (r.stderr) console.error(r.stderr.slice(-800));
    failed++;
  }
}

console.log("\n═══════════════════════════════════════════");
if (failed === 0) {
  console.log("  Resultado: TODOS OS PASSOS OK");
  process.exit(0);
} else {
  console.log(`  Resultado: ${failed} passo(s) com falha`);
  process.exit(1);
}
