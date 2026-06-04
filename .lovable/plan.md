## Diagnóstico confirmado

Testei o número novo do consultor `tvmensal01` e o problema se repetiu.

Novo lead criado:

- `customer_id`: `1cf4edd9-9c20-46e5-99e1-f024d2f670bb`
- telefone: `5511971254913`
- `bot_paused = false`
- `assigned_human_id = null`
- `conversation_step = welcome`
- `flow_variant = D`
- `last_bot_reply_at` atualizado

Histórico salvo:

- inbound real: `Oi`
- outbound salvo: `[inline-sent]`
- nenhuma mensagem real do fluxo foi salva/enviada

Log do webhook:

```text
inline_sent_skipped
customer_id=1cf4edd9-9c20-46e5-99e1-f024d2f670bb
step=welcome
reply_was_set=false
v2_flag=off
```

Conclusão: não é pausa, humano assumido, número antigo, nem flag `conversational_flow_enabled`. O webhook entra no fluxo, mas o handler devolve `__inline_sent=true` sem ter enviado nada real. O orquestrador acredita que o handler já enviou e encerra o turno silenciosamente.

## Causa técnica provável

Há dedupe em dois níveis usando a mesma tabela/chave:

1. `evolution-webhook/index.ts` chama `checkAndMarkProcessed(...)` no início do webhook.
2. `runConversationalFlow(...)` chama `checkAndMarkWebhookDedupe(...)` novamente com o mesmo `messageId` e `instanceName`.
3. A segunda chamada pode interpretar a própria mensagem recém-marcada pelo orquestrador como duplicada.
4. O handler retorna `updates: { __inline_sent: true }` e `reply: ""`.
5. O orquestrador pula o envio e grava `[inline-sent]`.

Mesmo que o dedupe interno não seja o único caminho, o contrato atual é inseguro: `__inline_sent=true` está sendo aceito como prova de envio sem validação.

## Plano de implementação

### 1. Remover o dedupe duplicado do handler conversacional

Arquivo:

- `supabase/functions/evolution-webhook/handlers/conversational/index.ts`

Alteração:

- Remover ou desativar a chamada a `checkAndMarkWebhookDedupe(...)` dentro de `runConversationalFlow` para o caminho Evolution.
- Manter o dedupe canônico no orquestrador `evolution-webhook/index.ts`.
- Remover imports que ficarem sem uso.

Objetivo:

- Uma mensagem inbound deve ser marcada como processada apenas uma vez por webhook.

### 2. Corrigir o contrato de `__inline_sent`

No handler conversacional:

- Nunca retornar `__inline_sent=true` apenas por dedupe/skip lógico.
- Só marcar `__inline_sent=true` quando `sendText`, `sendMedia` ou fallback real tiver retornado sucesso ou gravado outbound real.

Objetivo:

- `__inline_sent` volta a significar “algo foi realmente emitido ao cliente”.

### 3. Adicionar proteção anti-silêncio no orquestrador

Arquivo:

- `supabase/functions/evolution-webhook/index.ts`

Alteração:

- No bloco que trata `__inline_sent_flag`, evitar gravar `[inline-sent]` quando `reply` está vazio e não há evidência de outbound real recente para aquele customer/step.
- Se não houver outbound real, deixar cair no fallback de resposta ou registrar erro claro de contrato.

Objetivo:

- Mesmo que outro handler erre no futuro, o cliente não fica sem resposta com um falso `[inline-sent]`.

### 4. Liberar os leads afetados para reteste

Usar alteração de dados, não migração de schema.

Leads afetados:

- `937defb9-e206-4779-9855-92753883cf08`
- `1cf4edd9-9c20-46e5-99e1-f024d2f670bb`

Ajustes:

- `bot_paused=false`
- `assigned_human_id=null`
- limpar motivo/tempo de pausa antigos
- resetar `conversation_step` para `null` ou `welcome`, conforme o fluxo espera
- limpar registros recentes de dedupe desses turnos se necessário para permitir novo teste com “Oi”

### 5. Validar após a correção

Depois da implementação, testar novo inbound “Oi” e conferir:

- logs sem `inline_sent_skipped` vazio
- outbound real salvo em `conversations`
- envio real pela Evolution (`sendText` ou mídia/texto do passo `d_welcome`)
- customer avança/permanece no step correto sem silêncio

## Resultado esperado

Ao chamar de qualquer número novo, o fluxo D deve iniciar normalmente com o conteúdo configurado do `d_welcome`, em vez de salvar apenas `[inline-sent]`.