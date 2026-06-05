# Plano — Reduzir latência do Fluxo D no Evolution

Objetivo: trazer a 1ª msg após botão de ~7-52s para ~2-3s. Whapi **não muda**.

## Mudança 1 — `humanDelayMs` fixo em 800ms

**Arquivo:** `supabase/functions/evolution-webhook/index.ts` (linhas 2040-2051)

Hoje calcula `min(14000, max(3500, 3000 + chars*60))` = 3.5–14s por reply, com loop renovando "composing" a cada 2.8s.

Substituir por:

```ts
// Apenas 1 "digitando" curto para não parecer instantâneo
const humanDelayMs = 800;
try { await (sender as any).sendPresence?.(remoteJid, "composing", humanDelayMs); } catch (_) { /* noop */ }
await new Promise((r) => setTimeout(r, humanDelayMs));
```

Remove o `while` de renovação (não precisa para 800ms).

**Ganho:** 3-13s por reply de texto.

## Mudança 2 — `text_delay_ms` teto 2s

**Arquivo:** `supabase/functions/evolution-webhook/handlers/conversational/index.ts`

Dois pontos:
- Linha 529: `const wait = Math.max(0, Math.min(item.delayMs, 12_000));` → `Math.min(item.delayMs, 2_000)`
- Linha 1732-1733: `if (textDelay > 0 ...) await ... textDelay;` → encapsular em `Math.min(textDelay, 2_000)`

**Ganho:** até 10s em passos que tenham `text_delay_ms` alto configurado.

## Mudança 3 — Reduzir `min_interval` anti-ban para 3s

Hoje o `check_send_quota` (RPC) bloqueia envios por 30-45s quando 2 sends acontecem próximos. Investigar onde está o valor armazenado:

1. Ler RPC `check_send_quota` (migration anterior) para descobrir tabela/coluna que guarda `min_interval`.
2. Atualizar via migration o registro da(s) instância(s) Evolution ativas para `min_interval = 3 segundos` (ou ajustar a função RPC se for hardcoded).
3. Manter as outras proteções (cap por hora, warmup) intactas.

**Ganho:** elimina os spikes de 47s observados nos logs.

## Validação pós-deploy

1. Lead novo no Evolution: cronometrar clique → primeira msg. Esperado: ~2-3s.
2. Logs: confirmar ausência de `min_interval_not_elapsed` em sequência normal.
3. Comparar com Whapi (deve continuar inalterado).
4. Monitorar 24h para sinais de bloqueio da instância (warmup/anti-ban).

## Riscos

- **humanDelayMs 800ms**: bot fica mais "robótico". Aceito porque o ganho de UX é maior.
- **min_interval 3s**: pequena chance de aumentar suspeita do WhatsApp. Instância `tvmensal01` já madura — risco baixo. Reversão: rodar migration inversa.
- **text_delay_ms teto 2s**: consultor que configurou pausa longa no Flow Builder deixa de ter efeito além de 2s no Evolution (Whapi mantém).
