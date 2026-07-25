---
inclusion: always
name: ads-sql-pendente
description: Hardening Ads — SQL já aplicado em produção (2026-07-25). Não ligar CAPI/ENFORCE sem pedido.
---

# Hardening Ads: SQL aplicado

Espelho de `.cursor/rules/ads-hardening-sql-pendente.mdc`.
Detalhe: `docs/ads-hardening-rollout.md`.

Migrations aplicadas em produção (2026-07-25):

```
20260725170000_ads_orphan_crons_auth_headers.sql
20260724180000_ads_cron_auth_headers.sql
20260724190000_ads_spend_idempotent_billing.sql
20260724200000_ad_publish_saga.sql
20260724210000_facebook_capi_outbox.sql
```

+ cadência: `cadence_inbound_preserve_bc`, `crm_auto_progress_cron_auth`.

## NÃO FAÇA sem pedido explícito
- Ligar `facebook_capi_dispatch`
- Ligar `ENFORCE_CRON_AUTH`
- Tirar `kill_switch` / ativar `automation_mode` expansivo

## Pendência
- `winner_photo_url` HTTPS estável no brain do piloto (anchor já setado).
