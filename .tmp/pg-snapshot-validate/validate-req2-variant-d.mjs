// Feature: evolution-multiconsultor-pronto, Property 3: Consultor novo nasce
// provisionado na variante D — para qualquer consultor recém-criado, após o
// provisionamento (trigger -> seed_default_camila_flow), existe exatamente um
// bot_flow ativo com variant = 'D' e consultants.active_variants inclui 'D';
// re-executar o seed para o mesmo consultor não cria fluxo adicional
// (idempotência) e não altera linhas de consultores pré-existentes.
//
// Validates: Requirements 2.1, 2.2, 2.3 (Properties: 3) — Tarefa 4.3.
//
// INTEGRATION TEST contra um banco ISOLADO (PGlite / Postgres embarcado em
// WASM), seguindo exatamente o padrão documentado em
// .kiro/specs/flow-diagram-view/migration-15-3-validation.md e implementado em
// .tmp/pg-snapshot-validate/validate.mjs. NÃO toca produção.
//
// O script:
//   0. Sobe um Postgres efêmero (PGlite) e recria o schema relevante como na
//      base ativa: consultants (active_variants DEFAULT ARRAY['A']), bot_flows
//      (variant DEFAULT 'A', CHECK A..E), bot_flow_steps, o índice único
//      parcial uniq_bot_flows_active_per_consultant_variant, a função de seed
//      (corpo ANTERIOR à migração, INSERT sem variant) e o trigger
//      trg_seed_camila_flow + seed_camila_flow_on_consultant_insert.
//   1. Semeia uma linha "Rafael-like" (id 0c2711ad-...-698ae3) com fluxos
//      A/B/D ativos ANTES da migração e tira um snapshot (consultant + flows).
//   2. Aplica o CORPO REAL da migração forward
//      20260601030000_req2_seed_default_camila_flow_variant_d.sql.
//   3. Re-snapshot do Rafael -> afirma byte-idêntico (nenhum backfill rodou).
//   4. Insere um consultor NOVO -> trigger -> seed -> afirma exatamente 1
//      bot_flow ativo variant='D' e active_variants contém 'D'.
//   5. Idempotência: re-chama seed_default_camila_flow para o mesmo consultor
//      -> nenhum fluxo/passo adicional.
//   6. Aplica o ROLLBACK (verbatim de rollback/req2-rollback.md) no banco
//      isolado -> confirma que a função não grava mais variant no INSERT e que
//      o DEFAULT da coluna voltou para ARRAY['A'].

import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const FORWARD_MIGRATION_PATH = path.join(
  REPO_ROOT,
  "supabase/migrations/20260601030000_req2_seed_default_camila_flow_variant_d.sql"
);

const RAFAEL_ID = "0c2711ad-4836-41e6-afba-edd94f698ae3";

const ok = (label) => console.log(`  \x1b[32mOK\x1b[0m ${label}`);
const fail = (label, err) => {
  console.error(`  \x1b[31mFAIL\x1b[0m ${label}: ${err}`);
  process.exitCode = 1;
};
const assert = (cond, label, detail = "") => {
  if (cond) ok(label);
  else fail(label, detail || "expected true");
};
const eq = (actual, expected, label) =>
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    label,
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
  );

// ---------------------------------------------------------------------------
// Corpo ANTERIOR (pré-migração) da função de seed — verbatim de
// rollback/req2-backup.md. O INSERT INTO public.bot_flows NÃO especifica
// variant (o fluxo nasce com o default da coluna, 'A').
// ---------------------------------------------------------------------------
const SEED_FN_PRE_MIGRATION = `
CREATE OR REPLACE FUNCTION public.seed_default_camila_flow(_consultant_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_flow_id uuid;
  v_step_count int;
  s1 uuid; s2 uuid; s3 uuid; s4 uuid; s5 uuid; s6 uuid;
BEGIN
  SELECT id INTO v_flow_id
    FROM public.bot_flows
   WHERE consultant_id = _consultant_id AND is_active = true
   ORDER BY created_at ASC
   LIMIT 1;

  IF v_flow_id IS NULL THEN
    INSERT INTO public.bot_flows (consultant_id, name, is_active, strict_mode)
    VALUES (_consultant_id, 'Fluxo da Camila', true, false)
    RETURNING id INTO v_flow_id;
  END IF;

  SELECT count(*) INTO v_step_count FROM public.bot_flow_steps WHERE flow_id = v_flow_id;
  IF v_step_count > 0 THEN RETURN v_flow_id; END IF;

  s1 := gen_random_uuid(); s2 := gen_random_uuid(); s3 := gen_random_uuid();
  s4 := gen_random_uuid(); s5 := gen_random_uuid(); s6 := gen_random_uuid();

  INSERT INTO public.bot_flow_steps
    (id, flow_id, position, step_type, step_key, title, summary, icon,
     message_text, slot_key, transitions, is_active)
  VALUES
    (s1, v_flow_id, 1, 'message', 'welcome', 'Boas-vindas', 'Primeira mensagem', 'sparkle',
     'Oi {{nome}}', 'boas_vindas',
     jsonb_build_array(
       jsonb_build_object('trigger_intent','afirmacao','trigger_phrases',jsonb_build_array('sim'),'goto_step_id', s2,'goto_special',null)
     ), true),
    (s2, v_flow_id, 2, 'message', 'qualificacao', 'Qualif', 'Manda video', 'video',
     'Qual a conta?', 'explainer',
     jsonb_build_array(
       jsonb_build_object('trigger_intent','default','trigger_phrases',jsonb_build_array(),'goto_step_id', s2,'goto_special','repeat')
     ), true),
    (s3, v_flow_id, 3, 'message', 'checkin_pos_video', 'Check-in', 'Confere video', 'msg',
     'Que otimo {{nome}}', 'checkin', '[]'::jsonb, true),
    (s4, v_flow_id, 4, 'message', 'pitch_conexao_club', 'Pitch', 'Cashback', 'video',
     'Olha so', 'club', '[]'::jsonb, true),
    (s5, v_flow_id, 5, 'message', 'duvidas_pos_club', 'Duvidas', 'Final', 'msg',
     'Pode perguntar', 'duvidas', '[]'::jsonb, true),
    (s6, v_flow_id, 6, 'message', 'cadastro', 'Cadastro', 'Pedir conta', 'file',
     'Foto da conta', 'cadastro_pedir_conta', '[]'::jsonb, true);

  RETURN v_flow_id;
END;
$function$;
`;

// ---------------------------------------------------------------------------
// ROLLBACK — verbatim de rollback/req2-rollback.md (Passos 1 e 2). Restaura o
// corpo da função (INSERT sem variant) e o DEFAULT da coluna para ARRAY['A'].
// (Reaproveita SEED_FN_PRE_MIGRATION, que é exatamente o corpo anterior.)
// ---------------------------------------------------------------------------
const ROLLBACK_SQL = `
${SEED_FN_PRE_MIGRATION}
ALTER TABLE public.consultants ALTER COLUMN active_variants SET DEFAULT ARRAY['A'::text];
`;

console.log("== Validate REQ 2 (seed variante D) — Property 3 on isolated DB ==\n");

const db = new PGlite();
await db.waitReady;

// 0. Setup: snapshot schema (auth stub, consultants, bot_flows, bot_flow_steps,
//    constraint, seed function PRE-migration, trigger).
console.log("Step 0: build snapshot schema (consultants, bot_flows, bot_flow_steps, constraint, seed fn, trigger)");

await db.exec(`
  CREATE ROLE authenticated NOINHERIT;
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT current_setting('request.jwt.claim.sub', true)::uuid
  $$;

  CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql AS $$
  BEGIN NEW.updated_at = now(); RETURN NEW; END;
  $$;

  -- consultants: apenas as colunas relevantes; active_variants DEFAULT ARRAY['A']
  -- (FK para auth.users removida no snapshot — não há tabela auth.users).
  CREATE TABLE public.consultants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    license text UNIQUE NOT NULL,
    phone text NOT NULL,
    cadastro_url text NOT NULL,
    photo_url text,
    igreen_id text,
    created_at timestamptz DEFAULT now(),
    ab_test_enabled boolean NOT NULL DEFAULT false,
    ab_test_counter int NOT NULL DEFAULT 0,
    active_variants text[] NOT NULL DEFAULT ARRAY['A'::text]
  );
  ALTER TABLE public.consultants ENABLE ROW LEVEL SECURITY;

  CREATE TABLE public.bot_flows (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    consultant_id uuid NOT NULL,
    name text NOT NULL DEFAULT 'Fluxo sem nome',
    is_active boolean NOT NULL DEFAULT false,
    strict_mode boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    variant text NOT NULL DEFAULT 'A' CHECK (variant = ANY (ARRAY['A','B','C','D','E']))
  );

  -- Índice único parcial verificado: no máximo 1 fluxo ATIVO por (consultor, variante).
  CREATE UNIQUE INDEX uniq_bot_flows_active_per_consultant_variant
    ON public.bot_flows (consultant_id, variant)
    WHERE is_active = true;

  CREATE TABLE public.bot_flow_steps (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    flow_id uuid NOT NULL REFERENCES public.bot_flows(id) ON DELETE CASCADE,
    position integer NOT NULL DEFAULT 0,
    step_type text NOT NULL,
    slot_key text,
    message_text text,
    wait_for text NOT NULL DEFAULT 'none',
    wait_seconds integer NOT NULL DEFAULT 0,
    condition_text text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    title text,
    summary text,
    icon text NOT NULL DEFAULT 'msg',
    is_active boolean NOT NULL DEFAULT true,
    step_key text,
    media_order jsonb NOT NULL DEFAULT '["audio", "image", "video", "text"]'::jsonb,
    transitions jsonb NOT NULL DEFAULT '[]'::jsonb,
    captures jsonb NOT NULL DEFAULT '[]'::jsonb,
    fallback jsonb NOT NULL DEFAULT '{"mode": "repeat"}'::jsonb,
    text_delay_ms integer NOT NULL DEFAULT 1500,
    auto_detect_doc_type boolean NOT NULL DEFAULT true,
    persuasive_text text
  );

  DROP TRIGGER IF EXISTS trg_bot_flows_updated_at ON public.bot_flows;
  CREATE TRIGGER trg_bot_flows_updated_at
    BEFORE UPDATE ON public.bot_flows
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
`);

// Função de seed no estado ANTERIOR à migração (INSERT sem variant).
await db.exec(SEED_FN_PRE_MIGRATION);

// Trigger de provisionamento no INSERT de consultants (verbatim de 20260515102705).
await db.exec(`
  CREATE OR REPLACE FUNCTION public.seed_camila_flow_on_consultant_insert()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $$
  BEGIN
    PERFORM public.seed_default_camila_flow(NEW.id);
    RETURN NEW;
  END;
  $$;

  DROP TRIGGER IF EXISTS trg_seed_camila_flow ON public.consultants;
  CREATE TRIGGER trg_seed_camila_flow
    AFTER INSERT ON public.consultants
    FOR EACH ROW EXECUTE FUNCTION public.seed_camila_flow_on_consultant_insert();
`);

// Baseline da definição da função pré-migração (para diferenciar do rollback).
const seedDefPre = (await db.query(
  `SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.proname='seed_default_camila_flow' AND n.nspname='public';`
)).rows[0].def;
const defaultPre = (await db.query(
  `SELECT pg_get_expr(ad.adbin, ad.adrelid) AS d FROM pg_attribute a
     JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
     LEFT JOIN pg_attrdef ad ON ad.adrelid=a.attrelid AND ad.adnum=a.attnum
    WHERE n.nspname='public' AND c.relname='consultants' AND a.attname='active_variants';`
)).rows[0].d;
console.log(`  baseline: seed INSERT sem variant; active_variants DEFAULT = ${defaultPre}\n`);

// 1. Semeia "Rafael" com A/B/D ANTES da migração e tira snapshot.
console.log("Step 1: seed Rafael (A/B/D ativos) ANTES da migração + snapshot");
// Insere Rafael com active_variants explícito A/B/D. O trigger AFTER INSERT
// dispara o seed -> cria o fluxo 'A' (variant default, pré-migração).
await db.query(
  `INSERT INTO public.consultants (id, name, license, phone, cadastro_url, active_variants)
   VALUES ($1, 'Rafael', 'LIC-RAFAEL', '5511999999999', 'https://x/rafael', ARRAY['A','B','D']::text[]);`,
  [RAFAEL_ID]
);
// Adiciona os fluxos ativos B e D do Rafael (o A já veio do seed do trigger).
await db.query(
  `INSERT INTO public.bot_flows (consultant_id, name, variant, is_active, strict_mode)
   VALUES ($1, 'Fluxo Rafael B', 'B', true, false), ($1, 'Fluxo Rafael D', 'D', true, false);`,
  [RAFAEL_ID]
);

const snapRafael = async () => {
  const consultant = (await db.query(
    `SELECT row_to_json(c) AS j FROM (
       SELECT id, name, license, phone, cadastro_url, photo_url, igreen_id,
              created_at, ab_test_enabled, ab_test_counter, active_variants
         FROM public.consultants WHERE id = $1
     ) c;`,
    [RAFAEL_ID]
  )).rows[0].j;
  const flows = (await db.query(
    `SELECT COALESCE(json_agg(row_to_json(f) ORDER BY f.variant, f.created_at), '[]'::json) AS j FROM (
       SELECT id, consultant_id, name, variant, is_active, strict_mode, created_at
         FROM public.bot_flows WHERE consultant_id = $1
     ) f;`,
    [RAFAEL_ID]
  )).rows[0].j;
  return JSON.stringify({ consultant, flows });
};

const rafaelBefore = await snapRafael();
const rafaelFlowCountBefore = (await db.query(
  `SELECT count(*)::int AS n FROM public.bot_flows WHERE consultant_id = $1;`,
  [RAFAEL_ID]
)).rows[0].n;
eq(rafaelFlowCountBefore, 3, "Rafael possui 3 fluxos ativos (A/B/D) antes da migração");
console.log("");

// 2. Aplica o CORPO REAL da migração forward.
console.log("Step 2: aplica a migração forward 20260601030000_req2_seed_default_camila_flow_variant_d.sql");
const forwardSql = fs.readFileSync(FORWARD_MIGRATION_PATH, "utf-8");
await db.exec(forwardSql);
ok("migração aplicada sem erro");
// Idempotência da própria migração (CREATE OR REPLACE + ALTER ... SET DEFAULT).
await db.exec(forwardSql);
ok("migração é idempotente (segunda execução sem erro)");

// Static check: a migração NÃO contém bloco de backfill de todos os consultores.
// Remove comentários SQL de linha (-- ...) antes de testar, pois o cabeçalho da
// migração MENCIONA o backfill apenas para documentar que ele NÃO é replicado.
const forwardSqlNoComments = forwardSql
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");
const hasBackfill = /FOR\s+r\s+IN\s+SELECT\s+id\s+FROM\s+public\.consultants/i.test(forwardSqlNoComments)
  || /seed_default_camila_flow\(r\.id\)/i.test(forwardSqlNoComments);
assert(!hasBackfill, "migração NÃO replica backfill de todos os consultores (escopo: novos apenas)");
console.log("");

// 3. Rafael inalterado: snapshot pós-migração byte-idêntico ao pré.
console.log("Step 3: Rafael inalterado (snapshot pré/pós migração byte-idêntico)");
const rafaelAfter = await snapRafael();
assert(rafaelAfter === rafaelBefore, "linhas do Rafael byte-idênticas pré/pós migração (nenhum backfill rodou)",
  "snapshot divergente");
const rafaelFlowCountAfter = (await db.query(
  `SELECT count(*)::int AS n FROM public.bot_flows WHERE consultant_id = $1;`,
  [RAFAEL_ID]
)).rows[0].n;
eq(rafaelFlowCountAfter, rafaelFlowCountBefore, "contagem de fluxos do Rafael inalterada (sem inserções)");
console.log("");

// 4. Consultor NOVO nasce na variante D.
console.log("Step 4: consultor NOVO nasce na variante D (Property 3 / Req 2.1, 2.2)");
const NEW_ID = "22222222-2222-2222-2222-222222222222";
// Não especifica active_variants -> recebe o DEFAULT pós-migração (ARRAY['D']).
await db.query(
  `INSERT INTO public.consultants (id, name, license, phone, cadastro_url)
   VALUES ($1, 'Consultor Novo', 'LIC-NOVO', '5511888888888', 'https://x/novo');`,
  [NEW_ID]
);

const newActiveFlows = (await db.query(
  `SELECT id, variant, is_active FROM public.bot_flows
    WHERE consultant_id = $1 AND is_active = true;`,
  [NEW_ID]
)).rows;
eq(newActiveFlows.length, 1, "(2.1) consultor novo tem exatamente 1 bot_flow ativo");
eq(newActiveFlows[0]?.variant, "D", "(2.1) o bot_flow ativo do consultor novo é variant='D'");

const newActiveVariants = (await db.query(
  `SELECT active_variants FROM public.consultants WHERE id = $1;`,
  [NEW_ID]
)).rows[0].active_variants;
assert(
  Array.isArray(newActiveVariants) && newActiveVariants.includes("D"),
  "(2.2) consultants.active_variants do consultor novo contém 'D'",
  `active_variants = ${JSON.stringify(newActiveVariants)}`
);

// O fluxo semeado tem os 6 passos esperados.
const newSteps = (await db.query(
  `SELECT count(*)::int AS n FROM public.bot_flow_steps WHERE flow_id = $1;`,
  [newActiveFlows[0].id]
)).rows[0].n;
eq(newSteps, 6, "(2.1) fluxo semeado do consultor novo tem 6 passos");
console.log("");

// 5. Idempotência: re-chamar o seed não cria fluxo/passo adicional.
console.log("Step 5: idempotência — re-chamar seed_default_camila_flow para o mesmo consultor");
const seededFlowId = newActiveFlows[0].id;
const reseed = (await db.query(
  `SELECT public.seed_default_camila_flow($1) AS flow_id;`,
  [NEW_ID]
)).rows[0].flow_id;
eq(reseed, seededFlowId, "(2.3) re-chamada retorna o MESMO flow_id (reuso de fluxo ativo)");
const newFlowCountAfterReseed = (await db.query(
  `SELECT count(*)::int AS n FROM public.bot_flows WHERE consultant_id = $1;`,
  [NEW_ID]
)).rows[0].n;
eq(newFlowCountAfterReseed, 1, "(2.3) re-chamada NÃO cria fluxo adicional");
const newStepsAfterReseed = (await db.query(
  `SELECT count(*)::int AS n FROM public.bot_flow_steps WHERE flow_id = $1;`,
  [seededFlowId]
)).rows[0].n;
eq(newStepsAfterReseed, 6, "(2.3) re-chamada NÃO duplica passos");
console.log("");

// 6. Rollback no banco isolado -> função/coluna restauradas.
console.log("Step 6: rollback (rollback/req2-rollback.md) -> função/coluna restauradas");
await db.exec(ROLLBACK_SQL);

const seedDefAfterRollback = (await db.query(
  `SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.proname='seed_default_camila_flow' AND n.nspname='public';`
)).rows[0].def;
assert(
  /INSERT INTO public\.bot_flows \(consultant_id, name, is_active, strict_mode\)/.test(seedDefAfterRollback)
    && !/INSERT INTO public\.bot_flows \(consultant_id, name, variant, is_active, strict_mode\)/.test(seedDefAfterRollback),
  "rollback: o INSERT da função NÃO grava mais variant",
  "função ainda contém variant no INSERT"
);
eq(seedDefAfterRollback, seedDefPre, "rollback: corpo da função byte-idêntico ao estado pré-migração");

const defaultAfterRollback = (await db.query(
  `SELECT pg_get_expr(ad.adbin, ad.adrelid) AS d FROM pg_attribute a
     JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
     LEFT JOIN pg_attrdef ad ON ad.adrelid=a.attrelid AND ad.adnum=a.attnum
    WHERE n.nspname='public' AND c.relname='consultants' AND a.attname='active_variants';`
)).rows[0].d;
eq(defaultAfterRollback, defaultPre, "rollback: DEFAULT de active_variants restaurado para ARRAY['A'::text]");

// Confirmação empírica: consultor inserido APÓS o rollback volta a nascer em 'A'.
const POST_ROLLBACK_ID = "33333333-3333-3333-3333-333333333333";
await db.query(
  `INSERT INTO public.consultants (id, name, license, phone, cadastro_url)
   VALUES ($1, 'Consultor Pos-Rollback', 'LIC-POS', '5511777777777', 'https://x/pos');`,
  [POST_ROLLBACK_ID]
);
const postRollbackFlow = (await db.query(
  `SELECT variant FROM public.bot_flows WHERE consultant_id = $1 AND is_active = true;`,
  [POST_ROLLBACK_ID]
)).rows;
eq(postRollbackFlow.length, 1, "rollback: consultor pós-rollback tem 1 fluxo ativo");
eq(postRollbackFlow[0]?.variant, "A", "rollback: consultor pós-rollback volta a nascer em variant='A'");
const postRollbackVariants = (await db.query(
  `SELECT active_variants FROM public.consultants WHERE id = $1;`,
  [POST_ROLLBACK_ID]
)).rows[0].active_variants;
eq(postRollbackVariants, ["A"], "rollback: active_variants pós-rollback volta a ser ARRAY['A']");

console.log("\n== validation complete ==");
if (process.exitCode === 1) {
  console.error("\nVALIDATION FAILED");
} else {
  console.log("\nALL ASSERTIONS PASSED");
}
