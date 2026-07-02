# Plano — Spy SPA iGreen (Fase 1 em andamento)

## Status atual

- ✅ Endpoint `/spy-spa-detail` adicionado em `worker-igreen-sync/server.mjs`
- ✅ Edge function `spy-igreen-spa` criada
- ⏳ **Aguardando você fazer commit + deploy do `worker-igreen` no Easypanel**
- ⏭️  Depois eu chamo `spy-igreen-spa`, analiso o resultado e implemento Fase 2

## O que você precisa fazer AGORA

1. `git add worker-igreen-sync/ && git commit -m "spy: /spy-spa-detail"` e push
2. Easypanel → serviço **worker-igreen** → Deploy
3. Me avisa "deploy ok"

## Depois do deploy — eu executo

```
supabase.functions.invoke('spy-igreen-spa', {
  body: { idcliente: '1117549' }  // Sandra
})
```

O worker vai:
1. Reusar a sessão Playwright já autenticada da Rafael
2. Navegar para `https://escritorio.igreenenergy.com.br/clientes-green`
3. Monitorar TODOS os XHRs para `api-vo.igreenenergy.com.br`
4. Clicar no card da Sandra
5. Aguardar 6 s, coletar respostas
6. Devolver:
   - `winners`: requests que contêm "SANDRA" ou campos de endereço/licenciado
   - `requests`: lista completa com URL, status, tamanho e amostra do JSON
7. Persistir tudo em `igreen_endpoint_discovery` (bucket `spy_spa`)

## Fase 2 (após descoberta)

Com o path real em mãos:
1. Adiciono `fetchCustomerDetailReal(session, idcliente)` no worker
2. Modifico `/sync-all` com `enrich_all: true` (batch de 8 paralelo, sem cap de 400)
3. Atualizo `sync-igreen-customers/index.ts` com mapeamento de:
   - `endereco_rua/numero/bairro/cidade/uf/cep`
   - `licenciado_nome/codigo`
   - `data_nascimento` (corrige inversão dd/mm)
4. **Deploy 2** no Easypanel
5. Rodo sync completo da carteira de Rafael
6. Relatório 15/15 campos

## Aceite

- 100 % dos clientes de Rafael com endereço preenchido (quando existir na origem)
- ≥ 95 % com licenciado
- `data_nascimento` da Sandra = 1971-06-01
- `last_enriched_at` != null para todos
