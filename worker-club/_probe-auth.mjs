/**
 * Probes de auth Club — NÃO posta cadastro.
 * Uso: node _probe-auth.mjs [idconsultor]
 * Opcional: CLUB_PROXY_SERVER / CLUB_PROXY_USER / CLUB_PROXY_PASS
 */

import { ClubClient, closeBrowser } from './club-api-client.mjs';

const id = Number(process.argv[2] || process.env.CLUB_DEFAULT_CONSULTOR || 124170);

const client = new ClubClient({ idconsultor: id });
try {
  console.log('→ loginConsultor', id);
  const auth = await client.loginConsultor();
  console.log('OK name=', auth.name, 'licenca=', auth.tipo_licenca, 'tokenLen=', auth.token?.length);

  console.log('→ listPlanos');
  const planos = await client.listPlanos();
  console.log('OK planos=', Array.isArray(planos) ? planos.length : typeof planos);

  console.log('→ lookupCep 01310-100');
  const cep = await client.lookupCep('01310100');
  console.log('OK', cep);
} catch (e) {
  console.error('FAIL', e.message);
  process.exitCode = 1;
} finally {
  await closeBrowser();
}
