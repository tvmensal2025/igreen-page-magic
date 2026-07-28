# AGENTS — sync-igreen-customers

Domínio: `#igreen-sync-oficial` + `#pos-venda`. Esta edge lê a carteira iGreen; não é Portal 2 nem Club.

## Antes de editar

1. Leia `igreen-sync-oficial.md` e `_shared/igreen-sync-worker.ts`.
2. Worker oficial: setting `igreen_sync_worker_url`; valide `/health` antes de remapear.
3. Preserve a normalização e o upsert local após a leitura do worker.

## Contrato

- Origem dos registros sincronizados: `customer_origin = igreen_sync`.
- `name_source = igreen_portal` é fonte confiável para exibição, mas não invente dados.
- Sem telefone, usa identificador `sem_celular_*`; não descarte cliente da carteira.
- Status iGreen é mapeado para o status interno; `pending` sozinho é ambíguo na UI.
- Depois do sync, recalcula pós-venda sem desfazer `pos_venda_recadastro_at`.

## Multi-conta (obrigatório)

- Contas em `igreen_portal_accounts` (position 1 = principal; 2+ = subcontas).
- Unique `(consultant_id, igreen_code)` → **uma linha** por cliente, mesmo vindo de várias contas.
- A Conta principal (rede) **mascara** `celular` de clientes de licenciados; a subconta dona devolve o número.
- `persistCustomers`: se já existe linha por `igreen_code`, **UPDATE por id** (promove `sem_celular_*` → telefone real). Nunca depender só de upsert por `phone_whatsapp`.
- `applyCustomerDetails`: atualiza por `consultant_id + igreen_code` **sem** filtrar `igreen_account_id` (senão o enrich da subconta não cola na linha da principal).
- `enrich_only`: reprocessa também `sem_celular_*`; subconta pega placeholders cujo `registered_by_igreen_id` = `igreen_consultor_id` da conta.

## Workers separados

| Uso | Helper / setting |
|---|---|
| Carteira iGreen | `igreen-sync-worker.ts` / `igreen_sync_worker_url` |
| Cadastro Portal 2 | `portal-worker.ts` / `portal2_worker_url` |
| Club | `club-worker.ts` / `club_worker_url` |

## NÃO FAÇA

- Usar `portal2_worker_url`, localhost ou Docker interno para a carteira.
- Recriar o login/scraping na edge ou substituir o helper oficial.
- Transformar sync em disparo de WhatsApp ou ligar automação nova.
- Misturar estágios de pós-venda com `sale_stage_*`.
