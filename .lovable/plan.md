# Leads do WhatsApp não entram no CRM — diagnóstico e correção

## Diagnóstico (confirmado no banco)

- 16 leads `customer_origin='whatsapp_lead'` criados nas últimas 24h. **Nenhum** tem linha em `crm_deals`.
- `crm_deals` tem só 6 linhas no total e o último registro é de **19/maio**. Quebrou há ~2 semanas.
- Kanban (`useKanbanDeals`) lê `crm_deals` — sem deal o lead nunca aparece.
- Nenhum trigger cria deal em `customers INSERT`. Nenhum webhook (whapi/evolution) faz `insert` em `crm_deals`. O único código que toca em `crm_deals` é `syncDealStageFromStep` que **só faz UPDATE** de deals existentes; se não existe deal, não cria nada.
- Triggers que existem em `crm_deals` (`prevent_non_lead_deals`, `skip_insert_if_sandbox_customer`) deixam passar `whatsapp_lead`/`manual` não-sandbox.

Causa raiz: a criação do deal no `novo_lead` ficou sem dono. Provavelmente vinha do `runBotFlow` legado e sumiu na migração para o engine V3 / conversational. Não há ninguém criando o registro.

## Correção

### 1. Trigger `AFTER INSERT ON customers` (única fonte de verdade)

Cria automaticamente um `crm_deals` em `stage='novo_lead'` sempre que:
- `customer_origin IN ('whatsapp_lead','manual')` (NULL também conta como lead, igual ao filtro do `useKanbanDeals`),
- `is_sandbox` não é `true`,
- `is_test_lead` não é `true`,
- ainda não existe deal para esse `customer_id` (idempotente — proteção contra reinstalação).

Campos: `consultant_id`, `customer_id`, `remote_jid = phone_whatsapp || '@s.whatsapp.net'`, `stage='novo_lead'`, `deal_origin='whatsapp'`.

A `prevent_non_lead_deals` continua ativa (defesa em profundidade contra `igreen_sync`).

### 2. Backfill

`INSERT … SELECT` cria deal para todo `customers` que:
- é lead (`whatsapp_lead`/`manual`/NULL), não-sandbox, não-test,
- não tem deal por `customer_id` nem por `remote_jid` no mesmo consultor,
- foi criado nos últimos 90 dias (evita ressurreição de leads muito antigos).

Stage do backfill: derivado de `conversation_step` via mesma tabela que `syncDealStageFromStep` (fallback `novo_lead`). Implementação simples no SQL: `novo_lead` para todos e deixar o `crm-auto-progress`/sync subsequente promover se necessário — mas como muitos já estão em passos avançados, faço um `CASE` inline com os mapeamentos do `LEGACY_STEP_TO_STAGE` e prefixo `flow:`.

### 3. Sem mudança de código de aplicação

Webhooks, engine, kanban hooks, RLS — nada muda. A trigger resolve.

## Detalhes técnicos

Migration única com:
1. `CREATE OR REPLACE FUNCTION public.create_lead_deal_on_customer_insert()` (SECURITY DEFINER, `search_path=public`)
2. `CREATE TRIGGER trg_create_lead_deal AFTER INSERT ON public.customers ...`
3. Backfill `INSERT … SELECT … ON CONFLICT DO NOTHING` (via `NOT EXISTS`, já que não há unique constraint em customer_id de `crm_deals`).

Sem alteração de schema em `crm_deals`, sem novas colunas, sem mexer em RLS (trigger é SECURITY DEFINER).

## Validação pós-deploy

- `SELECT count(*) FROM crm_deals WHERE created_at >= now()-interval '1 day'` ≥ 16.
- Os 16 leads de hoje aparecem no Kanban do Rafael (`0c2711ad-...`).
- Próximo lead WhatsApp novo cria deal em <1s.

## Fora de escopo

- Não toca em fluxo D, engine V3, conversational, OCR, auto-captura.
- Não cria deals para `igreen_sync` (permanece bloqueado).
- Não mexe em deals históricos já aprovados/reprovados.
