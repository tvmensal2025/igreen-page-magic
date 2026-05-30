## Diagnóstico

O erro do job 12 ainda tem uma causa diferente do ajuste anterior:

- O lead `bd64e790-fc71-4c0a-81d7-e285004b105d` está com `electricity_bill_value = 1576.34`, distribuidora e instalação salvas, mas `media_consumo = NULL`.
- O webhook marcou o lead como completo e enviou ao `worker-portal-2` com `consumoMedio: 0`.
- Como o helper `_shared/portal-worker.ts` envia um payload completo em `dados`, o `worker-portal-2` não busca o customer no Supabase e, por isso, não usa o fallback interno dele que estimaria o consumo pelo valor da conta.
- Resultado: `/bonus/rules` recebe consumo zero/nulo e a iGreen rejeita com “Consumo médio não informado”.
- A repetição aconteceu porque o worker colocou o job em retry 3 vezes no BullMQ, mas o lead já estava em `portal_submitting`; o bot não recebeu um estado claro de falha recuperável nem uma ação automática para corrigir o consumo antes de reenviar.

## Plano de correção

1. Corrigir o payload do Portal 2 no helper compartilhado
   - Em `supabase/functions/_shared/portal-worker.ts`, calcular `consumoMedio` com esta prioridade:
     - `customers.media_consumo`, se válido.
     - estimativa por `electricity_bill_value / 1.10`, com clamp `100..2000`.
     - fallback seguro `350` somente se não houver valor.
   - Incluir `electricity_bill_value` no select do customer para permitir essa estimativa.
   - Assim, mesmo que o OCR não tenha preenchido `media_consumo`, o worker nunca recebe `consumoMedio: 0`.

2. Blindar o finalizador do fluxo antes de disparar o worker
   - No `whapi-webhook` e no `evolution-webhook`, antes de salvar `portal_submitting`, garantir que `media_consumo` seja preenchido quando houver valor da conta.
   - Isso evita que leads que já passaram pelo OCR, edição manual ou revisão cheguem incompletos no envio final.

3. Melhorar tratamento de falha do worker Portal 2
   - Quando o dispatch/worker falhar com “Consumo médio não informado”, salvar um estado acionável no customer (`portal2_status`/`error_message`) e manter o lead pronto para retry, sem fazer o bot voltar a perguntar a mesma coisa ao cliente.
   - O sistema deve corrigir automaticamente via estimativa quando houver valor da conta, em vez de depender do cliente.

4. Reparar o lead atual
   - Atualizar o lead `bd64e790-fc71-4c0a-81d7-e285004b105d` com `media_consumo = 1433` calculado por `1576.34 / 1.10`.
   - Depois disso, reenviar/reprocessar o lead para o Portal 2.

5. Validar
   - Conferir no banco se o lead ficou com `media_consumo` preenchido.
   - Verificar logs do `whapi-webhook` para confirmar que o payload enviado ao worker contém consumo maior que 100.
   - Confirmar que o próximo job não cai mais no `/bonus/rules` por consumo ausente.