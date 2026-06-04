## Diagnóstico confirmado

- O webhook do bot recebeu os dois “Oi” e chamou a Evolution corretamente.
- A Evolution respondeu 2xx e devolveu IDs de mensagem para os envios automáticos:
  - `5511989000650`: `3EB0A43971A3692FA75A2D`
  - `5511971254913`: `3EB02B7BB2CD02C94F42E0`
- O sistema gravou esses outbounds em `conversations` como se estivessem enviados.
- No envio manual visto no log, a Evolution retornou `201` com `status: "PENDING"`; hoje o frontend interpreta qualquer resposta sem erro como `sent` e adiciona a bolha com `status: 1`.
- Portanto o bug principal é: o app confunde “Evolution aceitou/filou a mensagem” com “WhatsApp recebeu/entregou a mensagem”.

## Plano de correção

1. Validar resposta real da Evolution no frontend
   - Alterar `src/services/messageSender.ts` para não retornar `sent` automaticamente após `sendTextMessage`/mídia.
   - Se a resposta vier com `status: "PENDING"`, retornar `pending` em vez de `sent`.
   - Se vier sem `key.id`, `messageId` ou estrutura mínima esperada, retornar `failed` ou `pending_confirmation`, não `sent`.

2. Mostrar estado correto na UI
   - Alterar `src/hooks/useMessages.ts` para criar mensagem otimista como pendente quando a Evolution retornar `PENDING`.
   - Não marcar visualmente como enviada até haver confirmação posterior pelo histórico/ACK.
   - Se o envio falhar, remover ou marcar a bolha como erro.

3. Validar o envio automático do bot
   - Alterar `supabase/functions/_shared/evolution-api.ts` para `sendWithRetry` distinguir:
     - `sent/accepted` com ID válido;
     - `pending` quando Evolution retornar fila pendente;
     - `failed` quando houver erro real ou payload inválido.
   - Não registrar `evolution_send_ok` como sucesso absoluto quando a resposta é apenas `PENDING`; registrar como `evolution_send_pending`.

4. Evitar registro falso no histórico do bot
   - Ajustar `supabase/functions/evolution-webhook/index.ts` para só inserir outbound em `conversations` como enviado quando o helper confirmar envio aceito com ID válido.
   - Quando ficar pendente, registrar de forma rastreável sem afirmar entrega final.

5. Adicionar verificação pós-envio
   - Após receber `key.id`, consultar `chat/findMessages` por alguns segundos para confirmar se a mensagem apareceu no histórico da Evolution.
   - Se não aparecer, logar falha de confirmação e não mostrar como entregue.

6. Opcional, mas recomendado: persistir status de entrega
   - Adicionar campos em `conversations` para `external_message_id`, `delivery_status` e `delivery_checked_at`.
   - Isso permite diferenciar `queued`, `sent`, `delivered`, `read` e `failed` no histórico.

7. Reconfigurar webhook para eventos de status
   - Atualizar a configuração da instância para ouvir também eventos de atualização/status de mensagem da Evolution, além de `MESSAGES_UPSERT` e `CONNECTION_UPDATE`.
   - Usar esses eventos para atualizar `delivery_status` quando a Evolution informar entrega/leitura.

8. Validação final
   - Enviar uma mensagem manual e uma automática para os dois números.
   - Conferir nos logs: resposta Evolution, ID externo, status inicial, confirmação no histórico e atualização visual.
   - O app só deve marcar como enviado quando houver confirmação, e deve mostrar pendente/falha quando a Evolution não confirmar entrega.