## Diagnóstico (confirmado nos dados)

O bot reenvia o início depois da simulação porque dois handlers carregam fluxos diferentes:

- `handlers/bot-flow.ts` (post-confirm-conta) usa `resolveFlowId`, que respeita `sync_mode`. Para um consultor em `sync_mode='public'`, lê o fluxo PÚBLICO do superadmin e grava o UUID do passo público (`d_resultado` = `4df1f90a...`) em `conversation_step`.
- `handlers/conversational/index.ts` (`loadFlow`) carrega só o fluxo PRÓPRIO do consultor (`b539a8a2...`). O UUID público não existe ali. Cai em `unknown step → restart at firstActive` e dispara o welcome de novo.

Validação no banco:
- Passo `4df1f90a` → `is_public=true`, consultor `0c2711ad` (superadmin).
- Lead afetado: `sync_mode='public'` apontando para o próprio fluxo `b539a8a2`.
- 4 consultores ativos hoje em `sync_mode='public'` (1 A, 1 B, 2 D) — todos reproduzem o bug.
- Em `sync_mode='custom'` ambos os handlers já leem o mesmo fluxo; a correção não muda o comportamento deles.

## Plano

1. Unificar carregamento no `conversational`
   - Em `supabase/functions/evolution-webhook/handlers/conversational/index.ts` e no espelho `supabase/functions/whapi-webhook/handlers/conversational/index.ts`, substituir o `loadFlow` por `resolveFlowId` + leitura dos steps pelo `flow_id` retornado.
   - Resultado: em `sync_mode='public'` carrega o fluxo do superadmin; em `sync_mode='custom'` segue carregando o próprio. Mesma fonte de verdade do `bot-flow`.

2. Rede de segurança contra UUID órfão (por `step_key`)
   - No bloco `unknown step` do `conversational`, antes do restart, tentar localizar um step ativo com o mesmo `step_key` no fluxo carregado.
   - Cobre os 11 leads em `sync_mode='custom'` com UUID antigo (republicações) sem perder o lugar deles.

3. Manter `bot-flow` como está
   - O lookup de `success_goto`/`fallback.goto_step_id` já filtra por `flow_id`. Sem mudança de schema.

4. Validação
   - Rodar `bot-flow_test.ts` e `step-namespace_test.ts`.
   - Conferir nos logs do `evolution-webhook` que após `[post-confirm-conta] next=d_resultado` o próximo turno NÃO emite `[conversational] unknown step`.

## Impacto em consultores novos

- Consultor cria do zero (default `sync_mode='public'`): passa a funcionar igual ao superadmin, sem reenviar welcome após a simulação.
- Consultor personaliza (`sync_mode='custom'`): nenhuma mudança visível — `resolveFlowId` devolve o próprio fluxo.
- Leads antigos com UUID inválido: a rede por `step_key` evita restart cego.

## Arquivos

- `supabase/functions/evolution-webhook/handlers/conversational/index.ts` — `loadFlow` passa a usar `resolveFlowId(supabase, consultantId, variant)` e carregar `bot_flow_steps` pelo id retornado; `strict_mode` continua sendo lido do fluxo resolvido.
- `supabase/functions/whapi-webhook/handlers/conversational/index.ts` — mesma mudança.
- No bloco `if (!currentStep)`: fallback `dbSteps.find(s => s.step_key === stepKey && s.is_active)` antes do restart.

Sem migração de banco.