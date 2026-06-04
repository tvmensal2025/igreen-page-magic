Problema identificado:

- A Evolution está aceitando o envio como `PENDING`, mas logo depois envia `messages.update` com `status: "ERROR"` para os mesmos IDs (`3EB02DC7886DC96D58E32A` e `3EB01413419DB5B3967337`).
- O webhook atual ignora `ERROR`, então não marca a mensagem como falha.
- A verificação pós-envio encontra a mensagem no histórico e promove para `sent` mesmo sem ACK válido. Isso mascara a falha real.
- Resultado: o sistema mostra “enviado/sent”, mas o WhatsApp não entregou.

Plano de correção:

1. Corrigir o handler de `messages.update` em `supabase/functions/evolution-webhook/index.ts`
   - Mapear `status: "ERROR"`, `"FAILED"` ou equivalentes para `delivery_status = "failed"`.
   - Salvar `delivery_error` com uma mensagem clara, como `Evolution returned ERROR ack`.
   - Usar corretamente `keyId`, `messageId` e `key.id` para encontrar o `external_message_id`.
   - Processar ACK/status antes dos bloqueios globais do bot, para status de entrega nunca serem ignorados.

2. Corrigir a verificação pós-envio
   - Não promover para `sent` só porque a mensagem apareceu no histórico.
   - Só marcar como `sent`, `delivered` ou `read` quando houver status/ACK positivo explícito.
   - Se o histórico trouxer `ERROR`, marcar como `failed`.
   - Se não houver status confiável, manter como `queued` em vez de fingir envio.

3. Corrigir a UI do chat manual
   - Permitir status visual de falha na bolha da mensagem.
   - Quando o `findMessages` retornar `ERROR`, mostrar falha em vez de relógio/check.
   - Evitar que mensagens manuais pendentes pareçam entregues sem confirmação.

4. Reconfigurar/validar webhook da instância atual
   - Confirmar que a instância `igreen-953f7e48509b` continua enviando `MESSAGES_UPDATE`.
   - Depois da alteração, testar com os dois contatos e validar nos logs que `ERROR` vira `failed`, não `sent`.

Arquivos envolvidos:

- `supabase/functions/evolution-webhook/index.ts`
- `src/services/evolutionApi.ts`
- `src/hooks/useMessages.ts`
- `src/components/whatsapp/MessageBubble.tsx`

Resultado esperado:

- Se a Evolution retornar `ERROR`, o sistema vai mostrar falha real.
- Se ficar apenas `PENDING`, ficará como pendente/queued.
- Só será exibido como enviado/entregue quando houver ACK positivo real do WhatsApp.