## Diagnóstico

Quando o consultor clica **"Eu confirmo"** no `OcrReviewCard`, acontece só:
1. UPDATE em `customers` setando `bill_data_confirmed_at` + `ocr_review_pending=null`
2. Toast "✓ Dados confirmados"
3. `onDecided()` fecha o modal

**O que está faltando** (confirmado lendo `mem://features/ocr-review-flow` e `src/lib/captacao/postBillConfirm.ts`):
- O card **não chama `dispatchPostBillConfirm`** — que é o helper responsável por:
  - Enviar a mensagem de simulação (até 20%) ao cliente
  - Despachar os passos `message` entre `capture_conta` e o próximo capture
  - Avançar para `capture_documento` (próximo passo do fluxo)
- O card **não limpa `bot_paused`** — o Rafael ainda está com `bot_paused=true` no banco (auto_loop_detected anterior). Mesmo despachando, o bot ficaria mudo.

Resultado: após confirmar, o modal fecha mas o lead congela em `confirmando_dados_conta` com bot pausado — nenhuma mensagem nova sai, fluxo não avança. É exatamente o "travado" que o usuário reportou.

A memória do projeto (`mem://features/ocr-review-flow`) literalmente diz: *"Quando o consultor clica 'Eu confirmo' em OcrReviewCard OU CaptureDataConfirmCard, ambos chamam dispatchPostBillConfirm(...). NÃO duplicar essa lógica em outros componentes — sempre importar o helper."* — o `CaptureDataConfirmCard` faz isso, o `OcrReviewCard` esqueceram.

## Correção

Em `src/components/captacao/OcrReviewCard.tsx`, função `confirmSelf`:

1. Adicionar ao `updatePayload` a limpeza do estado de pause:
   - `bot_paused: false`
   - `bot_paused_reason: null`
   - `bot_paused_at: null`
   - `bot_paused_until: null`
2. Depois do UPDATE bem-sucedido, importar e chamar:
   ```ts
   await dispatchPostBillConfirm({ customer, kind, continueFlowOnNextCapture: true });
   ```
3. Manter o toast e `onDecided()` como estão.
4. Erros do dispatch não devem reverter a confirmação (envolver em try/catch interno, igual o `CaptureDataConfirmCard` faz).

## Escopo

- Só `src/components/captacao/OcrReviewCard.tsx`.
- Sem migration, sem mexer em edge function, sem alterar `askClient` (esse caminho já está OK).

## Validação

Depois do fix, ao clicar "Eu confirmo" no Rafael:
- `bot_paused` volta pra false
- Bot dispara simulação (até 20%) e avança pro `capture_documento`
- Modal fecha de vez, lead continua o fluxo normalmente
