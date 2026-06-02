## Causa

A função `lead-temperature-classifier` lê uma coluna que **não existe** em `conversations`:

```ts
.select("message_direction, message_text, created_at, media_type")
```

A coluna real é `message_type` (verificado no schema). PostgREST devolve erro, o código ignora o `error`, `msgs` vira `null`, e cada lead retorna `skipped: "no_messages"`. Confirmei chamando a função: lead com 12 mensagens retornou `skipped: "no_messages"`. Tabela `lead_insights` está com **0 linhas** apesar dos 50+ POSTs de batch.

O frontend conta `processed = results.length` (inclui skipped), nunca para, roda 50× × 8s ≈ 7 min → "travou".

## Correção

### `supabase/functions/lead-temperature-classifier/index.ts`

1. Trocar `media_type` por `message_type` no `.select()` e no `formatted` (`m.message_type && m.message_type !== "text"`).
2. Capturar o `error` do select e devolver `{ customer_id, error: "..." }` em vez de "no_messages" silencioso.
3. No batch principal, parar o loop se nenhum lead da rodada teve sucesso real (`effective = results.filter(r => r.temperature).length === 0`).

### `src/pages/AdminConversao.tsx` — `classifyAllUnclassified`

1. Contar só os efetivos (`r.temperature`) para o `done`; parar quando rodada inteira vier sem sucesso.
2. No toast de erro, mostrar o primeiro `r.error` da rodada se houver.

## Fora de escopo

- Schema não muda.
- Outras páginas não mexem.
- Visual da página fica igual.

## Arquivos tocados

- `supabase/functions/lead-temperature-classifier/index.ts`
- `src/pages/AdminConversao.tsx`
