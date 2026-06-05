# Corrigir "Passo removido" nos steps 16–20 (fallback)

## Causa raiz confirmada

- A RPC `fork_flow_from_public` **já remapeia** `transitions[].goto_step_id` e `fallback.goto_step_id`, mas **não remapeia** `fallback.success_goto_step_id`.
- Fluxos de consultor forkados antes do remapeamento de `fallback` ganharem cobertura (ou para `success_goto_step_id`) ficaram com UUIDs apontando para steps do fluxo público — que não existem dentro do próprio `flow_id` do consultor. O editor mostra esses ponteiros como "Passo removido".
- Caso do `tvmensal01` (flow `b539a8a2-…`): steps 16, 17, 19, 20 têm `fallback.goto_step_id` apontando para IDs do template público. Step 18 está correto.

## Frente 1 — Migração de saneamento (roda 1x, conserta o histórico)

Para cada `bot_flow_steps.fallback` que contenha `goto_step_id` ou `success_goto_step_id`:
1. Verificar se o UUID existe em `bot_flow_steps.id` **dentro do mesmo `flow_id`**.
2. Se não existir, procurar no mesmo `flow_id` um step com o mesmo `step_key` do step original (resolvido via `step_key` correspondente no fluxo público, fazendo lookup pelo UUID quebrado).
3. Reescrever o campo com o novo UUID. Se nenhum equivalente for encontrado, remover só aquele campo (deixar o restante do `fallback` intacto) e logar `step_id` + chave removida em um `RAISE NOTICE` para auditoria.

Implementado como uma função PL/pgSQL one-shot executada na própria migração, varrendo todos os fluxos não públicos. Idempotente — pode rodar de novo sem efeito.

## Frente 2 — Patch em `fork_flow_from_public`

Adicionar, no segundo passe, o remapeamento de `fallback.success_goto_step_id` usando o mesmo `v_id_map` já usado para `goto_step_id`. Mantém a lógica existente; só estende o bloco que monta `remapped_fallback`:

```
IF remapped_fallback ? 'success_goto_step_id'
   AND v_id_map ? (remapped_fallback->>'success_goto_step_id') THEN
  remapped_fallback := remapped_fallback
    || jsonb_build_object('success_goto_step_id',
         v_id_map ->> (remapped_fallback->>'success_goto_step_id'));
END IF;
```

Assim, futuros forks (e re-syncs) não recriam o bug.

## Fora de escopo

- Nenhuma mudança no front-end (`StepTimelineItem`, `flowExits`) — assim que os IDs forem corrigidos no banco, os cards param de mostrar "Passo removido".
- Sem alteração em `transitions` (RPC já trata; varredura confirma que só `fallback` está quebrado nesses consultores).

## Validação

1. Antes da migração: `SELECT step_key FROM bot_flow_steps WHERE flow_id='b539a8a2-…' AND fallback->>'goto_step_id' NOT IN (SELECT id::text FROM bot_flow_steps WHERE flow_id='b539a8a2-…')` deve retornar steps 16, 17, 19, 20.
2. Depois da migração: a mesma query retorna 0 linhas.
3. Recarregar o editor logado como `tvmensal01` — os badges "Passo removido" nos cards 16–20 desaparecem.
4. Forkar um novo consultor de teste e conferir que `fallback.success_goto_step_id` aponta para IDs do próprio flow.
