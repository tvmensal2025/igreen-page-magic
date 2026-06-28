# Verificação: fix do "texto+botões some" funciona para todos os consultores

## Por que o fix já é universal
O bug e o fix vivem em `evolution-webhook/handlers/conversational/index.ts` linha 2132 — o `return` do `goToStep`. Esse caminho é compartilhado por **todo passo** de **todo fluxo** de **todo consultor** que usa o webhook Evolution. Não há código por-consultor que reimplemente essa lógica.

## Passos de verificação

1. **Comparar com `whapi-webhook`** — ler o equivalente para confirmar que o whapi não tem o mesmo bug (ou tem mas é mascarado por botões nativos).
2. **Rodar testes do conversational** (`evolution-webhook` test suite, especialmente `order_test.ts` que cobre ordem de envio).
3. **Re-auditar** os 3 sites `__inline_sent: anyMediaSent || undefined` (linhas 1238, 1435, 1716) para garantir que nenhum combina `anyMediaSent=true + reply!=""`.
4. **Conferir 3 consultores distintos via logs/banco** — leads recentes em passos com mídia+botões para confirmar que o texto numerado está chegando depois do deploy.
5. **Listar leads "presos sem botões"** (entraram em `d_como_funciona` ou similar antes do deploy) — sem migração; qualquer mensagem que mandarem aciona o re-render.

## O que NÃO vou fazer
- Não vou reescrever `__inline_sent` para um sistema novo.
- Não vou mexer em `whapi-webhook`.
- Não vou alterar `bot-flow.ts` nem o engine.

## Entrega
Relatório consolidado com o resultado dos 5 passos. Se aparecer regressão, paro e aviso antes de mexer em mais código.
