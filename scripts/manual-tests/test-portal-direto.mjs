// TESTE REAL DIRETO: Abre o portal iGreen e preenche usando a lógica do worker
// Pula a parte de download de documentos (que precisa de WhatsApp real)
// Foca no preenchimento do formulário que é onde travava
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { mkdirSync, writeFileSync } from 'fs';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const CONSULTOR_ID = '124170';
const PORTAL_URL = `https://digital.igreenenergy.com.br/?id=${CONSULTOR_ID}&sendcontract=true`;

const dados = {
  name: 'HUMBERTO VIEIRA E SILVA',
  cpf: '33277354172',
  rg: '55480061',
  data_nascimento: '22/07/1964',
  phone: '11971254913',
  email: 'tvmensal110@gmail.com',
  cep: '13309410',
  address_street: 'R GAL EPAMINONDAS TEIXEIRA GUIMALHAES',
  address_number: '182',
  address_neighborhood: 'VL GARDIMAN',
  address_complement: '',
  address_city: 'ITU',
  address_state: 'SP',
  distribuidora: 'CPFL Piratininga',
  numero_instalacao: '1232095855190',
  electricity_bill_value: '300',
  document_type: 'CNH',
};

const delay = (ms) => new Promise(r => setTimeout(r, ms));
try { mkdirSync('screenshots', { recursive: true }); } catch (_) {}

async function screenshot(page, name) {
  try {
    await page.screenshot({ path: `screenshots/real-${name}.png`, fullPage: true });
    console.log(`   📸 ${name}`);
  } catch (_) {}
}

// Preencher campo com máscara (CPF, CEP, telefone)
async function typeMasked(page, selector, value, label) {
  const digits = String(value).replace(/\D/g, '');
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const el = page.locator(selector).first();
      if (await el.count() === 0) { await delay(500); continue; }
      await el.scrollIntoViewIfNeeded().catch(() => {});
      await el.click({ force: true, timeout: 3000 }).catch(() => {});
      await el.evaluate(i => i.focus()).catch(() => {});
      await delay(60);
      // Limpar
      await el.evaluate(i => { i.select?.(); }).catch(() => {});
      await page.keyboard.press('Backspace').catch(() => {});
      await delay(40);
      // Re-focar
      await el.click({ force: true, timeout: 3000 }).catch(() => {});
      await el.evaluate(i => i.focus()).catch(() => {});
      await delay(40);
      // Digitar
      await page.keyboard.type(digits, { delay: 30 });
      await page.keyboard.press('Tab').catch(() => {});
      await delay(150);
      const filled = await el.inputValue().catch(() => '');
      if (filled.replace(/\D/g, '') === digits) {
        console.log(`   ✅ ${label}: "${filled}"`);
        return true;
      }
      console.log(`   🔁 ${label} attempt ${attempt}: "${filled}" ≠ "${digits}"`);
    } catch (e) {
      console.log(`   ⚠️ ${label} attempt ${attempt}: ${e.message}`);
    }
    await delay(300 + attempt * 200);
  }
  console.log(`   ❌ ${label}: FALHOU após 5 tentativas`);
  return false;
}

// Preencher campo normal (sem máscara)
async function fillField(page, selector, value, label) {
  try {
    const el = page.locator(selector).first();
    if (await el.count() === 0) { console.log(`   ⚠️ ${label}: não encontrado`); return false; }
    await el.evaluate((input, val) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (setter) {
        const tracker = input._valueTracker;
        if (tracker) tracker.setValue('');
        setter.call(input, val);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new Event('blur', { bubbles: true }));
      }
    }, value);
    const filled = await el.inputValue().catch(() => '');
    if (filled === value) { console.log(`   ✅ ${label}: "${value}"`); return true; }
    // Fallback: fill
    await el.fill(value);
    console.log(`   ✅ ${label}: "${value}" (fill)`);
    return true;
  } catch (e) {
    console.log(`   ❌ ${label}: ${e.message}`);
    return false;
  }
}

// Aguardar elemento aparecer
async function waitFor(page, selector, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const el = page.locator(selector).first();
    if (await el.count() > 0 && await el.isVisible().catch(() => false)) return el;
    await delay(300);
  }
  return null;
}

async function main() {
  console.log('═'.repeat(70));
  console.log('🚀 TESTE REAL DIRETO - PORTAL iGREEN');
  console.log('═'.repeat(70));
  console.log(`URL: ${PORTAL_URL}\n`);

  const browser = await chromium.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  try {
    // ═══ FASE 1: Abrir portal ═══
    console.log('[1/9] 🌐 Abrindo portal...');
    await page.goto(PORTAL_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await delay(3000);
    await screenshot(page, '01-portal');

    // ═══ FASE 2: CEP + Valor ═══
    console.log('\n[2/9] 📮 CEP + Valor da conta...');
    await typeMasked(page, 'input[name="cep"], input[placeholder*="CEP"]', dados.cep, 'CEP');
    await delay(500);

    // Valor da conta
    const valorSel = 'input[name="consumption"], input[placeholder*="valor"], input[placeholder*="conta"]';
    await fillField(page, valorSel, dados.electricity_bill_value, 'Valor conta');
    await delay(500);

    // Botão Calcular
    const calcBtn = page.locator('button:has-text("Calcular"), button:has-text("CALCULAR"), button:has-text("Simular")').first();
    if (await calcBtn.count() > 0) {
      await calcBtn.click();
      console.log('   ✅ Clicou Calcular');
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await delay(3000);
    }
    await screenshot(page, '02-calcular');

    // ═══ FASE 3: Garantir desconto ═══
    console.log('\n[3/9] 💰 Garantir desconto...');
    // Procurar botão com vários textos possíveis
    const garantirSels = [
      'button:has-text("Garantir")', 'button:has-text("garantir")',
      'button:has-text("Quero economizar")', 'button:has-text("quero")',
      'a:has-text("Garantir")', 'button:has-text("Continuar")',
      'button:has-text("Próximo")', 'button:has-text("Avançar")',
    ];
    let clicked = false;
    for (const sel of garantirSels) {
      const btn = page.locator(sel).first();
      if (await btn.count() > 0 && await btn.isVisible().catch(() => false)) {
        await btn.click();
        console.log(`   ✅ Clicou: ${sel}`);
        clicked = true;
        break;
      }
    }
    if (!clicked) console.log('   ⚠️ Nenhum botão encontrado, tentando scroll...');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await delay(3000);
    await screenshot(page, '03-garantir');

    // ═══ FASE 4: CPF ═══
    console.log('\n[4/9] 🆔 CPF...');
    const cpfSel = 'input[placeholder*="CPF"], input[name*="cpf"], input[placeholder*="cpf"]';
    const cpfEl = await waitFor(page, cpfSel, 10000);
    if (cpfEl) {
      await typeMasked(page, cpfSel, dados.cpf, 'CPF');
      console.log('   ⏳ Aguardando autofill (Receita Federal)...');
      await delay(5000);
      // Verificar se nome foi preenchido automaticamente
      const autoName = await page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll('input'));
        for (const i of inputs) {
          const ph = (i.placeholder || '').toLowerCase();
          const name = (i.name || '').toLowerCase();
          if (/nome|fullname|titular/i.test(ph) || /nome|fullname|titular/i.test(name)) {
            return i.value?.trim() || '';
          }
        }
        return '';
      });
      if (autoName) console.log(`   ✅ Autofill nome: "${autoName}"`);
      else console.log('   ⚠️ Autofill não preencheu nome');
    } else {
      console.log('   ❌ Campo CPF não apareceu em 10s');
    }
    await screenshot(page, '04-cpf');

    // ═══ FASE 5: WhatsApp ═══
    console.log('\n[5/9] 📱 WhatsApp...');
    const phoneSels = [
      'input[placeholder*="WhatsApp"]', 'input[placeholder*="whatsapp"]',
      'input[placeholder*="Celular"]', 'input[placeholder*="celular"]',
      'input[placeholder*="Telefone"]', 'input[placeholder*="telefone"]',
      'input[name*="phone"]', 'input[type="tel"]',
    ];
    for (const sel of phoneSels) {
      const el = page.locator(sel).first();
      if (await el.count() > 0 && await el.isVisible().catch(() => false)) {
        await typeMasked(page, sel, dados.phone, 'WhatsApp');
        break;
      }
    }
    // Confirmar WhatsApp
    const phoneConfSels = ['input[placeholder*="Confirme o celular"]', 'input[placeholder*="Confirmar celular"]', 'input[placeholder*="Confirme celular"]'];
    for (const sel of phoneConfSels) {
      const el = page.locator(sel).first();
      if (await el.count() > 0) { await typeMasked(page, sel, dados.phone, 'Confirmar WhatsApp'); break; }
    }
    await delay(500);
    await screenshot(page, '05-whatsapp');

    // ═══ FASE 6: Email ═══
    console.log('\n[6/9] 📧 Email...');
    const emailSels = ['input[placeholder*="mail"]', 'input[placeholder*="Mail"]', 'input[type="email"]', 'input[name*="email"]'];
    for (const sel of emailSels) {
      const el = page.locator(sel).first();
      if (await el.count() > 0 && await el.isVisible().catch(() => false)) {
        await fillField(page, sel, dados.email, 'Email');
        break;
      }
    }
    // Confirmar email
    const emailConfSels = ['input[placeholder*="Confirme o e-mail"]', 'input[placeholder*="Confirmar e-mail"]', 'input[placeholder*="Confirme e-mail"]'];
    for (const sel of emailConfSels) {
      const el = page.locator(sel).first();
      if (await el.count() > 0) { await fillField(page, sel, dados.email, 'Confirmar Email'); break; }
    }
    await delay(500);
    await screenshot(page, '06-email');

    // ═══ FASE 7: Endereço ═══
    console.log('\n[7/9] 📍 Endereço...');
    // Número
    const numSels = ['input[placeholder*="mero"]', 'input[placeholder*="Número"]', 'input[name*="number"]', 'input[name*="numero"]'];
    for (const sel of numSels) {
      const el = page.locator(sel).first();
      if (await el.count() > 0 && await el.isVisible().catch(() => false)) {
        await fillField(page, sel, dados.address_number, 'Número');
        break;
      }
    }
    await delay(500);
    await screenshot(page, '07-endereco');

    // ═══ FASE 8: Distribuidora + Instalação + Tipo Doc ═══
    console.log('\n[8/9] ⚡ Distribuidora + Instalação...');
    // Distribuidora (geralmente é um select MUI)
    const distSels = ['input[placeholder*="istribuidora"]', 'input[name*="distribuidora"]'];
    for (const sel of distSels) {
      const el = page.locator(sel).first();
      if (await el.count() > 0) { await fillField(page, sel, dados.distribuidora, 'Distribuidora'); break; }
    }
    // Nº Instalação
    const instSels = ['input[placeholder*="nstalação"]', 'input[placeholder*="Código"]', 'input[name*="instalacao"]', 'input[name*="installation"]'];
    for (const sel of instSels) {
      const el = page.locator(sel).first();
      if (await el.count() > 0) { await fillField(page, sel, dados.numero_instalacao, 'Nº Instalação'); break; }
    }
    await delay(500);
    await screenshot(page, '08-distribuidora');

    // ═══ FASE 9: Perguntas + Resultado ═══
    console.log('\n[9/9] ❓ Perguntas finais...');
    // Marcar "Não" em perguntas sim/não
    const naoLabels = page.locator('label:has-text("Não"), span:has-text("Não")');
    const naoCount = await naoLabels.count();
    for (let i = 0; i < naoCount; i++) {
      try { await naoLabels.nth(i).click(); } catch (_) {}
    }
    if (naoCount > 0) console.log(`   ✅ ${naoCount} perguntas respondidas "Não"`);
    await delay(500);
    await screenshot(page, '09-final');

    // ═══ DUMP DE TODOS OS CAMPOS ═══
    console.log('\n' + '═'.repeat(70));
    console.log('📊 ESTADO FINAL DO FORMULÁRIO');
    console.log('═'.repeat(70));

    const allInputs = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('input, select, textarea'))
        .filter(el => el.offsetParent !== null) // visíveis
        .map(el => ({
          tag: el.tagName,
          type: el.type || '',
          name: el.name || '',
          placeholder: el.placeholder || '',
          value: el.value || '',
          id: el.id || '',
        }));
    });

    let preenchidos = 0, vazios = 0;
    for (const inp of allInputs) {
      if (inp.type === 'hidden' || inp.type === 'submit') continue;
      const label = inp.placeholder || inp.name || inp.id || `${inp.tag}[${inp.type}]`;
      const status = inp.value ? '✅' : '❌';
      if (inp.value) preenchidos++; else vazios++;
      console.log(`   ${status} ${label}: "${inp.value}"`);
    }

    console.log(`\n   📊 Preenchidos: ${preenchidos} | Vazios: ${vazios}`);
    console.log('\n   ⚠️ NÃO clicou em Finalizar (teste seguro)');
    console.log('   👀 Navegador aberto por 120s para você conferir...');
    console.log('═'.repeat(70));

    await delay(120000);

  } catch (error) {
    console.error('\n❌ ERRO:', error.message);
    await screenshot(page, 'error');
  } finally {
    await browser.close();
    console.log('🔒 Navegador fechado.');
  }
}

main().catch(e => console.error('FATAL:', e));
