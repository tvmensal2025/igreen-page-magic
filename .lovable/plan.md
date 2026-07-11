# Auditoria + Fechamento "Nada Fica Sem Agendamento"

Objetivo: garantir que **toda função de background** da plataforma esteja (1) em cron ativo, (2) visível em um painel único no Admin, (3) configurável sem tocar código.

## Parte A — Ligar os crons que estão faltando

Adicionar via `cron.schedule` (SQL com secrets — vou usar `supabase--insert` porque contém anon key, conforme instrução):


| Função                      | Frequência     | Motivo                                      |
| --------------------------- | -------------- | ------------------------------------------- |
| `send-scheduled-messages`   | `*/2 * * * *`  | Agenda manual do consultor precisa disparar |
| `reactivation-cron`         | `*/15 * * * *` | Reaquecimento legado — hoje parado          |
| `process-followups`         | `*/10 * * * *` | Follow-up IA de conversas abertas           |
| `bulk-scheduler`            | `*/5 * * * *`  | Campanhas em massa agendadas                |
| `outbound-media-flush-cron` | `*/3 * * * *`  | Mídia travada saindo                        |
| `inbound-media-retry-cron`  | `*/10 * * * *` | Downloads que falharam                      |
| `voice-dialer-health`       | `*/30 * * * *` | Detecta discador travado                    |
| `voice-dashboard-metrics`   | `*/15 * * * *` | Atualiza KPIs de voz                        |
| `meta-ads-metrics`          | `0 */3 * * *`  | Sync métricas Meta                          |


Cada job com try/unschedule defensivo antes de criar (mesmo padrão do `cron_setup.sql`).

## Parte B — Fase 5 do motor: retargeting Meta automático

- Migration: coluna `retarget_audience_id` em `consultants` + tabela `retarget_sync_log`.
- Edge `facebook-retarget-sync` (cron 3x/dia): pega leads em `CLOSE_LOST` / `RETARGET_META` dos últimos 90d, faz hash SHA256 de telefone e email, chama `POST /{audience_id}/users` na Marketing API (token já em `facebook_connections`).
- Respeita opt-out em `lead_consent_log` (remove do audience).
- Log em `cadence_action_log` com `channel = meta_audience` e `cost_cents = 0`.

## Parte C — Painel único "Central de Agendamentos" (`/admin/agendamentos-central`)

Uma tela só, 4 abas, para o usuário nunca mais precisar de SQL:

1. **Crons ativos** — lista `cron.job` + último `cron.job_run_details` (status, duração, erro). Botão "Rodar agora", "Pausar", "Editar frequência".
2. **Motor de cadência** — reaproveita `/admin/motor` atual, embutido como aba.
3. **Filas & retries** — mídia inbound/outbound pendente, mensagens agendadas por consultor, campanhas em massa próximas, follow-ups previstos.
4. **SLA & alertas** — leads com `next_action_at` vencido >30min, instâncias offline, tokens Meta expirando em <7d, saldo carteira <R$50.

Botão global "Executar tudo agora" (dispara os 9 crons novos + `cadence-tick` em sequência) — útil pra teste.

## Parte D — Configuração via UI (sem tocar código)

Nova tabela `platform_cron_config` (`job_name`, `enabled`, `schedule`, `last_run_at`, `last_status`, `notes`) — fonte de verdade lida pela tela acima.

Trigger que, ao atualizar `schedule` ou `enabled`, chama uma função `pg_cron_apply(job_name)` que faz `unschedule` + `schedule` com a nova expressão. Assim toda alteração no painel reflete no cron real.

Adicionar também em `app_settings`:

- `retarget_enabled` (bool)
- `retarget_lookback_days` (default 90)
- `sla_alert_minutes` (default 30)

## Parte E — Fase 6 (parcial): Timeline por lead

- Novo componente `LeadCadenceTimeline` no perfil do cliente mostrando todas as linhas de `cadence_action_log` + próxima ação prevista.
- Push web + som quando SLA violado (browser Notification API, opt-in por usuário).

## Fora deste plano (fica pra próxima)

- Fase 7 completa (temperatura IA dinâmica, A/B áudio×texto, best-time-to-call) — depende de dados históricos que ainda estão sendo coletados. Melhor rodar 2 semanas com o motor no ar antes.

## Ordem de execução

1. Parte A (crons faltantes) — impacto imediato, 1 SQL.
2. Parte C aba "Crons ativos" — visibilidade antes de mexer em mais coisa.
3. Parte D (config via UI) — remove necessidade de SQL.
4. Parte B (retargeting Meta) — fecha Fase 5 do motor.
5. Parte E (timeline + alertas) — polimento.

Posso começar pela Parte A + C.1 no mesmo commit, que já cobre 80% do "nada perdido"? sim e depois ja va para a proxima fase