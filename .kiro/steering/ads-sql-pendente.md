---
inclusion: always
name: ads-sql-pendente
description: Hardening Ads aplicado; ENFORCE/CAPI/Cérebro limited ON no piloto.
---

# Hardening Ads: SQL aplicado + go-live

Espelho de `.cursor/rules/ads-hardening-sql-pendente.mdc`.
Detalhe: `docs/ads-hardening-rollout.md`.

## Já ligado (2026-07-25)
- `ENFORCE_CRON_AUTH=true`
- `facebook_capi_dispatch=true` + cron `facebook-capi-dispatch-5min`
- Cérebro piloto Rafael: `kill_switch=false`, `automation_mode=full`,
  `autopilot=true`, âncora Uberlândia ativa, preferred saudáveis

## NÃO FAÇA sem pedido explícito
- Liberar seed automático de exploradoras no cron (hoje `automatic_seed_disabled`)
- Liberar `targeting_patch` automático (incidente aprendizado Meta)
- Ligar Cérebro em outros consultores sem anchor + foto HTTPS
- Reativar campanhas `AUTO_PERF_PAUSE` / MANUAL / STOP via cron
