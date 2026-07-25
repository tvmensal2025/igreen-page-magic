# SQL DO HARDENING ADS — APLICADO EM PRODUÇÃO (2026-07-25)

**Status: APLICADO.** Migrations executadas via MCP `apply_migration` em
produção, na ordem abaixo (incluindo a #0 dos crons órfãos). Este arquivo
permanece como registro histórico + checklist de verificação.

Quem aplicou: Cursor via MCP Supabase. Migrations de banco **não** passam pelo
GitHub Actions (ver `.kiro/steering/deploy.md`).

---

## Ordem obrigatória

As edge functions do hardening **já chamam** os RPCs criados aqui. Se as functions
forem deployadas antes destas migrations, as chamadas falham. A ordem é:

```
1) migrations (este documento)   →   2) edge functions   →   3) config por consultor
```

| # | Arquivo | Cria |
|---|---|---|
| 0 | `supabase/migrations/20260725170000_ads_orphan_crons_auth_headers.sql` | headers nos 3 crons órfãos (`fb-cbo-to-abo`, `fb-mg-city-rotator`, `facebook-retarget-sync-3x-day`) que usam `assertCronAuthStrict` e ficaram de fora da #1 |
| 1 | `supabase/migrations/20260724180000_ads_cron_auth_headers.sql` | reagenda 7 crons de Ads com `x-internal-secret` / `x-service-secret` |
| 2 | `supabase/migrations/20260724190000_ads_spend_idempotent_billing.sql` | `campaign_spend_observations`, `ads_spend_reconciliation_log`, `debit_campaign_spend_observation`, `record_ads_spend_reconciliation` |
| 3 | `supabase/migrations/20260724200000_ad_publish_saga.sql` | `ad_publish_sagas` + `claim_ad_publish_saga`, `record_ad_publish_stage`, `complete_ad_publish_saga`, `fail_ad_publish_saga` |
| 4 | `supabase/migrations/20260724210000_facebook_capi_outbox.sql` | `facebook_capi_outbox` + 5 RPCs de fila e o `fb_emit_capi` reescrito (só enfileira) |

A #0 pode (e deve) ser aplicada **antes** do deploy das edges; a ordem numérica
do filename é posterior à #1, mas o conteúdo é independente e só altera command
via `cron.alter_job`. Aplicar #0 + #1 antes de qualquer deploy Ads.

Todas são **aditivas**: nenhum `DROP`, `TRUNCATE` ou `DELETE`; tabelas e índices com
`IF NOT EXISTS`; funções com `CREATE OR REPLACE`. Podem ser reaplicadas.

---

## Pré-requisito que BLOQUEIA a migration 1

A migration 1 **aborta de propósito** se o segredo interno não existir, porque sem
ele os crons de Ads passariam a tomar 401 e o Ads pararia:

```sql
select key, (value is not null and btrim(value::text, '"') <> '') as preenchido
from public.settings
where key in ('embed_internal_token', 'service_shared_secret');
```

`embed_internal_token` precisa existir e não estar vazio. Se faltar, configure antes.

---

## Verificação depois de aplicar

```sql
-- 1) crons de Ads mandando os headers (7 jobs)
select jobname, schedule
from cron.job
where jobname in ('fb-auto-pause','fb-sync-metrics-6h','fb-sync-ad-creatives-daily',
                  'fb-token-refresh','ad-creative-learner-daily',
                  'ad-competitor-scraper-weekly','facebook-creative-rotator-daily')
order by jobname;
-- esperado: exatamente 7 linhas, sem duplicata de token refresh

-- 2) objetos novos existem
select table_name from information_schema.tables
where table_schema='public'
  and table_name in ('campaign_spend_observations','ads_spend_reconciliation_log',
                     'ad_publish_sagas','facebook_capi_outbox');
-- esperado: 4 linhas

select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and proname in ('debit_campaign_spend_observation','record_ads_spend_reconciliation',
                  'claim_ad_publish_saga','record_ad_publish_stage',
                  'complete_ad_publish_saga','fail_ad_publish_saga',
                  'enqueue_facebook_capi_event','claim_facebook_capi_events',
                  'mark_facebook_capi_sent','mark_facebook_capi_sent_by_key',
                  'mark_facebook_capi_failed','fb_emit_capi');
-- esperado: 12 linhas

-- 3) despachante CAPI nasce DESLIGADO (não ligar sem pedido)
select key, enabled from public.automation_toggles where key='facebook_capi_dispatch';
-- esperado: enabled = false
```

## Riscos a observar na primeira execução

- **Migration 1** faz `cron.unschedule` + `cron.schedule` nos nomes reais dos jobs.
  Os nomes e as cadências foram auditados contra as migrations anteriores e são
  idênticos aos de hoje — nenhuma cadência muda. Confirme as 7 linhas da consulta 1.
- **Migration 2** cria uma cadeia de locks nova por transação:
  advisory lock (campanha+dia) → `facebook_metrics_daily` → `consultant_wallet`.
  Não há ciclo conhecido, mas é o ponto a olhar se aparecer contenção.
- **`ENFORCE_CRON_AUTH` continua desligado.** Só ligue depois de ver nos logs que
  os 7 jobs autenticaram.

## Depois das migrations

- Regenerar `src/integrations/supabase/types.ts` (não foi feito: exige as migrations
  aplicadas, e o arquivo está sendo alterado em paralelo pelo trabalho de referral/WA).
- Deploy das edge functions e configuração por consultor: ver
  `docs/ads-hardening-rollout.md`.
