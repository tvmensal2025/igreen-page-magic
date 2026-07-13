import { Portal2Client, closeBrowser } from './portal2-api-client.mjs';
const c = new Portal2Client({ idconsultor: 124170 });

async function rules(uf, conc, consumo) {
  try {
    const r = await c._fetch('GET', '/bonus/rules', { query: { uf, concessionaria: conc, consumo_medio: consumo } });
    const list = Array.isArray(r) ? r : (r?.rules ?? []);
    console.log(`✓ ${uf}/${conc}/${consumo}kWh → ${list.length} regras`, JSON.stringify(list).slice(0,400));
    return list;
  } catch (e) {
    console.log(`✗ ${uf}/${conc}/${consumo}kWh → ${e.status} ${String(e.message).slice(0,120)}`);
    return null;
  }
}

// Nome oficial atual (CPFL) x nome antigo (CPFL PIRATININGA)
for (const conc of ['CPFL', 'CPFL PIRATININGA', 'CPFL SANTA CRUZ', 'ELEKTRO']) {
  for (const consumo of [200, 350, 1751]) {
    await rules('SP', conc, consumo);
  }
}

// Testar resolveConcessionaria do worker (o que ele mandaria pro bonus/rules)
console.log('\n=== resolveConcessionaria (worker) ===');
for (const [uf, name, city] of [
  ['SP', 'CPFL PIRATININGA', 'SALTO'],
  ['SP', 'CPFL', 'SALTO'],
  ['SP', 'CPFL ENERGIA', 'CAMPINAS'],
]) {
  try {
    const off = await c.resolveConcessionaria(uf, name, city);
    console.log(`resolveConcessionaria(${uf}, "${name}", "${city}") → "${off}"`);
  } catch (e) {
    console.log(`resolveConcessionaria(${uf},"${name}","${city}") ERRO ${e.message}`);
  }
}

// Outras UFs comuns
console.log('\n=== outras UFs ===');
await (async()=>{ try { const d = await c._fetch('GET','/bonus/distributors',{query:{uf:'MG'}}); console.log('MG distribuidoras:', JSON.stringify(d)); } catch(e){ console.log('MG dist err', e.message);} })();
await (async()=>{ try { const d = await c._fetch('GET','/bonus/distributors',{query:{uf:'RJ'}}); console.log('RJ distribuidoras:', JSON.stringify(d)); } catch(e){ console.log('RJ dist err', e.message);} })();
await rules('MG', 'CEMIG', 350);
await rules('RJ', 'ENEL', 350);
await rules('RJ', 'LIGHT', 350);

await closeBrowser();
