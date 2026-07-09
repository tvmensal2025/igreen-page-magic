## Objetivo
1. **Puxar todos** os leads que já iniciaram uma conversa (mensagem trocada ou `last_bot_interaction_at` preenchido) para o Conversão, mesmo que estejam com `pos_venda_stage` marcado ou origem diferente — mantendo apenas a exclusão de cliente ativo.
2. **Apagar** os cadastros de teste (números `0000...`, `1111...`, `9999...`, nomes "Teste"/"Claro WhatsApp") do banco.

## Diagnóstico
- 41 customers têm `last_bot_interaction_at`; 64 têm mensagem em `conversations`. Juntando + excluindo clientes ativos dá **~57 leads reais**. O fetch atual, com `.eq(consultant_id) + .or(customer_origin.in.(whatsapp_lead,manual),null) + .is(pos_venda_stage,null)`, corta a maioria.
- Identificados **10 cadastros de teste** (Lead Simulado, Joao Silva Teste, TESTE E2E DEPLOY, Cliente Teste Bateria, EMPRESA TESTE BATERIA LTDA, TESTE CADASTRO ×2, Teste Portal2, Claro WhatsApp, Teste Fluxo B).

## Mudanças

### 1. `src/components/admin/conversao/ConversaoCockpit.tsx` — fetch (linhas 127-222)
Reescrever `fetchRows` para trazer todo mundo que conversou:

- Query A: `select` em `customers` do consultor com filtros de cliente ativo (`igreen_code IS NULL`, `data_ativo IS NULL`, `data_validado IS NULL`, `data_cadastro IS NULL`), **sem** filtro de origem e **sem** `.is('pos_venda_stage', null)`. Ordena por `last_bot_interaction_at desc`, limite 1000.
- Query B: `select distinct customer_id` em `conversations` restrito aos IDs devolvidos por A → `convSet`.
- Filtro JS: mantém `keep = last_bot_interaction_at != null || convSet.has(id)`; mantém exclusão de `andamento_igreen ∈ CLIENT_STATUSES` e `assinatura_cliente` truthy (`true/t/sim/yes/1`).
- Resto do mapeamento (`inboundMap`, score, `LeadRow`) permanece igual.

Sem mudanças em ordenação, filtros de UI, drawer ou ações de IA.

### 2. Apagar cadastros de teste (via `supabase--insert` com DELETE)
Executar um `DELETE FROM public.customers WHERE id IN (...)` para os 10 UUIDs abaixo. FKs de `conversations`, `lead_insights`, etc. estão em cascade em relação a `customers.id`; se algum bloquear, deletar antes as filhas (`conversations`, `lead_insights`, `customer_memory`, `customer_flow_state`) para os mesmos IDs.

IDs alvo:
- `00000000-0000-4000-8000-000000000001` — Lead Simulado (0000000000)
- `f90dd52a-367b-47fb-bfa0-8d04a135f807` — Joao Silva Teste (5500003548452)
- `33dcea70-d3ae-4f63-b87a-c0372fafb707` — TESTE E2E DEPLOY
- `e9fcdef4-b984-43f5-9b54-97543d1a767c` — Cliente Teste Bateria
- `8e5d5723-1d98-4db4-a95b-9734db96e453` — EMPRESA TESTE BATERIA LTDA
- `8fd8ba88-125e-46ca-aa69-fc2a700e2d22` — TESTE CADASTRO (5511989000650)
- `ff52e91f-2bd4-4020-a063-431fa5c7c2a1` — Teste Portal2
- `f937ca31-2e6f-4fcd-9702-b8a7c8ae4778` — TESTE CADASTRO (5511999887766)
- `1f839f9c-191e-4cb9-b955-260ad3aca80d` — Claro WhatsApp (contato de sistema)
- `11111111-1111-1111-1111-111111111111` — Teste Fluxo B (5511999999999)

## Fora de escopo
- Sem alterar Captação, schema, migrations ou RLS.
- Sem mexer nos filtros de UI (temperatura, origem, parceiro, busca).
- Cadastros `igreen_sync` que estão realmente ativos (com `igreen_code`/`data_ativo`) continuam fora do Conversão pelo filtro natural.

## Verificação
Abrir `/admin` → Central de Conversão. Esperado: fila com ~57 leads, incluindo os que têm `pos_venda_stage` preenchido mas conversaram; nenhum "Teste"/"Simulado"/"Claro WhatsApp" na lista nem no banco.
