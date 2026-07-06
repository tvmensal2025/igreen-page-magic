## Problema

O worker rodando ainda é **v18** (log: `igreen-sync-worker v18`). O código v19 com `/recon-endpoints` foi escrito mas **nunca foi deployado**. Por isso os 26 endpoints "full_extras" continuam retornando 0 — são as URLs chutadas do v18, sem descoberta real.

Além disso, mesmo se v19 subisse, ainda faltam as etapas 2–5 do plano (reescrever `collectFullExtras`, criar tabelas, persistir, auditar).

## Plano de execução (4 fases sequenciais)

### Fase 1 — Deploy do worker v19

1. `cd worker-igreen-sync && docker build -t igreen-sync-worker:v19 .`
2. `docker stop igreen-sync-worker && docker rm igreen-sync-worker`
3. `docker run -d --name igreen-sync-worker --restart unless-stopped -p 3102:3102 -e WORKER_SECRET=... igreen-sync-worker:v19`
4. Verificar log de boot: deve dizer `v19 (tor+playwright+api-vo, recon-endpoints)`.

### Fase 2 — Rodar recon com rafael.ids (único com dados reais)

```
curl -X POST http://<worker>:3102/recon-endpoints \
  -H "x-worker-token: $SECRET" \
  -H "content-type: application/json" \
  -d '{"portal_email":"rafael.ids@icloud.com","portal_password":"..."}' \
  > /tmp/catalog.json
```

Isso navega ~40 rotas SPA capturando toda chamada `api-vo.igreenenergy.com.br/v1/*`. Retorna catálogo `{method, pathTemplate, shape, first_total, sample}`. Persistido em `igreen_endpoint_discovery`.

### Fase 3 — Reescrever `collectFullExtras` com endpoints REAIS

- Ler `/tmp/catalog.json`, agrupar por categoria (green / telecom / seguros / rede / comissões / financeiro / relatórios).
- Substituir os 18 caminhos chutados atuais pelos reais capturados.
- Detectar convenção de paginação de cada rota (query `page`/`limit` vs `offset` vs cursor) a partir das amostras.
- Cada rota registra `{route, portal_total, rows_fetched, gap}` no retorno.

### Fase 4 — Persistência + auditoria + UI

- Migration criando/ajustando tabelas faltantes conforme catálogo real:
  - `igreen_green_faturas`, `igreen_green_injecao`
  - `igreen_telecom_linhas` (já existe — validar colunas), `igreen_telecom_recargas`, `igreen_telecom_bonus`, `igreen_telecom_portabilidade`
  - `igreen_seguros_sinistros`, `igreen_seguros_renovacoes`, `igreen_seguros_cashback`
  - `igreen_rede_membros_full`, `igreen_comissoes_movimento`
  - Todas com `GRANT` completo + RLS por consultor.
- `sync-igreen-customers` grava linha por rota em `igreen_sync_runs.details` com `portal_total`, `rows_saved`, `gap`, `status` (`ok`/`partial`/`fail`).
- Botão "Sincronizar TODOS" já cobre — sem mudança.
- Dashboard admin: cartão "Cobertura da última sync" mostrando por rota `saved/total (gap)` em vermelho quando `gap>0`.

## Bloqueio atual

Não posso executar `docker build/run` do meu lado — o worker roda na VPS do usuário. Precisamos que **você rode os comandos da Fase 1 e Fase 2** (ou me confirme que já tem SSH pipeline pra eu disparar via edge function `deploy-worker`).

## Detalhes técnicos

- v19 já está no branch (`worker-igreen-sync/server.mjs`), só falta build+run.
- `pathTemplate` normaliza `/clientes/12345/faturas` → `/clientes/{n}/faturas` para deduplicar.
- Recon respeita `networkidle` + 300ms entre navegações + backoff 429 → seguro pro portal.
- Playwright já está no Dockerfile do worker (v18 já usa pra login).
- Após catálogo real, o número de rotas provavelmente cai de 26 (chutes) para ~15–20 reais mas com dados de verdade.

## Pergunta antes de finalizar

Confirma que:
(a) você mesmo vai rodar `docker build/run` da Fase 1 (te passo os comandos exatos), e
(b) posso usar `rafael.ids@icloud.com` (consultor 124170, o único com dados densos) pra rodar o recon? sim rode

Sem esses dois "sim" fica impossível descobrir as URLs reais e o worker continua chutando.  
  
pare de chutar, rode automatico para mapear, agora vamos usar o [tvmensal12@gmail.com](mailto:tvmensal12@gmail.com)  email para entrar no portal [censuralivrealiaad@gmail.com](mailto:censuralivrealiaad@gmail.com) senha:201097De.