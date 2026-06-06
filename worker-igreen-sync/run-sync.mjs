// run-sync.mjs — executado pelo GitHub Actions
// Faz login no portal iGreen via Playwright (IP Microsoft = sem bloqueio CF)
// e salva os dados direto no Supabase via service role key.

import { chromium } from 'playwright-chromium';

const PORTAL_EMAIL = process.env.PORTAL_EMAIL?.trim().toLowerCase();
const PORTAL_PASSWORD = process.env.PORTAL_PASSWORD?.trim();
const CONSULTANT_ID = process.env.CONSULTANT_ID?.trim();
const MODE = process.env.MODE || 'sync_customers';
const SUPABASE_URL = process.env.SUPABASE_URL?.trim();
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY?.trim();

const PORTAL_LOGIN_URL = 'https://escritorio.igreenenergy.com.br/login';
const API_BASE = 'https://api-voffice.igreenenergy.com.br/v1';

if (!PORTAL_EMAIL || !PORTAL_PASSWORD || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Variáveis de ambiente obrigatórias não definidas.');
  process.exit(1);
}

// ------------ Supabase helpers ------------
async function supabaseUpsert(table, records, onConflict) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': `resolution=merge-duplicates,return=representation`,
    },
    body: JSON.stringify(records),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase upsert ${table} falhou: ${err.slice(0, 300)}`);
  }
  return res.json().catch(() => []);
}

async function supabaseUpdate(table, id, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) console.warn(`supabaseUpdate ${table} warning:`, await res.text());
}

async function supabaseSetting(key, value) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/settings`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates',
    },
    body: JSON.stringify({ key, value }),
  });
  if (!res.ok) console.warn('setting update warning:', await res.text());
}

// ------------ Helpers de mapeamento ------------
function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('55') && digits.length >= 12) return digits;
  if (digits.length === 11) return `55${digits}`;
  if (digits.length === 10) return `55${digits}`;
  return digits.length >= 12 ? digits : '';
}

function mapStatus(andamento) {
  if (!andamento) return 'pending';
  const l = andamento.toLowerCase().trim();
  if (l === 'validado' || l === 'aprovado' || l === 'ativo') return 'approved';
  if (l === 'devolutiva') return 'devolutiva';
  if (l === 'reprovado' || l === 'cancelado') return 'rejected';
  if (l.includes('falta assinatura')) return 'awaiting_signature';
  if (l.includes('aguardando')) return 'pending';
  if (l === 'pendente' || l.includes('analise') || l.includes('análise')) return 'pending';
  if (l === 'lead' || l === 'novo') return 'lead';
  return 'pending';
}

function safeStr(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  return s || null;
}

function safeNum(v) {
  if (v == null || v === '') return null;
  const n = parseFloat(String(v).replace(',', '.').replace('%', ''));
  return isNaN(n) ? null : n;
}

function get(obj, ...keys) {
  for (const k of keys) {
    if (obj[k] != null && obj[k] !== '') return obj[k];
    const f = Object.keys(obj).find(x => x.toLowerCase() === k.toLowerCase());
    if (f && obj[f] != null && obj[f] !== '') return obj[f];
  }
  return null;
}

function buildCustomerRecord(c) {
  const phoneRaw = get(c, 'celular', 'telefone', 'phone', 'whatsapp', 'Celular', 'Telefone');
  let phone = normalizePhone(String(phoneRaw || ''));
  let isPlaceholder = false;

  if (!phone || phone.length < 12) {
    const codigo = safeStr(get(c, 'codigoCliente', 'codigo', 'codigoIgreen', 'id'));
    const inst = safeStr(get(c, 'instalacao', 'numeroInstalacao'));
    const fallback = codigo || inst;
    if (fallback) { phone = `sem_celular_${fallback.replace(/\D/g, '')}`; isPlaceholder = true; }
    else return null;
  }

  const r = {
    phone_whatsapp: phone,
    customer_origin: 'igreen_sync',
    phone_contact_confirmed: false,
    status: isPlaceholder ? 'contato_incompleto' : mapStatus(safeStr(get(c, 'andamento', 'Andamento', 'status'))),
  };

  if (CONSULTANT_ID) r.consultant_id = CONSULTANT_ID;

  const name = safeStr(get(c, 'nomeCliente', 'nome', 'Nome', 'name'));
  if (name) r.name = name;
  const cpf = safeStr(get(c, 'cpf', 'CPF', 'documento'));
  if (cpf) r.cpf = cpf.replace(/\D/g, '');
  const email = safeStr(get(c, 'email', 'Email', 'E-mail'));
  if (email) r.email = email;
  const city = safeStr(get(c, 'cidade', 'Cidade', 'municipio'));
  if (city) r.address_city = city;
  const state = safeStr(get(c, 'uf', 'UF', 'estado'));
  if (state) r.address_state = state.toUpperCase();
  const dist = safeStr(get(c, 'distribuidora', 'Distribuidora'));
  if (dist) r.distribuidora = dist;
  const andamento = safeStr(get(c, 'andamento', 'Andamento'));
  if (andamento) r.andamento_igreen = andamento;
  const consumo = safeNum(get(c, 'consumoMedio', 'consumo_medio'));
  if (consumo != null) r.media_consumo = consumo;
  const desc = safeNum(get(c, 'descontoCliente', 'desconto_cliente'));
  if (desc != null) r.desconto_cliente = desc;
  const icode = safeStr(get(c, 'codigoIgreen', 'codigo'));
  if (icode) r.igreen_code = icode;
  const lic = safeStr(get(c, 'licenciado', 'Licenciado', 'nomeLicenciado'));
  if (lic) r.registered_by_name = lic;
  const dCad = safeStr(get(c, 'dataCadastro', 'data_cadastro'));
  if (dCad) r.data_cadastro = dCad;
  const dAtivo = safeStr(get(c, 'dataAtivo', 'data_ativo'));
  if (dAtivo) r.data_ativo = dAtivo;

  return r;
}

// ------------ Coleta paginada ------------
async function fetchPaginated(page, url, { pageParam = 'page', sizeParam = 'pageSize', size = 500 } = {}) {
  const all = [];
  for (let p = 1; p <= 200; p++) {
    const sep = url.includes('?') ? '&' : '?';
    const full = `${url}${sep}${pageParam}=${p}&${sizeParam}=${size}`;
    const res = await page.request.get(full, { timeout: 60000 });
    const status = res.status();
    if (status === 401 || status === 403) throw new Error(`Sessão expirada (${status})`);
    if (status === 429) {
      console.log(`429 rate limit — aguardando 30s`);
      await new Promise(r => setTimeout(r, 30000));
      continue;
    }
    if (!res.ok()) throw new Error(`HTTP ${status} em ${full}`);
    const j = await res.json();
    const arr = Array.isArray(j) ? j :
      Array.isArray(j?.data) ? j.data :
      Array.isArray(j?.items) ? j.items :
      Array.isArray(j?.results) ? j.results :
      Array.isArray(j?.customers) ? j.customers :
      Array.isArray(j?.members) ? j.members : [];
    all.push(...arr);
    console.log(`  página ${p}: ${arr.length} itens (total: ${all.length})`);
    if (arr.length < size) break;
  }
  return all;
}

// ------------ Main ------------
async function main() {
  console.log(`[sync] iniciando mode=${MODE} email=${PORTAL_EMAIL}`);

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1280,800', '--lang=pt-BR,pt',
    ],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    locale: 'pt-BR',
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {} };
  });

  const page = await context.newPage();

  try {
    // Login
    console.log(`[login] navegando para ${PORTAL_LOGIN_URL}`);
    await page.goto(PORTAL_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });

    const emailSel = 'input[type="email"], input[name="email"], input[name="usuario"], input[name="login"]';
    const passSel = 'input[type="password"]';

    // Loop para aguardar resolução do Cloudflare JS challenge (até 60s)
    console.log('[login] aguardando CF challenge resolver...');
    let cfResolved = false;
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(3000);
      const title = await page.title().catch(() => '');
      const body = await page.locator('body').innerText().catch(() => '');
      console.log(`[login] [${i+1}/20] título: "${title}" | URL: ${page.url()}`);
      if (!title.includes('Attention Required') && !title.includes('Just a moment') &&
          !body.includes('Checking your browser') && !body.includes('Just a moment')) {
        cfResolved = true;
        break;
      }
    }

    await page.screenshot({ path: '/tmp/login-1-after-cf.png', fullPage: true }).catch(() => {});

    if (!cfResolved) {
      console.error('[login] Cloudflare não resolveu em 60s — IP bloqueado');
      process.exit(1);
    }

    // Aguarda formulário de login aparecer
    let formFound = false;
    try {
      await page.waitForSelector(emailSel, { timeout: 20000 });
      formFound = true;
    } catch (_) {}

    if (!formFound) {
      const bodyNow = await page.locator('body').innerText().catch(() => '');
      console.error(`[login] formulário não encontrado. Body: ${bodyNow.slice(0, 400)}`);
      await page.screenshot({ path: '/tmp/login-error.png', fullPage: true }).catch(() => {});
      process.exit(1);
    }

    console.log('[login] formulário encontrado — preenchendo...');
    await page.click(emailSel);
    await page.waitForTimeout(300 + Math.random() * 300);
    await page.fill(emailSel, PORTAL_EMAIL);
    await page.waitForTimeout(400 + Math.random() * 300);
    await page.fill(passSel, PORTAL_PASSWORD);
    await page.waitForTimeout(400 + Math.random() * 300);

    await page.screenshot({ path: '/tmp/login-2-filled.png', fullPage: true }).catch(() => {});

    const submitSel = 'button[type="submit"], button:has-text("Entrar"), button:has-text("Acessar")';
    await Promise.all([
      page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => {}),
      page.click(submitSel).catch(() => page.keyboard.press('Enter')),
    ]);

    await page.waitForTimeout(4000);
    await page.screenshot({ path: '/tmp/login-3-after-submit.png', fullPage: true }).catch(() => {});

    const currentUrl = page.url();
    console.log(`[login] URL após submit: ${currentUrl}`);

    if (/\/login/i.test(currentUrl)) {
      const bodyText = await page.locator('body').innerText().catch(() => '');
      console.error(`[login] FALHOU — credenciais inválidas ou bloqueio. Body: ${bodyText.slice(0, 400)}`);
      process.exit(1);
    }

    console.log('[login] OK!');

    // Busca consultor_id
    let consultorId = null;
    const consultantRes = await page.request.get(`${API_BASE}/consultant`, { timeout: 20000 }).catch(() => null);
    if (consultantRes?.ok()) {
      const j = await consultantRes.json();
      consultorId = String(j?.id || j?.consultor?.id || j?.data?.id || j?.idconsultor || '') || null;
      console.log(`[consultant] id = ${consultorId}`);
      if (CONSULTANT_ID && consultorId) {
        await supabaseUpdate('consultants', CONSULTANT_ID, { igreen_consultor_id: consultorId });
      }
    }

    if (MODE === 'sync_network') {
      // Rede
      console.log('[network] buscando membros...');
      const members = await fetchPaginated(page, `${API_BASE}/network-map`, { pageParam: 'page', sizeParam: 'per_page', size: 100 });
      console.log(`[network] total: ${members.length} membros`);

      const deduped = new Map();
      for (const m of members) {
        const id = Number(m.idconsultor || m.id);
        if (id) deduped.set(id, m);
      }
      const netData = Array.from(deduped.values());

      const netRecords = netData.map(m => ({
        consultant_id: CONSULTANT_ID,
        igreen_id: Number(m.idconsultor || m.id),
        name: String(m.nome || 'Sem nome'),
        phone: normalizePhone(String(m.celular || '')),
        sponsor_id: m.idpatrocinador ? Number(m.idpatrocinador) : null,
        nivel: Number(m.nivel ?? 0),
        data_ativo: safeStr(m.data_ativo) || null,
        cidade: safeStr(m.cidade) || null,
        uf: safeStr(m.uf) || null,
        clientes_ativos: Number(m.cliativo ?? 0),
        gp: safeNum(m.gp) ?? 0,
        gi: safeNum(m.gi) ?? 0,
        qtde_diretos: Number(m.qtde_diretos ?? 0),
        updated_at: new Date().toISOString(),
      }));

      let netUpdated = 0;
      for (let i = 0; i < netRecords.length; i += 25) {
        const batch = netRecords.slice(i, i + 25);
        const saved = await supabaseUpsert('network_members', batch, 'consultant_id,igreen_id');
        netUpdated += saved.length;
      }
      console.log(`[network] upserted: ${netUpdated}`);

    } else {
      // Customers
      if (!consultorId) { console.error('[customers] consultor_id não encontrado'); process.exit(1); }

      console.log(`[customers] buscando clientes do consultor ${consultorId}...`);
      const allCustomers = await fetchPaginated(page, `${API_BASE}/customer-map/${consultorId}`, { pageParam: 'page', sizeParam: 'pageSize', size: 500 });
      console.log(`[customers] total: ${allCustomers.length} clientes`);

      const seenPhones = new Map();
      const records = [];
      let skipped = 0;

      for (const c of allCustomers) {
        const rec = buildCustomerRecord(c);
        if (!rec) { skipped++; continue; }
        const phone = String(rec.phone_whatsapp);
        if (seenPhones.has(phone)) {
          const icode = safeStr(get(c, 'codigoCliente', 'codigoIgreen', 'codigo'));
          if (icode) { rec.phone_whatsapp = `${phone}_${icode}`; }
          else { skipped++; continue; }
        }
        seenPhones.set(String(rec.phone_whatsapp), true);
        records.push(rec);
      }

      console.log(`[customers] processados: ${records.length}, pulados: ${skipped}`);

      let updated = 0;
      for (let i = 0; i < records.length; i += 100) {
        const batch = records.slice(i, i + 100);
        const saved = await supabaseUpsert('customers', batch, 'phone_whatsapp,consultant_id');
        updated += saved.length;
        console.log(`  batch ${i}–${i + batch.length}: ${saved.length} upserted`);
      }

      await supabaseSetting('last_igreen_sync', new Date().toISOString());
      console.log(`[customers] total upserted: ${updated}`);
    }

    console.log('[sync] concluído com sucesso!');
    process.exit(0);

  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch(e => {
  console.error('[sync] erro fatal:', e.message);
  process.exit(1);
});
