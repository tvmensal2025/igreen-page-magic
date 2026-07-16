# 11 — Agendamentos e crons

**Data:** 2026-07-16  
**Escopo:** pg_cron + edge functions `*-cron` / runners agendados  
**Método:** parse de `supabase/migrations/*.sql` (`cron.schedule`) + leitura dos handlers  
**Situação produção:** jobs reais podem divergir do repo (unschedules/schedules sucessivos). Fonte de verdade operacional: `admin-cron-status` / `cron.job` no banco.

---

## 1. Fotografia

| Métrica | Valor (repo) |
|---|---|
| Chamadas `cron.schedule` parseadas | ~72 |
| Nomes de job únicos | ~62 |
| EFs com `cron` no nome | ~20+ |
| `verify_jwt=false` no `config.toml` | 60 funções |

Há migration explícita de auditoria: `20260712234500_auditoria_agendamentos_pg_cron_jobs.sql` (aditiva; liga jobs que existiam no código sem schedule no repo).

UI: `admin-cron-status` + Central de Agendamentos (toggles / `isAutomationEnabled`).

---

## 2. Inventário por domínio (última migration vencedora no parse)

### WhatsApp / bot / follow-up (envio possível)

| Job | Schedule | EF | Auth no handler | DNC |
|---|---|---|---|---|
| `bulk-scheduler-tick` | `*/5` | `bulk-scheduler` | **Nenhuma** | filtra `do_not_contact` |
| `bot-followup-checker-30min` / daily | `*/30` / `0 12` | `bot-followup-checker` | **Nenhuma** | `.eq(do_not_contact,false)` |
| `faq-reengagement-nudge-5min` | `*/5` | `faq-reengagement-nudge` | fraca (service client) | filtra DNC |
| `reactivation-cron-hourly` | `0 * * * *` | `reactivation-cron` | **Nenhuma** | filtra DNC |
| `process-followups-tick` | `*/5` | `process-followups` | `x-internal-secret` / JWT | DNC |
| `cadence-tick-5min` | `*/5` | `cadence-tick` | **Nenhuma** | checa `do_not_contact` |
| `send-scheduled-messages-every-5min` | `*/5` | `send-scheduled-messages` | **Nenhuma** | checa DNC |
| `daily-reheat-tick` | `*/15` | `daily-reheat-cron` | internal secret / admin JWT | DNC no `plan.ts` |
| `outbound-media-flush-cron` | **sem job pg_cron no repo** | `outbound-media-flush-cron` | **Nenhuma** | `assertCanContact` (Onda 2) |
| `rodizio-metrics-10m` | `*/10` | `rodizio-metrics-broadcast` | **Nenhuma** | N/A (parceiro) |

### Voz

| Job | Schedule | EF | Auth |
|---|---|---|---|
| `voice-dialer-tick` | `*/5` | `voice-dialer-cron` | `x-voice-dialer-cron-secret` / `x-service-secret` / service_role |

### Meta / Ads

| Job | Schedule | EF | Notas |
|---|---|---|---|
| `fb-sync-metrics` / `fb-sync-metrics-6h` | `*/30` / `*/6h` | `facebook-sync-metrics` | Bearer / apikey |
| `fb-token-refresh` | `0 6` | `facebook-token-refresh` | — |
| `fb-sync-ad-creatives*` | diário / 6h | sync creatives | — |
| `facebook-creative-rotator-daily` | `0 8` | rotator | — |
| `ad-creative-learner-daily` | `0 7` | learner | — |
| `ad-competitor-scraper-weekly` | seg 6h | scraper | — |

`facebook-campaign-healthcheck`: **sem** schedule parseado no repo; Onda 1 exige secret no modo cron (sem `campaign_id`).

### Infra / portal / health

| Job | EF / ação |
|---|---|
| `portal-otp-watchdog-1m` | `portal-otp-watchdog` |
| `inbound-media-retry-cron-*` | retry mídia inbound |
| `instance-health-cron*` | health instâncias |
| `flow-d-health-cron*` | health Flow D |
| `production-health-snapshot*` | snapshot |
| `bot-loop-watchdog*` / `bot-stuck-recovery*` | recuperação bot |
| `minio-quota-check*` / `migrate-storage-to-minio` | storage |
| `cleanup-webhook-*` | SQL cleanup (sem EF) |
| `ocr-review-timeout*` | OCR |
| `super-admin-alerts*` | alertas |
| `speed-to-lead-check-5min` | retention |
| `pos-venda-*` | pós-venda |
| `conversion-classifier*` | temperatura lead |
| `crm-auto-progress-daily` | CRM |
| `ai-followup-cron` / `ai-closer-cron` / digests | IA |

---

## 3. Achados

### AUD-009 — Vários crons de **envio** sem auth no handler

**Prioridade:** P1  
**Situação:** Confirmado no código  

EFs com `verify_jwt=false` (ou default permissivo no gateway) e **sem** checagem `x-service-secret` / internal secret no `index.ts`, mas capazes de enviar WhatsApp:

- `reactivation-cron`
- `bulk-scheduler`
- `bot-followup-checker`
- `cadence-tick`
- `send-scheduled-messages`
- `outbound-media-flush-cron`
- `rodizio-metrics-broadcast` (notifica parceiro)

**Mitigações já existentes:** `isAutomationEnabled`, `bot_global_enabled`, filtros DNC em vários.  
**Risco residual:** quem descobrir a URL pode forçar tick (custo / spam / bypass de “central off” se o gate não estiver no início).

**Correção recomendada:** padrão de `voice-dialer-cron` / `daily-reheat-cron` / `process-followups` — exigir `x-service-secret` ou `x-internal-secret` fail-closed; alinhar headers no `cron.schedule`.

### AUD-010 — `outbound-media-flush-cron` sem `cron.schedule` no repositório

**Prioridade:** P2  
**Situação:** Confirmado  

Comentários pedem tick ~5s; migrations só mencionam a EF. Se não houver schedule externo/ops, mídia pendente fica presa; se houver schedule fora do repo, fica invisível na auditoria Git.

**Ação:** confirmar em `cron.job` / Central; documentar ou adicionar schedule + auth.

### Observação — anon key embutida em migrations de cron

Vários `net.http_post` usam JWT **anon** no header `apikey` (público por design do Supabase). Não é service_role vazado, mas acopla project ref ao SQL. Preferível: Vault / settings.

---

## 4. O que já está bem feito

- `daily-reheat-cron`: default `dryRun=true`; triplo cadeado + quiet hours; DNC no planner.
- `voice-dialer-cron`: auth fail-closed + DNC (Onda 2).
- `process-followups`: `x-internal-secret`.
- Migration `auditoria_agendamentos_*`: consciência explícita de gaps de schedule.
- Kill switch global + toggles por automação.

---

## 5. Checklist ops (somente leitura recomendada)

1. Rodar `admin-cron-status` ou `select * from cron.job` e comparar com a tabela §2.  
2. Confirmar se `outbound-media-flush` e `facebook-campaign-healthcheck` existem no banco.  
3. Não ligar automations em massa sem dryRun.
