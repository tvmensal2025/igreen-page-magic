## Diagnóstico

Reconstrui a linha do tempo do lead `5511989000650` no consultor `tvmensal01` (instância Evolution `igreen-953f7e48509b`, connectionState=`open`):

- 11:36:50 — inbound do lead: "Bom Dia" gravado em `conversations` (step=`welcome`).
- 11:37:28 — outbound do bot: "Oi! Tudo bem? Aqui é da equipe da *tvmensal01* 💚 …" gravado em `conversations` (step=`qualificacao`).
- 11:37:27 — `outbound_message_log` registra `result_status='sent'`, mas `evolution_message_id = NULL`.
- A partir daí: zero mensagens novas. O lead não respondeu — porque nunca recebeu nada no WhatsApp.

Confirmações cruzadas:
- Webhook está configurado no servidor Evolution (`/webhook/set` retornou 201 com `url=…/evolution-webhook`, eventos `MESSAGES_UPSERT`+`CONNECTION_UPDATE`, `enabled:true`).
- `verify_jwt=false` em `supabase/config.toml` para `evolution-webhook` → não há bloqueio de auth no inbound.
- Instância `igreen-953f7e48509b` está `state:open`, `status='connected'`, `connected_phone=5511946097469`.
- Bot global ligado, consultant existe (`bot_engine_mode=legacy`, `flow_engine_v3=off`), `conversational_flow_enabled=false`.
- O outbound não retornou erro: `sendWithRetry` só marca `'sent'` quando o HTTP do Evolution é 2xx.

## Causa raiz mais provável

Em `supabase/functions/evolution-webhook/index.ts` o webhook chama `sender.sendText(remoteJid, …)` passando o JID completo (`5511989000650@s.whatsapp.net`, vindo de `body.data.key.remoteJid`).

Dentro de `supabase/functions/_shared/evolution-api.ts:228-234` esse JID é repassado como está para o Evolution:

```ts
body: JSON.stringify({ number: remoteJid, text })
```

O endpoint `/message/sendText` da Evolution API v2 espera `number` em dígitos puros (`5511989000650`). Quando recebe `…@s.whatsapp.net`, em boa parte das versões do Baileys/Evolution ele responde `2xx` (parecendo sucesso) mas Baileys nunca envia a mensagem — exatamente o sintoma observado: `result_status='sent'` no nosso log, zero entrega no WhatsApp.

O fluxo WhAPI funciona porque o cliente WhAPI já normaliza o destinatário (e/ou aceita JID completo). O envio manual do consultor às 11:40 ("Oi") também chegou — feito pelo próprio cliente WhatsApp do consultor, sem passar pelo nosso sender.

Ponto adicional: hoje `recordOutboundResult(..., 'sent', null)` sempre grava `evolution_message_id=NULL` mesmo em sucesso (`evolution-api.ts:161`). Sem o `key.id` retornado, perdemos a única prova objetiva de que a Evolution aceitou o envio.

## Plano

Mudanças cirúrgicas, só em Evolution. Nada do WhAPI é tocado.

### 1. Normalizar `number` antes de enviar (`_shared/evolution-api.ts`)

Em `sendText`, `sendButtons`, `sendMedia`, `sendAudio` e `sendPresence`: extrair os dígitos do `remoteJid` antes do `JSON.stringify`. Helper único:

```ts
const toEvolutionNumber = (jid: string) =>
  String(jid || "").split("@")[0].replace(/\D/g, "");
```

E usar `number: toEvolutionNumber(remoteJid)`. Não muda o `remoteJid` usado nos logs/handlers — só o payload do POST.

### 2. Capturar e persistir o `evolution_message_id`

- Em `sendWithRetry`, quando `res.ok`, ler `await res.json()` e extrair `key?.id` (resposta padrão da Evolution v2 para sendText/sendButtons/sendMedia).
- Propagar esse id para `recordOutboundResult(..., 'sent', messageId)` em vez de `null`.
- Em caso de falha, gravar status code + 200 chars de body no log estruturado (já existe parcialmente em `captureError`).

### 3. Garantir que botões não são usados na Evolution

Pedido explícito do usuário ("assim como na whapi, mas sem botão"). Forçar fallback de `sendButtons` para texto numerado quando o canal é Evolution: pular o POST para `/message/sendButtons` e ir direto ao `sendText` com a lista numerada já existente em `evolution-api.ts:278`.

### 4. Verificação pós-deploy

- Reabrir conversa do lead (ou simular novo inbound) e conferir:
  - `outbound_message_log` agora tem `evolution_message_id` não-nulo.
  - Log do webhook mostra `✅ [sendText] resultado=true` + `key.id`.
  - Lead recebe a mensagem no WhatsApp.
- Se ainda falhar: o `key.id` capturado permite consultar `chat/findMessages` na Evolution e descobrir se a mensagem ficou em `PENDING` (problema de sessão Baileys) vs nunca foi aceita.

## Detalhes técnicos

Arquivos tocados:
- `supabase/functions/_shared/evolution-api.ts` — helper `toEvolutionNumber`, mudança em todos os payloads `number:`, parser de `key.id` no `sendWithRetry`, propagação do id para `recordOutboundResult`, short-circuit do `sendButtons` para texto.
- Nenhuma alteração em `evolution-webhook/index.ts` (continua passando `remoteJid` completo nos handlers — só o sender normaliza).
- Nenhuma alteração no WhAPI (`whapi-webhook`, `_shared/whapi-api.ts`).
- Sem migração de banco: `outbound_message_log.evolution_message_id` já existe.

Risco: baixo. Só normaliza o campo `number` enviado à Evolution e melhora telemetria. Caso a Evolution já aceitasse JID completo em alguma rota, o número puro continua válido (formato canônico documentado).
