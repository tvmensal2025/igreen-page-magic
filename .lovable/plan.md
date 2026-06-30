
## Diagnóstico do lead 19998804421 (Whapi / Super Admin)

Linha do tempo do `customer_id 5f49ec30...`:

```
00:35:55  inbound  "Olá! Posso ter mais informações..."
00:36:03  outbound (bot) d_welcome
00:36:47  inbound  "💚 Quero simular" (botão)
00:36:47  ⚠️ bot_paused=true, bot_paused_reason="humano_assumiu_whatsapp"
00:36:55  outbound (bot) d_escolher_simulacao  ← já em corrida, ainda sai
00:59:43  inbound  "💡 Simulação rápida"        ← bot já pausado, NÃO responde
00:59:58  inbound  "📸 Simulação completa"      ← bot já pausado, NÃO responde
```

**Causa raiz:** `parseWhapiMessage` (`supabase/functions/_shared/whapi-api.ts:458-470`) considera takeover humano qualquer evento `from_me=true` cujo `source` não seja exatamente `"api"` ou vazio. O Whapi às vezes devolve o eco da nossa própria mensagem (enviada via API) com `source` diferente (`"ai"`, `"web"`, etc.) e o webhook pausa o bot como se o consultor tivesse digitado no app. Foi exatamente isso que aconteceu entre 00:36:03 e 00:36:47.

O Evolution-webhook não tem esse bug (ignora `fromMe` direto), mas também perde a detecção legítima de takeover.

## Plano (3 mudanças mínimas, escopo backend/edge)

### 1. Whapi: cross-check do eco antes de pausar
Arquivo: `supabase/functions/_shared/whapi-api.ts`

- Antes de devolver `{ outboundHuman: true, ... }`, exigir que `source` esteja em uma allowlist explícita de apps humanos: `["app","iphone","android","web","desktop","mobile"]`.
- Se `source` estiver fora dessa lista (ex.: `"ai"`, `"bot"`, `"sdk"`, valores novos do Whapi), tratar como eco de API e retornar `null` (igual ao `source="api"`), com log `from_me_unknown_source`.

Arquivo: `supabase/functions/whapi-webhook/index.ts` (bloco linhas 131–168)

- Antes do `update bot_paused`, consultar `outbound_message_log` por `external_id = messageId` enviado nos últimos 120s. Se encontrar → é eco do próprio bot, **não pausar**, retornar `ignored_self_echo`.
- Guarda adicional: se `last_bot_reply_at` do customer foi há ≤ 30s, **não pausar** (janela típica de eco), só logar `takeover_skipped_recent_bot_reply`.

### 2. Evolution: paridade segura (detectar takeover REAL)
Arquivo: `supabase/functions/_shared/evolution-api.ts` (linhas 614–648) e `supabase/functions/evolution-webhook/index.ts`

- Quando `fromMe=true`, em vez de retornar `null` cego:
  - Se `data.source` ∈ allowlist humana acima → devolver `{ outboundHuman: true, chatId, source, messageId }`.
  - Caso contrário (sem source ou `api`) → manter `null`.
- No webhook, mesmo cross-check do item 1 (`outbound_message_log` + janela de 30s) antes de pausar.

### 3. Destravar o lead afetado
Migração única (idempotente) para reabrir o lead que está preso:

```sql
update public.customers
set bot_paused = false,
    bot_paused_reason = null,
    bot_paused_at = null,
    bot_paused_until = null,
    assigned_human_id = null,
    updated_at = now()
where id = '5f49ec30-ddb1-4305-8830-adae3e595dad'
  and bot_paused_reason = 'humano_assumiu_whatsapp';
```

(Limpa só o flag — o `conversation_step = flow:b1a53333-...-000000000003` continua, então o lead retoma exatamente no passo "Simulação rápida/Completa" no próximo inbound — e os dois cliques que ele já mandou ficam aguardando o próximo trigger.)

## Validação após deploy

1. Reenviar manualmente para o número uma mensagem de teste e confirmar nos logs do `whapi-webhook`:
   - eco do próprio bot → `from_me_api` ou `from_me_unknown_source` (sem pause).
   - se consultor digitar do celular → `outboundHuman` com `source=app` (pause OK).
2. Conferir `customers.bot_paused_reason` para o lead — não deve voltar a ficar `humano_assumiu_whatsapp` após resposta automática.
3. Rodar `bot-stuck-recovery` para garantir nenhum outro lead ficou nessa armadilha.

## Por que isso fecha o caso

- **Whapi:** elimina o pause-fantasma; a partir daqui, **só** pausa quando o source for app humano comprovado E o id não bater com o que o bot acabou de enviar.
- **Evolution:** ganha a detecção que faltava, sem repetir o bug (cross-check protege).
- **Nada quebra fluxos atuais:** allowlist é aditiva, eco já era para ser ignorado, takeover legítimo continua funcionando.
