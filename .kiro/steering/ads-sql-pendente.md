---
inclusion: always
name: ads-sql-pendente
description: Hardening Ads — SQL aplicado; ENFORCE/CAPI ligados; expansão Cérebro ainda off.
---

# Hardening Ads: SQL aplicado + go-live parcial

Espelho de `.cursor/rules/ads-hardening-sql-pendente.mdc`.
Detalhe: `docs/ads-hardening-rollout.md`.

Migrations aplicadas em produção (2026-07-25):

```
20260725170000_ads_orphan_crons_auth_headers.sql
20260724180000_ads_cron_auth_headers.sql
20260724190000_ads_spend_idempotent_billing.sql
20260724200000_ad_publish_saga.sql
20260724210000_facebook_capi_outbox.sql
20260725180000_facebook_capi_dispatch_cron.sql
```

+ cadência: `cadence_inbound_preserve_bc`, `crm_auto_progress_cron_auth`.

## Já ligado (2026-07-25)
- `ENFORCE_CRON_AUTH=true`
- `facebook_capi_dispatch=true` + cron `facebook-capi-dispatch-5min`
- brain piloto: `anchor` + `winner_photo_url`; `kill_switch=true`

## NÃO FAÇA sem pedido explícito
- Tirar `kill_switch` / ativar `automation_mode` expansivo
