// Valida as migrations F16 em Postgres embutido (PGlite) — DRY, sem produção:
//   1. 20260713023000_fix_dm_cadastrar_to_conta_cadastro.sql
//   2. 20260713031000_audit_flow_activate_rules.sql
//
// Cenário: Fluxo D e Fluxo M (clone com UUIDs próprios) semeados com as
// transitions ERRADAS que existiam em produção:
//   d_como_funciona: cadastrar → d_pedir_conta (simulação)      [R1]
//   d_duvidas:       cadastrar → d_pedir_documento (pula conta) [R2]
//
// Asserts:
//   (a) audit_flow_activate_rules() aponta R1+R2 nos DOIS fluxos ANTES do fix.
//   (b) Depois do fix, auditoria devolve 0 linhas.
//   (c) Transitions não-cadastro foram PRESERVADAS (nada apagado).
//   (d) Fluxo futuro "X" (keys próprias) com cadastrar→conta_sim é detectado.

import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const MIG_FIX = path.join(
  REPO_ROOT,
  "supabase/migrations/20260713023000_fix_dm_cadastrar_to_conta_cadastro.sql",
);
const MIG_AUDIT = path.join(
  REPO_ROOT,
  "supabase/migrations/20260713031000_audit_flow_activate_rules.sql",
);

const ok = (label) => console.log(`  \x1b[32mOK\x1b[0m ${label}`);
const fail = (label, err) => {
  console.error(`  \x1b[31mFAIL\x1b[0m ${label}: ${err}`);
  process.exitCode = 1;
};
const assert = (cond, label, detail = "") =>
  cond ? ok(label) : fail(label, detail || "expected true");
const eq = (actual, expected, label) =>
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    label,
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );

console.log("== Validação DRY das migrations F16 (fix + auditoria) ==\n");

const db = new PGlite();
await db.waitReady;

// ── 0. Schema mínimo compatível com produção ────────────────────────────────
console.log("Passo 0: schema snapshot (bot_flows, bot_flow_steps, roles)");
await db.exec(`
  CREATE ROLE authenticated NOINHERIT;
  CREATE ROLE service_role NOINHERIT;

  CREATE TABLE public.bot_flows (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    consultant_id uuid NOT NULL DEFAULT gen_random_uuid(),
    name text NOT NULL DEFAULT 'Fluxo',
    is_active boolean NOT NULL DEFAULT true,
    is_public boolean NOT NULL DEFAULT false,
    variant text NOT NULL DEFAULT 'A',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE public.bot_flow_steps (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    flow_id uuid NOT NULL REFERENCES public.bot_flows(id) ON DELETE CASCADE,
    position integer NOT NULL DEFAULT 0,
    step_type text NOT NULL,
    step_key text,
    title text,
    is_active boolean NOT NULL DEFAULT true,
    transitions jsonb NOT NULL DEFAULT '[]'::jsonb,
    fallback jsonb NOT NULL DEFAULT '{"mode":"repeat"}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
`);
ok("schema criado");

// ── 1. Semear Fluxo D e M com o grafo ERRADO de produção ────────────────────
console.log("\nPasso 1: semear D + M com transitions erradas (pré-fix)");

async function seedFlow(variant) {
  const f = await db.query(
    `INSERT INTO bot_flows (name, variant) VALUES ($1, $2) RETURNING id`,
    [`Fluxo ${variant}`, variant],
  );
  const flowId = f.rows[0].id;
  const mk = async (pos, type, key, transitions = "[]", fallback = null) => {
    const r = await db.query(
      `INSERT INTO bot_flow_steps (flow_id, position, step_type, step_key, transitions, fallback)
       VALUES ($1,$2,$3,$4,$5::jsonb, COALESCE($6::jsonb, '{"mode":"repeat"}'::jsonb)) RETURNING id`,
      [flowId, pos, type, key, transitions, fallback],
    );
    return r.rows[0].id;
  };

  const doc = await mk(6, "capture_documento", "d_pedir_documento");
  const contaCad = await mk(5, "capture_conta", "d_simular_pedir_conta", "[]",
    JSON.stringify({ mode: "goto", goto_step_id: doc, success_goto_step_id: doc }));
  const resultado = await mk(4, "message", "d_resultado");
  const contaSim = await mk(3, "capture_conta", "d_pedir_conta", "[]",
    JSON.stringify({ mode: "goto", goto_step_id: resultado, success_goto_step_id: resultado }));

  // ERRADO (como estava em produção): cadastrar → conta de SIMULAÇÃO
  await mk(1, "message", "d_como_funciona", JSON.stringify([
    { trigger_intent: "cadastrar", trigger_phrases: ["quero me cadastrar", "cadastrar"], goto_step_id: contaSim, goto_special: null },
    { trigger_intent: "simular", trigger_phrases: ["quero simular"], goto_step_id: contaSim, goto_special: null },
    { trigger_intent: "duvida", trigger_phrases: ["tenho dúvidas"], goto_step_id: resultado, goto_special: null },
  ]));
  // ERRADO: cadastrar → documento DIRETO (pula conta de cadastro)
  await mk(2, "message", "d_duvidas", JSON.stringify([
    { trigger_intent: "cadastrar", trigger_phrases: ["quero ativar o benefício"], goto_step_id: doc, goto_special: null },
    { trigger_intent: "humano", trigger_phrases: ["falar com atendente"], goto_step_id: null, goto_special: "humano" },
  ]));

  return { flowId, contaSim, contaCad, doc, resultado };
}

const D = await seedFlow("D");
const M = await seedFlow("M");
ok(`fluxo D=${D.flowId.slice(0, 8)}… M=${M.flowId.slice(0, 8)}… semeados`);

// Fluxo futuro "X" (keys próprias, sem d_*): cadastrar → conta de simulação
const X = await (async () => {
  const f = await db.query(
    `INSERT INTO bot_flows (name, variant) VALUES ('Fluxo X futuro', 'D') RETURNING id`,
  );
  const flowId = f.rows[0].id;
  const doc = (await db.query(
    `INSERT INTO bot_flow_steps (flow_id, position, step_type, step_key)
     VALUES ($1, 4, 'capture_documento', 'x_envia_documento') RETURNING id`, [flowId],
  )).rows[0].id;
  const contaCad = (await db.query(
    `INSERT INTO bot_flow_steps (flow_id, position, step_type, step_key, fallback)
     VALUES ($1, 3, 'capture_conta', 'x_conta_adesao', $2::jsonb) RETURNING id`,
    [flowId, JSON.stringify({ mode: "goto", goto_step_id: doc, success_goto_step_id: doc })],
  )).rows[0].id;
  const resultado = (await db.query(
    `INSERT INTO bot_flow_steps (flow_id, position, step_type, step_key)
     VALUES ($1, 2, 'message', 'x_resultado') RETURNING id`, [flowId],
  )).rows[0].id;
  const contaSim = (await db.query(
    `INSERT INTO bot_flow_steps (flow_id, position, step_type, step_key, fallback)
     VALUES ($1, 1, 'capture_conta', 'x_conta_simular', $2::jsonb) RETURNING id`,
    [flowId, JSON.stringify({ mode: "goto", goto_step_id: resultado, success_goto_step_id: resultado })],
  )).rows[0].id;
  await db.query(
    `INSERT INTO bot_flow_steps (flow_id, position, step_type, step_key, transitions)
     VALUES ($1, 0, 'message', 'x_menu', $2::jsonb)`,
    [flowId, JSON.stringify([
      { trigger_intent: "cadastrar", trigger_phrases: ["ativar"], goto_step_id: contaSim, goto_special: null },
    ])],
  );
  return { flowId, contaSim, contaCad };
})();
ok(`fluxo futuro X=${X.flowId.slice(0, 8)}… semeado (cadastrar→conta_sim ERRADO)`);

// ── 2. Migration de AUDITORIA (read-only) ────────────────────────────────────
console.log("\nPasso 2: aplicar migration da função de auditoria");
await db.exec(fs.readFileSync(MIG_AUDIT, "utf8"));
ok("audit_flow_activate_rules criada");

const before = await db.query(`SELECT flow_id, step_key, rule FROM audit_flow_activate_rules() ORDER BY flow_id, rule`);
console.log(`  → violações ANTES do fix: ${before.rows.length}`);
for (const r of before.rows) console.log(`     • ${r.step_key} [${r.rule}]`);

// D e M: R1 (como_funciona→conta sim) + R2 (duvidas→doc) = 2 cada
// X: R1 (menu→conta sim) = 1
const countBy = (rows, flowId, rule) =>
  rows.filter((r) => r.flow_id === flowId && r.rule === rule).length;
eq(countBy(before.rows, D.flowId, "R1_activate_to_sim"), 1, "D pré-fix: 1×R1 detectada");
eq(countBy(before.rows, D.flowId, "R2_activate_skips_conta"), 1, "D pré-fix: 1×R2 detectada");
eq(countBy(before.rows, M.flowId, "R1_activate_to_sim"), 1, "M pré-fix: 1×R1 detectada");
eq(countBy(before.rows, M.flowId, "R2_activate_skips_conta"), 1, "M pré-fix: 1×R2 detectada");
eq(countBy(before.rows, X.flowId, "R1_activate_to_sim"), 1, "X (fluxo futuro) pré-fix: 1×R1 detectada");

// ── 3. Migration de FIX (D/M somente) ────────────────────────────────────────
console.log("\nPasso 3: aplicar migration fix (cadastrar→conta de cadastro)");
await db.exec(fs.readFileSync(MIG_FIX, "utf8"));
ok("fix aplicado");

const after = await db.query(`SELECT flow_id, step_key, rule FROM audit_flow_activate_rules() ORDER BY flow_id, rule`);
console.log(`  → violações DEPOIS do fix: ${after.rows.length}`);
for (const r of after.rows) console.log(`     • ${r.step_key} [${r.rule}]`);
eq(countBy(after.rows, D.flowId, "R1_activate_to_sim") + countBy(after.rows, D.flowId, "R2_activate_skips_conta"), 0, "D pós-fix: 0 violações");
eq(countBy(after.rows, M.flowId, "R1_activate_to_sim") + countBy(after.rows, M.flowId, "R2_activate_skips_conta"), 0, "M pós-fix: 0 violações");
// X não é coberto pelo fix (keys próprias) — auditoria CONTINUA apontando:
eq(countBy(after.rows, X.flowId, "R1_activate_to_sim"), 1, "X pós-fix: auditoria ainda vigia fluxos futuros");

// ── 4. Nada foi apagado; destinos corretos ──────────────────────────────────
console.log("\nPasso 4: transitions preservadas + destinos corretos");
for (const [label, F] of [["D", D], ["M", M]]) {
  const cf = await db.query(
    `SELECT transitions FROM bot_flow_steps WHERE flow_id = $1 AND step_key = 'd_como_funciona'`,
    [F.flowId],
  );
  const trs = cf.rows[0].transitions;
  eq(trs.length, 3, `${label} d_como_funciona: 3 transitions preservadas`);
  const cad = trs.find((t) => t.trigger_intent === "cadastrar");
  eq(cad.goto_step_id, F.contaCad, `${label} d_como_funciona cadastrar → d_simular_pedir_conta`);
  const sim = trs.find((t) => t.trigger_intent === "simular");
  eq(sim.goto_step_id, F.contaSim, `${label} d_como_funciona simular → d_pedir_conta (INTACTA)`);

  const dv = await db.query(
    `SELECT transitions FROM bot_flow_steps WHERE flow_id = $1 AND step_key = 'd_duvidas'`,
    [F.flowId],
  );
  const dtrs = dv.rows[0].transitions;
  eq(dtrs.length, 2, `${label} d_duvidas: 2 transitions preservadas`);
  const dcad = dtrs.find((t) => t.trigger_intent === "cadastrar");
  eq(dcad.goto_step_id, F.contaCad, `${label} d_duvidas cadastrar → d_simular_pedir_conta`);
  const hum = dtrs.find((t) => t.trigger_intent === "humano");
  eq(hum.goto_special, "humano", `${label} d_duvidas humano → INTACTA`);
}

// Fluxo X (futuro) NÃO foi tocado pelo fix (é escopo D/M por step_key d_*)
const xMenu = await db.query(
  `SELECT transitions FROM bot_flow_steps WHERE flow_id = $1 AND step_key = 'x_menu'`,
  [X.flowId],
);
eq(xMenu.rows[0].transitions[0].goto_step_id, X.contaSim, "X: fix não tocou fluxo de keys próprias (auditoria/motor cobrem)");

console.log(
  process.exitCode
    ? "\n\x1b[31mFALHOU — reveja acima.\x1b[0m"
    : "\n\x1b[32mTUDO OK — migrations validadas em Postgres embutido, produção intocada.\x1b[0m",
);
