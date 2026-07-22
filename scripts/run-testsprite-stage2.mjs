#!/usr/bin/env node
/**
 * Stage 2: PRD + plano FE + execução (code_summary.yaml já existe).
 * Usa preview produção :8081 (até 30 testes high-priority).
 */
import { Client } from '/home/dev/.npm/_npx/8ddf6bea01b2519d/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '/home/dev/.npm/_npx/8ddf6bea01b2519d/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PROJECT = '/home/dev/Documents/ultra-cursor/igreen-page-magic';
const OUT_DIR = path.join(PROJECT, 'testsprite_tests', 'pipeline-logs');
const CONFIG_PATH = path.join(PROJECT, 'testsprite_tests', 'tmp', 'config.json');
const LOCAL_PORT = 8081;
const NPX = `${process.env.HOME}/.nvm/versions/node/v22.22.3/bin/npx`;
const NODE = `${process.env.HOME}/.nvm/versions/node/v22.22.3/bin/node`;
const TS_BIN = '/home/dev/.npm/_npx/8ddf6bea01b2519d/node_modules/@testsprite/testsprite-mcp/dist/index.js';

fs.mkdirSync(OUT_DIR, { recursive: true });

function loadEnv() {
  for (const f of ['.env.mcp.local', '.env.local', '.env.e2e', '.env']) {
    const p = path.join(PROJECT, f);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  }
  process.env.API_KEY = process.env.TESTSPRITE_API_KEY || process.env.API_KEY;
}

function save(name, data) {
  const p = path.join(OUT_DIR, name);
  fs.writeFileSync(p, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  console.log(`[save] ${p}`);
}

function extractText(result) {
  return (result?.content || []).map((c) => (c.type === 'text' ? c.text : JSON.stringify(c))).join('\n');
}

function writeCommittedConfig() {
  const loginUser = process.env.E2E_EMAIL || process.env.TESTSPRITE_LOGIN_USER || '';
  const loginPassword = process.env.E2E_PASSWORD || process.env.TESTSPRITE_LOGIN_PASSWORD || '';
  const cfg = {
    status: 'commited',
    type: 'frontend',
    scope: 'codebase',
    localEndpoint: `http://localhost:${LOCAL_PORT}`,
    loginUser,
    loginPassword,
    serverMode: 'production',
  };
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  console.log('[config] committed production', LOCAL_PORT, 'login=', loginUser ? 'yes' : 'no');
}

async function call(client, name, args, timeoutMs = 900_000) {
  console.log(`\n=== CALL ${name} ===`);
  const started = Date.now();
  try {
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: timeoutMs });
    const text = extractText(result);
    save(`${name}.stage2.json`, { ok: !result.isError, ms: Date.now() - started, result });
    save(`${name}.stage2.txt`, text);
    console.log(`[done] ${name} ${Date.now() - started}ms err=${!!result.isError}`);
    console.log(text.slice(0, 2500));
    return { ok: !result.isError, text, result };
  } catch (err) {
    save(`${name}.stage2.error.json`, { error: err.message, stack: err.stack });
    console.error(`[fail] ${name}`, err.message);
    return { ok: false, text: err.message, result: null };
  }
}

function runGenerateCodeAndExecute() {
  return new Promise((resolve) => {
    console.log('\n=== CLI generateCodeAndExecute ===');
    const logPath = path.join(OUT_DIR, 'generateCodeAndExecute.cli.log');
    const out = fs.createWriteStream(logPath, { flags: 'w' });
    const child = spawn(NODE, [TS_BIN, 'generateCodeAndExecute'], {
      cwd: PROJECT,
      env: {
        ...process.env,
        API_KEY: process.env.API_KEY,
        PATH: `${path.dirname(NODE)}:${process.env.PATH || ''}`,
        BROWSER: '/tmp/noop-browser.sh',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.pipe(out);
    child.stderr.pipe(out);
    child.stdout.on('data', (d) => process.stdout.write(d));
    child.stderr.on('data', (d) => process.stderr.write(d));
    child.on('close', (code) => {
      console.log(`[cli exit] ${code}`);
      resolve(code);
    });
  });
}

async function main() {
  loadEnv();
  if (!process.env.API_KEY) throw new Error('API_KEY missing');
  if (!fs.existsSync(path.join(PROJECT, 'testsprite_tests', 'tmp', 'code_summary.yaml'))) {
    throw new Error('code_summary.yaml missing');
  }
  writeCommittedConfig();

  const transport = new StdioClientTransport({
    command: NPX,
    args: ['-y', '@testsprite/testsprite-mcp@latest'],
    env: {
      ...process.env,
      API_KEY: process.env.API_KEY,
      PATH: `${path.dirname(NPX)}:${process.env.PATH || ''}`,
      HOME: process.env.HOME,
      BROWSER: '/tmp/noop-browser.sh',
    },
    cwd: PROJECT,
  });
  const client = new Client({ name: 'igreen-testsprite-stage2', version: '1.0.0' });
  await client.connect(transport);

  await call(client, 'testsprite_generate_standardized_prd', { projectPath: PROJECT });
  const fe = await call(client, 'testsprite_generate_frontend_test_plan', {
    projectPath: PROJECT,
    needLogin: Boolean(process.env.E2E_EMAIL || process.env.TESTSPRITE_LOGIN_USER),
  });

  // Pedir execução via MCP (devolve comando) — já rodamos CLI direto
  await call(client, 'testsprite_generate_code_and_execute', {
    projectName: 'igreen-page-magic',
    projectPath: PROJECT,
    testIds: [],
    serverMode: 'production',
    additionalInstruction:
      'Maximum precision. Run all generated high-priority cases. Cover public pages and authenticated admin journeys when credentials exist. Assert PT-BR UI, protected redirects, WhatsApp/CRM/fluxos/meta/materiais/produtos/cadastro portal. Prefer deep assertions.',
  });

  save('frontend_plan_stage2.txt', fe.text);
  await client.close();

  const code = await runGenerateCodeAndExecute();
  console.log('[stage2 complete]', { code });
  process.exit(code === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
