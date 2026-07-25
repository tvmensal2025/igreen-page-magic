---
inclusion: always
name: ads-sql-pendente
description: Hardening Ads + Cérebro que aprende (piloto full com seed/criativo).
---

# Hardening Ads + Cérebro que aprende

Espelho de `.cursor/rules/ads-hardening-sql-pendente.mdc`.
Detalhe: `docs/ads-hardening-rollout.md`.

## Já ligado (piloto Rafael)
- `ENFORCE_CRON_AUTH=true`, `facebook_capi_dispatch=true`
- Cérebro: `kill_switch=false`, `automation_mode=full`, `autopilot=true`
- Loop: rank→preferred_slugs → rotator slots → seed_explorer (1/tick) →
  creative_rotate (pausa ad loser) → winner_photo_url

## NÃO FAÇA sem pedido explícito
- `targeting_patch` automático (incidente aprendizado Meta)
- Reativar `AUTO_PERF_PAUSE` / MANUAL / STOP via cron
- Ligar outros consultores sem anchor + foto HTTPS
- Liberar `create_object` genérico no cron (use só `seed_explorer`)
