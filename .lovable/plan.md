# Plano final: Corrigir entrega + visibilidade Evolution API

Combina os 7 itens da auditoria de código + 4 itens novos (reconexão, health-check, critério de bloqueio, `@lid` matching) para resolver tanto a **visibilidade** quanto a **entrega real** das mensagens.

---

## Parte A — Visibilidade e tracking (resolve "mostra enviado mas não entregou")

### 1. Unificar envios internos do bot
Todos os handlers passam a usar `sendTextDetailed`/`sendMediaDetailed` e gravam no insert da `conversations`:
- `external_message_id` = `messageId` retornado
- `delivery_status` = `'queued'` (PENDING) ou `'sent'` (ACK imediato)
- `delivery_error` = null

Arquivos: `bot-flow.ts` e todos os subhandlers, `send-scheduled-messages`, follow-ups, fallback/reentry.

### 2. Webhook `messages.update` resiliente
Em `supabase/functions/evolution-webhook/index.ts`:
- `ERROR`/`FAILED` → `delivery_status='failed'`, `delivery_error='Evolution returned <status> ack'`. Nunca promover para sent.
- **Fallback de matching:** se `external_message_id` não casa, buscar último outbound do mesmo `customer_id` + `instance_id` nos últimos 60s sem `external_message_id` e linkar antes de marcar como failed.
- Idempotência inversa: não regredir `delivered`/`read` ao receber ERROR tardio.
- Atualiza `outbound_message_log.result_status='failed'` em conjunto.

### 3. Remover promoção falsa via `findMessages`
- Trocar verificação pós-envio por `chat/findStatusMessage`.
- Se status ≠ ACK positivo explícito → mantém `queued`. Nunca "timeout vira sent".
- Se retornar ERROR → marca `failed`.

### 4. UI mostrar status correto
Em `MessageBubble.tsx` + `useMessages.ts`:
- `failed` → ícone vermelho + tooltip com `delivery_error`
- `queued` → relógio
- `sent`/`delivered`/`read` → checks como hoje
- Realtime propaga `delivery_status` e `delivery_error`

---

## Parte B — Entrega real (resolve "ERROR ack contínuo")

### 5. Preservar `remoteJidAlt` e `@lid`
- Migration: adicionar `remote_jid_alt TEXT` em `conversations`.
- Em `evolution-api.ts`: detectar sufixo (`@lid` vs `@s.whatsapp.net`) e preservar. Só normalizar dígitos quando o endpoint pede `number` puro.
- Webhook persiste `remoteJidAlt` quando presente — usado como segundo critério de matching de ACK.

### 6. Detecção inteligente de instância degradada
Migration: adicionar em `whatsapp_instances`:
- `consecutive_send_errors INT DEFAULT 0`
- `error_destinations JSONB DEFAULT '[]'` (lista de números distintos que falharam na janela)
- `last_error_at TIMESTAMPTZ`

Regra: marcar `status='needs_reconnect'` apenas quando houver **3 destinos distintos** com ERROR em janela de 5 min (evita bloquear lote por um único número inválido). SERVER_ACK/DELIVERY_ACK zera o contador.

### 7. Botão "Reconectar instância" no painel admin (NOVO — crítico)
- Componente `InstanceReconnectButton` que chama edge function `evolution-instance-reconnect`.
- Edge function chama `POST /instance/logout/{name}` + `GET /instance/connect/{name}` e devolve o QR base64.
- Modal exibe QR para o usuário escanear; ao detectar `connectionUpdate` com `state='open'` via webhook, zera `consecutive_send_errors`, limpa `needs_reconnect`, fecha modal.

### 8. Health-check canário antes de broadcast (NOVO)
- Em `bulk-scheduler`: antes de processar a fila, chamar `/instance/connectionState`. Se `open` e `consecutive_send_errors < 3`, segue. Caso contrário, pausa o lote e notifica admin.
- Opcional (fase 2): envio canário para número de teste configurável.

### 9. Banner de saúde da instância (NOVO)
- Componente `InstanceStatusBanner` no topo do painel WhatsApp.
- Mostra estado (`open`/`needs_reconnect`), contagem de erros, botão reconectar.
- Visível em todas as telas que dependem da instância (chat, broadcast, scheduler).

---

## Parte C — Validação

1. **Antes do deploy:** rodar `findStatusMessage` em msgs já entregues para garantir que não regredimos status correto.
2. **Após deploy:** reenviar para `5511989000650` e `5511971254913`. Esperado:
   - `conversations.delivery_status='failed'`
   - `outbound_message_log.result_status='failed'`
   - UI bolha vermelha com erro
3. **Reconexão:** clicar botão, escanear QR, confirmar `status='connected'` e `consecutive_send_errors=0`.
4. **Pós-reconexão:** reenviar para os mesmos números, confirmar `delivered` real.

---

## Arquivos afetados

```text
# Migrations
supabase/migrations/<ts>_instance_health_tracking.sql
  - whatsapp_instances: consecutive_send_errors, error_destinations, last_error_at
  - conversations: remote_jid_alt

# Edge functions
supabase/functions/_shared/evolution-api.ts        (sendText unificado, @lid preservado, findStatusMessage)
supabase/functions/evolution-webhook/index.ts      (ERROR→failed, fallback matching, remoteJidAlt, contador)
supabase/functions/bot-flow/**/*.ts                (todos call-sites de sendText)
supabase/functions/send-scheduled-messages/index.ts
supabase/functions/bulk-scheduler/index.ts         (health-check canário)
supabase/functions/evolution-instance-reconnect/index.ts  (NOVA)

# Frontend
src/services/evolutionApi.ts
src/hooks/useMessages.ts
src/hooks/useInstanceHealth.ts                     (NOVO)
src/components/whatsapp/MessageBubble.tsx
src/components/whatsapp/InstanceStatusBanner.tsx   (NOVO)
src/components/whatsapp/InstanceReconnectButton.tsx (NOVO)
```

## Resultado esperado

- Mensagens que falharem aparecem como **falha real** na UI (não mais "enviado" falso).
- Quando a sessão Baileys degrada, o admin vê o banner e reconecta com 1 clique.
- Broadcasts não disparam contra instância quebrada.
- Após reconexão, entregas voltam ao normal sem deploy nem mexer no servidor Evolution.

## Nota
Se mesmo após reconexão por QR o ERROR persistir, será necessário no servidor Evolution: atualizar para v2.2.x+ e setar `WPP_LID_MODE=false`. Isso é config do provedor, fora do escopo do app — vou avisar no banner se detectarmos esse padrão.
