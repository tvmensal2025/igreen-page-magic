## Problema observado nos logs

O job 47/48/49/50 do worker `worker-portal-2` ficou em loop infinito de retry com a mesma mensagem:

```
POST /customers -> 400: Erro de validação | detail=Too small: expected string to have >=14 characters
worker fail job=47: ... (e BullMQ tenta de novo, e de novo)
```

Causa: `classifyPortalError` não tem regra para "Erro de validação / Too small / expected string" → cai em `kind='unknown'` → o `server.mjs` **re-lança o erro** (linha 446), o BullMQ faz retry, e o cadastro tenta de novo com o mesmo payload inválido para sempre. Resultado: a fila trava no mesmo lead e o próximo cliente fica esperando.

Casos como `duplicate_phone` já funcionam (kind ≠ unknown → não re-lança → marca status e libera a fila).

## Fix proposto (mínimo, 2 arquivos)

### 1) `worker-portal-2/portal-errors.mjs`

- Adicionar nova classe `validation_error` em `ERROR_KINDS` (recoverable:false).
- Em `classifyPortalError`, adicionar regra ANTES do `unknown` para detectar:
  - `erro de validação`
  - `too small`, `too big`, `expected string`, `expected number`
  - `unprocessable`, `invalid input`
  → retorna `{ kind: 'validation_error', recoverable: false }`.

### 2) `worker-portal-2/server.mjs` — defesa em profundidade

Trocar a condição de retry (linha 445) de:
```js
if (kind === 'unknown') throw e;
```
para:
```js
// Só re-lança quando for genuinamente transporte/instabilidade.
// Qualquer 400 do portal é payload inválido — retry não resolve.
const isTransient = kind === 'unknown' && !/\b(400|422)\b/.test(e.message);
if (isTransient) throw e;
```

Isso garante que mesmo se aparecer um novo formato de erro 400 não previsto, o job termina e libera a fila (vai para `needs_human` ou `awaiting_correction`).

### 3) Atualizar teste

Acrescentar 1-2 casos em `worker-portal-2/test/` (se existir suite de portal-errors) cobrindo "Erro de validação | Too small".

## Resultado esperado

- Lead com payload inválido (ex.: celular com <14 chars) é classificado como `validation_error`, marcado `portal2_status='needs_human'`, e a fila libera imediatamente para o próximo job.
- Nenhum impacto nos fluxos `duplicate_phone` / `duplicate_email` / `duplicate_installation` (continuam recuperáveis com loop de correção).
- Erros realmente transitórios (ECONNRESET, 5xx, timeout) continuam fazendo retry como hoje.

## Fora de escopo (apenas observar)

Os logs mostram dois bugs adjacentes que **não vou tocar agora** (peça se quiser):
1. **Loop de jobs duplicados (47, 47, 47…)** → o `attempts: 3` do BullMQ está mascarando 3 retries do mesmo job; após o fix acima, esse loop desaparece naturalmente.
2. **Lead "CNH de A com conta de B"** → a IA já detectou (`Nome do titular da fatura divergente`). Existe `name_mismatch_flag` em `customers`, mas o portal2 não está bloqueando antes do POST. Posso adicionar um gate em `ensureDocumentsAttachedAndGate` que rejeita com `kind='name_mismatch'` (recoverable:false) se quiser — me confirme.