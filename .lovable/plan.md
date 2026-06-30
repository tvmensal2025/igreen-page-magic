## Auditoria do que já foi aplicado

### ✅ Aplicado em código (vai ao ar no próximo deploy automático das Edge Functions)

1. `**supabase/functions/_shared/whapi-api.ts` (linhas 455-476)** — `parseWhapiMessage` agora usa allowlist estrita de `source` humano (`app`, `iphone`, `android`, `web`, `desktop`, `mobile`). Qualquer outro valor (`ai`, `bot`, `sdk`, vazio, novo…) é tratado como eco de API e retorna `null` com log `from_me_unknown_source`. **Verificado no arquivo.**
2. `**supabase/functions/whapi-webhook/index.ts` (bloco outboundHuman)** — adicionadas duas guardas antes do pause:
  - Guard 1: consulta `outbound_message_log.evolution_message_id` nos últimos 120s. Se bater → `ignored_self_echo`, sem pausar.
  - Guard 2: se `customers.last_bot_reply_at` ≤ 30s → `takeover_skipped_recent_bot_reply`, sem pausar.
3. `**supabase/functions/_shared/evolution-api.ts` (linhas 624-637)** — `parseEvolutionMessage` ganhou detecção de takeover REAL (`outboundHuman`) sob mesma allowlist; eco de API continua retornando `null`.
4. `**supabase/functions/evolution-webhook/index.ts` (logo após `parseEvolutionMessage`)** — mesmo bloco de cross-check do Whapi: echo de 120s + janela de 30s de `last_bot_reply_at` antes de pausar.

### ⚠️ Pendente (interrompido na última execução) BAO DESTRAVAR, JA FOI FINALIADO MANUAL

## xecutar

- Posso rodar a **Ação A** (1 UPDATE no lead específico)?
- Posso rodar a **Ação B** (primeiro o SELECT diagnóstico, te mostro o resultado, e só depois o UPDATE em massa)?