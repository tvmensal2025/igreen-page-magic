/**
 * Worker Club — cadastro iGreen Club (Conexão Club).
 * Serviço INDEPENDENTE. Não usa Portal 2 / autoconexão / HMAC green-connection.
 *
 * Endpoints:
 *   GET  /health
 *   POST /submit-lead       — enfileira / cadastra PF (dryRun default)
 *   POST /preview-payload   — monta payload oficial (sem API)
 *   POST /lookup-cep        — ViaCEP
 *   GET  /queue/status
 *
 * Auth: Authorization: Bearer ${WORKER_SECRET}
 *
 * Segurança:
 *   - dryRun=true por default
 *   - POST real só com dryRun=false E ALLOW_LIVE_CLUB_POST=true
 *
 * Fonte: CLUB-OFICIAL.md
 */

import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { Queue, Worker } from 'bullmq';
import dotenv from 'dotenv';
import ws from 'ws';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { ClubClient, closeBrowser } from './club-api-client.mjs';
import { montarPayloadClubPf, maskPii, formatCep } from './club-normalize.mjs';
import { classifyClubError } from './club-errors.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

const PORT = Number(process.env.PORT || 3102);
const SECRET = process.env.WORKER_SECRET || '';
const WEAK_SECRETS = new Set(['change-me', 'secret', 'password', 'test', 'worker', '123456', 'admin']);
if (!SECRET || SECRET.length < 16 || WEAK_SECRETS.has(SECRET.toLowerCase())) {
  console.error('❌ WORKER_SECRET ausente, curto (<16) ou fraco. Defina um segredo forte e reinicie.');
  process.exit(1);
}
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const REDIS_URL = process.env.REDIS_URL || 'redis://evolution-api-redis:6379';
const QUEUE_NAME = 'club-worker-leads';
const ALLOW_LIVE = String(process.env.ALLOW_LIVE_CLUB_POST || '').toLowerCase() === 'true';

const supabase = (() => {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.warn('⚠️ Supabase não configurado — status club_* não será persistido');
    return null;
  }
  try {
    return createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { transport: ws },
    });
  } catch (e) {
    console.warn(`⚠️ Supabase init falhou: ${e.message}`);
    return null;
  }
})();

function authRequired(req, res, next) {
  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${SECRET}`) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  next();
}

function buildRedisConn(forWorker = false) {
  try {
    const u = new URL(REDIS_URL);
    return {
      host: u.hostname,
      port: Number(u.port || 6379),
      password: u.password ? decodeURIComponent(u.password) : undefined,
      username: u.username ? decodeURIComponent(u.username) : undefined,
      maxRetriesPerRequest: forWorker ? null : 3,
      retryStrategy: (times) => (times > 5 ? null : Math.min(times * 1000, 5000)),
    };
  } catch {
    return { host: 'evolution-api-redis', port: 6379, maxRetriesPerRequest: forWorker ? null : 3 };
  }
}

/** Persiste só colunas club_* (não mexe em portal2_*). */
async function updateCustomerClub(customerId, patch) {
  if (!supabase || !customerId) return;
  try {
    const { error } = await supabase.from('customers').update({
      ...patch,
      club_updated_at: new Date().toISOString(),
    }).eq('id', customerId);
    if (error) console.warn(`  ⚠ update club_*: ${error.message}`);
  } catch (e) {
    console.warn(`  ⚠ update club_*: ${e.message}`);
  }
}

async function processLead(job) {
  const { customer_id, dados, dryRun } = job.data || {};
  const wantDry = dryRun !== false;
  const tracer = [];
  const client = new ClubClient({ idconsultor: dados.idconsultor, tracer });

  console.log(`▶ club job=${job.id} customer=${customer_id || '-'} dryRun=${wantDry}`);

  if (customer_id) {
    await updateCustomerClub(customer_id, {
      club_status: wantDry ? 'dry_run' : 'submitting',
      club_error: null,
      club_error_kind: null,
    });
  }

  try {
    const result = await client.cadastrarPf(dados, { dryRun: wantDry });

    if (customer_id) {
      await updateCustomerClub(customer_id, {
        club_status: result.dryRun ? 'dry_run_ok' : 'submitted',
        club_payload: result.payload,
        club_response: result.response || null,
        club_dry_run: !!result.dryRun,
        club_created_at: result.dryRun ? null : new Date().toISOString(),
      });
    }

    console.log(`  ✅ job=${job.id} dryRun=${result.dryRun}`);
    return { ...result, trace: tracer };
  } catch (err) {
    const classified = classifyClubError(err);
    console.error(`  ❌ job=${job.id} kind=${classified.kind}: ${classified.message.slice(0, 200)}`);

    if (customer_id) {
      await updateCustomerClub(customer_id, {
        club_status: 'error',
        club_error: classified.message.slice(0, 2000),
        club_error_kind: classified.kind,
      });
    }

    if (classified.retry) throw err;
    return { success: false, ...classified, trace: tracer };
  }
}

let queue = null;
let worker = null;
let queueAvailable = false;

async function initQueue() {
  try {
    queue = new Queue(QUEUE_NAME, { connection: buildRedisConn(false) });
    queue.on('error', (e) => {
      if (queueAvailable) console.warn(`  queue error: ${e.message}`);
    });
    await queue.getJobCounts();
    worker = new Worker(QUEUE_NAME, processLead, {
      connection: buildRedisConn(true),
      concurrency: 1,
      limiter: { max: 10, duration: 60_000 },
    });
    worker.on('error', (e) => {
      if (queueAvailable) console.warn(`  worker conn error: ${e.message}`);
    });
    worker.on('failed', (job, err) => console.error(`  worker fail job=${job?.id}: ${err.message}`));
    worker.on('completed', (job) => console.log(`  worker done job=${job.id}`));
    queueAvailable = true;
    const conn = buildRedisConn();
    console.log(`✅ BullMQ fila="${QUEUE_NAME}" (${conn.host}:${conn.port})`);
  } catch (e) {
    console.warn(`⚠️ Redis indisponível: ${e.message} — modo síncrono`);
    try { if (worker) await worker.close(); } catch { /* */ }
    try { if (queue) await queue.close(); } catch { /* */ }
    queue = null;
    worker = null;
    queueAvailable = false;
  }
}

const app = express();
app.use(express.json({ limit: '2mb' }));

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'worker-club',
    landing: 'https://club.igreenenergy.com.br',
    api: 'https://api.igreenenergy.com.br',
    queue: queueAvailable ? 'redis-bullmq' : 'sync',
    allow_live_post: ALLOW_LIVE,
    dry_run_default: true,
    uptime: process.uptime(),
  });
});

app.get('/queue/status', authRequired, async (req, res) => {
  if (!queueAvailable || !queue) {
    return res.json({ ok: true, mode: 'sync', counts: null });
  }
  const counts = await queue.getJobCounts();
  res.json({ ok: true, mode: 'redis-bullmq', queue: QUEUE_NAME, counts });
});

/** Valida e monta o body oficial — sem Playwright / sem API Club. */
app.post('/preview-payload', authRequired, (req, res) => {
  try {
    const dados = req.body?.dados || req.body || {};
    const payload = montarPayloadClubPf(dados);
    res.json({ ok: true, payload, masked: maskPii(payload) });
  } catch (e) {
    const c = classifyClubError(e);
    res.status(400).json({ ok: false, ...c, details: e.details || null });
  }
});

app.post('/lookup-cep', authRequired, async (req, res) => {
  try {
    const cep = formatCep(req.body?.cep);
    if (!cep) return res.status(400).json({ ok: false, error: 'cep inválido' });
    const idconsultor = Number(req.body?.idconsultor || process.env.CLUB_DEFAULT_CONSULTOR || 124170);
    const client = new ClubClient({ idconsultor });
    const addr = await client.lookupCep(cep);
    res.json({ ok: true, ...addr });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message, code: e.code || null });
  }
});

/**
 * Cadastra PF no Club.
 * Exige `dados` completo (não busca ficha Portal / energia).
 * `customer_id` é opcional — só grava status em club_*.
 */
app.post('/submit-lead', authRequired, async (req, res) => {
  const { customer_id, dados } = req.body || {};
  let { dryRun } = req.body || {};

  if (dryRun === undefined) dryRun = true;
  dryRun = dryRun !== false;

  if (!ALLOW_LIVE && dryRun === false) {
    return res.status(403).json({
      ok: false,
      error: 'live_post_disabled',
      message: 'Defina ALLOW_LIVE_CLUB_POST=true no worker para POST real. Use dryRun:true.',
    });
  }

  if (!dados || typeof dados !== 'object') {
    return res.status(400).json({
      ok: false,
      error: 'dados_obrigatorio',
      message: 'Envie dados: { idconsultor, cpf, nome, dtnasc, rg, email, celular, cep, endereco, numero, bairro, cidade, uf }',
    });
  }

  if (!dados.idconsultor) {
    return res.status(400).json({ ok: false, error: 'dados.idconsultor obrigatório' });
  }

  try {
    montarPayloadClubPf(dados);
  } catch (e) {
    const c = classifyClubError(e);
    return res.status(400).json({ ok: false, ...c, details: e.details || null });
  }

  const jobData = { customer_id: customer_id || null, dados, dryRun };

  if (queueAvailable && queue) {
    const job = await queue.add('cadastrar-club-pf', jobData, {
      attempts: dryRun ? 1 : 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 200,
    });
    return res.json({ ok: true, queued: true, job_id: String(job.id), dryRun });
  }

  try {
    const result = await processLead({ id: 'sync', data: jobData });
    res.json({ ok: true, queued: false, dryRun, result });
  } catch (e) {
    const c = classifyClubError(e);
    res.status(502).json({ ok: false, ...c });
  }
});

async function shutdown() {
  console.log('shutting down…');
  try { if (worker) await worker.close(); } catch { /* */ }
  try { if (queue) await queue.close(); } catch { /* */ }
  await closeBrowser().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await initQueue();
app.listen(PORT, () => {
  console.log(`🌱 worker-club :${PORT} (serviço independente — só Club)`);
  console.log(`   GET  /health`);
  console.log(`   POST /submit-lead (dryRun default=true, live=${ALLOW_LIVE})`);
  console.log(`   POST /preview-payload`);
  console.log(`   POST /lookup-cep`);
  console.log(`   GET  /queue/status`);
});
