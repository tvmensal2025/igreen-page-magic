## Auditoria — resultado

### ✅ Tudo que foi aplicado e está correto

- **Hard-lock no banco**: `check_send_quota` retorna `fatal_lock_manual_review` quando `manual_review_required=true` ou `fatal_lock_until>now()` — verificado no SQL da função.
- **Instância `igreen-953f7e48509b**` continua travada até **2026-06-18 17:46 UTC** (reason 403).
- **Sender-guard** ativo em `evolution-webhook/index.ts` → cobre 100% do fluxo conversacional (~50 callsites em conversational/*, bot-flow.ts).
- **Frontend**: `fatalLocked` propagado em `useWhatsApp`, `WhatsAppTab`, `ConnectionPanel`, `InstanceHealth`. Botões de reconectar bloqueados.
- **Webhook**: gate de hard-lock na entrada (`evolution-webhook/index.ts:299-313`) impede o bot-flow inteiro.
- **Reconnect endpoint**: retorna `423 Locked`.

### ⚠️ Gaps encontrados — Edge Functions que criam sender SEM guard

Estes ainda chamam `createEvolutionSender` direto e podem disparar mensagens mesmo com a instância em hard-lock, alimentando o ban:


| Function                                | Risco     | O que envia                                   |
| --------------------------------------- | --------- | --------------------------------------------- |
| `ai-agent-router` (linhas 215, 709)     | 🔴 ALTO   | Respostas IA disparadas por triggers internos |
| `bot-stuck-recovery` (linha 268)        | 🔴 ALTO   | "Rescue" automático de leads parados          |
| `outbound-media-flush-cron` (linha 148) | 🔴 ALTO   | Flush de mídia pendente em lote               |
| `worker-callback` (linha 94)            | 🟡 MÉDIO  | Confirmação após processo externo             |
| `ai-daily-digest` (linha 167)           | 🟢 BAIXO  | Relatório ao consultor (não ao lead)          |
| `manual-step-send` (linhas 207, 595)    | 🟢 manter | Envio manual do operador — bypass intencional |


### Plano de correção

Aplicar `wrapSenderWithGuard` nos 4 pontos críticos + 1 médio:

1. `**ai-agent-router/index.ts**` — envolver ambos os senders (215, 709). Disparos IA respeitam quota/fatal-lock.
2. `**bot-stuck-recovery/index.ts:268**` — envolver. Recovery cron NUNCA deve enviar em instância travada.
3. `**outbound-media-flush-cron/index.ts:148**` — envolver. Maior risco: rajada de mídia em instância suspeita = ban garantido.
4. `**worker-callback/index.ts:94**` — envolver. Confirmações pós-processamento entram na fila normal.
5. `**ai-daily-digest**` e `**manual-step-send**`: deixar como estão (digest é admin, manual é intencional do operador).

### Padrão de edit (idêntico ao já aplicado em evolution-webhook)

```ts
const rawSender = createEvolutionSender(url, key, instanceName);
const { wrapSenderWithGuard } = await import("../_shared/sender-guard.ts");
const sender = wrapSenderWithGuard(rawSender, { supabase, instanceName });
```

### Critério de aceite

- Toda função automatizada (cron, webhook, IA) passa por `check_send_quota`.
- `manual-step-send` mantém bypass (é o operador clicando manualmente).
- Instância `igreen-953f7e48509b` permanece intocada (lock até 18/06).
- Nenhum envio adicional possível para essa instância via qualquer caminho automatizado.

Posso aplicar? sim pode

&nbsp;