# Plano (auditado v2): eliminar `silent_handoff_empty_reply` para qualquer cliente

## Correções da auditoria vs. plano anterior

| Ponto antigo | Verdade no código | Impacto |
|---|---|---|
| "~50 call sites em bot-flow.ts" | **68** sites (`await sendText/sendOptions/sendButtons/sendMedia/sendAudio/ctx.sender…`) | Reescrever 68 por mão é inviável → reforça que a Camada 1 (counter automático) é o caminho certo |
| "Espelhar em whapi-webhook" | `whapi-webhook/index.ts` **não contém** `silent_handoff_empty_reply` — bug é exclusivo de Evolution | Remove escopo do whapi |
| "Wrappers em `_shared/channels/*`" | Já existe `_shared/sender-guard.ts` → `wrapSenderWithGuard` que embrulha `sendText/sendMedia/sendButtons/sendAudio` no boot do webhook (`index.ts:344`) | Lugar **único e óbvio** para colocar o contador; ganha cobertura total sem tocar handlers |
| "sendOptions precisa ser instrumentado" | `sendOptions` é helper local em `bot-flow.ts:1037` que apenas chama `sendText` por baixo | Instrumentar só os 4 métodos base já cobre `sendOptions`, `sendButtons`, etc. |
| "`BotContext` ganha campo `__turnOutbound`" | `BotContext.sender` é `any` (`handlers/types.ts:17`) | Pendurar o contador **no próprio objeto sender** (não na raiz do ctx) é menos invasivo e não muda a interface |

## Causa raiz (re-confirmada)

`evolution-webhook/index.ts:1850-1905` tem uma rede de segurança que pausa o bot quando: (a) handler retorna `reply=""`, (b) updates não tem `__inline_sent: true`, (c) consulta em `conversations` nos últimos 30s (excluindo `[inline-sent]%` / `[failed:%`) não acha outbound real. Falha quando:

1. Handler chamou sender inline mas esqueceu de marcar a flag (achado real de hoje no OCR conta/doc).
2. Envio gravou em `conversations` como `[inline-sent]` ou `[failed:pending]` → o filtro do safety-check exclui essas linhas (`index.ts:1814-1815, 1868-1869`).
3. Race: handler chamou `sendText` mas a row ainda não persistiu quando o pipeline consulta.

## Solução

### Camada 1 — Contador determinístico no sender-guard (fix estrutural)

**Arquivo:** `supabase/functions/_shared/sender-guard.ts`

Modificar `wrapSendFn` para incrementar um contador escondido no objeto `wrapped` toda vez que a função retornar com sucesso (qualquer valor que não seja literalmente `false` ou throw).

```ts
// dentro de wrapSenderWithGuard, antes de retornar `wrapped`:
Object.defineProperty(wrapped, "__turnOutbound", {
  value: 0, writable: true, enumerable: false, configurable: false,
});

// dentro de wrapSendFn, no caller:
const result = await origFn.apply(this, args);
if (result !== false) {
  try { (wrapped as any).__turnOutbound++; } catch { /* noop */ }
}
return result;
```

**Arquivo:** `supabase/functions/evolution-webhook/index.ts` (linhas 1858-1905)

Trocar a heurística atual por leitura do contador antes do DB-check:

```ts
const senderOutboundCount = Number((sender as any).__turnOutbound || 0);
let realOutboundExistsFinal = senderOutboundCount > 0;
if (!realOutboundExistsFinal && !reply) {
  // fallback: consulta DB como antes
  try {
    const sinceIso = new Date(Date.now() - 30_000).toISOString();
    const { data: realRow } = await supabase
      .from("conversations")
      .select("id")
      .eq("customer_id", customer.id)
      .eq("message_direction", "outbound")
      .gte("created_at", sinceIso)
      .not("message_text", "like", "[inline-sent]%")
      .not("message_text", "like", "[failed:%")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    realOutboundExistsFinal = !!realRow;
  } catch { /* fail-open */ }
}
const handlerSentInline =
  !reply && (
    (updates as any).__inline_sent === true ||
    senderOutboundCount > 0 ||
    realOutboundExistsFinal
  );
```

O mesmo `senderOutboundCount` substitui o gate equivalente no bloco `if (__inline_sent_flag)` (linhas 1798-1846) — assim quando o handler marca `__inline_sent: true` mas por algum bug não enviou nada, o contador detecta e o `inline_sent_contract_violation` continua disparando como hoje.

**Como o reset do contador acontece:** o `sender` é instanciado uma vez por request (`index.ts:344`), então o contador nasce em 0 a cada turno automaticamente. Não precisa reset manual.

### Camada 2 — Rede de segurança nunca pausa o bot

**Arquivo:** `supabase/functions/evolution-webhook/index.ts` (linhas 1893-1904)

Remover o `bot_paused = true` + `bot_paused_reason = "silent_handoff_empty_reply"`. No lugar, **re-prompt do step atual**:

```ts
if (!finalReply && !handlerSentInline) {
  console.error(`🚨 [empty-reply-safety] step="${stepToSend}" customer=${customer.id} → re-prompting`);
  captureError(new Error(`Bot empty reply at step ${stepToSend}`), {
    tags: { function: "evolution-webhook", kind: "empty_reply_safety" },
    extra: { customer_id: customer.id, step: stepToSend },
  });
  // Tenta re-emitir o template do step atual; se não houver template, usa cumprimento humano.
  try {
    const repromptText = await getTemplate(
      supabase, String(stepToSend), "default",
      { nome: customer.name, representante: nomeRepresentante },
    );
    finalReply = (repromptText && repromptText.trim()) || "oii 😊";
  } catch {
    finalReply = "oii 😊";
  }
}
```

A enum `silent_handoff_empty_reply` em `customer-flow-state.ts:24` **fica** (compatibilidade com dados antigos) mas nunca mais é escrita pelo bot.

### Camada 3 — Anti-loop (rede da rede de segurança)

Se o mesmo `customer_id + conversation_step` cair na Camada 2 **≥3 vezes em 5 min**, aí sim pausa para humano com `bot_paused_reason = "anti_loop"` (enum já existe). Critério verificado por:

```ts
const { count } = await supabase
  .from("conversations")
  .select("id", { count: "exact", head: true })
  .eq("customer_id", customer.id)
  .eq("conversation_step", String(stepToSend))
  .eq("message_text", "[empty-reply-safety]")
  .gte("created_at", new Date(Date.now() - 5 * 60_000).toISOString());
if ((count ?? 0) >= 2) { /* pausa com anti_loop */ }
// e grava 1 row sentinel `[empty-reply-safety]` por ocorrência.
```

### Camada 4 — Backfill one-off

Migração que despausa todos os leads atualmente travados pelo bug:

```sql
UPDATE customers
SET bot_paused = false,
    bot_paused_reason = null,
    bot_paused_at = null
WHERE bot_paused_reason = 'silent_handoff_empty_reply';
```

## Validação

1. **Teste unitário Deno** em `supabase/functions/_shared/__tests__/sender-guard.turn-counter.test.ts`: chama `wrapSenderWithGuard` com mock, executa 3 `sendText` e asserta `wrapped.__turnOutbound === 3`. Testa caminho `false` (não incrementa).
2. **Teste de integração** em `evolution-webhook/__tests__/empty-reply-safety.test.ts`: stub do handler que faz `sender.sendText(...)` e retorna `{reply:"", updates:{}}` (sem flag). Asserta que `customers.bot_paused` continua `false` e que o cliente recebeu a mensagem.
3. **Smoke manual:** reset do `11971254913`, `Oi → 1 → foto da conta → 1` → segue para `aguardando_documento` sem pausar.
4. **Monitor pós-deploy:** alerta no Sentry para `empty_reply_safety` — se subir, sinaliza handler com bug real (não mais falso-positivo).

## Riscos & mitigações

| Risco | Mitigação |
|---|---|
| Contador conta envio que **falhou silenciosamente** (sender retornou `true` mas Evolution não entregou) | Mantemos o DB-check como 2º fallback; `evolution_send_pending` continua sendo `warn` no Sentry |
| Re-prompt com `getTemplate` pode lançar exceção e quebrar a Camada 2 | Bloco `try/catch` que cai em `"oii 😊"` |
| Sender é re-criado por chamada interna em algum handler (perderia o contador) | Audit confirma: sender é construído **só** em `index.ts:344` e passado como referência via `ctx.sender`. Nenhum handler reinstancia (`grep wrapSenderWithGuard`/`new Sender` em handlers = 0 hits) |
| Camada 3 (anti-loop) pode pausar legítimo se 3 turnos seguidos forem do mesmo step | Threshold 3× em 5min é tolerante; em fluxo normal o step muda a cada turno |

## Escopo NÃO incluído

- `whapi-webhook` (bug não existe lá — confirmado).
- Reescrita dos 68 call sites com `__inline_sent` (Camada 1 torna a flag opcional; quem já tem fica como reforço documental).
- Lint estático de regressão (Camada 3 anterior) — substituído pelo monitor Sentry, mais barato e detecta runtime de verdade.
- `dispatcher/` e `conversational/index.ts` — eles já inserem em `conversations` corretamente e não disparam o safety.

## Aviso

`.lovable/` está no `.gitignore`, então este plano **não persiste** após o snapshot. Se quiser mantê-lo versionado, posso remover essa entrada — me avise.
