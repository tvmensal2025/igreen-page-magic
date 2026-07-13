/**
 * DryRun por UF — valida caminho de cadastro SEM criar cliente.
 * Cobre: resolve + /bonus/rules + montarPayloadCadastro (formato).
 * NÃO chama: POST /customers, OTP, terms, manual-fallback.
 */
import { Portal2Client, closeBrowser, formatPhone, formatCep, onlyDigits } from './portal2-api-client.mjs';
import fs from 'node:fs';

const c = new Portal2Client({ idconsultor: 124170 });

/** Casos representativos (cidade real + alias comum + CEP). */
const CASES = [
  { uf: 'SP', label: 'CPFL (ex-Piratininga/Salto)', name: 'CPFL PIRATININGA', city: 'SALTO', cep: '13323630', consumo: 350 },
  { uf: 'SP', label: 'CPFL (Paulista/Ribeirão)', name: 'PAULISTA', city: 'RIBEIRAO PRETO', cep: '14010000', consumo: 400 },
  { uf: 'SP', label: 'ELEKTRO (Campinas)', name: 'ELEKTRO', city: 'CAMPINAS', cep: '13010000', consumo: 300 },
  { uf: 'SP', label: 'CPFL SANTA CRUZ', name: 'CPFL SANTA CRUZ', city: 'OURINHOS', cep: '19900001', consumo: 280 },
  { uf: 'SP', label: 'ENERGISA SUL SUDESTE', name: 'ENERGISA SUL SUDESTE', city: 'PRESIDENTE PRUDENTE', cep: '19010000', consumo: 320 },
  { uf: 'MG', label: 'CEMIG-D', name: 'CEMIG', city: 'BELO HORIZONTE', cep: '30110000', consumo: 350 },
  { uf: 'MG', label: 'ENERGISA MINAS RIO', name: 'ENERGISA MINAS RIO', city: 'CATAGUASES', cep: '36770001', consumo: 250 },
  { uf: 'PR', label: 'COPEL', name: 'COPEL', city: 'CURITIBA', cep: '80010000', consumo: 350 },
  { uf: 'PR', label: 'CELESC (PR)', name: 'CELESC', city: 'CURITIBA', cep: '80010000', consumo: 300 },
  { uf: 'RJ', label: 'ENEL RJ', name: 'ENEL', city: 'NITEROI', cep: '24020000', consumo: 350 },
  { uf: 'RJ', label: 'ENERGISA MINAS RIO (RJ)', name: 'ENERGISA MINAS RIO', city: 'NITEROI', cep: '24020000', consumo: 280 },
  { uf: 'RS', label: 'CEEE', name: 'CEEE', city: 'PORTO ALEGRE', cep: '90010000', consumo: 300 },
  { uf: 'RS', label: 'RGE', name: 'RGE', city: 'CAXIAS DO SUL', cep: '95010000', consumo: 300 },
  { uf: 'SC', label: 'CELESC', name: 'CELESC', city: 'FLORIANOPOLIS', cep: '88010000', consumo: 300 },
  { uf: 'BA', label: 'COELBA', name: 'COELBA', city: 'SALVADOR', cep: '40010000', consumo: 350 },
  { uf: 'CE', label: 'ENEL CE', name: 'ENEL', city: 'FORTALEZA', cep: '60010000', consumo: 350 },
  { uf: 'PE', label: 'NEO ENERGIA', name: 'CELPE', city: 'RECIFE', cep: '50010000', consumo: 300 },
  { uf: 'GO', label: 'EQUATORIAL', name: 'CELG', city: 'GOIANIA', cep: '74010000', consumo: 300 },
  { uf: 'MT', label: 'ENERGISA MT', name: 'ENERGISA', city: 'CUIABA', cep: '78010000', consumo: 300 },
  { uf: 'MS', label: 'ELEKTRO MS', name: 'ELEKTRO', city: 'TRES LAGOAS', cep: '79600001', consumo: 280 },
  { uf: 'ES', label: 'EDP ES', name: 'ESCELSA', city: 'VITORIA', cep: '29010000', consumo: 300 },
  { uf: 'PA', label: 'EQUATORIAL PA', name: 'CELPA', city: 'BELEM', cep: '66010000', consumo: 350 },
  { uf: 'PB', label: 'ENERGISA PB', name: 'ENERGISA', city: 'JOAO PESSOA', cep: '58010000', consumo: 280 },
  { uf: 'RN', label: 'COSERN', name: 'COSERN', city: 'NATAL', cep: '59010000', consumo: 280 },
  { uf: 'AL', label: 'EQUATORIAL AL', name: 'EQUATORIAL', city: 'MACEIO', cep: '57010000', consumo: 280 },
  { uf: 'TO', label: 'ENERGISA TOCANTINS', name: 'ENERGISA', city: 'PALMAS', cep: '77010000', consumo: 280 },
  // Negativos esperados (sem cobertura)
  { uf: 'RJ', label: 'LIGHT (sem cobertura)', name: 'LIGHT', city: 'RIO DE JANEIRO', cep: '20010000', consumo: 350, expectNoCoverage: true },
  { uf: 'SP', label: 'ENEL SP capital (sem cobertura)', name: 'ENEL', city: 'SAO PAULO', cep: '01001000', consumo: 350, expectNoCoverage: true },
  { uf: 'DF', label: 'DF (sem cobertura)', name: 'CEB', city: 'BRASILIA', cep: '70040010', consumo: 300, expectNoCoverage: true },
];

function payloadChecks(payload) {
  const errs = [];
  if (!payload.concessionaria) errs.push('concessionaria vazia');
  if (!payload.fornecedora) errs.push('fornecedora vazia');
  if (!payload.consumomedio || payload.consumomedio <= 0) errs.push('consumomedio inválido');
  if (String(payload.celular || '').length < 14) errs.push(`celular curto: ${payload.celular}`);
  if (!/^\d{5}-\d{3}$/.test(String(payload.cep || ''))) errs.push(`cep formato: ${payload.cep}`);
  if (!/^\d{11}$/.test(String(payload.cpf_cnpj || ''))) errs.push('cpf não tem 11 dígitos');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(payload.dtnasc || ''))) errs.push(`dtnasc: ${payload.dtnasc}`);
  if (payload.sendcontract !== true && payload.sendcontract !== false) errs.push('sendcontract ausente');
  return errs;
}

const results = [];
let pass = 0, fail = 0;

console.log('=== DRYRUN UF — sem POST /customers ===\n');

for (const tc of CASES) {
  const row = { ...tc, ok: false, steps: {} };
  try {
    // 1) resolve
    const resolved = await c.resolveConcessionaria(tc.uf, tc.name, tc.city);
    row.steps.resolved = resolved;

    // 2) CEP (se tiver)
    if (tc.cep) {
      const cepR = await c.resolveConcessionariaByCep(tc.cep).catch((e) => ({ error: e.message }));
      row.steps.cep = cepR?.concessionaria ?? null;
      row.steps.cepNaoAtendida = !!cepR?.naoAtendida;
      row.steps.cepCity = cepR?.cidade ?? null;
    }

    if (tc.expectNoCoverage) {
      // Esperamos null / sem rules
      if (!resolved) {
        row.ok = true;
        row.note = 'sem cobertura (esperado)';
      } else {
        // resolveu nome mas pode não ter regra na UF errada
        try {
          await c.getBonusRules({ uf: tc.uf, concessionaria: resolved, consumo_medio: tc.consumo });
          row.ok = false;
          row.error = `esperava sem cobertura mas rules OK com ${resolved}`;
        } catch {
          row.ok = true;
          row.note = `resolveu ${resolved} mas rules 404 (ok p/ negativo)`;
        }
      }
    } else {
      if (!resolved) throw new Error('resolveConcessionaria retornou null');

      // 3) bonus/rules
      const rulesRaw = await c.getBonusRules({
        uf: tc.uf,
        concessionaria: resolved,
        consumo_medio: tc.consumo,
      });
      const list = Array.isArray(rulesRaw) ? rulesRaw : (rulesRaw?.rules ?? []);
      const pick = c._pickActiveBonusRule(list, tc.consumo);
      if (!pick) throw new Error(`sem regra ativa em ${list.length} rules`);
      row.steps.fornecedora = pick.fornecedora;
      row.steps.desconto = pick.desconto_cliente;
      row.steps.rulesN = list.length;

      // 4) montar payload (formato) — sem enviar
      const payload = c.montarPayloadCadastro({
        cpf: '11144477735',
        nome: 'DRYRUN TESTE IGREEN',
        dataNascimento: '15/08/1990',
        whatsapp: '11999887766',
        email: 'dryrun.naoenviar@example.com',
        cep: tc.cep || '01310100',
        endereco: 'RUA DRYRUN',
        numero: '100',
        bairro: 'CENTRO',
        cidade: tc.city,
        uf: tc.uf,
        numeroInstalacao: '1234567890',
        consumoMedio: tc.consumo,
        concessionaria: resolved,
        fornecedora: pick.fornecedora,
        desconto_cliente: Number(String(pick.desconto_cliente || '8').split(',')[0]),
        sendcontract: true,
        contaUnica: false,
        transferirTitularidade: false,
      });
      const fmtErrs = payloadChecks(payload);
      row.steps.payloadCelular = payload.celular;
      row.steps.payloadCep = payload.cep;
      if (fmtErrs.length) throw new Error(`payload: ${fmtErrs.join('; ')}`);

      // 5) check-exists (só leitura)
      const exists = await c.checkCustomerExists({
        email: 'dryrun.naoenviar@example.com',
        document: '11144477735',
      }).catch((e) => ({ error: e.message }));
      row.steps.exists = exists?.exists ?? null;

      row.ok = true;
    }
  } catch (e) {
    row.ok = false;
    row.error = String(e.message || e).slice(0, 220);
  }

  if (row.ok) pass++; else fail++;
  const mark = row.ok ? '✓' : '✗';
  const detail = row.ok
    ? (row.note || `${row.steps.resolved} → ${row.steps.fornecedora} ${row.steps.desconto}%`)
    : row.error;
  console.log(`${mark} [${tc.uf}] ${tc.label}: ${detail}`);
  results.push(row);
}

const report = {
  at: new Date().toISOString(),
  pass, fail, total: CASES.length,
  results,
};
fs.writeFileSync('/tmp/dryrun-uf-report.json', JSON.stringify(report, null, 2));

console.log(`\n==== RESUMO: ${pass}/${CASES.length} PASS | ${fail} FAIL ====`);
if (fail) {
  console.log('Falhas:');
  for (const r of results.filter((x) => !x.ok)) {
    console.log(`  - [${r.uf}] ${r.label}: ${r.error}`);
  }
}
await closeBrowser();
process.exit(fail ? 1 : 0);
