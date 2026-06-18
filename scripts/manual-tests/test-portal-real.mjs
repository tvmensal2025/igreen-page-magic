// TESTE REAL: Abre o portal iGreen e preenche TODOS os campos
// Dados extraídos da CNH + Conta de Energia
import { chromium } from 'playwright';

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
  address_city: 'ITU',
  address_state: 'SP',
  distribuidora: 'CPFL Piratininga',
  numero_instalacao: '1232095855190',
  electricity_bill_value: '300',
  document_type: 'cnh',
};

const delay = (ms) => new Promise(r => setTimeout(r, ms));

// Preencher campo React/MUI com 3 estratégias
async function reactFill(page, selector, value) {
  const el = typeof selector === 'string' ? page.locator(selector).first() : selector;
  if (await el.count() === 0) { console.log(`   ⚠️ Campo não encontrado: ${selector}`); return false; }

  // Detectar campo com máscara
  let isMasked = false;
  try {
    isMasked = await el.evaluate((input) => {
      const ph = (input.getAttribute('placeholder') || '').toLowerCase();
      const name = (input.getAttribute('name') || '').toLowerCase();
      const type = (input.getAttribute('type') || '').toLowerCase();
      const masks = ['whatsapp','celular','telefone','phone','cpf','cnpj','cep','data','nascimento'];
      return type === 'tel' || masks.some(k => ph.includes(k) || name.includes(k));
    });
  } catch (_) {}

  if (isMasked) {
    const digits = String(value).replace(/\D/g, '');
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const fresh = typeof selector === 'string' ? page.locator(selector).first() : selector;
        await fresh.click({ timeout: 3000 }).catch(() => {});
        await fresh.evaluate(i => { i.select?.(); });
        await page.keyboard.press('Backspace');
        await delay(40);
        await fresh.type(digits, { delay: 35 });
        await fresh.evaluate(i => i.dispatchEvent(new Event('blur', { bubbles: true })));
        await delay(150);
        const filled = await fresh.inputValue().catch(() => '');
        if (filled.replace(/\D/g, '') === digits) {
          console.log(`   ✅ [mask] ${typeof selector === 'string' ? selector : '(loc)'}: "${filled}"`);
          return true;
        }
      } catch (e) { console.log(`   ⚠️ [mask attempt ${attempt}] ${e.message}`); }
      await delay(400);
    }
    return false;
  }

  // Tier 1: React native setter
  try {
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
    if (filled === value) { console.log(`   ✅ [T1] ${typeof selector === 'string' ? selector : '(loc)'}: "${value}"`); return true; }
  } catch (_) {}

  // Tier 2: Playwright fill
  try {
    await el.fill(value);
    console.log(`   ✅ [T2] ${typeof selector === 'string' ? selector : '(loc)'}: "${value}"`);
    return true;
  } catch (_) {}

  // Tier 3: type
  try {
    await el.click();
    await el.fill('');
    await el.type(value, { delay: 40 });
    console.log(`   ✅ [T3] ${typeof selector === 'string' ? selector : '(loc)'}: "${value}"`);
    return true;
  } catch (_) {}

  return false;
}

// Aguardar campo por placeholder
async function waitField(page, placeholder, timeoutMs = 15000) {
  const esc = placeholder.replace(/"/g, '\\"');
  const loc = page.locator(`input[placeholder="${esc}"]`).first();
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await loc.count() > 0 && await loc.isVisible().catch(() => false)) return loc;
    await delay(300);
  }
  return null;
}

// Aguardar autofill após CPF
async function waitAutoFill(page, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const result = await page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll('input'));
        const find = (re) => {
          for (const i of inputs) {
            const ph = (i.placeholder || '').toLowerCase();
            const name = (i.name || '').toLowerCase();
            if (re.test(ph) || re.test(name)) { const v = i.value?.trim(); if (v && v.length > 1) return v; }
          }
          return '';
        };
        return { nome: find(/nome|fullname|titular/i), nasc: find(/nascim|birth|nasc/i) };
      });
      if (result.nome && result.nome.length >= 5) return result;
    } catch (_) {}
    await delay(500);
  }
  return { nome: '', nasc: '' };
}

async function screenshot(page, name) {
  try {
    await page.screenshot({ path: `screenshots/teste-real-${name}.png`, fullPage: true });
    console.log(`   📸 Screenshot: teste-real-${name}.png`);
  } catch (e) { console.log(`   ⚠️ Screenshot falhou: ${e.message}`); }
}

async function main() {
  console.log('═'.repeat(70));
  console.log('🚀 TESTE REAL - PORTAL iGREEN - PREENCHIMENTO COMPLETO');
  console.log('═'.repeat(70));
  console.log(`Portal: ${PORTAL_URL}`);
  console.log(`Consultor ID: ${CONSULTOR_ID}`);
  console.log('');

  // Criar pasta screenshots
  const { mkdirSync } = await import('fs');
  try { mkdirSync('screenshots', { recursive: true }); } catch (_) {}

  const browser = await chromium.launch({
    headless: false, // VISÍVEL para você ver
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  try {
    // ═══ FASE 1: Abrir portal ═══
    console.log('\n[1/8] 🌐 Abrindo portal iGreen...');
    await page.goto(PORTAL_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await delay(2000);
    await screenshot(page, '01-portal-aberto');
    console.log('   ✅ Portal carregado');

    // ═══ FASE 2: CEP + Valor da conta ═══
    console.log('\n[2/8] 📮 Preenchendo CEP e valor da conta...');
    const cepField = await waitField(page, 'CEP') || await waitField(page, 'cep') || page.locator('input[placeholder*="CEP"], input[placeholder*="cep"]').first();
    if (cepField && await cepField.count() > 0) {
      await reactFill(page, cepField, dados.cep);
    } else {
      console.log('   ⚠️ Campo CEP não encontrado, tentando por tipo...');
      await reactFill(page, 'input[name="cep"]', dados.cep);
    }
    await delay(500);

    // Valor da conta
    const valorField = page.locator('input[placeholder*="valor"], input[placeholder*="conta"], input[placeholder*="Valor"], input[name*="valor"], input[name*="bill"]').first();
    if (await valorField.count() > 0) {
      await reactFill(page, valorField, dados.electricity_bill_value);
    }
    await delay(500);

    // Botão Calcular
    console.log('   🔍 Procurando botão Calcular...');
    const calcBtn = page.locator('button:has-text("Calcular"), button:has-text("calcular"), button:has-text("CALCULAR"), button:has-text("Simular")').first();
    if (await calcBtn.count() > 0) {
      await calcBtn.click();
      console.log('   ✅ Clicou em Calcular');
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await delay(2000);
    } else {
      console.log('   ⚠️ Botão Calcular não encontrado');
    }
    await screenshot(page, '02-apos-calcular');

    // ═══ FASE 3: Garantir desconto ═══
    console.log('\n[3/8] 💰 Clicando em Garantir desconto...');
    const garantirBtn = page.locator('button:has-text("Garantir"), button:has-text("garantir"), button:has-text("GARANTIR"), button:has-text("desconto"), a:has-text("Garantir")').first();
    if (await garantirBtn.count() > 0) {
      await garantirBtn.click();
      console.log('   ✅ Clicou em Garantir');
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await delay(2000);
    } else {
      console.log('   ⚠️ Botão Garantir não encontrado, continuando...');
    }
    await screenshot(page, '03-apos-garantir');

    // ═══ FASE 4: CPF ═══
    console.log('\n[4/8] 🆔 Preenchendo CPF...');
    const cpfField = page.locator('input[placeholder*="CPF"], input[placeholder*="cpf"], input[name*="cpf"], input[name*="CPF"]').first();
    if (await cpfField.count() > 0) {
      await reactFill(page, cpfField, dados.cpf);
      console.log('   ⏳ Aguardando autofill (consulta Receita Federal)...');
      await delay(3000);
      const autoFill = await waitAutoFill(page, 10000);
      if (autoFill.nome) {
        console.log(`   ✅ Autofill: Nome="${autoFill.nome}", Nasc="${autoFill.nasc}"`);
      } else {
        console.log('   ⚠️ Autofill não preencheu (normal em alguns portais)');
      }
    } else {
      console.log('   ⚠️ Campo CPF não encontrado');
    }
    await screenshot(page, '04-apos-cpf');

    // ═══ FASE 5: WhatsApp + Email ═══
    console.log('\n[5/8] 📱 Preenchendo WhatsApp e Email...');
    const phoneField = page.locator('input[placeholder*="WhatsApp"], input[placeholder*="whatsapp"], input[placeholder*="Celular"], input[placeholder*="celular"], input[placeholder*="Telefone"], input[name*="phone"], input[type="tel"]').first();
    if (await phoneField.count() > 0) {
      await reactFill(page, phoneField, dados.phone);
    } else {
      console.log('   ⚠️ Campo telefone não encontrado');
    }
    await delay(500);

    // Confirmar telefone (se existir segundo campo)
    const phoneConfirm = page.locator('input[placeholder*="Confirme"], input[placeholder*="confirme"], input[placeholder*="Confirmar celular"]').first();
    if (await phoneConfirm.count() > 0) {
      await reactFill(page, phoneConfirm, dados.phone);
    }

    const emailField = page.locator('input[placeholder*="mail"], input[placeholder*="Mail"], input[type="email"], input[name*="email"]').first();
    if (await emailField.count() > 0) {
      await reactFill(page, emailField, dados.email);
    } else {
      console.log('   ⚠️ Campo email não encontrado');
    }
    await delay(500);

    // Confirmar email
    const emailConfirm = page.locator('input[placeholder*="Confirme"], input[placeholder*="confirme e-mail"], input[placeholder*="Confirmar e-mail"]').first();
    if (await emailConfirm.count() > 0) {
      await reactFill(page, emailConfirm, dados.email);
    }
    await screenshot(page, '05-apos-contato');

    // ═══ FASE 6: Endereço ═══
    console.log('\n[6/8] 📍 Preenchendo endereço...');
    // CEP novamente (formulário pode ter outro campo CEP)
    const cepField2 = page.locator('input[placeholder*="CEP"]:not([value])').first();
    if (await cepField2.count() > 0) {
      await reactFill(page, cepField2, dados.cep);
      await delay(1500); // Aguardar autocomplete do CEP
    }

    // Número
    const numField = page.locator('input[placeholder*="mero"], input[placeholder*="Número"], input[name*="number"], input[name*="numero"]').first();
    if (await numField.count() > 0) {
      await reactFill(page, numField, dados.address_number);
    }
    await delay(300);

    // Complemento (vazio)
    const compField = page.locator('input[placeholder*="Complemento"], input[placeholder*="complemento"], input[name*="complement"]').first();
    if (await compField.count() > 0) {
      await reactFill(page, compField, '');
    }
    await screenshot(page, '06-apos-endereco');

    // ═══ FASE 7: Distribuidora + Instalação ═══
    console.log('\n[7/8] ⚡ Preenchendo distribuidora e nº instalação...');

    // Distribuidora (pode ser select/dropdown)
    const distField = page.locator('input[placeholder*="Distribuidora"], input[placeholder*="distribuidora"], input[name*="distribuidora"]').first();
    if (await distField.count() > 0) {
      await reactFill(page, distField, dados.distribuidora);
    } else {
      // Tentar select MUI
      const distSelect = page.locator('[class*="MuiSelect"], select[name*="distribuidora"]').first();
      if (await distSelect.count() > 0) {
        await distSelect.click();
        await delay(500);
        const option = page.locator(`li:has-text("CPFL"), li:has-text("cpfl"), [data-value*="CPFL"]`).first();
        if (await option.count() > 0) {
          await option.click();
          console.log('   ✅ Distribuidora selecionada: CPFL');
        }
      }
    }
    await delay(300);

    // Número de instalação
    const instField = page.locator('input[placeholder*="instalação"], input[placeholder*="Instalação"], input[placeholder*="Código"], input[name*="instalacao"], input[name*="installation"]').first();
    if (await instField.count() > 0) {
      await reactFill(page, instField, dados.numero_instalacao);
    }
    await delay(300);

    // Tipo de documento
    const docSelect = page.locator('[class*="MuiSelect"]:has-text("Documento"), select[name*="document"], [class*="MuiSelect"]:has-text("RG")').first();
    if (await docSelect.count() > 0) {
      await docSelect.click();
      await delay(500);
      const cnh = page.locator('li:has-text("CNH")').first();
      if (await cnh.count() > 0) {
        await cnh.click();
        console.log('   ✅ Tipo documento: CNH');
      }
    }
    await screenshot(page, '07-apos-distribuidora');

    // ═══ FASE 8: Perguntas finais ═══
    console.log('\n[8/8] ❓ Respondendo perguntas finais...');

    // Perguntas sim/não comuns no portal
    const radioNao = page.locator('input[type="radio"][value="nao"], input[type="radio"][value="Não"], label:has-text("Não") input[type="radio"]');
    const count = await radioNao.count();
    if (count > 0) {
      for (let i = 0; i < count; i++) {
        try { await radioNao.nth(i).click(); } catch (_) {}
      }
      console.log(`   ✅ Respondeu ${count} perguntas com "Não"`);
    }
    await delay(500);
    await screenshot(page, '08-final');

    // ═══ RESULTADO ═══
    console.log('\n' + '═'.repeat(70));
    console.log('📊 RESULTADO DO TESTE');
    console.log('═'.repeat(70));

    // Listar todos os inputs e seus valores
    const allInputs = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"])'));
      return inputs.map(i => ({
        placeholder: i.placeholder || '',
        name: i.name || '',
        value: i.value || '',
        type: i.type || 'text',
      })).filter(i => i.placeholder || i.name);
    });

    console.log(`\n   📋 ${allInputs.length} campos encontrados no formulário:\n`);
    for (const input of allInputs) {
      const label = input.placeholder || input.name;
      const status = input.value ? '✅' : '❌';
      console.log(`   ${status} ${label}: "${input.value}"`);
    }

    const preenchidos = allInputs.filter(i => i.value).length;
    const total = allInputs.length;
    console.log(`\n   📊 Preenchidos: ${preenchidos}/${total}`);

    // NÃO clicar em Finalizar (teste seguro)
    console.log('\n   ⚠️ NÃO clicou em Finalizar (teste seguro)');
    console.log('   ✅ Navegador permanece aberto para você conferir!');
    console.log('═'.repeat(70));

    // Manter navegador aberto por 60 segundos para inspeção
    console.log('\n   ⏳ Navegador aberto por 60s para você conferir...');
    console.log('   (Ctrl+C para fechar antes)');
    await delay(60000);

  } catch (error) {
    console.error('\n❌ ERRO:', error.message);
    await screenshot(page, 'error');
  } finally {
    await browser.close();
    console.log('\n🔒 Navegador fechado.');
  }
}

main().catch(e => console.error('FATAL:', e));
