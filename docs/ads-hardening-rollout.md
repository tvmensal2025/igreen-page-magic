# Rollout do hardening do Cérebro Meta Ads

Branch: `hardening/cerebro-meta-ads` · base: `56a86aa1270197d7f41db220c91bac76706b47f2`

Este documento é a ordem de execução quando você decidir subir.

> **Status 2026-07-25 (go-live hardening + Cérebro):** migrations aplicadas;
> edges Ads/cadência deployadas; smokes OK. **Já ligado:** `ENFORCE_CRON_AUTH=true`,
> `facebook_capi_dispatch=true` + cron `facebook-capi-dispatch-5min`,
> Cérebro piloto Rafael em **`full`** (`kill_switch=false`, `autopilot=true`).
> Seed / targeting / create_object continuam **human-only** (de propósito).

## Estado alvo

Depois do rollout o Cérebro fica **inerte para expansão** e **ativo para
proteção**:

| Categoria | Ações | Estado |
|---|---|---|
| Protetiva | pausar por saldo, teto, prazo, queima sem conversa | **sempre roda** |
| Expansiva | reativar, escalar budget, rotacionar criativo | exige `automation_mode` explícito (default `disabled` + `kill_switch=true`) |
| Human-only | criar campanha/anúncio, reescrever segmentação, subir audiência | **nunca automática** |

Cobrança de gasto já ocorrido **não depende** do modo do Cérebro.

## Pré-requisitos (bloqueiam o deploy)

1. **`settings.embed_internal_token` preenchido.** A migration
   `20260724180000` aborta com erro claro se estiver vazio — de propósito: sem
   ele, os crons de Ads voltariam 401 e o Ads pararia.
2. **CI verde no mesmo SHA.** O workflow de deploy agora recusa rodar sem um run
   de `ci.yml` concluído com sucesso para o `github.sha` selecionado.
3. **Host público de mídia na allowlist do QA.** `ad-creative-qa` e
   `ad-image-validator` são fail-closed: se o host das imagens não estiver em
   `AD_ASSET_ALLOWED_HOSTS`, `SUPABASE_URL`, `MINIO_PUBLIC_URL` ou
   `PUBLIC_MEDIA_BASE_URL`, **todo QA reprova**. Confirme o env antes.

## Ordem de execução

### 1. Migrations (aplicar antes das functions)

Todas são aditivas: nenhuma tem `DROP`, `TRUNCATE` ou `DELETE`; tabelas e
índices usam `IF NOT EXISTS`; funções usam `CREATE OR REPLACE`.

| Ordem | Arquivo | O que faz |
|---|---|---|
| 1 | `20260724180000_ads_cron_auth_headers.sql` | reagenda 7 crons de Ads com `x-internal-secret`/`x-service-secret` |
| 2 | `20260724190000_ads_spend_idempotent_billing.sql` | cobrança idempotente (`campaign_spend_observations`) + log de reconciliação |
| 3 | `20260724200000_ad_publish_saga.sql` | saga da publicação (`ad_publish_sagas`) |
| 4 | `20260724210000_facebook_capi_outbox.sql` | fila CAPI + `fb_emit_capi` sem HTTP |

Detalhe da #1: ela faz `cron.unschedule` + `cron.schedule` usando os **nomes e
cadências que já existem em produção** (`fb-auto-pause` `*/30`,
`fb-sync-metrics-6h` `0 */6`, `fb-sync-ad-creatives-daily` `0 7`,
`fb-token-refresh` `0 6`, `ad-creative-learner-daily` `0 7`,
`ad-competitor-scraper-weekly` `0 6 * * 1`,
`facebook-creative-rotator-daily` `0 8`). Nada de cadência muda. Aliases
legados também são desagendados por segurança.

`ENFORCE_CRON_AUTH` foi ligado em 2026-07-25 após smokes (401 sem secret / 200
com secret) nos crons Ads e `cadence-tick`.

### 2. Edge functions

Depois das migrations, porque as functions já chamam os RPCs novos. `_shared/`
mudou, então o deploy precisa alcançar todas as functions de Ads:

```
ad-competitor-scraper, ad-creative-learner, ad-creative-qa, ad-image-validator,
campaign-brain-rank, facebook-auto-pause, facebook-balance-check,
facebook-balance-reconcile, facebook-campaign-healthcheck, facebook-capi,
facebook-capi-dispatch, facebook-cbo-to-abo, facebook-cpl-correction,
facebook-create-campaign, facebook-creative-rotator, facebook-mg-city-rotator,
facebook-realign-lifetime, facebook-repair-campaign-tracking,
facebook-retarget-sync, facebook-sync-ad-creatives, facebook-sync-metrics,
facebook-token-refresh
```

O `config.toml` ganhou 5 entradas `verify_jwt = false`
(`ad-creative-learner`, `ad-competitor-scraper`, `facebook-creative-rotator`,
`facebook-balance-check`, `facebook-capi-dispatch`). As quatro primeiras
**faltavam** e por isso herdavam `verify_jwt = true` — esses crons já morriam
com 401 no gateway antes de qualquer mudança deste hardening.

### 3. Configuração por consultor

O rotator não age mais por UUID escrito no código. Para cada consultor que use o
Cérebro, preencha em `consultant_ad_settings.brain_config`:

- `anchor_campaign_id` — campanha âncora (UUID)
- `winner_photo_url` — criativo das exploradoras (HTTPS)

Sem isso o rotator responde `anchor_campaign_not_configured` e não faz nada. O
consultor piloto continua funcionando por fallback legado.

## Verificação pós-deploy

1. **Crons autenticando:** logs dos 7 jobs sem 401.
2. **Cobrança:** `campaign_spend_observations` recebendo linhas e
   `wallet_transactions` sem duplicata para o mesmo dia/campanha.
3. **Proteção viva:** campanha sem saldo continua sendo pausada (não deve
   depender do modo).
4. **Publicação:** publicar uma campanha e reenviar o mesmo pedido — a segunda
   chamada deve devolver `idempotent_replay: true`, sem criar campanha nova.
5. **Sagas órfãs:** `select * from ad_publish_sagas where requires_reconciliation`
   deve estar vazio; se aparecer linha, conferir a Meta antes de republicar.
6. **UI do consultor:** botões de Insights, Concorrentes, Audiências e Cérebro
   respondendo (não 401).

## Rollback

Ordem estreito → largo, sem desfazer migration:

1. `automation_toggles.facebook_capi_dispatch = false`
2. `brain_config.kill_switch = true` no consultor afetado
3. `ENFORCE_CRON_AUTH` desligado (só se auth estiver quebrando crons)
4. Redeploy da function específica no SHA anterior

As tabelas novas podem ficar: são aditivas e ninguém legado depende delas.

## Pendências conhecidas

- Seed automático de exploradoras permanece **human-only** (`automatic_seed_disabled`).
- `targeting_patch` automático permanece **human-only** (incidente aprendizado Meta).
- Types regenerados em `src/integrations/supabase/types.ts` (commit pós-SQL).
- **Tabelas novas com RLS ligada e sem policy.** `service_role` acessa (é o que
  as edges usam); `anon`/`authenticated` não. Se a UI precisar ler sagas ou
  observações, crie a policy de admin no momento dessa tela.
- **Despachante CAPI sem cron.** Existe, autentica e está desligado por toggle.
  Agendar é decisão humana.
- **Protocolo no link dos anúncios antigos.** `facebook-repair-campaign-tracking`
  limpa o banco e apenas relata quais anúncios ainda carregam o protocolo no
  `?text=`. Remover de verdade exige republicar o criativo manualmente.
