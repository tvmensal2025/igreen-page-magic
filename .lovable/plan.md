## Diagnóstico

A UI do `/admin/fluxos` grava a ordem em `consultants.flow_step_media_order` indexada por **step_key** (ex.: `d_como_funciona`). Mas a maioria dos passos do fluxo D tem **slot_key compartilhado com o fluxo A** (ex.: `slot_key="como_funciona"`).

Exemplo real do consultor Rafael (`0c2711ad-...`):

```text
flow_step_media_order:
  como_funciona:    [text, audio, video, image]   ← config antiga (A)
  d_como_funciona:  [audio, video, text, image]   ← config nova (D) ✅ correta

bot_flow_steps:
  step_key=d_como_funciona, slot_key=como_funciona
```

No envio, o handler `whapi-webhook/handlers/conversational/index.ts` (e o irmão em `evolution-webhook/...`) calcula:

```ts
const slotKey = step.slot_key || step.step_key || step.id;       // = "como_funciona"
const uiOrder = await getStepMediaOrder(supabase, consultantId, slotKey); // pega ordem do A
```

Resultado: o fluxo D recebe `[text, audio, video, image]` (config do A) em vez de `[audio, video, text, image]` (config do D).

Comparação: o handler legado `bot-flow.ts` já faz certo — passa `[stepKey, slotKey]` para o helper, então o `step_key` ganha precedência. Só o `conversational` está errado.

## Correção (mínima e cirúrgica)

Trocar **todas** as chamadas de `getStepMediaOrder` no handler conversational para passar um array com `step_key` primeiro, idêntico ao padrão já usado em `bot-flow.ts`:

```ts
const uiOrder = await getStepMediaOrder(
  ctx.supabase,
  consultantId,
  [step.step_key, step.slot_key].filter(Boolean) as string[],
);
```

### Arquivos a editar

1. `supabase/functions/whapi-webhook/handlers/conversational/index.ts`
   - Linha ~385 (envio principal `sendStepMedia`)
   - Linha ~1266 (slot virtual `__qa__` — manter `"__qa__"` como única chave, sem mudança)
   - Linha ~1724 (segunda chamada `sendStepMedia` em path de retomada)

2. `supabase/functions/evolution-webhook/handlers/conversational/index.ts`
   - Mesmas 2-3 chamadas equivalentes (linhas ~385 e ~1103 visíveis no grep).

Nenhuma alteração em: `_shared/step-media-order.ts` (já aceita array), `_shared/engine/loader.ts` (v3 já trata candidatos corretamente), variants `a.ts`/`d.ts`, ou em `bot-flow.ts` (já corretos).

### Validação

1. Deploy das duas funções (`whapi-webhook`, `evolution-webhook`).
2. Consulta de sanidade em `engine_logs`/console: enviar mensagem para lead do Rafael (fluxo D) no step `d_como_funciona` e confirmar que a sequência sai `audio → video → text → image`.
3. Conferir os demais steps D do consultor (`d_welcome`, `d_resultado`, `d_pedir_*`, `d_finalizar`) — todos têm entrada própria com prefixo `d_` em `flow_step_media_order`, então o fix resolve todos de uma vez.
4. Regressão fluxo A/B: como o helper tenta `step_key` e cai para `slot_key`, passos sem entrada `d_*` continuam pegando a config antiga sem mudança de comportamento.

## Fora de escopo

- Não mexer em UI, em `bot_flow_steps.media_order` (já é fallback secundário), no engine v3 (que está em dark) nem em qualquer lógica de negócio.
- Não alterar o helper compartilhado.
