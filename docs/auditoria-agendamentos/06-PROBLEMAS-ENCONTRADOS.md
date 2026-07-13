# 06 — Problemas Encontrados

- **Data:** 12/07/2026
- **Legenda de status:**
  - **CORRIGIDO (código)** — alteração implementada no repositório
  - **CORRIGIDO (docs)** — documentado/decisão registrada, sem mudança de código
  - **PENDENTE** — ainda não resolvido
  - **MITIGADO** — risco reduzido (ex.: toggle OFF), não eliminado

---

## 1. Críticos

| ID | Problema | Evidência | Causa raiz | Status | Tipo correção |
|---|---|---|---|---|---|
| C1 | Dupla execução de `scheduled_messages` | `send-scheduled-messages/index.ts` (SELECT+UPDATE antigo) | Sem claim atômico; dois ticks pegavam a mesma linha | **CORRIGIDO (código)** | RPC `claim_scheduled_messages` + status `processing` |
| C2 | Bulk targets: corrida + preso em `sending` | `bulk-scheduler/index.ts:276-286` | Claim após SELECT; sem reconciliador | **CORRIGIDO (código)** | Claim condicional `queued→sending` + `reconcile_stuck_bulk_targets` |
| C3 | `process-followups` ignorava `bot_paused_until` | `process-followups/index.ts:84-86` | Query só filtrava `bot_paused` booleano | **CORRIGIDO (código)** | Filtro `.or(bot_paused_until null\|lte now)` + defesa em profundidade |
| C4 | `cadence-tick` avança estágio com falha + sem filtros | `cadence-tick/index.ts:215-286` | Motor não checava pause/human/origin | **MITIGADO** | Toggle `cadence_engine` OFF; filtros parciais adicionados |
| C5 | Dois crons na mesma toggle `process_followups` | `bot-followup-checker/index.ts:51-54` | Reuso de chave | **CORRIGIDO (código)** | Toggle `bot_followup_checker` separado (nasce OFF) |
| C6 | Anti-ban TOCTOU (`check` + `register` separados) | `_shared/anti-ban.ts:38-72` | Duas RPCs não atômicas | **PENDENTE** | — |

---

## 2. Altos

| ID | Problema | Evidência | Causa raiz | Status | Tipo correção |
|---|---|---|---|---|---|
| A1 | "Iniciar atendimento" bloqueado por toggle de automação | `start-customer-attendance/index.ts:65-74` | Gate aplicado a ação manual | **CORRIGIDO (código)** | Bypass quando JWT tem `auth.user.id` |
| A2 | Chat pausa bot; `manual-step-send` despausa | `auto-takeover.ts` vs `manual-step-send/index.ts:31-38` | Comportamentos opostos sem coordenação | **PENDENTE** | — |
| A3 | Sem autoria: `conversations`, `scheduled_messages` | types + schema | Schema nunca teve colunas | **CORRIGIDO (código)** | `origin`/`sent_by`, `created_by`/`canceled_*` |
| A4 | Batch cria auto-close oculto | `runAttendanceBatch.ts:113-122` | `attendance_auto_close_at` sem UI | **PENDENTE** | — |
| A5 | Kanban toast dizia "automática" | `KanbanBoard.tsx:128-130` | Texto incorreto | **CORRIGIDO (código)** | Toast "msg(s) da coluna enviada(s)" |
| A6 | Agenda manual bloqueada por `bot_global_enabled` | `send-scheduled-messages/index.ts:47-51` | Kill switch do bot aplicado a agenda humana | **CORRIGIDO** | Gate removido; só toggle `send_scheduled_messages` |
| A7 | Crons sem job nas migrations | — | Jobs criados manualmente em prod | **CORRIGIDO (código)** | Migration `20260712234500` |
| A8 | `send-scheduled-messages` só Evolution | `send-scheduled-messages/index.ts:38-42` | Hardcode Evolution | **PENDENTE** | — |

---

## 3. Médios

| ID | Problema | Evidência | Causa raiz | Status | Tipo correção |
|---|---|---|---|---|---|
| M1 | Postpone "segunda" → amanhã | `postpone-intent.ts:75-79` | Lógica `daysUntilMonday` errada | **CORRIGIDO (código)** | `nextMonday9am()` + testes Deno |
| M2 | Timezone UTC-3 fixo / dia UTC no anti-ban | `bulk-scheduler`, `nudge-quiet-hours`, `anti-ban` | Implementações divergentes | **CORRIGIDO (código)** | `Intl` + dia BRT em `check_send_quota` |
| M3 | Agenda: DELETE cancel, edição sem validação, lookup sem `consultant_id` | `AgendamentosHub.tsx` | UX/schema incompletos | **CORRIGIDO** | Soft cancel + validação edição + lookup por `consultant_id` |
| M4 | `logSkipped` falhava silenciosamente | `automation-gate.ts:38-43` | Colunas inexistentes em `cadence_action_log` | **CORRIGIDO (código)** | Tabela `automation_skip_log` |
| M5 | `bot_global_enabled` fail-open | `global-flag.ts:22-27` | `catch` e linha ausente → `true` | **PENDENTE** | — |
| M6 | `faq-reengagement-nudge` sem toggle | `faq-reengagement-nudge/index.ts` | Cron criado sem gate granular | **CORRIGIDO (código)** | Toggle `faq_reengagement_nudge` OFF |
| M7 | `bot-loop-watchdog` sem toggle/quiet hours | `bot-loop-watchdog/index.ts` | Cron "emergencial" sem guardas | **PENDENTE** | — |
| M8 | TERMINAL_STEPS / `assigned_human_id` faltando em vários crons | Seção 6.4 do mapa geral | Cobertura inconsistente | **PARCIAL** | `process-followups` melhorou; demais **PENDENTE** |
| M9 | `ScheduleStep` "mantenha aba aberta" | `ScheduleStep.tsx:167` | Texto desatualizado (pré-cron) | **CORRIGIDO (código)** | Texto explica cron do servidor |
| M10 | Campanha `paused` invisível no hub | `useAgendamentosHub.ts:82` | Filtro só `scheduled\|running` | **CORRIGIDO (código)** | Inclui `paused` + badge |
| M11 | Sem índice `(status, scheduled_at)` | migrations | Performance em cron | **CORRIGIDO (código)** | `idx_scheduled_messages_pending_due` |
| M12 | `close-attendance-scheduled` flag stuck | `close-attendance-scheduled/index.ts:88-91` | Exception antes do update | **PENDENTE** | — |
| M13 | BulkPro imediato sem `isWhapi` | `BulkProPanel.tsx:289-310` | Parâmetro omitido | **PENDENTE** | — |
| M14 | Retry de `scheduled_messages` inexistente | `send-scheduled-messages` (antigo) | Falha era terminal | **CORRIGIDO (código)** | 3 tentativas, +10min entre elas |

---

## 4. Baixos

| ID | Problema | Evidência | Status | Tipo correção |
|---|---|---|---|---|
| B1 | `holidays` — tabela morta | zero refs em src/functions | **CORRIGIDO (docs)** | Documentado, não apagar |
| B2 | `bulk_campaigns.status='draft'` nunca usado | schema default | **CORRIGIDO (docs)** | — |
| B3 | `voice_campaign_targets.status='answered'` nunca escrito | voice-dialer-cron | **CORRIGIDO (docs)** | — |
| B4 | `deve_agendar_followup` forçado `false` | `guarda.ts:620` | **CORRIGIDO (docs)** | — |
| B5 | Spec `.kiro/specs/scheduled-messages` não implementada | spec dir | **CORRIGIDO (docs)** | — |
| B6 | Context7 MCP indisponível | erro de conexão na auditoria | **CORRIGIDO (docs)** | Análise só via repositório |
| B7 | Agente Outono inexistente | ambiente Cursor | **CORRIGIDO (docs)** | — |
| B8 | Secret voice-dialer em migration versionada | `20260710020000:21` | **PENDENTE** | — |
| B9 | `ai_decisions` RLS ampla | migration policy | **PENDENTE** | Fora do escopo imediato |

---

## 5. Resumo quantitativo

| Severidade | Total | Corrigido (código) | Corrigido (docs) | Mitigado | Pendente |
|---|---|---|---|---|---|
| Crítico | 6 | 4 | 0 | 1 | 1 |
| Alto | 8 | 5 | 0 | 0 | 3 |
| Médio | 14 | 9 | 0 | 1 | 4 |
| Baixo | 9 | 0 | 5 | 0 | 4 |
| **Total** | **37** | **18** | **5** | **2** | **12** |

---

## 6. Correções por arquivo (referência rápida)

| Arquivo | Problemas endereçados |
|---|---|
| `20260712233000_auditoria_agendamentos_claim_rastreio.sql` | C1, C2, A3, M4, M6, M11, M2 (anti-ban) |
| `20260712234500_auditoria_agendamentos_pg_cron_jobs.sql` | A7 |
| `send-scheduled-messages/index.ts` | C1, M14 |
| `bulk-scheduler/index.ts` | C2, M2 |
| `process-followups/index.ts` | C3, M8 |
| `bot-followup-checker/index.ts` | C5 |
| `faq-reengagement-nudge/index.ts` | M6 |
| `postpone-intent.ts` + test | M1 |
| `start-customer-attendance/index.ts` | A1 |
| `automation-gate.ts` | M4 |
| `messageSender.ts` | A3 |
| `AgendamentosHub.tsx` | A3, M3 |
| `useAgendamentosHub.ts` + `agendamentosHub.ts` | M10 |
| `KanbanBoard.tsx` | A5 |
| `ScheduleStep.tsx` | M9 |
| `_shared/bot/nudge-quiet-hours.ts` | M2 |

---

## 7. O que ainda exige validação em produção

1. Migrations aplicadas no banco de produção
2. Estado real dos toggles (`SELECT * FROM automation_toggles`)
3. Jobs pg_cron ativos (`cron.job` ou `admin-cron-status`)
4. `embed_internal_token` configurado para `process-followups`
5. Nenhum envio automático ligado sem pedido explícito do operador

---

*Próximo: [`07-PLANO-DE-CORRECAO.md`](./07-PLANO-DE-CORRECAO.md) — etapas, testes e rollback.*
