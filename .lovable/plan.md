
# Sync completo em todos os consultores — sem deixar nada

Diagnóstico do log: worker roda **v17** na VPS e chama só as rotas antigas (`/crm/*`, `/network-map`, `/clientes-green/boletos`, devolutivas). Tudo que adicionamos nas rodadas anteriores (paginação, `/telecom/clientes|linhas|faturas|comissoes`, `/seguros/apolices|clientes|comissoes|sinistros`, `/clientes-green?status=todos`) **está dormente no repositório**. Além disso, "Sincronizar TODOS" precisa disparar exatamente o mesmo pacote que o botão single-consultant (100%, sem cortes).

## Objetivo

1 clique em "Sincronizar TODOS" → cada consultor recebe o pacote **completo** (energia + rede + telecom completo + seguros completo + devolutivas + cashback + histórico de boletos), com paginação máxima em cada rota, persistência nas tabelas certas, e diagnóstico transparente do que veio de cada endpoint.

---

## 1. Worker v18 — cobertura total das páginas

Reescrever o handler `/sync-all` do `worker-igreen-sync/server.mjs` para SEMPRE executar as coletas extras (hoje já existem funções `fetchTelecomPayload` etc., mas o payload retornado só inclui o Kanban + poucas rotas extras). Vou:

- **Bumpar versão para v18** no log de boot, para você confirmar visualmente no log da VPS.
- Trocar `Promise.all` por execução **sequencial por produto** (evita 429 do portal) com try/catch individual.
- Para cada página do portal, iterar `page=1..N` até `items.length < perPage` **sem cap**, respeitando `Retry-After` do portal.
- Novas rotas obrigatórias no pacote (todas com paginação):
  - **Clientes Green**: `/clientes-green?status=todos&injecao=todos&tipo=todos`, `/clientes-green/summary`, `/clientes-green/faturas`, `/clientes-green/injecao`, `/clientes-green/devolutivas-resolvidas`, `/clientes-green/boletos/{idcliente}` (ficha completa por cliente do Kanban).
  - **Telecom**: `/telecom/clientes?status=todos`, `/telecom/linhas?status=todos`, `/telecom/portabilidade?status=todos`, `/telecom/faturas?status=todos` (todos os meses), `/telecom/comissoes`, `/telecom/recargas`, `/telecom/bonus`, `/telecom/licenciados`, `/telecom/resumo-geral`, `/telecom/client-map`.
  - **Seguros**: `/seguros/apolices?status=todos`, `/seguros/clientes?status=todos`, `/seguros/comissoes`, `/seguros/sinistros`, `/seguros/renovacoes`, `/seguros/cashback/resumo`, `/seguros/licenciados`, `/seguros/resumo-geral`.
  - **Rede**: `/network-map/data?month=YYYY-MM` (mês corrente + últimos 12), `/estatisticas-pro`, `/network` (raiz), painéis onboarding/inativos/ranking.
- Cada rota entra no payload como bloco separado: `{ items:[], diagnostics:{ path, pages, items_total, portal_total, error } }` para que a edge saiba distinguir "portal retornou 0" de "erro no fetch".

## 2. Edge `sync-igreen-customers` — persistência nas tabelas certas

Cada bloco novo do worker vai para a tabela apropriada (todas já existem, criadas na migração da última rodada):

- `/telecom/linhas` → `igreen_telecom_linhas` (upsert por `consultant_id, msisdn`).
- `/telecom/faturas` → `igreen_telecom_faturas` (upsert por `consultant_id, idcnxtelecom, mes_referencia`).
- `/telecom/comissoes` → `igreen_telecom_comissoes` (upsert por `consultant_id, external_id, mes_referencia`).
- `/seguros/comissoes` → `igreen_seguros_comissoes` (mesma chave).
- `/seguros/sinistros` + `/seguros/renovacoes` + `/seguros/cashback` → colunas novas em `igreen_seguros_customers` (`sinistros`, `renovacao_prevista_at`, `cashback_previsto_cents`).
- `/network-map` histórico → `igreen_network_snapshots` (1 linha por mes_referencia).
- Nada é apagado das persistências antigas; só ADIÇÃO de blocos de upsert.

Todos os upserts com fallback `stableIntId` quando o portal não trouxer ID (já implementado).

## 3. Diagnóstico "gaps" por página

Estender `igreen_sync_runs.counts.extras` para conter, por rota:
```json
{ "telecom.clientes": { "portal_total": 6, "rows_saved": 6, "pages": 1, "gap": false },
  "telecom.faturas":  { "portal_total": 127, "rows_saved": 0, "pages": 2, "gap": true, "reason": "erro parse" } }
```
O `IGreenSyncStatusBar` já suporta gaps — vou expandir a seção para listar cada rota que ficou com gap, com o motivo.

## 4. Botão "Sincronizar TODOS" = pacote 100%

O botão já existe e chama `source=bulk_manual`. Vou garantir que ele:
- Passe `mode=sync_all` com `full_history=true` e `enrich=true` (ficha completa por cliente).
- Timeout do worker sobe para 8 min por consultor quando `full_history=true`.
- Rate limit de 250ms entre requests dentro de um consultor + 3s de espaço entre consultores (já existe).
- Estado em `igreen_bulk_sync_state` já grava progresso; adiciono um resumo agregado por produto no `results[consultant_id]` (ex: `{ energy: 21, telecom: {clientes:6, linhas:6, faturas:127}, seguros: {apolices:1, comissoes:12} }`) para você ver de bater o olho o que veio.

## 5. Verificação (sem quebrar nada)

Depois do deploy do worker v18:
1. Rodar sync single em `rafael.ids@icloud.com` (consultor 124170, sabemos que tem dados) e conferir se `igreen_telecom_linhas`, `igreen_telecom_faturas`, `igreen_seguros_comissoes` recebem linhas.
2. Rodar single em `censuralivrealiaad@gmail.com` (consultor 124661) — se continuar 0 telecom/seguros, o log agora vai mostrar quais rotas foram tentadas e o `portal_total` de cada uma, provando se é o portal que retorna vazio ou se é bug.
3. Só depois clicar em "Sincronizar TODOS".

---

## Detalhes técnicos

**Worker (`worker-igreen-sync/server.mjs`)**
- Bump `[boot] igreen-sync-worker v18 (…)`.
- Helper `paginate(session, path, {perPage=100, maxPages=Infinity})` já existe; retirar cap `maxPages=30`.
- Novas fns: `fetchTelecomLinhasAll`, `fetchTelecomFaturasAll`, `fetchTelecomComissoesAll`, `fetchSegurosApolicesAll`, `fetchSegurosComissoesAll`, `fetchSegurosSinistros`, `fetchClientesGreenListaMestre`, `fetchNetworkSnapshotsHistorico(month, monthsBack=12)`.
- `/sync-all` retorna cada bloco separadamente + `diagnostics.per_route`.

**Edge (`supabase/functions/sync-igreen-customers/index.ts`)**
- Novos `persistTelecomLinhas`, `persistTelecomFaturas`, `persistTelecomComissoes`, `persistSegurosComissoes`, `persistSegurosSinistros`, `persistNetworkSnapshots`.
- `logSyncFinish` inclui `counts.extras.per_route` bruto do worker.

**UI**
- `IGreenBulkSyncPanel`: mostrar contagem por produto no snapshot final de cada consultor.
- `IGreenSyncStatusBar`: seção "Cobertura por página" com badge verde/laranja por rota (`portal_total vs rows_saved`).

## Deploy

Você redeployará o Docker do worker manualmente (é o único jeito, o worker roda fora do Lovable). Vou preparar:
1. Código v18 comitado (Lovable já commita automaticamente).
2. `worker-igreen-sync/README.md` atualizado com o comando exato do EasyPanel (`git pull && docker build && docker up`).
3. Log de boot mudando para `v18` para você confirmar que pegou.

## Fora deste plano

- Cron automático (sob demanda depois).
- Realtime updates no painel bulk (polling de 5s já basta).
- Refactor do CRM Kanban.
