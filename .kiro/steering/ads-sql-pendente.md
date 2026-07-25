---
inclusion: always
name: ads-sql-pendente
description: Hardening Ads — migrations commitadas mas NÃO aplicadas. Aplicar antes de deployar as edges de Ads.
---

# ⚠️ Hardening Ads: SQL pendente

Espelho de `.cursor/rules/ads-hardening-sql-pendente.mdc`.
Detalhe completo: `docs/ads-hardening-SQL-PENDENTE.md`.

Estas migrations estão no repositório e **nunca foram executadas** (nem em
produção, nem em teste). Só passaram por validação estática.

```
supabase/migrations/20260725170000_ads_orphan_crons_auth_headers.sql  (#0)
supabase/migrations/20260724180000_ads_cron_auth_headers.sql
supabase/migrations/20260724190000_ads_spend_idempotent_billing.sql
supabase/migrations/20260724200000_ad_publish_saga.sql
supabase/migrations/20260724210000_facebook_capi_outbox.sql
```

A #0 cobre `fb-cbo-to-abo`, `fb-mg-city-rotator` e `facebook-retarget-sync-3x-day`
(handlers com `assertCronAuthStrict` que a #1 não reagendava).

## FAÇA
- Aplicar via MCP Supabase `apply_migration`, na ordem #0 → #1 → #2 → #3 → #4
  (migrations não passam pelo GitHub Actions — ver `#deploy`).
- Conferir `settings.embed_internal_token` preenchido antes da migration 1: ela
  aborta de propósito se estiver vazio, porque sem o segredo os crons de Ads
  passariam a tomar 401.
- Migrations **antes** do deploy das edges: `facebook-sync-metrics`,
  `facebook-create-campaign`, `facebook-capi` e `facebook-capi-dispatch` já
  chamam `debit_campaign_spend_observation`, `claim_ad_publish_saga` e
  `enqueue_facebook_capi_event`.

## NÃO FAÇA
- Não deployar as edges de Ads antes de aplicar as migrations.
- Não ligar o toggle `facebook_capi_dispatch` (nasce `false`) sem pedido explícito.
- Não ligar `ENFORCE_CRON_AUTH` antes de ver nos logs que os crons de Ads
  autenticaram.

## Quando terminar
Depois de aplicar e verificar, **remova este arquivo e o `.mdc` espelho** (e a
linha correspondente no índice do `AGENTS.md`): a pendência deixa de existir.
