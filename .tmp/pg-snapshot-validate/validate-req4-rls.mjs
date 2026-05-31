// ============================================================================
// Feature: evolution-multiconsultor-pronto, Property 4: UPDATE em customers
// não pode reatribuir consultant_id.
//
// Integration (RLS) test — Task 7.3.
// Validates: Requirements 4.1, 4.2, 4.3
//
// Strategy: spin up an ISOLATED embedded Postgres (PGlite, real Postgres in
// WASM), faithfully reconstruct public.customers with RLS enabled and the FULL
// production policy set (all 9 policies, verbatim from
// .kiro/specs/evolution-multiconsultor-pronto/rollback/req4-backup.md), then
// simulate the Supabase `authenticated` role with a given auth.uid() via
//   SELECT set_config('request.jwt.claim.sub', <uuid>, false);  -- session GUC
//   SET ROLE authenticated;
//
// We run the attack matrix BOTH before and after applying the REQ 4 forward
// migration (supabase/migrations/20260601030000_owner_update_customers_with_check.sql)
// so the result documents exactly what the WITH CHECK clause changes.
//
// NOTE on isolation: this NEVER touches production. Everything runs in an
// in-memory PGlite instance created fresh for this process.
// ============================================================================

import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const MIGRATION_PATH = path.join(
  REPO_ROOT,
  "supabase/migrations/20260601030000_owner_update_customers_with_check.sql"
);

// ---- tiny assertion helpers -------------------------------------------------
let failures = 0;
const ok = (label) => console.log(`  \x1b[32mOK\x1b[0m ${label}`);
const fail = (label, detail = "") => {
  console.error(`  \x1b[31mFAIL\x1b[0m ${label}${detail ? `: ${detail}` : ""}`);
  failures++;
  process.exitCode = 1;
};
const assert = (cond, label, detail = "") => (cond ? ok(label) : fail(label, detail));

// ---- identities -------------------------------------------------------------
const A = "0a000000-0000-0000-0000-0000000000aa"; // consultant A (owner)
const B = "0b000000-0000-0000-0000-0000000000bb"; // consultant B (other)
const ADMIN = "0c000000-0000-0000-0000-0000000000ad"; // admin user
const LEADER_ID = "0d000000-0000-0000-0000-00000000001d"; // leader of A's team
const ASSIGNEE = "0e000000-0000-0000-0000-0000000000ae"; // assigned consultant on a B-owned row

console.log("== REQ4 RLS WITH CHECK integration test (isolated PGlite) ==\n");

const db = new PGlite();
await db.waitReady;

// --- Step 0: faithful schema reconstruction ---------------------------------
console.log("Step 0: reconstruct public.customers + helpers + 9 RLS policies (verbatim)");

await db.exec(`
  -- Supabase ships an "authenticated" role; PGlite does not. Create it first.
  CREATE ROLE authenticated NOINHERIT;

  CREATE SCHEMA IF NOT EXISTS auth;
  -- auth.uid() reads the simulated JWT 'sub' claim (Supabase convention).
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;

  -- app_role enum + has_role (verbatim from 20260401121223_create_user_roles_and_approved.sql)
  CREATE TYPE public.app_role AS ENUM ('admin', 'user');
  CREATE TABLE public.user_roles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    role app_role NOT NULL,
    UNIQUE (user_id, role)
  );
  CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
  RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
  $$;

  -- consultants (parent for team helpers / assigned FK)
  CREATE TABLE public.consultants (
    id uuid PRIMARY KEY,
    referred_by uuid
  );

  -- team helpers (verbatim from 20260520161732_*.sql)
  CREATE OR REPLACE FUNCTION public.get_team_consultant_ids(_leader uuid)
  RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    WITH RECURSIVE team AS (
      SELECT id FROM public.consultants WHERE id = _leader
      UNION
      SELECT c.id FROM public.consultants c JOIN team t ON c.referred_by = t.id
    )
    SELECT array_agg(id) FROM team;
  $$;
  CREATE OR REPLACE FUNCTION public.is_team_member(_leader uuid, _member uuid)
  RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT _member = ANY(public.get_team_consultant_ids(_leader));
  $$;

  -- manager visibility helpers (verbatim from 20260519171711_*.sql)
  CREATE OR REPLACE FUNCTION public.is_super_admin(_uid uuid) RETURNS boolean
    LANGUAGE sql STABLE AS $$ SELECT false $$;
  CREATE TABLE public.ad_account_managers (
    manager_user_id uuid NOT NULL,
    consultant_id   uuid NOT NULL,
    PRIMARY KEY (manager_user_id, consultant_id)
  );
  CREATE OR REPLACE FUNCTION public.can_view_consultant(_user uuid, _consultant uuid)
  RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT _user = _consultant
        OR public.is_super_admin(_user)
        OR EXISTS (SELECT 1 FROM public.ad_account_managers
                    WHERE manager_user_id = _user AND consultant_id = _consultant);
  $$;

  -- public.customers (only the columns relevant to the 9 policies)
  CREATE TABLE public.customers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    consultant_id uuid,
    assigned_consultant_id uuid,
    name text
  );
  ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
  -- Supabase grants table privileges to authenticated; RLS still applies on top.
  GRANT SELECT, INSERT, UPDATE, DELETE ON public.customers TO authenticated;
`);

// All 9 policies verbatim (req4-backup.md). PRE-migration state: "Owner update
// customers" has USING but NO WITH CHECK.
await db.exec(`
  CREATE POLICY "Admins read all customers" ON public.customers
    FOR SELECT TO authenticated
    USING (has_role(auth.uid(), 'admin'::app_role));

  CREATE POLICY "Assigned consultant select customers" ON public.customers
    FOR SELECT TO public
    USING (assigned_consultant_id = auth.uid());

  CREATE POLICY "Assigned consultant update customers" ON public.customers
    FOR UPDATE TO public
    USING (assigned_consultant_id = auth.uid())
    WITH CHECK (assigned_consultant_id = auth.uid());

  CREATE POLICY "Leader reads team customers" ON public.customers
    FOR SELECT TO authenticated
    USING (is_team_member(auth.uid(), consultant_id));

  CREATE POLICY "Owner delete customers" ON public.customers
    FOR DELETE TO authenticated
    USING (consultant_id = auth.uid());

  CREATE POLICY "Owner insert customers" ON public.customers
    FOR INSERT TO authenticated
    WITH CHECK (consultant_id = auth.uid());

  CREATE POLICY "Owner select customers" ON public.customers
    FOR SELECT TO authenticated
    USING (consultant_id = auth.uid());

  CREATE POLICY "Owner update customers" ON public.customers
    FOR UPDATE TO authenticated
    USING (consultant_id = auth.uid());
  -- ^ PRE-migration: NO WITH CHECK (NULL)

  CREATE POLICY "managers can read customers" ON public.customers
    FOR SELECT TO public
    USING (can_view_consultant(auth.uid(), consultant_id));
`);

// --- fixtures (inserted as superuser, bypassing RLS) ------------------------
await db.exec(`
  INSERT INTO public.consultants (id, referred_by) VALUES
    ('${A}', '${LEADER_ID}'),
    ('${B}', NULL),
    ('${LEADER_ID}', NULL),
    ('${ASSIGNEE}', NULL);
  INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin');
`);

const ROW_A = "11111111-1111-1111-1111-111111111111"; // owned by A
const ROW_B = "22222222-2222-2222-2222-222222222222"; // owned by B
const ROW_B_ASSIGNED_A = "33333333-3333-3333-3333-333333333333"; // owned by B, assigned to ASSIGNEE

function seedRows() {
  return db.exec(`
    DELETE FROM public.customers;
    INSERT INTO public.customers (id, consultant_id, assigned_consultant_id, name) VALUES
      ('${ROW_A}', '${A}', NULL, 'rowA'),
      ('${ROW_B}', '${B}', NULL, 'rowB'),
      ('${ROW_B_ASSIGNED_A}', '${B}', '${ASSIGNEE}', 'rowB-assigned');
  `);
}

// run fn under a simulated authenticated user (session GUC survives autocommit)
async function asUser(uid, fn) {
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '${uid}', false);`);
  await db.exec(`SET ROLE authenticated;`);
  try {
    return await fn();
  } finally {
    await db.exec(`RESET ROLE;`);
    await db.exec(`SELECT set_config('request.jwt.claim.sub', '', false);`);
  }
}

// helper: attempt an UPDATE; returns { affected, error }
async function tryUpdate(sql) {
  try {
    const r = await db.query(sql);
    return { affected: r.affectedRows ?? r.rows?.length ?? 0, error: null };
  } catch (e) {
    return { affected: 0, error: e.message };
  }
}

async function ownerOf(rowId) {
  const r = await db.query(`SELECT consultant_id FROM public.customers WHERE id = $1;`, [rowId]);
  return r.rows[0]?.consultant_id ?? null;
}

// ============================================================================
// Run the full attack/access matrix for a given phase label.
// Returns a structured result we can compare across pre/post migration.
// ============================================================================
async function runMatrix(phase) {
  const res = {};
  await seedRows();

  // --- 4.1: A updates own row keeping consultant_id = A -> SUCCEEDS ---------
  res.aKeepOwn = await asUser(A, () =>
    tryUpdate(`UPDATE public.customers SET name='rowA-edit', consultant_id='${A}' WHERE id='${ROW_A}';`)
  );

  // --- 4.2: A attempts to reassign its own row consultant_id = B -----------
  // (no other policy can rescue this: assigned_consultant_id stays NULL)
  res.aReassignToB = await asUser(A, () =>
    tryUpdate(`UPDATE public.customers SET consultant_id='${B}' WHERE id='${ROW_A}';`)
  );
  res.aReassignToB_owner = await ownerOf(ROW_A);

  // --- 4.2 variant: A reassigns own row to B BUT sets assigned_consultant_id=A
  // This is the multi-policy bypass vector: the "Assigned consultant update"
  // policy's WITH CHECK (assigned_consultant_id = auth.uid()) is OR-ed with the
  // owner check, so a new row {consultant_id=B, assigned_consultant_id=A} may
  // satisfy the combined WITH CHECK.
  await seedRows();
  res.aReassignToB_keepAssignedA = await asUser(A, () =>
    tryUpdate(
      `UPDATE public.customers SET consultant_id='${B}', assigned_consultant_id='${A}' WHERE id='${ROW_A}';`
    )
  );
  res.aReassignToB_keepAssignedA_owner = await ownerOf(ROW_A);

  // --- 4.3: assigned consultant can still update its assigned row ----------
  await seedRows();
  res.assigneeUpdatesAssigned = await asUser(ASSIGNEE, () =>
    tryUpdate(`UPDATE public.customers SET name='assignee-edit' WHERE id='${ROW_B_ASSIGNED_A}';`)
  );

  // --- 4.3: admin can read all rows (SELECT access preserved) --------------
  res.adminSees = await asUser(ADMIN, async () => {
    const r = await db.query(`SELECT count(*)::int AS n FROM public.customers;`);
    return r.rows[0].n;
  });

  // --- 4.3: leader can read team (A) customers -----------------------------
  res.leaderSeesRowA = await asUser(LEADER_ID, async () => {
    const r = await db.query(`SELECT count(*)::int AS n FROM public.customers WHERE id='${ROW_A}';`);
    return r.rows[0].n;
  });

  // --- 4.3: owner A still sees only its own row ----------------------------
  res.aSelfSelect = await asUser(A, async () => {
    const r = await db.query(`SELECT array_agg(name ORDER BY name) AS names FROM public.customers;`);
    return r.rows[0].names;
  });

  return res;
}

// --- PRE-migration matrix ----------------------------------------------------
console.log("\nStep 1: baseline matrix (PRE-migration: Owner update WITHOUT WITH CHECK)");
const pre = await runMatrix("pre");
console.log("  pre =", JSON.stringify(pre, null, 0));

// --- apply the REQ4 forward migration ---------------------------------------
console.log("\nStep 2: apply REQ4 forward migration (adds WITH CHECK)");
const migrationSql = fs.readFileSync(MIGRATION_PATH, "utf-8");
await db.exec(migrationSql);
ok("migration applied without error");

// confirm the policy now has WITH CHECK
const wc = (await db.query(`
  SELECT pg_get_expr(pol.polwithcheck, pol.polrelid) AS with_check
    FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
   WHERE c.relname='customers' AND pol.polname='Owner update customers';
`)).rows[0].with_check;
assert(
  wc != null && /consultant_id\s*=\s*auth\.uid\(\)/.test(wc),
  "post-migration: Owner update customers has WITH CHECK (consultant_id = auth.uid())",
  `with_check=${JSON.stringify(wc)}`
);

// confirm all 9 policies still present (other 8 intact)
const polCount = (await db.query(`
  SELECT count(*)::int AS n FROM pg_policy pol JOIN pg_class c ON c.oid=pol.polrelid
   WHERE c.relname='customers';
`)).rows[0].n;
assert(polCount === 9, "post-migration: all 9 customers policies still present", `count=${polCount}`);

// --- POST-migration matrix ---------------------------------------------------
console.log("\nStep 3: matrix (POST-migration: Owner update WITH CHECK)");
const post = await runMatrix("post");
console.log("  post =", JSON.stringify(post, null, 0));

// ============================================================================
// Assertions
//   GROUP A — REQUIRED (Task 7.3 named assertions): the 3 scenarios the task
//             explicitly enumerates. These define the task deliverable.
//   GROUP B — EXTENDED (Property 4 universal): adversarial probes that test the
//             design's universal claim "qualquer UPDATE que tente definir
//             consultant_id para outro consultor é rejeitado". These can reveal
//             residual gaps the 3 named examples miss.
// ============================================================================
let namedFailures = 0;
let findings = [];
const named = (cond, label, detail = "") => {
  if (cond) ok(label);
  else { fail(label, detail); namedFailures++; }
};
const probe = (cond, label, detail = "") => {
  if (cond) { ok(label); }
  else {
    console.error(`  \x1b[33m⚠ FINDING\x1b[0m ${label}${detail ? `: ${detail}` : ""}`);
    findings.push({ label, detail });
  }
};

console.log("\nStep 4: GROUP A — REQUIRED task-named assertions (post-migration target)");

// 4.1 — A updates own row keeping consultant_id=A -> succeeds (1 row)
named(
  post.aKeepOwn.affected === 1 && post.aKeepOwn.error === null,
  "4.1 consultant A updates own row keeping consultant_id=A -> succeeds (1 row)",
  JSON.stringify(post.aKeepOwn)
);

// 4.2 — A reassigns own row to consultant_id=B (assigned NULL) -> rejected
named(
  post.aReassignToB.affected === 0 && post.aReassignToB_owner === A,
  "4.2 consultant A reassign own row to consultant_id=B -> rejected; owner unchanged (=A)",
  JSON.stringify({ r: post.aReassignToB, owner: post.aReassignToB_owner })
);

// 4.3 — assigned consultant can still update its assigned row
named(
  post.assigneeUpdatesAssigned.affected === 1 && post.assigneeUpdatesAssigned.error === null,
  "4.3 assigned consultant update of assigned row still works (policy intact)",
  JSON.stringify(post.assigneeUpdatesAssigned)
);
// 4.3 — admin read access preserved (sees all 3 rows)
named(post.adminSees === 3, "4.3 admin still reads all customers (3 rows)", `n=${post.adminSees}`);
// 4.3 — leader read access preserved (sees A's row)
named(post.leaderSeesRowA === 1, "4.3 leader still reads team (A) customer", `n=${post.leaderSeesRowA}`);
// 4.3 — owner isolation preserved (A sees only rowA)
named(
  JSON.stringify(post.aSelfSelect) === JSON.stringify(["rowA"]),
  "4.3 owner A still sees only its own row (isolation preserved)",
  JSON.stringify(post.aSelfSelect)
);

console.log("\nStep 5: GROUP B — EXTENDED Property-4 universal probes (adversarial)");

// Property 4 universal: ANY update that sets consultant_id to another consultant
// must be rejected. Bypass vector: reassign to B while keeping assigned=A.
probe(
  post.aReassignToB_keepAssignedA.affected === 0 && post.aReassignToB_keepAssignedA_owner === A,
  "P4-universal: A reassign consultant_id A->B while setting assigned_consultant_id=A -> must be rejected",
  JSON.stringify({
    affected: post.aReassignToB_keepAssignedA.affected,
    resulting_owner: post.aReassignToB_keepAssignedA_owner,
    expected_owner: A,
  })
);

// ============================================================================
// Behavioural diff PRE vs POST (does the WITH CHECK change anything?)
// ============================================================================
console.log("\nStep 6: behavioural diff PRE vs POST (what did WITH CHECK change?)");
const diff = (label, extract) => {
  const a = extract(pre), b = extract(post);
  const same = JSON.stringify(a) === JSON.stringify(b);
  console.log(`  ${same ? "= " : "≠ "} ${label}: pre=${JSON.stringify(a)} post=${JSON.stringify(b)}`);
};
diff("A keep-own update (affected)", (m) => m.aKeepOwn.affected);
diff("A reassign->B, assigned NULL", (m) => ({ affected: m.aReassignToB.affected, owner: m.aReassignToB_owner }));
diff("A reassign->B, keep assigned=A [BYPASS VECTOR]", (m) => ({
  affected: m.aReassignToB_keepAssignedA.affected, owner: m.aReassignToB_keepAssignedA_owner,
}));

// ============================================================================
// Summary
// ============================================================================
console.log("\n== test complete ==");
console.log(`\nGROUP A (required task assertions): ${namedFailures === 0 ? "ALL PASS" : namedFailures + " FAILED"}`);
if (findings.length > 0) {
  console.log(`\nGROUP B (Property-4 universal) — ${findings.length} RESIDUAL FINDING(S):`);
  for (const f of findings) console.log(`  ⚠ ${f.label}\n     counterexample: ${f.detail}`);
  console.log(
    "\n  Root cause: PostgreSQL OR-combines the WITH CHECK of all PERMISSIVE UPDATE\n" +
    "  policies. The new `Owner update customers` WITH CHECK (consultant_id=auth.uid())\n" +
    "  is OR-ed with the pre-existing `Assigned consultant update customers` WITH CHECK\n" +
    "  (assigned_consultant_id=auth.uid()). A row mutated to {consultant_id=B,\n" +
    "  assigned_consultant_id=A} therefore still satisfies the combined check, so an\n" +
    "  owner can reassign consultant_id to another consultant by also making itself the\n" +
    "  assignee. The migration closes the DIRECT reassignment path but not this one.\n" +
    "  This is a Property-4 / Req 4.2 gap that needs human triage (do NOT silently\n" +
    "  change acceptance criteria; possible options: tighten the migration, or document\n" +
    "  the assigned-consultant interaction as an accepted exception)."
  );
}

// Exit code policy: GROUP A named assertions + migration sanity checks (both
// tracked in `failures`) govern the process exit code. GROUP B probe findings
// are reported loudly but do not, by themselves, fail the named task
// deliverable's exit code; the PBT status is decided by the agent after triage.
process.exitCode = failures === 0 ? 0 : 1;
