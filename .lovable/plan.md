# Tornar o teste virgem mais realista

## Mudança
No `supabase/functions/dev-fire-all-steps/index.ts`, dentro do bloco `if (fresh)` (linhas ~101-106), remover o seed de `name`/`name_source`. Deixar `name = null` no reset para que o passo de boas-vindas do Fluxo A **pergunte o nome ao cliente e espere a resposta** — igual lead real chegando.

`conversation_summary: null` continua sendo limpo.

## Resultado esperado
Após o próximo disparo `fresh:true`:
1. Bot envia só **1 mensagem**: "Opa! Aqui é o Rafael… Como posso te chamar?"
2. Bot **espera** o cliente responder o nome
3. Só depois dispara "Prazer, [nome]! Qual o valor…"

## Sem impacto em produção
A mudança é só no `dev-fire-all-steps`, que está travado no número `5511971254913`. Nenhum lead real é afetado.

## Após aplicar
Re-disparo o Fluxo A virgem no seu número para você testar pelo WhatsApp.
