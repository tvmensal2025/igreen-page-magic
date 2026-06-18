// TESTE REAL: Insere lead no Supabase com documentos como data URL
// e roda a automação REAL do worker-portal (playwright-automation.mjs)
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_KEY || SUPABASE_KEY.length < 50) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY inválida');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Converter arquivos locais para data URL
const cnhBytes = readFileSync('fixtures/cnh-frente.jpg');
const cnhBase64 = cnhBytes.toString('base64');
const cnhDataUrl = `data:image/jpeg;base64,${cnhBase64}`;

const contaBytes = readFileSync('fixtures/conta-energia.pdf');
const contaBase64 = contaBytes.toString('base64');
const contaDataUrl = `data:application/pdf;base64,${contaBase64}`;

async function main() {
  console.log('═'.repeat(70));
  console.log('🚀 TESTE REAL - AUTOMAÇÃO COMPLETA DO WORKER');
  console.log('═'.repeat(70));

  // 1. Buscar consultor
  console.log('\n[1/5] 👤 Buscando consultor...');
  const { data: consultants } = await supabase.from('consultants').select('id, name, igreen_id').limit(1);
  const consultantId = consultants?.[0]?.id || null;
  const igreenId = consultants?.[0]?.igreen_id || '124170';
  console.log(`   Consultor: ${consultants?.[0]?.name || 'N/A'} (igreen_id: ${igreenId})`);

  // 2. Inserir lead
  console.log('\n[2/5] 📝 Inserindo lead no banco...');
  const insertData = {
    name: 'HUMBERTO VIEIRA E SILVA',
    cpf: '33277354172',
    rg: '55480061',
    data_nascimento: '22/07/1964',
    document_type: 'cnh',
    phone_whatsapp: '5511971254913',
    phone_landline: '(11) 97125-4913',
    email: 'tvmensal110@gmail.com',
    address_street: 'R GAL EPAMINONDAS TEIXEIRA GUIMALHAES',
    address_number: '182',
    address_neighborhood: 'VL GARDIMAN',
    address_complement: '',
    address_city: 'ITU',
    address_state: 'SP',
    cep: '13309410',
    distribuidora: 'CPFL Piratininga',
    numero_instalacao: '1232095855190',
    electricity_bill_value: 205.04,
    electricity_bill_photo_url: contaDataUrl,
    document_front_url: cnhDataUrl,
    document_back_url: 'nao_aplicavel',
    status: 'data_complete',
    conversation_step: 'portal_submitting',
  };
  if (consultantId) insertData.consultant_id = consultantId;

  const { data: lead, error: insertErr } = await supabase
    .from('customers')
    .insert(insertData)
    .select()
    .single();

  if (insertErr) {
    console.error('   ❌ Erro:', insertErr.message);
    process.exit(1);
  }
  console.log(`   ✅ Lead: ${lead.id}`);
  console.log(`   Nome: ${lead.name} | CPF: ${lead.cpf}`);

  // 3. Configurar env e rodar automação
  console.log('\n[3/5] 🤖 Iniciando automação Playwright...');
  console.log('   (Navegador vai abrir VISÍVEL na sua tela)');
  console.log('');

  process.env.SUPABASE_URL = SUPABASE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = SUPABASE_KEY;
  process.env.HEADLESS = '0';
  process.env.IGREEN_CONSULTOR_ID = igreenId;

  let result;
  try {
    const { executarAutomacao } = await import('./worker-portal/playwright-automation.mjs');
    result = await executarAutomacao(lead.id, {
      headless: false,
      stopBeforeSubmit: true, // NÃO clicar em Enviar (teste seguro)
    });
  } catch (error) {
    console.error('\n❌ ERRO NA AUTOMAÇÃO:', error.message);
    result = { success: false, error: error.message };
  }

  // 4. Resultado
  console.log('\n' + '═'.repeat(70));
  console.log('📊 RESULTADO');
  console.log('═'.repeat(70));
  console.log(`   Sucesso: ${result?.success ? '✅ SIM' : '❌ NÃO'}`);
  if (result?.error) console.log(`   Erro: ${result.error}`);
  if (result?.pageUrl) console.log(`   URL: ${result.pageUrl}`);

  // 5. Status final no banco
  console.log('\n[4/5] 🔍 Status final no banco...');
  const { data: finalLead } = await supabase
    .from('customers')
    .select('status, conversation_step, error_message')
    .eq('id', lead.id)
    .single();

  if (finalLead) {
    console.log(`   Status: ${finalLead.status}`);
    console.log(`   Step: ${finalLead.conversation_step}`);
    if (finalLead.error_message) console.log(`   Erro: ${finalLead.error_message}`);
  }

  // 6. Limpar
  console.log('\n[5/5] 🧹 Limpando lead de teste...');
  await supabase.from('customers').delete().eq('id', lead.id);
  console.log('   ✅ Lead removido');
  console.log('═'.repeat(70));
}

main().catch(e => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
