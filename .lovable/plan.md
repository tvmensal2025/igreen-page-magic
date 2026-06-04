
## Problema

Quando você clica em **"Zerar conversa"** no painel do admin, o sistema:
- apaga o histórico visível,
- zera `conversation_step`, `capture_mode`, contadores e prompts,
- **MAS NÃO** zera o handoff humano (`bot_paused=true`, `bot_paused_reason=humano_assumiu`, `assigned_human_id=<operador>`).

Resultado: a próxima mensagem do lead bate no webhook, vê o pause de takeover e responde no log `🤝 [handoff] bot pausado ... Skip auto-reply`. O fluxo D nunca arranca.

Foi exatamente o que aconteceu com **5511989000650 (Rafael Ferreira)** no consultor `tvmensal01` agora há pouco.

## Correção em 2 partes

### 1. Destravar o lead específico agora (manual)

Migration única que, **só para esse customer**, reseta o handoff e devolve para o ponto inicial do fluxo D:

```sql
UPDATE public.customers
SET bot_paused = false,
    bot_paused_reason = NULL,
    bot_paused_at = NULL,
    bot_paused_until = NULL,
    assigned_human_id = NULL,
    conversation_step = NULL,
    capture_mode = 'auto',
    custom_step_retries = 0,
    custom_step_retries_step = NULL,
    last_custom_prompt_at = NULL,
    ai_followups_count = 0
WHERE id = '937defb9-e206-4779-9855-92753883cf08';

DELETE FROM public.ai_slot_dispatch_log
 WHERE customer_id = '937defb9-e206-4779-9855-92753883cf08';
```

Na próxima mensagem do Rafael, o webhook deve cair no fluxo D do `tvmensal01` (já cloneado do superadmin, `is_active=true`).

### 2. Corrigir o "Zerar conversa" para também liberar o bot

Hoje a action `resetConversation` (em `src/services/resetConversation.ts`) limpa estado do funil mas **mantém** o pause. Ajustar para que, ao zerar:

- `bot_paused = false`
- `bot_paused_reason = NULL`
- `bot_paused_at = NULL`
- `bot_paused_until = NULL`
- `assigned_human_id = NULL`
- limpar `ai_slot_dispatch_log` do customer (já é feito em alguns paths, garantir aqui)

Assim, "Zerar conversa" volta a significar "o bot recomeça do zero" — que é o que o toast já promete: *"O bot vai começar do zero."*

### 3. Investigação à parte (não bloqueia)

Existe um segundo `customer` com o mesmo número (`5f8be1a8...`) no consultor `rafael.ids` desde 30/05, também travado em `humano_assumiu_whatsapp`. Como o mesmo número conversa com 2 consultores diferentes via instâncias separadas, isso é esperado — mas vale revisar se um dos dois deveria ser arquivado/marcado `do_not_contact` para evitar dupla resposta caso ambas as instâncias estejam ativas para esse número.

## Não escopo

- Não vou mexer no fluxo D em si (steps, mídia, templates) — ele está correto e cloneado.
- Não vou mexer no auto-takeover (operador digitar = pause). A regra está correta; só a action de "Zerar conversa" precisa também limpar esse pause.
