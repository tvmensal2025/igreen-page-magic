/**
 * Dry-run de cadastro PF — monta payload + auth, NUNCA posta /cliente/club.
 * Uso: node _dryrun-cadastro.mjs
 */

import { writeFileSync } from 'node:fs';
import { ClubClient, closeBrowser } from './club-api-client.mjs';
import { maskPii } from './club-normalize.mjs';

const dados = {
  idconsultor: Number(process.env.CLUB_DEFAULT_CONSULTOR || 124170),
  indcli: 0,
  cpf: '11144477735',
  nome: 'TESTE MAPEAMENTO WORKER CLUB',
  dtnasc: '01/01/1990',
  rg: '123456789',
  email: 'teste.mapeamento.worker.club@example.com',
  celular: '11987654321',
  cep: '01310100',
  endereco: 'Avenida Paulista',
  numero: '100',
  complemento: '',
  bairro: 'Bela Vista',
  cidade: 'São Paulo',
  uf: 'SP',
};

const client = new ClubClient({ idconsultor: dados.idconsultor });
try {
  const result = await client.cadastrarPf(dados, { dryRun: true });
  console.log(JSON.stringify({
    success: result.success,
    dryRun: result.dryRun,
    wouldPost: result.wouldPost,
    consultor: result.consultor,
    payload: maskPii(result.payloadRaw || result.payload),
  }, null, 2));
  writeFileSync('dryrun-result.json', JSON.stringify(result, null, 2));
  console.log('→ dryrun-result.json');
} catch (e) {
  console.error('FAIL', e.message, e.details || '');
  process.exitCode = 1;
} finally {
  await closeBrowser();
}
