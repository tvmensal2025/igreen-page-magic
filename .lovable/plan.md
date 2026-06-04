## Diagnóstico confirmado

Pelos logs e banco, o problema ainda não é “o bot não chamou a Evolution”. Ele chamou.

Evidências recentes:

- Lead `5511971254913` enviou `Oi` às `16:26:35`.
- O webhook respondeu com a mensagem de boas-vindas às `16:27:29`.
- A Evolution devolveu `message_id = 3EB09BD5AAD23CBECBEC10`, mas com estado `PENDING`.
- Mesmo assim, o sistema gravou em `conversations` como outbound normal e logou `outbound_done sent=true`.
- Em `outbound_message_log`, o mesmo envio foi salvo como `result_status='sent'`, apesar de ser apenas `PENDING`.

Conclusão: a correção anterior melhorou a leitura do `PENDING`, mas o fluxo principal do bot ainda trata `PENDING` como sucesso final. O app continua dizendo “enviado” quando, na prática, a Evolution só aceitou a requisição e ainda não confirmou entrega pelo WhatsApp/Baileys.

## Correção proposta

### 1. Separar “aceito pela Evolution” de “confirmado pelo WhatsApp”

Alterar `supabase/functions/_shared/evolution-api.ts` para retornar um resultado estruturado em vez de apenas `true/false` no envio detalhado:

```text
accepted: Evolution recebeu HTTP 2xx
pending: Evolution respondeu PENDING
messageId: id externo retornado
confirmed: apareceu no histórico/ACK
failed: erro real
```

Manter compatibilidade com os pontos antigos que ainda esperam booleano, mas o webhook do bot passará a usar o resultado detalhado.

### 2. Parar de gravar PENDING como enviado final

Alterar `supabase/functions/evolution-webhook/index.ts`:

- Se Evolution retornar erro: não gravar como mensagem enviada.
- Se retornar `PENDING`: gravar como rastreável, mas não como envio final confirmado.
- Ajustar `outbound_done` para registrar `delivery_status='queued' | 'sent' | 'failed'`, não apenas `sent=true`.

### 3. Persistir status real de entrega

Criar migração para adicionar em `conversations`:

- `external_message_id`
- `delivery_status`
- `delivery_checked_at`
- `delivery_error`

Valores esperados:

```text
queued       Evolution aceitou, mas WhatsApp ainda não confirmou
sent         apareceu no histórico/ACK como enviado
-delivered   entregue ao aparelho do contato, quando ACK existir
read         lida, quando ACK existir
failed       falha real ou não apareceu após verificação
```

Assim o painel deixa de depender de texto/log e passa a ter estado auditável por mensagem.

### 4. Verificação pós-envio no webhook do bot

Depois de receber `messageId`, consultar `chat/findMessages` por alguns segundos.

- Se o ID aparecer no histórico da Evolution: marcar `sent`.
- Se não aparecer: manter `queued` ou marcar `failed` após tentativas.
- Se status vier menor que entrega real, manter `queued` e deixar o ACK atualizar depois.

### 5. Configurar eventos de status/ACK da Evolution

Atualizar `src/services/evolutionApi.ts` em `createInstance` e `setInstanceWebhook` para ouvir também eventos de atualização/status, além dos atuais:

- `MESSAGES_UPSERT`
- `CONNECTION_UPDATE`
- `MESSAGES_UPDATE` / `MESSAGE_ACK` conforme payload da Evolution

Depois adaptar `evolution-webhook` para reconhecer esses eventos e atualizar `conversations.delivery_status` pelo `external_message_id`.

### 6. Corrigir envio manual no painel

Ajustar `src/hooks/useMessages.ts` e `src/services/messageSender.ts`:

- `PENDING` não deve renderizar como “enviado final”.
- A bolha fica pendente enquanto não houver confirmação no histórico.
- Se não confirmar, a UI marca como falha/pendente em vez de manter check falso.

### 7. Reconfigurar a instância atual

Além de alterar o código para novas instâncias, aplicar a configuração de webhook na instância atual:

```text
igreen-953f7e48509b
```

Isso é necessário porque mudar `setInstanceWebhook` só afeta quando essa função for chamada novamente.

## Validação final

Após implementar:

1. Enviar `Oi` para `5511971254913`.
2. Enviar `Oi` para `5511989000650`.
3. Conferir nos logs:
   - resposta Evolution;
   - `messageId`;
   - `delivery_status` inicial;
   - confirmação no histórico;
   - atualização por ACK, se chegar.
4. Confirmar que o app não mostra mais “enviado” quando a Evolution retorna apenas `PENDING`.

## Resultado esperado

O sistema vai parar de mentir visualmente. Se a Evolution aceitar mas o WhatsApp não entregar, o painel mostrará pendente/falha rastreável. Se confirmar no histórico ou ACK, aí sim será marcado como enviado/entregue.