# Fluxo D público e padrão para todos os consultores

## Objetivo

O Fluxo D do superadmin (`Fluxo Whapi (botões)` — id `320bf22c-e383-4f53-a3c0-b88b89b02558`) passa a ser um **template vivo compartilhado**: todos os consultores executam exatamente esse fluxo, em tempo real, sem cópia. Edições feitas pelo superadmin refletem imediatamente em todos. Todo lead novo, de qualquer consultor, começa na variante D.

## Passo 1 — Migration (schema + dados)

1. Adicionar coluna `is_public BOOLEAN NOT NULL DEFAULT false` em `public.bot_flows`.
2. Marcar `is_public = true` no fluxo D do superadmin (`320bf22c-…`).
3. Garantir unicidade: índice parcial único `(variant) WHERE is_public = true` — só pode existir UM fluxo público por variante.
4. Atualizar `active_variants` de todos os 13 consultores não-superadmin para `ARRAY['D']` (hoje estão em `{A}`). O trigger `assign_flow_variant_on_insert` já trata corretamente arrays de 1 item, então novos leads cairão automaticamente em `flow_variant='D'`.
5. Atualização opcional de leads existentes não será feita — só vale para leads novos. (Se quiser migrar os atuais, diga depois.)

## Passo 2 — Resolver flow_id nos webhooks (fallback público)

Hoje, em `supabase/functions/whapi-webhook/handlers/bot-flow.ts` e `…/evolution-webhook/handlers/bot-flow.ts`, todas as queries fazem:

```ts
bot_flows.select('id').eq('consultant_id', X).eq('is_active', true).eq('variant', V)
```

Vamos centralizar em um helper único:

```ts
// resolveFlowId(supabase, consultantId, variant)
// 1) tenta fluxo do próprio consultor (consultant_id=X, variant=V, is_active=true)
// 2) se não achar, retorna o fluxo público dessa variant (is_public=true, is_active=true, variant=V)
```

E substituir todas as ~12 ocorrências dentro dos dois `handlers/bot-flow.ts` (e em `findNextActiveFlowStep`) por esse helper. Os steps (`bot_flow_steps`), QA (`bot_flow_qa`) e mídias continuam sendo lidos por `flow_id` — como o `flow_id` resolvido será o do superadmin, todos os consultores executam exatamente os mesmos steps/QA/mídia em tempo real.

Arquivos editados:
- `supabase/functions/_shared/resolve-flow.ts` (novo helper)
- `supabase/functions/whapi-webhook/handlers/bot-flow.ts`
- `supabase/functions/evolution-webhook/handlers/bot-flow.ts`

## Passo 3 — UI do FluxoBuilder (somente leitura para não-superadmin)

Como o fluxo é compartilhado, consultores comuns **não podem editar** o template público. No `src/pages/FluxoBuilder.tsx`:
- Se o fluxo carregado tem `is_public=true` e o usuário não é superadmin → modo read-only (desabilita botões de salvar/adicionar/excluir step e mostra banner "Fluxo padrão da plataforma — somente leitura").
- Superadmin continua editando normalmente.

## Passo 4 — Validação

- Após a migration: verificar `SELECT variant, count(*) FROM bot_flows WHERE is_public` retorna `D=1`.
- Verificar que novos leads inseridos via webhook recebem `flow_variant='D'`.
- Simular uma conversa de teste em um consultor não-superadmin e confirmar que o webhook resolve o `flow_id` do superadmin e dispara os steps do Fluxo D.

## Detalhes técnicos

- O trigger `assign_flow_variant_on_insert` já existe e funciona para arrays de 1 elemento — sem alteração.
- Nenhuma alteração em RLS: `bot_flows` continua só visível ao próprio consultor + superadmin; o webhook usa `service_role` e ignora RLS.
- O helper resolve em **uma query** com `or(consultant_id.eq.X,is_public.eq.true)` + ordenação para priorizar o do consultor, evitando 2 round-trips.
- Nada muda em `bot_flow_qa` / `bot_flow_steps` / `bot_flow_qa_media` — todos referenciam `flow_id`, então o template público "carrega" todo seu conteúdo automaticamente.
