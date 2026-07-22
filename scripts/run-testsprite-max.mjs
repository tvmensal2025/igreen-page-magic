#!/usr/bin/env node
/**
 * Execução máxima TestSprite: TODOS os TCs FE em lotes de 30 + tentativa backend.
 */
import { Client } from '/home/dev/.npm/_npx/8ddf6bea01b2519d/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '/home/dev/.npm/_npx/8ddf6bea01b2519d/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PROJECT = '/home/dev/Documents/ultra-cursor/igreen-page-magic';
const OUT = path.join(PROJECT, 'testsprite_tests', 'pipeline-logs');
const NPX = `${process.env.HOME}/.nvm/versions/node/v22.22.3/bin/npx`;
const NODE = `${process.env.HOME}/.nvm/versions/node/v22.22.3/bin/node`;
const TS = '/home/dev/.npm/_npx/8ddf6bea01b2519d/node_modules/@testsprite/testsprite-mcp/dist/index.js';
const CONFIG = path.join(PROJECT, 'testsprite_tests', 'tmp', 'config.json');
const INSTR =
  'MAXIMUM coverage. Run every requested test id. Public portal MUST use /cadastro/tvmensal12 and /licenciado/tvmensal12 only. Assert by routes (/admin/motor, /admin/fluxos, /admin/meta-ads, /admin/reaquecimento, /admin/saude-bot, /admin/whatsapp-clients, /admin/conhecimento, /admin/voz, /admin/agendamentos-central). Do not require CRM column named Bloqueado. PT-BR. Deep assertions.';

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
  fs.writeFileSync(p, JSON.stringify(o, null, 2) + '\n');
}
function say(s) {
  console.log(s);
  fs.appendFileSync(path.join(OUT, 'max_run.log'), s + '\n');
}

async function withClient(fn) {
  const transport = new StdioClientTransport({
    command: NPX,
    args: ['-y', '@testsprite/testsprite-mcp@latest'],
    env: { ...process.env, API_KEY: process.env.API_KEY, BROWSER: '/tmp/noop-browser.sh' },
    cwd: PROJECT,
  });
  const client = new Client({ name: 'max-run', version: '1.0.0' });
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close().catch(() => {});
  }
}

async function call(client, name, args, timeout = 900000) {
  say(`CALL ${name}`);
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout });
  const text = (result.content || []).map((c) => (c.type === 'text' ? c.text : '')).join('\n');
  fs.writeFileSync(path.join(OUT, `${name}.max.json`), JSON.stringify(result, null, 2));
  say(`${name} err=${!!result.isError} ${(text || '').slice(0, 400)}`);
  return result;
}

function runCli() {
  return new Promise((resolve) => {
    say('CLI generateCodeAndExecute start');
    try {
      fs.rmSync(path.join(PROJECT, 'testsprite_tests', 'tmp', 'execution.lock'), {
        force: true,
        recursive: true,
      });
    } catch {}
    const child = spawn(NODE, [TS, 'generateCodeAndExecute'], {
      cwd: PROJECT,
      env: { ...process.env, API_KEY: process.env.API_KEY, BROWSER: '/tmp/noop-browser.sh' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const log = fs.createWriteStream(path.join(OUT, `cli_${Date.now()}.log`));
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
      say(`CLI exit ${code}`);
      resolve(code || 0);
    };
    const onChunk = (d) => {
      const s = d.toString();
      process.stdout.write(d);
      log.write(d);
      if (s.includes('Test execution completed') || s.includes('Execution lock released')) {
        // CLI fica 1h com server HTTP — encerrar assim que a suíte terminar
        setTimeout(() => finish(0), 1500);
      }
      if (s.includes('Test execution failed') || s.includes('ECOMPROMISED')) {
        setTimeout(() => finish(1), 1500);
      }
    };
    child.stdout.on('data', onChunk);
    child.stderr.on('data', onChunk);
    child.on('close', (code) => finish(code || 0));
    // safety: 45 min max por lote
    setTimeout(() => {
      say('CLI timeout safety');
      finish(1);
    }, 45 * 60 * 1000);
  });
}

function setBatch(ids, type = 'frontend', endpoint = 'http://localhost:8081') {
  const cfg = readJson(CONFIG);
  cfg.status = 'commited';
  cfg.type = type;
  cfg.scope = 'codebase';
  cfg.localEndpoint = endpoint;
  cfg.loginUser = process.env.E2E_EMAIL || cfg.loginUser || '';
  cfg.loginPassword = process.env.E2E_PASSWORD || cfg.loginPassword || '';
  cfg.serverMode = 'production';
  const ea = cfg.executionArgs || {};
  ea.projectName = 'igreen-page-magic';
  ea.projectPath = PROJECT;
  ea.testIds = ids;
  ea.serverMode = 'production';
  ea.additionalInstruction = INSTR;
  ea.envs = ea.envs || {};
  cfg.executionArgs = ea;
  writeJson(CONFIG, cfg);
  say(`batch set type=${type} ids=${ids.length} endpoint=${endpoint}`);
}

async function runFrontendBatches() {
  const plan = readJson(path.join(PROJECT, 'testsprite_tests', 'testsprite_frontend_test_plan.json'));
  const allIds = plan.map((t) => t.id);
  const batches = [];
  for (let i = 0; i < allIds.length; i += 30) batches.push(allIds.slice(i, i + 30));
  say(`FE total=${allIds.length} batches=${batches.map((b) => b.length).join(',')}`);

  await withClient(async (client) => {
    await call(client, 'testsprite_generate_frontend_test_plan', {
      projectPath: PROJECT,
      needLogin: true,
    });
  });
  // reaplicar fixtures reais após regenerar plano
  try {
    const planPath = path.join(PROJECT, 'testsprite_tests', 'testsprite_frontend_test_plan.json');
    let s = fs.readFileSync(planPath, 'utf8');
    s = s
      .replaceAll('valid-license', 'tvmensal12')
      .replaceAll('/cadastro/igreen', '/cadastro/tvmensal12')
      .replaceAll('/cadastro/teste', '/cadastro/tvmensal12');
    fs.writeFileSync(planPath, s);
    say('plan fixtures reapplied');
  } catch (e) {
    say('plan fixture patch skip: ' + e.message);
  }

  const codes = [];
  for (let i = 0; i < batches.length; i++) {
    const ids = batches[i];
    say(`\n=== FE BATCH ${i + 1}/${batches.length} (${ids.length}) ===`);
    setBatch(ids, 'frontend', 'http://localhost:8081');
    await withClient(async (client) => {
      await call(client, 'testsprite_generate_code_and_execute', {
        projectName: 'igreen-page-magic',
        projectPath: PROJECT,
        testIds: ids,
        serverMode: 'production',
        additionalInstruction: INSTR,
      });
    });
    // preserve login + ensure testIds
    setBatch(ids, 'frontend', 'http://localhost:8081');
    codes.push(await runCli());
    // archive raw report per batch
    const raw = path.join(PROJECT, 'testsprite_tests', 'tmp', 'raw_report.md');
    if (fs.existsSync(raw)) {
      fs.copyFileSync(raw, path.join(OUT, `raw_report_fe_batch${i + 1}.md`));
    }
    const tr = path.join(PROJECT, 'testsprite_tests', 'tmp', 'test_results.json');
    if (fs.existsSync(tr)) {
      fs.copyFileSync(tr, path.join(OUT, `test_results_fe_batch${i + 1}.json`));
    }
  }
  return codes;
}

async function runBackend() {
  say('\n=== BACKEND BOOTSTRAP + PLAN + EXECUTE ===');
  // API pública Supabase (edge) — melhor alvo backend disponível
  const endpoint = 'https://zlzasfhcxcznaprrragl.supabase.co';
  const anon = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
  const commitBackend = () => {
    writeJson(CONFIG, {
      status: 'commited',
      type: 'backend',
      scope: 'codebase',
      localEndpoint: endpoint,
      serverMode: 'production',
      backendAuthType: 'API key',
      backendApiKey: 'apikey',
      backendApiValue: anon,
    });
  };
  commitBackend();
  const watcher = setInterval(() => {
    try {
      const cfg = readJson(CONFIG);
      if (cfg.status !== 'commited') commitBackend();
    } catch {}
  }, 800);
  await withClient(async (client) => {
    await call(client, 'testsprite_bootstrap', {
      localPort: 443,
      type: 'backend',
      projectPath: PROJECT,
      testScope: 'codebase',
      pathname: '',
    }, 180000);
    commitBackend();

    await call(client, 'testsprite_generate_code_summary', { projectRootPath: PROJECT }, 120000);
    // ensure yaml exists (already does)
    await call(client, 'testsprite_generate_standardized_prd', { projectPath: PROJECT }, 300000);
    await call(client, 'testsprite_generate_backend_test_plan', { projectPath: PROJECT }, 600000);
    await call(client, 'testsprite_generate_code_and_execute', {
      projectName: 'igreen-page-magic',
      projectPath: PROJECT,
      testIds: [],
      serverMode: 'production',
      additionalInstruction:
        'Maximum backend coverage for Supabase edge/API: auth rejects, health, public endpoints, schema errors. Do not mutate production data destructively.',
    }, 300000);
  });
  clearInterval(watcher);
  const bePlan = path.join(PROJECT, 'testsprite_tests', 'testsprite_backend_test_plan.json');
  if (fs.existsSync(bePlan)) {
    const plan = readJson(bePlan);
    const ids = Array.isArray(plan) ? plan.map((t) => t.id).filter(Boolean) : [];
    say(`backend plan ids=${ids.length}`);
    if (ids.length) {
      setBatch(ids, 'backend', endpoint);
      return [await runCli()];
    }
  }
  // try CLI anyway if executionArgs present
  const cfg = readJson(CONFIG);
  if (cfg.executionArgs) return [await runCli()];
  say('backend skipped: no plan/executionArgs');
  return [];
}

async function main() {
  loadEnv();
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'max_run.log'), `start ${new Date().toISOString()}\n`);
  if (!process.env.API_KEY) throw new Error('API_KEY missing');
  if (!process.env.E2E_EMAIL) throw new Error('E2E_EMAIL missing');

  const feCodes = await runFrontendBatches();
  let beCodes = [];
  try {
    beCodes = await runBackend();
  } catch (e) {
    say(`backend error: ${e.message}`);
    fs.writeFileSync(path.join(OUT, 'backend_error.txt'), String(e.stack || e));
  }

  say(`DONE feCodes=${JSON.stringify(feCodes)} beCodes=${JSON.stringify(beCodes)}`);
  process.exit(feCodes.some((c) => c !== 0) ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
