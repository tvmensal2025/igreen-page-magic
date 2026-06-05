## Diagnóstico

O modal `OcrReviewBanner` fica preso em "Atualizando…" para o lead Rafael (que já está com `ocr_review_pending='bill'` no banco — confirmado via query).

**Causa raiz:** O `OcrReviewCardWrapper` lê `customer.ocr_review_pending` via `useCaptureSession`, mas o `SELECT` desse hook (`src/hooks/useCaptureSession.ts`, linha 82) **não inclui a coluna `ocr_review_pending`**. Resultado:

1. `useOcrReviewQueue` encontra o lead (query direta filtra por `ocr_review_pending IS NOT NULL` → retorna Rafael).
2. Modal abre e renderiza `OcrReviewCardWrapper`.
3. `useCaptureSession` carrega o customer **sem** o campo `ocr_review_pending` → vem `undefined`.
4. Wrapper cai no branch `if (!kind)` → mostra "Atualizando…" e agenda `onDecided()` que chama `refresh()`.
5. `refresh()` re-consulta a fila, lead continua lá (DB ainda tem `bill`), modal re-renderiza → **loop infinito** com "Atualizando…" piscando.

Não é nem watchdog nem o backend — é puramente o SELECT incompleto do hook do frontend.

## Correção

Adicionar `ocr_review_pending` e `ocr_review_started_at` ao SELECT em `src/hooks/useCaptureSession.ts` (linha 82) e ao tipo `CaptureCustomer` (campos opcionais).

Sem alteração de backend, sem migration, sem mexer no fluxo de OCR — só o hook do painel.

## Arquivos

- `src/hooks/useCaptureSession.ts`
  - Adicionar `ocr_review_pending` e `ocr_review_started_at` na string do `.select(...)`
  - Adicionar os dois campos opcionais na interface `CaptureCustomer`

## Validação

Depois do fix, o modal vai renderizar o `OcrReviewCard` real com a foto e dados extraídos do Rafael, e o consultor poderá clicar "Eu confirmo" ou "Pedir ao cliente" — destravando o lead de vez.
