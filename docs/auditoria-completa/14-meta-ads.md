# 14 — Meta Ads / Facebook

**Data:** 2026-07-16  
**Pós Onda 1:** `facebook-campaign-healthcheck` modo cron exige `x-service-secret` ou Bearer service_role.

---

## 1. Superfície (EFs)

| EF | Papel | Auth / notas |
|---|---|---|
| `facebook-oauth-start` / `facebook-oauth-callback` | OAuth | fluxo usuário |
| `facebook-sync-metrics` | sync métricas (cron) | Bearer / apikey |
| `facebook-sync-ad-creatives` / `facebook-sync-audiences` | sync | cron |
| `facebook-token-refresh` | refresh token | cron |
| `facebook-campaign-healthcheck` | reativa / diagnostica | **Onda 1:** cron autenticado; UI com `campaign_id` |
| `facebook-toggle-campaign` | pause/play | JWT |
| `facebook-platform-sync-all` | sync plataforma | — |
| `facebook-balance-check` / reconcile | saldo | — |
| `facebook-auto-fix-whatsapp` | CTWA | — |
| `facebook-detect-waba` / `facebook-diagnose-page` | diagnóstico | — |
| `facebook-creative-rotator` | rotação | cron |
| `meta-ads-import` / `meta-ads-metrics` | import/métricas | — |
| `meta-leadads-webhook` | Lead Ads inbound | GET verify token; POST `X-Hub-Signature-256` |
| `ad-creative-learner` / `ad-competitor-scraper` | IA/spy | cron |
| `ctwa-status` | status CTWA | — |

---

## 2. Webhook Lead Ads

Arquivo: `meta-leadads-webhook/index.ts`

- `verify_jwt=false` (correto para Meta).
- Validação HMAC com `FACEBOOK_APP_SECRET`.
- Verify: `META_VERIFY_TOKEN`.
- Ingest via `lead-ingest` (consent do form Meta).
- Fallback consultor: `META_LEADADS_FALLBACK_CONSULTANT` se campanha não resolver.

**Risco:** se `FACEBOOK_APP_SECRET` vazio, comportamento de assinatura precisa ser fail-closed — confirmar no handler que POST sem secret válido → 401 (ler implementação completa em correção futura).

---

## 3. Achados / status

| ID | Tema | Status |
|---|---|---|
| AUD-004 | healthcheck cron sem auth | **Corrigido Onda 1** (código; deploy pendente) |
| — | Tokens long-lived / refresh | Jobs `fb-token-refresh` existem; ops deve monitorar falhas |
| — | Múltiplos schedules duplicados (`fb-sync-metrics` vs `6h`) | Confirmar job ativo único no banco |
| AUD-015 | EFs Meta “API-like” pouco referenciadas no front | Ver `15-codigo-morto.md` — podem ser só cron/ops |

---

## 4. Relação com WhatsApp / rodízio

CTWA / Meta referral → webhooks Whapi/Evolution + `deterministic-campaign-resolver` + rodízio (já em `10b-rodizio.md`).  
Não reativar sync/rotator em massa sem dryRun / flags.
