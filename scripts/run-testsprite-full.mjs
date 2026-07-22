#!/usr/bin/env node
/**
 * Pipeline TestSprite full-auto (zero confirmação).
 * - Watcher grava config.status=commited assim que o bootstrap cria o arquivo
 * - Gera summary + PRD + planos FE/BE + executa todos os testes
 */
import { Client } from '/home/dev/.npm/_npx/8ddf6bea01b2519d/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '/home/dev/.npm/_npx/8ddf6bea01b2519d/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';
import fs from 'node:fs';
import path from 'node:path';

const PROJECT = '/home/dev/Documents/ultra-cursor/igreen-page-magic';
const OUT_DIR = path.join(PROJECT, 'testsprite_tests', 'pipeline-logs');
const CONFIG_PATH = path.join(PROJECT, 'testsprite_tests', 'tmp', 'config.json');
const PRD_DIR = path.join(PROJECT, 'testsprite_tests', 'tmp', 'prd_files');
const LOCAL_PORT = 8080;
const NPX = `${process.env.HOME}/.nvm/versions/node/v22.22.3/bin/npx`;

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(PRD_DIR, { recursive: true });

function loadEnvLocal() {
  const envPath = path.join(PROJECT, '.env.mcp.local');
  const text = fs.readFileSync(envPath, 'utf8');
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2];
  }
  // E2E opcional
  for (const f of ['.env.local', '.env.e2e', '.env']) {
    const p = path.join(PROJECT, f);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^(E2E_EMAIL|E2E_PASSWORD)=(.+)$/);
      if (m) process.env[m[1]] = m[2];
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
  if (!result) return '';
  const parts = result.content || [];
  return parts.map((c) => (c.type === 'text' ? c.text : JSON.stringify(c))).join('\n');
}

function writeSeedPrd() {
  const prd = `# iGreen Official Portal — PRD para TestSprite

## Product overview
Portal SaaS multi-tenant para consultores de energia solar (iGreen): WhatsApp (Whapi), CRM, cadência/bot, Meta Ads, portal de cadastro do cliente, materiais, produtos/orçamento, voz/TTS, reaquecimento e super-admin.

## Core goals
- Consultor autentica e opera o admin com segurança
- Qualificar leads no WhatsApp com cadência/bot
- Acompanhar CRM e portal de cadastro
- Gerenciar campanhas Meta e materiais
- Configurar fluxos, motor de cadência e saúde do bot

## Public / auth routes
- /auth — login email+senha (Supabase Auth)
- /tutorial — onboarding
- /assistente — assistente
- /crm — landing CRM
- /licenciado/:licenca — página licenciada
- /cadastro/:licenca — portal de cadastro do cliente
- /conexao-* /:licenca — landings de produto
- /politica-privacidade, /install, /reset
- /proposta/:token — proposta pública

## Protected admin routes (require login)
- /admin — dashboard principal (tabs: clientes, captacao, conversao, crm, links, materiais, parceiros, produtos, whatsapp, academy, audio-studio, central-anuncios)
- /admin/whatsapp-clients — clientes WhatsApp / iGreen
- /admin/fluxos — builder de cadência
- /admin/fluxo-b — fluxo B / vendedora AI
- /admin/saude-bot, /admin/saude-producao — saúde/ops
- /admin/portal-monitor — monitor do portal
- /admin/conhecimento — base de conhecimento / FAQ IA
- /admin/reaquecimento — daily reheat
- /admin/voz — TTS / voz
- /admin/recon — recon iGreen
- /admin/conversao — conversão
- /admin/meta-ads — Meta Ads
- /admin/protocolos — protocolos
- /admin/motor — motor de cadência
- /admin/agendamentos-central — agenda/captação
- /admin/solar-design — solar 3D
- /admin/sofia-audios — áudios Sofia
- /consultor/mensagens — mensagens do consultor
- /ajuda — ajuda
- /super-admin — super admin + suporte remoto

## Validation criteria (maximum precision)
- Login válido entra no /admin; inválido mostra erro
- Rotas protegidas redirecionam para /auth sem sessão
- WhatsApp tab carrega e composer é usável
- CRM kanban renderiza colunas
- Fluxo builder abre e lista steps
- Meta ads / materiais / produtos páginas carregam sem crash
- Portal /cadastro/:licenca renderiza formulário
- Mobile viewport (375px) sem overflow crítico nas páginas admin principais
- Labels em português (BR)
- Sem vazamento de secrets no DOM
`;
  fs.writeFileSync(path.join(PRD_DIR, 'igreen-prd.md'), prd);
}

function startAutoCommitWatcher() {
  const loginUser = process.env.E2E_EMAIL || process.env.TESTSPRITE_LOGIN_USER || '';
  const loginPassword = process.env.E2E_PASSWORD || process.env.TESTSPRITE_LOGIN_PASSWORD || '';
  console.log(`[watcher] auto-commit ON login=${loginUser ? 'yes' : 'no'}`);

  const commit = () => {
    try {
      if (!fs.existsSync(CONFIG_PATH)) return false;
      const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      if (cfg.status === 'commited') return true;
      const next = {
        ...cfg,
        status: 'commited',
        type: (cfg.type || 'frontend').toLowerCase(),
        scope: cfg.scope || 'codebase',
        localEndpoint: cfg.localEndpoint || `http://localhost:${LOCAL_PORT}`,
        loginUser: cfg.loginUser || loginUser,
        loginPassword: cfg.loginPassword || loginPassword,
        serverMode: 'development',
      };
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2));
      console.log('[watcher] config committed automatically');
      return true;
    } catch (e) {
      console.error('[watcher] error', e.message);
      return false;
    }
  };

  // seed committed config before bootstrap to reduzir race
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  commit();

  const timer = setInterval(commit, 800);
  return () => clearInterval(timer);
}

async function call(client, name, args, timeoutMs = 600_000) {
  console.log(`\n=== CALL ${name} ===`);
  console.log('args', JSON.stringify(args));
  const started = Date.now();
  try {
    const result = await client.callTool({ name, arguments: args }, undefined, {
      timeout: timeoutMs,
    });
    const text = extractText(result);
    save(`${name}.json`, { ok: !result.isError, ms: Date.now() - started, result });
    save(`${name}.txt`, text);
    console.log(`[done] ${name} in ${Date.now() - started}ms isError=${!!result.isError}`);
    console.log(text.slice(0, 2000));
    return { ok: !result.isError, text, result };
  } catch (err) {
    const msg = err?.message || String(err);
    save(`${name}.error.json`, { ms: Date.now() - started, error: msg, stack: err?.stack });
    console.error(`[fail] ${name}: ${msg}`);
    return { ok: false, text: msg, result: null };
  }
}

async function main() {
  loadEnvLocal();
  if (!process.env.API_KEY || process.env.API_KEY.includes('your-api-key')) {
    throw new Error('TESTSPRITE_API_KEY ausente');
  }

  writeSeedPrd();
  const stopWatcher = startAutoCommitWatcher();

  const transport = new StdioClientTransport({
    command: NPX,
    args: ['-y', '@testsprite/testsprite-mcp@latest'],
    env: {
      ...process.env,
      API_KEY: process.env.API_KEY,
      PATH: `${path.dirname(NPX)}:${process.env.PATH || ''}`,
      HOME: process.env.HOME,
      BROWSER: 'echo', // evita abrir browser real no headless
    },
    cwd: PROJECT,
  });

  const client = new Client({ name: 'igreen-testsprite-full', version: '1.0.0' });
  await client.connect(transport);
  console.log('[connected]');

  const tools = await client.listTools();
  save('list_tools.json', tools);
  console.log('TOOLS:', tools.tools.map((t) => t.name).join(', '));

  await call(client, 'testsprite_check_account_info', {}, 120_000);

  await call(
    client,
    'testsprite_bootstrap',
    {
      localPort: LOCAL_PORT,
      type: 'frontend',
      projectPath: PROJECT,
      testScope: 'codebase',
    },
    180_000,
  );

  await call(client, 'testsprite_generate_code_summary', { projectRootPath: PROJECT }, 900_000);
  await call(client, 'testsprite_generate_standardized_prd', { projectPath: PROJECT }, 900_000);

  const fePlan = await call(
    client,
    'testsprite_generate_frontend_test_plan',
    { projectPath: PROJECT, needLogin: true },
    900_000,
  );

  const bePlan = await call(
    client,
    'testsprite_generate_backend_test_plan',
    { projectPath: PROJECT },
    900_000,
  );

  await call(
    client,
    'testsprite_generate_code_and_execute',
    {
      projectName: 'igreen-page-magic',
      projectPath: PROJECT,
      testIds: [],
      serverMode: 'development',
      additionalInstruction:
        'Maximum coverage and precision. Exhaustively test: auth login/logout and protected redirects; admin dashboard tabs; WhatsApp clients/chat composer; CRM; fluxos builder; fluxo-b; saude-bot; portal-monitor; conhecimento; reaquecimento; voz; meta-ads; motor cadencia; agendamentos-central; materiais; produtos; parceiros; links; solar-design; cadastro portal public form; licenciado page; mobile 375px; form validation; empty/error states; authorization. Prefer deep assertions. UI labels in Brazilian Portuguese. Do not skip high-priority cases.',
    },
    2_400_000,
  );

  save(
    'PLAN_SUMMARY.md',
    `# TestSprite — mapa de testes gerado\n\n## Frontend\n\n${fePlan.text}\n\n## Backend\n\n${bePlan.text}\n`,
  );

  stopWatcher();
  await client.close();
  console.log('\n[pipeline complete]');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
