# Enriquecimento via escritório oficial (api-vo) — Plano revisado

## O que mudou vs plano anterior

Antes: enriquecer via `worker-portal-2` + `api-green-connection` (autoconexão).
Agora: **enriquecer só via escritório** — `escritorio.igreenenergy.com.br` → API interna `https://api-vo.igreenenergy.com.br/v1` (Bearer token). O worker `worker-igreen-sync` já faz login e chama essa API para as listagens; falta cobrir o **detalhe por cliente**.

## Descobertas da análise

O worker `worker-igreen-sync/server.mjs` já mapeia ~70 endpoints do `api-vo`. Endpoints usados hoje:
- `/crm/green` (lista Kanban de clientes) ← `fetchCustomers`
- `/clientes-green/boletos` (lista) e `/clientes-green/boletos/{idcliente}` (detalhe de boleto)
- `/clientes-green/devolutivas`, `/clientes-green/faturas`, `/clientes-green/injecao`
- `/crm/telecom`, `/crm/seguros`, `/network-map/data`, `/financeiro/*`, etc.

**Endpoint de detalhe do cliente ainda NÃO existe no mapeamento.** Candidatos prováveis (nenhum probado ainda):
- `GET /clientes-green/{idcliente}`
- `GET /crm/green/{idcliente}`
- `GET /clientes-green/detalhe/{idcliente}`
- `GET /customer/{idcliente}`

O worker já tem um mecanismo `/probe-all` que testa lista de candidatos e grava resultado em `igreen_endpoint_discovery`. Vamos usar esse mecanismo pra descobrir o endpoint certo antes de escrever o enrich.

## Reversão da Fase 2 anterior (portal2)

1. Remover a rota `POST /enrich-customer` de `worker-portal-2/server.mjs`.
2. Remover o bloco `if (mode === "enrich")` e as variáveis `enrichCustomerIds` / `enrichLimit` do `supabase/functions/sync-igreen-customers/index.ts`.
3. **Manter** as 6 colunas novas da Fase 1 (`signature_summary`, `otp_status`, `otp_status_checked_at`, `document_verify_status`, `document_verify_at`, `last_enriched_at`) — servem igual para a versão nova.
4. **Manter** o doc `docs/portal-api/PORTAL2_ENRIQUECIMENTO_MAP.md` (marcar como superado e apontar pro novo doc).

## Novo plano — 5 fases

### Fase A — Descobrir o endpoint de detalhe (probe)
Adicionar em `worker-igreen-sync/server.mjs` (arquivo `PROBE_ALLOWLIST`, extendido pelo `/probe-all`) os candidatos:
- `/clientes-green/{sample_id}`
- `/crm/green/{sample_id}`
- `/clientes-green/detalhe/{sample_id}`
- `/customer/{sample_id}` / `/customers/{sample_id}`
- `/clientes-green/{sample_id}/completo`
- `/clientes-green/{sample_id}/endereco`
- `/clientes-green/{sample_id}/dados-cadastrais`

O `sample_id` vem do primeiro cliente listado em `/crm/green` da sessão.

Novo endpoint `POST /probe-customer-detail { consultant_id }` que:
1. Loga como o consultor
2. Pega o primeiro `idcliente` de `/crm/green`
3. Testa cada candidato acima
4. Retorna JSON com status/tamanho/amostra de cada um (top 3 KB do body)

Entregável: doc `docs/portal-api/ESCRITORIO_API_MAP.md` com o veredito — qual endpoint responde 200, quais campos traz, comparação com `/crm/green`.

### Fase B — `fetchCustomerDetail` no worker
Uma vez identificado o endpoint (Fase A), adicionar em `worker-igreen-sync/server.mjs`:
- Função `fetchCustomerDetail(session, idcliente)` que chama o endpoint descoberto.
- Rota `POST /enrich-customer { consultant_id, idcliente }` que faz login (reusando session cache), chama o detalhe e devolve payload normalizado.
- Rota `POST /enrich-customer-batch { consultant_id, idclientes: [...], concurrency: 3 }` para varredura em lote (mais rápido que 1 chamada HTTP por cliente).

### Fase C — modo `enrich` na edge function
Reescrever o bloco `if (mode === "enrich")` do `sync-igreen-customers` para:
1. Chamar `worker-igreen-sync` (não mais worker-portal-2) em `/enrich-customer-batch`.
2. Selecionar até N clientes do consultor com `igreen_code IS NOT NULL` e `last_enriched_at` mais antigo/NULL (a chave da lista é `igreen_code`, não `portal2_idcliente` — mudança importante).
3. Mapear resposta → colunas de `customers`. Colunas alvo continuam as mesmas do plano anterior (endereço completo, concessionária, fornecedora, PJ, procurador, flags, signature_summary, otp_status, document_verify).

### Fase D — UI
- Card do cliente: 4 blocos novos (Endereço completo, Concessionária/Fornecedora, Status detalhado assinatura+contrato+OTP+doc, PJ — só quando aplicável).
- Botão **"Enriquecer agora"** no drawer do cliente (chama edge function com `customer_ids: [id]`).
- Botão **"Enriquecer todos os pendentes"** no painel de sync (limite 100 por vez).
- Chip de "última atualização há X min/h/d" baseado em `last_enriched_at`.

### Fase E — Automação
- Cron noturno (via `pg_cron` + `net.http_post`) que dispara `sync-igreen-customers` com `mode: enrich, limit: 200` por consultor aprovado com credenciais válidas.
- Trigger no upsert de `customers`: quando um `igreen_code` novo aparece pela primeira vez, agenda um enrich imediato via `pg_net`.

## O que NÃO vou fazer

- Não tocar em `worker-portal-2` além da remoção da rota já criada.
- Não tocar em `Portal2Client`, cadastro, OTP, envio de contrato — cadastro segue 100% intacto.
- Não escrever no portal iGreen — só leitura.
- Não vou adivinhar o endpoint de detalhe. Se a Fase A der 404 em todos os candidatos, paro e volto pra você com a lista testada + próximos passos (talvez precise inspecionar via DevTools do navegador logado no escritório).

## Ordem de execução após aprovação

1. **Reverter** Fase 2 antiga (remove `/enrich-customer` do worker-portal-2 e o modo `enrich` da edge).
2. Executar **Fase A** (probe). Entrego o doc com o veredito.
3. Você aprova ou me passa o endpoint certo se souber.
4. Executo **Fase B → C → D → E** sequencialmente, pausando pra confirmação entre B e C.

## Pontos que precisam da sua confirmação agora

Nenhum — pode aprovar. Se quiser acelerar a Fase A, me diga se você:
- Já conhece o endpoint que o front do escritório usa (F12 → Network ao clicar num cliente).
- Ou prefere que eu descubra sozinho via probe.
