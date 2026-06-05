# Sincronização tempo-real e padrão público para todos os consultores

## Estado atual (confirmado)

- `bot_flows.sync_mode` default já é `'public'` — novos consultores nascem sincronizados.
- Runtime do bot (`resolve-flow.ts`) e editor (`FluxoBuilder.tsx`) já leem os steps direto do flow público quando `sync_mode='public'`. Então **quando o super-admin altera um passo, o bot dos consultores em modo público responde com a mudança na próxima mensagem**.
- O editor (UI) atualiza só ao recarregar — não tem subscription realtime ainda.
- Consultores **criados antes** da migração de 05/jun ficaram com `sync_mode='custom'` (backfill preservou edições deles). É por isso que "não estão todos no público".
- Hook `useFlowSteps.ts` (usado em `ManualStepDialog` e `LiveConversationsPanel`) ignora `sync_mode` — mostra steps do flow do próprio consultor mesmo quando ele segue o público.

## O que vou mudar

### 1. Migração: colocar todos os consultores em `sync_mode='public'`
`UPDATE bot_flows SET sync_mode='public' WHERE consultant_id IS NOT NULL AND is_public=false AND sync_mode<>'public'`. O consultor pode desativar pelo toggle existente (`FluxoBuilder` linhas 759-797) a qualquer momento.

### 2. Realtime no editor (`FluxoBuilder.tsx`)
Adicionar uma subscription Supabase em `bot_flow_steps` filtrada por `flow_id=stepsSourceFlowId`:
- Quando `sync_mode='public'` (ou o usuário é super-admin), escuta `postgres_changes` (INSERT/UPDATE/DELETE) e refaz o `SELECT * FROM bot_flow_steps WHERE flow_id=...` com debounce de ~400ms, atualizando `setSteps`.
- Não interrompe edição local: se houver `isDirty` no inspetor, só mostra um toast "Template atualizado — recarregue para ver" em vez de sobrescrever (modo público é read-only, então isso só importa para o super-admin editando o próprio template).
- Cleanup do canal no `useEffect` return.

### 3. Corrigir `useFlowSteps.ts` para respeitar `sync_mode`
Ler `bot_flows.sync_mode` junto com o flow do consultor; se `public`, trocar `flow_id` para o do template público antes de buscar os steps. Mesma lógica do `FluxoBuilder` e `resolve-flow.ts`, mantendo as três superfícies coerentes.

## Fora de escopo
- Não mexer no toggle UI (já existe e funciona).
- Não mexer na RPC `fork_flow_from_public` (já patcheada).
- Sem alterações no template público em si.

## Validação
1. Antes da migração: `SELECT COUNT(*) FROM bot_flows WHERE consultant_id IS NOT NULL AND is_public=false AND sync_mode='custom'` → mostra o N atual.
2. Depois: a mesma query → 0 (ou só os que pediram custom explicitamente, mas como o pedido é "todos", vai para 0).
3. Abrir `FluxoBuilder` como consultor `tvmensal01`, e em outra aba alterar um título de passo como super-admin. O título deve atualizar sozinho no consultor em ≤1s.
4. Abrir `ManualStepDialog` num consultor em modo público e conferir que lista os passos do template público.
