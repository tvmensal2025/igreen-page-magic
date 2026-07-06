
## Diagnóstico do que aconteceu

O worker v18 já está no ar, mas 17 das 18 rotas paginadas do `collectFullExtras` voltaram `pages=0` — sinal de erro na página 1 (path errado). Só `telecom.faturas` (5 itens) funcionou porque já era um endpoint conhecido. Os totais que já batem com o portal são `/crm/green` (21 e 159), `/crm/telecom` (0 e 6), `/crm/seguros` (0 e 5), `/network-map/data`, `/telecom/faturas`, `/clientes-green/boletos` e `/rotinas/devolutivas-*`. Todo o resto que adicionei foi chute e por isso "faltou muito".

Não dá para continuar chutando URLs. A solução definitiva é fazer o worker **descobrir sozinho** todas as rotas que o portal realmente chama, usando a sessão do rafael.ids (o consultor com dados) e navegando o SPA inteiro com Playwright interceptando XHR.

## Etapa 1 — Recon endpoint no worker (v19)

Adicionar rota `POST /recon-endpoints` em `worker-igreen-sync/server.mjs`:

1. Faz login normal (rafael.ids@icloud.com, consultor 124170).
2. Registra listener `page.on('request'|'response')` filtrando `api-vo.igreenenergy.com.br/v1/*`.
3. Navega sequencialmente por cada rota do SPA do portal:
   - `/dashboard`, `/crm/green`, `/crm/green/*` (abrir 1 card), `/clientes-green/*` (todas abas: lista, faturas, injeção, boletos, devolutivas, cashback, resumo)
   - `/crm/telecom`, `/telecom/*` (linhas, faturas, comissões, recargas, bônus, portabilidade, licenciados)
   - `/crm/seguros`, `/seguros/*` (apólices, clientes, comissões, sinistros, renovações, cashback)
   - `/network-map`, `/rede/*`, `/rede/licenciados`, `/comissoes/*`, `/relatorios/*`, `/financeiro/*`
   - Em cada tela: rolar até o fim, trocar filtros de status para "todos", trocar mês para os últimos 12 meses.
4. Agrega os requests por `{method, path_template}` (com query params substituídos por placeholders), guarda: shape da resposta (chaves top-level), primeiro `total`, quantidade de páginas observada, exemplo de item (1 objeto).
5. Persiste em `igreen_endpoint_discovery` (tabela já existe) e devolve JSON com o catálogo.

## Etapa 2 — Reescrever `collectFullExtras` baseado no catálogo real

Após o recon rodar, uso o catálogo para:

1. Substituir a lista atual de 18 rotas chute por **exatamente** os paths que o portal usa (com os query params corretos: nomes de status, nomes de campo de paginação, se é `perPage`/`pageSize`/`limit`, etc.).
2. Ajustar `fetchPaged` se algum grupo de endpoints usar convenção diferente (ex.: `pagina`/`porPagina` em vez de `page`/`perPage`).
3. Ajustar `firstArrayPayload` e `totalFromPayload` se aparecerem chaves novas no wrapper.
4. Marcar cada rota com o "grupo" (green/telecom/seguros/rede/comissoes) e persistir tudo com upsert idempotente.

## Etapa 3 — Persistência completa no Supabase

Para cada bloco descoberto, garantir que existe:
- Tabela de destino (usar as já existentes: `igreen_telecom_linhas/faturas/comissoes`, `igreen_seguros_customers/comissoes`, `igreen_customer_boletos`, `igreen_customer_devolutivas`, `igreen_network_snapshots`, `network_members`).
- Migração criando o que faltar (ex.: `igreen_telecom_recargas`, `igreen_telecom_bonus`, `igreen_seguros_sinistros`, `igreen_seguros_cashback`, `igreen_green_faturas`, `igreen_green_injecao`) com `GRANT`s e RLS (admin lê tudo, consultor lê só o próprio).
- Chave de conflito clara para upsert (sem duplicar em re-sync).

## Etapa 4 — Auditoria "nada de fora"

No fim de cada sync gravar em `igreen_sync_runs.counts` um diff:
```
{ route, portal_total, rows_saved, gap, sample_missing_id }
```
Se `gap > 0`, marca `status='partial'` e o admin destaca em vermelho.

## Etapa 5 — Botão "Sincronizar TODOS"

Continua igual (já passa `full_history:true`), mas o worker agora usa a lista real de rotas e cobre 100%. Timeout já está em 8min/consultor.

## Passo a passo de execução

```text
1. Escrevo /recon-endpoints no worker (v19) e faço build local.
2. Você redeploya (docker build/run) e me confirma "v19" no boot.
3. Rodo o recon via curl no rafael.ids e recebo o catálogo.
4. Reescrevo collectFullExtras + persistência com base no catálogo.
5. Migração criando tabelas que faltam.
6. Deploy edge sync-igreen-customers (automático).
7. Você redeploya worker (v20) com collectFullExtras final.
8. Testo Sincronizar TODOS e comparo portal vs banco por consultor.
```

## Detalhes técnicos

- **Playwright recon**: usa o mesmo context autenticado, aguarda `networkidle` entre navegações, ignora requests para `/auth/*` e `/telemetry/*`, deduplica por `${method} ${pathTemplate}`.
- **Path template**: regex substitui UUIDs, dígitos longos e datas por `{id}`/`{n}`/`{yyyy-mm}`.
- **Shape sampling**: guarda só top-level keys + tipo (evita PII grande no log).
- **Rate limit**: 300ms entre navegações, respeita 429 (backoff 15s).
- **Tabelas novas** (migração):
  ```
  igreen_telecom_recargas, igreen_telecom_bonus,
  igreen_seguros_sinistros, igreen_seguros_cashback,
  igreen_green_faturas, igreen_green_injecao
  ```
  Todas com `consultant_id uuid`, `raw jsonb`, `synced_at timestamptz`, GRANT `authenticated`/`service_role`, RLS `has_role(admin) OR consultant_id = auth.uid()`.
- **Sem quebrar nada existente**: o v17/v18 continua funcionando; o v19 só adiciona a rota `/recon-endpoints` e não muda o `/sync-all` até a etapa 4.
