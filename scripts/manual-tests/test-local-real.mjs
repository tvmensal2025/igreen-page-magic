// TESTE LOCAL REAL: Insere lead no Supabase e roda a automação do worker localmente
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// JPEG mínimo em base64 (1x1 pixel)
const JPEG_B64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAFBABAAAAAAAAAAAAAAAAAAAACf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKgA/9k=';

async function main() {
  console.log('═'.repeat(70));
  console.log('🚀 TESTE LOCAL REAL - WORKER + PORTAL iGREEN');
  console.log('═'.repeat(70));

  // 1. Buscar consultor
  console.log('\n[1/5] 👤 Buscando consultor...');
  const { data: consultants } = await supabase.from('consultants').select('id, name, igreen_id').limit(1);
  const consultant = consultants?.[0];
  if (consultant) {
    console.log(`   ✅ ${consultant.name} (igreen_id: ${consultant.igreen_id})`);
  } else {
    console.log('   ⚠️ Nenhum consultor, usando fallback');
  }

  // 2. Inserir lead
  console.log('\n[2/5] 📝 Inserindo lead de teste...');
  const leadData = {
    name: 'CARLOS EDUARDO MENDES TESTE',
    cpf: '52998224725',  // CPF válido fictício
    rg: '44782019',
    data_nascimento: '15/03/1985',
    document_type: 'cnh',
    phone_whatsapp: '5511971254913',
    phone_landline: '(11) 97125-4913',
    email: 'tvmensal110@gmail.com',
    address_street: 'RUA FLORIANO PEIXOTO',
    address_number: '450',
    address_neighborhood: 'CENTRO',
    address_complement: '',
    address_city: 'ITU',
    address_state: 'SP',
    cep: '13300070',
    distribuidora: 'CPFL Piratininga',
    numero_instalacao: '9988776655',  // fictício — não existe no portal
    electricity_bill_value: 320.50,
    // URLs data: com JPEG real (base64 inline) — worker aceita isso
    electricity_bill_photo_url: `data:image/jpeg;base64,${JPEG_B64}`,
    document_front_url: `data:image/jpeg;base64,${JPEG_B64}`,
    document_back_url: 'nao_aplicavel',
    // Base64 inline para o worker baixar
    bill_base64: JPEG_B64,
    document_front_base64: JPEG_B64,
    status: 'data_complete',
    conversation_step: 'portal_submitting',
  };
  if (consultant) leadData.consultant_id = consultant.id;

  const { data: lead, error: insertErr } = await supabase
    .from('customers')
    .insert(leadData)
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
  process.env.IGREEN_CONSULTOR_ID = consultant?.igreen_id || '124170';

  let result;
  try {
    const { executarAutomacao } = await import('./worker-portal/playwright-automation.mjs');
    result = await executarAutomacao(lead.id, {
      headless: false,
      stopBeforeSubmit: false, // VAI ATÉ O FINAL
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
  if (result?.pageUrl) console.log(`   URL final: ${result.pageUrl}`);

  // 5. Status no banco
  console.log('\n[4/5] 🔍 Status final no banco...');
  const { data: finalLead } = await supabase
    .from('customers')
    .select('id, name, status, conversation_step, error_message, portal_submitted_at')
    .eq('id', lead.id)
    .single();

  if (finalLead) {
    console.log(`   Status: ${finalLead.status}`);
    console.log(`   Step: ${finalLead.conversation_step}`);
    if (finalLead.error_message) console.log(`   Erro: ${finalLead.error_message}`);
    if (finalLead.portal_submitted_at) console.log(`   Submetido: ${finalLead.portal_submitted_at}`);
  }

  // 6. Limpar
  console.log('\n[5/5] 🧹 Limpando lead de teste...');
  await supabase.from('customers').delete().eq('id', lead.id);
  console.log('   ✅ Lead removido');

  console.log('\n' + '═'.repeat(70));
  if (result?.success) {
    console.log('🎉 TESTE PASSOU! A automação preencheu o portal com sucesso!');
  } else {
    console.log('⚠️ Teste falhou — verifique o erro acima.');
  }
  console.log('═'.repeat(70));
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
