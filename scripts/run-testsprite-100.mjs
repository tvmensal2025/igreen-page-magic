#!/usr/bin/env node
/**
 * Runner 100%: executa o plano JÁ corrigido (não regenera via MCP).
 * - Copia docs/e2e/fixtures → testsprite_tests/
 * - FE em lotes de 30 em http://localhost:8081
 * - Backend Auth API no host Supabase com anon key + E2E_EMAIL/PASSWORD
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PROJECT = '/home/dev/Documents/ultra-cursor/igreen-page-magic';
const FIX = path.join(PROJECT, 'docs', 'e2e', 'fixtures');
const TS_DIR = path.join(PROJECT, 'testsprite_tests');
const OUT = path.join(TS_DIR, 'pipeline-logs');
const CONFIG = path.join(TS_DIR, 'tmp', 'config.json');
const NODE = `${process.env.HOME}/.nvm/versions/node/v22.22.3/bin/node`;
const TS = '/home/dev/.npm/_npx/8ddf6bea01b2519d/node_modules/@testsprite/testsprite-mcp/dist/index.js';

const INSTR_FE = [
  'Execute exactly the cases in testsprite_frontend_test_plan.json.',
  'Product truth:',
  '- /cadastro/:licenca is QR + CTA WhatsApp (wa.me), NOT an HTML Nome/CPF form.',
  '- After login, assert /admin shell + sidebar (Painel/Captação/Clientes interessados). Do NOT require href list /admin/motor on dashboard DOM.',
  '- Bloqueado badge lives in Captação (do_not_contact), NOT a CRM Kanban column.',
  '- License slug MUST be tvmensal12; invalid slug shows Consultor não encontrado.',
  '- Dismiss Aceitar cookies and Encerrar tour when present.',
  '- Never send WhatsApp to real customers; never leave the app to WhatsApp Web.',
  'UI labels in Brazilian Portuguese. Prefer deep assertions matching the steps.',
].join(' ');

const INSTR_BE = [
  'Backend Auth only:',
  'POST {SUPABASE_URL}/auth/v1/token?grant_type=password',
  'headers: apikey={{SUPABASE_ANON_KEY}}, Content-Type: application/json',
  'body: email={{E2E_EMAIL}} password={{E2E_PASSWORD}}',
  'Assert 200 + access_token + user.email.',
  'Do NOT GET /admin/* on the Supabase host (those routes are the Vite SPA).',
].join(' ');

function loadEnv() {
  for (const f of ['.env.mcp.local', '.env.local']) {
    const p = path.join(PROJECT, f);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) process.env[m[1]] = m[2];
    }
  }
  process.env.API_KEY = process.env.TESTSPRITE_API_KEY || process.env.API_KEY;
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function writeJson(p, o) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(o, null, 2) + '\n');
}
function say(s) {
  console.log(s);
  fs.appendFileSync(path.join(OUT, 'run100.log'), s + '\n');
}

function restoreFixtures() {
  for (const name of [
    'testsprite_frontend_test_plan.json',
    'testsprite_backend_test_plan.json',
    'standard_prd.json',
  ]) {
    const src = path.join(FIX, name);
    const dst = path.join(TS_DIR, name);
    if (!fs.existsSync(src)) throw new Error(`fixture missing: ${src}`);
    fs.copyFileSync(src, dst);
  }
  say('fixtures restored into testsprite_tests/');
}

function setBatch(ids, type, endpoint, instruction, extra = {}) {
  const cfg = {
    status: 'commited',
    type,
    scope: 'codebase',
    localEndpoint: endpoint,
    loginUser: process.env.E2E_EMAIL || '',
    loginPassword: process.env.E2E_PASSWORD || '',
    serverMode: 'production',
    ...extra,
    executionArgs: {
      projectName: 'igreen-page-magic',
      projectPath: PROJECT,
      testIds: ids,
      serverMode: 'production',
      additionalInstruction: instruction,
      envs: {
        LOGIN_USER: process.env.E2E_EMAIL || '',
        LOGIN_PASSWORD: process.env.E2E_PASSWORD || '',
        E2E_EMAIL: process.env.E2E_EMAIL || '',
        E2E_PASSWORD: process.env.E2E_PASSWORD || '',
        SUPABASE_URL: process.env.SUPABASE_URL || '',
        SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || '',
      },
    },
  };
  writeJson(CONFIG, cfg);
  say(`batch type=${type} ids=${ids.length} endpoint=${endpoint}`);
}

function runCli(label) {
  return new Promise((resolve) => {
    say(`CLI start ${label}`);
    try {
      fs.rmSync(path.join(TS_DIR, 'tmp', 'execution.lock'), { force: true, recursive: true });
    } catch {}
    const child = spawn(NODE, [TS, 'generateCodeAndExecute'], {
      cwd: PROJECT,
      env: {
        ...process.env,
        API_KEY: process.env.API_KEY,
        BROWSER: '/tmp/noop-browser.sh',
        PATH: `${path.dirname(NODE)}:${process.env.PATH || ''}`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const log = fs.createWriteStream(path.join(OUT, `cli100_${label}_${Date.now()}.log`));
    let settled = false;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      try {
        child.kill('SIGTERM');
      } catch {}
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {}
      }, 2000);
      say(`CLI exit ${label} code=${code}`);
      resolve(code || 0);
    };
    const onChunk = (d) => {
      const s = d.toString();
      process.stdout.write(d);
      log.write(d);
      if (s.includes('Test execution completed') || s.includes('Execution lock released')) {
        setTimeout(() => finish(0), 1500);
      }
      if (s.includes('Test execution failed') || s.includes('ECOMPROMISED')) {
        setTimeout(() => finish(1), 1500);
      }
    };
    child.stdout.on('data', onChunk);
    child.stderr.on('data', onChunk);
    child.on('close', (code) => finish(code || 0));
    setTimeout(() => {
      say(`CLI timeout ${label}`);
      finish(1);
    }, 50 * 60 * 1000);
  });
}

function archive(label) {
  const raw = path.join(TS_DIR, 'tmp', 'raw_report.md');
  const tr = path.join(TS_DIR, 'tmp', 'test_results.json');
  if (fs.existsSync(raw)) fs.copyFileSync(raw, path.join(OUT, `raw_report_${label}.md`));
  if (fs.existsSync(tr)) fs.copyFileSync(tr, path.join(OUT, `test_results_${label}.json`));
}

function summarizeResults() {
  const files = fs
    .readdirSync(OUT)
    .filter((f) => f.startsWith('test_results_') && f.endsWith('.json'))
    .map((f) => path.join(OUT, f));
  let pass = 0;
  let fail = 0;
  let blocked = 0;
  let other = 0;
  const rows = [];
  for (const f of files) {
    try {
      const data = readJson(f);
      const list = Array.isArray(data) ? data : data.results || data.tests || [];
      for (const t of list) {
        const id = t.id || t.testId || t.name || '?';
        const st = String(t.status || t.result || t.state || '').toUpperCase();
        rows.push({ id, st, file: path.basename(f) });
        if (st.includes('PASS')) pass++;
        else if (st.includes('FAIL')) fail++;
        else if (st.includes('BLOCK')) blocked++;
        else other++;
      }
    } catch (e) {
      say(`summarize skip ${f}: ${e.message}`);
    }
  }
  say(`SUMMARY pass=${pass} fail=${fail} blocked=${blocked} other=${other} total=${rows.length}`);
  writeJson(path.join(OUT, 'summary_100.json'), { pass, fail, blocked, other, rows });
  return { pass, fail, blocked, other, rows };
}

async function main() {
  loadEnv();
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'run100.log'), `start ${new Date().toISOString()}\n`);
  if (!process.env.API_KEY) throw new Error('TESTSPRITE_API_KEY missing');
  if (!process.env.E2E_EMAIL || !process.env.E2E_PASSWORD) throw new Error('E2E credentials missing');
  if (!process.env.SUPABASE_ANON_KEY) throw new Error('SUPABASE_ANON_KEY missing');

  restoreFixtures();

  const plan = readJson(path.join(TS_DIR, 'testsprite_frontend_test_plan.json'));
  const allIds = plan.map((t) => t.id);
  const batches = [];
  for (let i = 0; i < allIds.length; i += 30) batches.push(allIds.slice(i, i + 30));
  say(`FE total=${allIds.length} batches=${batches.map((b) => b.length).join(',')}`);

  const codes = [];
  for (let i = 0; i < batches.length; i++) {
    const ids = batches[i];
    const label = `fe_batch${i + 1}`;
    say(`\n=== ${label} (${ids.length}) ===`);
    // Re-restore in case CLI mutates plan mid-run
    restoreFixtures();
    setBatch(ids, 'frontend', 'http://localhost:8081', INSTR_FE);
    codes.push(await runCli(label));
    archive(label);
    restoreFixtures();
  }

  // Backend auth
  say('\n=== backend auth ===');
  restoreFixtures();
  const bePlan = readJson(path.join(TS_DIR, 'testsprite_backend_test_plan.json'));
  const beIds = (Array.isArray(bePlan) ? bePlan : []).map((t) => t.id).filter(Boolean);
  const supabase = process.env.SUPABASE_URL || 'https://zlzasfhcxcznaprrragl.supabase.co';
  setBatch(beIds.length ? beIds : ['TC001'], 'backend', supabase, INSTR_BE, {
    backendAuthType: 'API key',
    backendApiKey: 'apikey',
    backendApiValue: process.env.SUPABASE_ANON_KEY,
  });
  codes.push(await runCli('backend'));
  archive('backend');

  const summary = summarizeResults();
  say(`DONE codes=${JSON.stringify(codes)} summary=${JSON.stringify({
    pass: summary.pass,
    fail: summary.fail,
    blocked: summary.blocked,
  })}`);

  const ok = summary.fail === 0 && summary.blocked === 0 && summary.pass > 0;
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
