# 01 — Mapa Geral do Sistema de Agendamentos e Envios

- **Data da auditoria:** 12/07/2026
- **Método:** análise estática do código (repositório como fonte de verdade). Nenhum arquivo de código foi alterado nesta fase.
- **Git no momento da auditoria:** branch `main` sincronizada com `origin/main`; mudanças locais não commitadas em cadastro/portal/validators (fora do domínio de agendamentos — preservadas).
- **Ferramentas indisponíveis:** o MCP **Context7** está com erro de conexão (autenticação falhou com "server not found") e o agente/MCP **Outono** não existe neste ambiente. Consultas de documentação externa ficaram limitadas ao conhecimento embutido; onde isso importa, o ponto está marcado como *não confirmado*.

---

## 1. Tecnologias e versões (reais, do lockfile/package.json)

| Camada | Tecnologia | Versão |
|---|---|---|
| Frontend | React + Vite + TypeScript | 18.3.1 / 5.4.19 / 5.8.3 |
| UI | shadcn/ui (Radix) + Tailwind | 3.4.17 |
| Dados (frontend) | @supabase/supabase-js | ^2.108.2 |
| Backend | Supabase Edge Functions (Deno) + Postgres (pg_cron, net.http_post) | deno.lock presente |
| Workers Node | worker-portal-2 (BullMQ + Redis), worker-igreen-sync | `.mjs` |
| Testes | Vitest 3.2.4, fast-check, Playwright 1.57, Deno test | |
| Gerenciador de pacotes | **bun** (`bun.lock`) | — |
| Provedores WhatsApp | Evolution API + Whapi (via edge proxies) | — |
| Voz | Velip (voice-dialer) | — |

Scripts disponíveis: `bun run lint`, `bun run typecheck`, `bun run test`, `bun run build`.

---

## 2. Estrutura de diretórios relevante

```
src/
  components/whatsapp/     AgendamentosHub, BulkPro (Disparo PRO), ChatView, PosVendaKanban
  components/voz/          ScheduleCallButton
  hooks/                   useAgendamentosHub, useMessages, useCustomerAttendance
  services/                messageSender, evolutionApi (proxy), whapiApi (proxy)
  lib/                     agendamentosHub, posVendaSchedule, whatsapp/send, runAttendanceBatch
  pages/                   AdminAgendamentosCentral (cron + toggles)
supabase/
  functions/               ~20 edge functions de envio/agenda (lista na seção 6)
  functions/_shared/       automation-gate, quiet-hours, business-window, anti-ban,
                           postpone-intent, cadence-engine, attendance-flow, origin-guard
  migrations/              schema + pg_cron (consolidação principal: 20260708014208)
worker-portal-2/           fila BullMQ do portal (envia WhatsApp pós-cadastro)
docs/auditoria-agendamentos/  esta auditoria
```

---

## 3. Regra crítica: classificação Manual × Agendado × Automático

Critério aplicado (definido pelo usuário): **manual = clique humano dispara o envio naquele momento**, mesmo que passe por API/edge/fila. Agendado = criação manual, execução futura automática. Automático = execução sem novo clique.

### 3.1 Tabela de classificação de todos os fluxos

| Fluxo | Origem | Execução | Arquivos principais | Tabela | Classificação correta | Classificação atual no sistema | Riscos |
|---|---|---|---|---|---|---|---|
| Chat — texto/mídia | Clique "Enviar" | Imediata | `ChatView.tsx:948-1051` → `useMessages.ts:644` → `messageSender.ts:129` → `evolution-proxy`/`whapi-proxy` | `conversations` (`conversation_step: "consultor_manual"`) | Manual individual | ✅ Manual (correto) | Sem coluna de autoria (`sent_by`) |
| Passos do fluxo (⚡) | Clique no passo | Imediata | `FlowQuickBar.tsx:203` → `manual-step-send/index.ts` | `conversations` + `customers` | Manual individual | ✅ Manual, mas **despausa o bot** (`buildUnpausePatch` L31-38) e `continueFlow` encadeia passos | Comportamento híbrido manual→bot sem aviso claro |
| Iniciar atendimento | Clique "Iniciar" | Imediata | `useCustomerAttendance.ts:138` → `start-customer-attendance` | `customers`, `conversations` | Manual individual | ⚠️ **Tratado como automação**: gate `automation_toggles.start_customer_attendance` default OFF; erros dizem "automático" | Clique manual bloqueado por kill switch de automação |
| Finalizar atendimento | Clique "Finalizar" | Imediata | `end-customer-attendance` → `attendance-flow.ts` | `customers` | Manual individual | ✅ Manual | — |
| Batch de atendimento | Seleção + clique | Imediata (loop) | `runAttendanceBatch.ts:83-314` | `customers` (+ `attendance_auto_close_at`) | Manual em lote | ⚠️ Cria **agendamento oculto** de auto-close (`runAttendanceBatch.ts:113-122`) executado por cron | Usuário pode não saber que a pesquisa sairá depois sozinha |
| Disparo PRO "agora" | Clique "Enviar" | Imediata (loop no browser) | `BulkProPanel.tsx:247-370` | `bulk_campaigns` + targets | Manual em lote | ✅ Manual; **fallback**: se a aba fechar, cron `bulk-scheduler` assume | Processamento depende da tela aberta (com rede de segurança) |
| Disparo PRO "agendar" | Clique "Agendar" | Futura por cron | `ScheduleStep.tsx:145-167` → `bulk-scheduler` | `bulk_campaigns.scheduled_at` | Agendado | ✅ Agendado, mas UI diz "mantenha esta aba aberta" (`ScheduleStep.tsx:166`) — texto errado | Confusão do usuário |
| Agenda manual (hub) | Clique "Agendar" | Futura por cron | `AgendamentosHub.tsx:169-197` → `send-scheduled-messages` | `scheduled_messages` | Agendado | ✅ Agendado; execução sujeita a `bot_global_enabled` + toggle + quiet hours | Sem `created_by`; cancelar = DELETE sem trilha |
| Kanban CRM (mover card) | Drag + confirmação | Imediata | `KanbanBoard.tsx:61-151` | `crm_auto_message_log` | Manual individual | ⚠️ Toast diz "msg **automática**(s)" | Rótulo errado |
| Ligação agendada | Clique "Agendar ligação" | Futura por cron | `ScheduleCallButton` → `voice-dialer-enqueue` → `voice-dialer-cron` | `voice_campaigns` | Agendado | ✅ Agendado | — |
| Follow-up do bot | Postpone do lead ou hook | Cron | `postpone-intent.ts`, `process-followups` | `customers.next_followup_at` | Automático (autorizado pelo fluxo) | ✅ Automático | Cron não encontrado nas migrations |
| Follow-up "sumido" | Regra 6–48h | Cron diário | `bot-followup-checker` | `customers` | Automático | ✅ Automático | Divide toggle com process-followups |
| Pós-venda D+30/60/90/120 | Regra por data | Cron | `pos-venda-auto-progress` | `customer_auto_message_log` | Automático | ✅ Automático | Cron não encontrado nas migrations |
| Reaquecimento | Regra 24h+ | Cron | `reactivation-cron` | `reactivation_sends` | Automático | ✅ Automático | Cron não encontrado nas migrations |
| Cadência (Zero Lead Perdido) | Regra por estágio | Cron | `cadence-tick` + `cadence-engine.ts` | `lead_cadence_state` | Automático | ✅ Automático | Sem filtros pause/human; avança estágio mesmo com falha |
| Resgate de lead travado | Regra 10min+ | Cron 1×/h | `bot-stuck-recovery` | `customers` | Automático | ✅ Automático | — |
| Nudge FAQ | Regra detour 20min | Cron 30min | `faq-reengagement-nudge` | `customers` | Automático | ✅ Automático | Sem toggle nem kill switch global |
| Watchdog de loop | Regra >N msgs | Cron 1×/h | `bot-loop-watchdog` | `bot_handoff_alerts` | Automático | ✅ Automático | Envia msg sem quiet hours/toggle |
| Auto-close atendimento | Prazo `attendance_auto_close_at` | Cron | `close-attendance-scheduled` | `customers` | Automático (autorizado no batch) | ✅ Automático | Cron não encontrado nas migrations |
| Worker portal | Evento (submit do cadastro) | Fila BullMQ | `worker-portal-2/server.mjs` | Redis + `customers` | Automático por evento | ✅ Automático | Sem quiet hours/anti-ban (envio transacional — aceitável) |

### 3.2 Resposta direta às perguntas da auditoria

**"O clique manual está sendo classificado incorretamente como automático?"**
- **Chat individual: NÃO** — corretamente manual (`consultor_manual`), sem agendamento, sem cron.
- **Iniciar atendimento: SIM** — ação manual passa por gate de automação (`start-customer-attendance/index.ts:52-60`), seed default OFF (`20260711121714:101`), e mensagens de erro falam em "envio automático".
- **Kanban CRM: parcialmente** — envio é manual confirmado, mas o toast o chama de "automática" (`KanbanBoard.tsx:128`).
- **Não existe coluna `execution_mode`/`is_automated`** em nenhuma tabela — a classificação é implícita (via `conversation_step` e logs), o que impede rastreabilidade correta.

**"Algum envio manual cria agendamento oculto ou depende de cron?"**
- **Chat, ⚡ passos, Kanban, orçamento: NÃO** — envio imediato via proxy.
- **Batch de atendimento: SIM** — grava `attendance_auto_close_at` (auto-close futuro por cron) quando `autoCloseAfterMin > 0`.
- **Disparo PRO imediato: híbrido** — roda no browser, mas se a aba fechar o cron assume a campanha `running` (rede de segurança, não dependência).

---

## 4. Fluxo manual individual (mapa ponta a ponta)

```
Clique "Enviar" (MessageComposer.tsx:80-105, botão disabled enquanto envia)
  → ChatView.onSend (948-978)
  → useMessages.sendMessage (644-778) — valida destinatário, renderiza {{nome}} etc.
  → messageSender.sendWhatsAppMessage (129-271)
      • normaliza telefone BR (DDI 55)
      • rate-limit por contato: 5s (L60-75)
  → evolution-proxy OU whapi-proxy (edge, JWT do usuário + anon key)
      • chaves Evolution/Whapi só no servidor — NADA exposto no frontend
  → Provedor (Evolution/Whapi)
  → logPlatformOutbound → INSERT conversations (conversation_step: "consultor_manual")
  → autoTakeoverByPhone → customers.bot_paused = true (bot silencia; humano assumiu)
  → bolha otimista status "✓" + confirmação assíncrona em 6s (useMessages.ts:757-771)
```

- **Não depende de agendamento/cron** ✅
- **Não cria recorrência** ✅
- **Não consulta `bot_global_enabled` nem quiet hours** (correto para manual) ✅
- Duplo clique: botão desabilitado durante envio ✅ (proteção de UI; sem chave de idempotência no backend)
- Falha: toast de erro, texto preservado no composer, retry manual não duplica (novo envio = nova mensagem) ✅

**Contradição confirmada (P1):** o chat manual **pausa** o bot (takeover), mas `manual-step-send` **despausa** (`buildUnpausePatch`, `manual-step-send/index.ts:31-38`). O mesmo consultor pode pausar no chat e religar o bot sem perceber ao clicar ⚡.

---

## 5. Fluxos agendados

### 5.1 `scheduled_messages` (agenda manual do hub)

- **Criação** (`AgendamentosHub.tsx:178-184`): insere `consultant_id`, `instance_name`, `remote_jid`, `message_text`, `scheduled_at` (datetime-local do browser → ISO UTC). Validação de data passada só na criação (`min=` na L759); **edição não valida** (L1010-1014).
- **Cancelamento**: `DELETE` físico (L199-201) — sem trilha de cancelamento (`canceled_at` não existe).
- **Execução** (`send-scheduled-messages/index.ts`, cron */5min):
  1. Gate `bot_global_enabled` (L34) — **agenda criada manualmente é bloqueada pelo kill switch do bot**
  2. Gate `automation_toggles.send_scheduled_messages` (L40, default OFF)
  3. Quiet hours 21:30–08:00 BRT: adia todos os pendentes para 08:00 (L47-62)
  4. Seleção: `status=pending AND scheduled_at<=now LIMIT 50` — **sem claim atômico**
  5. Skip se `bot_paused`/`assigned_human_id`/`bot_paused_until` do customer (L100-112) → `status=skipped`
  6. Anti-ban: reagenda `scheduled_at` se quota estourada
  7. Envio **somente Evolution** (L25-29) — consultor Whapi-only cria agenda que nunca envia
  8. `sent`/`failed` (falha é terminal, sem retry)

Campos ausentes (padrão conceitual): `created_by`, `execution_mode`, `trigger_source`, `attempt_count`, `idempotency_key`, `provider_message_id`, `error_message`, `locked_at/by`, `canceled_at`. Índice `(status, scheduled_at)` ausente.

### 5.2 `bulk_campaigns` (Disparo PRO agendado)

- Criação com `scheduled_at` → `status=scheduled`; cron promove `scheduled→running` com **claim atômico de campanha** (`UPDATE ... WHERE status='scheduled'`, L169-171) ✅
- Targets `queued→sending→sent/failed` — claim de target é **select-então-update** (janela de corrida) e target pode ficar **preso em `sending`** se o worker morrer (sem reconciliador).
- Campanha `paused` (anti-ban/telefone) **não aparece no hub** (`useAgendamentosHub.ts:80` filtra só `scheduled|running`).

### 5.3 `voice_campaigns` (ligações)

- Melhor padrão do sistema: **claim atômico** `queued→dialing` (`voice-dialer-cron:209-216`) + reconciliação de `dialing` preso >10min + `attempts/max_attempts/next_attempt_at` ✅
- Risco: secret do cron hardcoded na migration `20260710020000:21`.

---

## 6. Mecanismos de execução automática (inventário completo)

### 6.1 Jobs pg_cron esperados (última migration aplicável: `20260708014208` + posteriores)

| Job | Frequência | Função | Enviam msg? |
|---|---|---|---|
| `send-scheduled-messages-every-5min` | */5min | send-scheduled-messages | Sim |
| `bulk-scheduler-tick` | */5min | bulk-scheduler | Sim |
| `voice-dialer-tick` | */5min | voice-dialer-cron | Ligação |
| `bot-followup-checker-daily` | 12:00 UTC (09h BRT) | bot-followup-checker | Sim |
| `bot-stuck-recovery-hourly` | 1×/h | bot-stuck-recovery | Sim |
| `bot-loop-watchdog-hourly` | 1×/h (:05) | bot-loop-watchdog | Sim (handoff) |
| `faq-reengagement-nudge-30min` | */30min | faq-reengagement-nudge | Sim |
| `crm-auto-progress-daily` | 09:00 UTC | crm-auto-progress | **Não** (só vincula deals) |
| `portal-otp-watchdog-1m` | 1min | portal-otp-watchdog | Sim (OTP) |
| `rodizio-metrics-10m` | */10min | rodizio-metrics-broadcast | Sim (parceiros) |
| + jobs não-mensageria | — | fb-sync, minio, health, ocr-timeout etc. | Não |

### 6.2 Funções com toggle mas SEM job pg_cron nas migrations (⚠️ não confirmado em produção)

| Função | Toggle | Consequência se não houver cron em prod |
|---|---|---|
| `process-followups` | `process_followups` | Follow-ups de postpone (`next_followup_at`) nunca disparam |
| `pos-venda-auto-progress` | `pos_venda_auto_messages` | Pós-venda D+30/60/90/120 não envia |
| `reactivation-cron` | `reactivation_cron` | Reaquecimento não roda |
| `cadence-tick` | `cadence_engine` | Motor de cadência não roda |
| `close-attendance-scheduled` | `end_customer_attendance_auto` | `attendance_auto_close_at` nunca executa (flag órfã) |

Nota: doc interno (`.kiro/specs/auditoria-fluxos-2026-06/report.md:152`) diz que `process-followups` rodava a cada 5min — o job pode ter sido criado direto no banco. **Verificar via Central de Agendamentos (`admin-cron-status`) antes de qualquer correção.**

### 6.3 Gates e janelas de horário (inconsistências)

| Módulo | Implementação | Usado por |
|---|---|---|
| `quiet-hours.ts` (21:30–08:00) | `Intl` America/Sao_Paulo ✅ | send-scheduled, process-followups, bot-followup-checker, bot-stuck-recovery, pos-venda, crm-auto-progress |
| `business-window.ts` (08–20 / sáb 08–14) | `Intl` ✅ | cadence-tick, voice-dialer |
| `nudge-quiet-hours.ts` | **UTC-3 fixo** ⚠️ | só faq-reengagement-nudge |
| `bulk-scheduler inWindow()` | **UTC-3 fixo** ⚠️ | bulk-scheduler |
| `reactivation isInsideWindow()` | `Intl` por consultor ✅ | reactivation-cron |

- `business-window.ts:7-8` afirma ser usado por `send-scheduled-messages` e `reactivation-cron` — **falso** (nenhum importa).
- `anti-ban.ts`: contador diário usa dia **UTC** (`register_send`), divergindo do "dia BRT".
- `automation-gate.ts` = fail-closed ✅ (default OFF). `global-flag.ts` (`bot_global_enabled`) = **fail-open** ⚠️ (erro/linha ausente → ligado).
- `logSkipped` grava em `cadence_action_log` com **colunas que não existem** no schema (`automation-gate.ts:38-43` vs migration `20260711030849:49-59`) — log de skip falha silenciosamente.

### 6.4 Quem checa o quê (cobertura de guardas por cron)

| Guarda | Checam | NÃO checam |
|---|---|---|
| `TERMINAL_STEPS` (lead já concluiu) | process-followups, bot-followup-checker, faq-nudge (subset) | send-scheduled, bulk-scheduler, reactivation, cadence-tick, bot-loop-watchdog, close-attendance, pos-venda |
| `assigned_human_id` (humano assumiu) | process-followups, bot-followup-checker, bot-stuck-recovery, send-scheduled | faq-nudge, reactivation, cadence-tick, bulk-scheduler, bot-loop-watchdog, close-attendance |
| `bot_global_enabled` | send-scheduled, bot-stuck-recovery, bot-loop-watchdog | todos os demais |
| Toggle próprio | maioria | **faq-reengagement-nudge, bot-loop-watchdog** (nenhum toggle) |

---

## 7. Banco de dados (resumo; detalhe completo na Fase 3)

### Tabelas do domínio

`scheduled_messages`, `bulk_campaigns` + `bulk_campaign_targets`, `voice_campaigns` + `voice_campaign_targets`, `customer_auto_message_log` (idempotência pós-venda, UNIQUE `(customer_id, stage_key)` ✅), `automation_toggles`, `app_settings`, `reactivation_settings` + `reactivation_sends`, `lead_cadence_state` + `cadence_action_log`, `holidays` (morta), `conversations`, `customers` (colunas: `next_followup_at`, `bot_paused`, `bot_paused_until`, `followup_count`, `followup_hook`, `last_followup_at`, `last_bot_interaction_at`, `attendance_auto_close_at`, `assigned_human_id`, `customer_origin`), `whatsapp_instances`, `ai_decisions`.

### Estados reais

- `scheduled_messages.status`: `pending → sent | failed | skipped` (todos terminais; sem `processing`, sem `cancelled` — cancelamento é DELETE). Texto livre, sem CHECK.
- `bulk_campaigns.status`: `draft*(nunca usado) → scheduled → running → done | paused` (paused sem resume automático e invisível no hub).
- `bulk_campaign_targets.status`: `queued → sending → sent | failed` (**preso em `sending`** possível).
- `voice_campaign_targets.status`: `queued → dialing → completed | no_answer | failed` (+ `answered`/`busy`/`machine` lidos mas **nunca escritos**).

### RLS (resumo)

- Isolamento por `consultant_id = auth.uid()` correto em `scheduled_messages`, `bulk_*`, `voice_*` ✅; admin com SELECT amplo; crons via service role ✅.
- `ai_decisions` INSERT policy `TO public WITH CHECK true` — ampla ⚠️.
- Nenhuma chave de provedor no frontend ✅ (proxies com JWT).

---

## 8. Funcionalidades duplicadas / sobrepostas

| Par | Sobreposição |
|---|---|
| `process-followups` × `bot-followup-checker` | Dois crons de follow-up, **mesma toggle** `process_followups`, critérios diferentes — mesmo lead pode receber dos dois |
| `process-followups` × `bot-stuck-recovery` | Ambos usam Cérebro p/ nudge de lead parado |
| `bot-stuck-recovery` × `faq-reengagement-nudge` | Ambos miram inatividade pós-bot |
| `reactivation-cron` × follow-ups | Reativação não checa `bot_paused`/`assigned_human_id` |
| `cadence-tick` × todos | Motor paralelo sem filtros de pause/human/origin (hoje OFF por toggle) |
| `quiet-hours` × `nudge-quiet-hours` × `inWindow` | 3 implementações da mesma janela |
| `crm-auto-progress` (legado) × `pos-venda-auto-progress` | Cron diário aponta para o legado; o novo não tem cron |

---

## 9. Schema/código morto (NÃO apagar — apenas documentado)

| Item | Evidência |
|---|---|
| `holidays` (tabela) | zero referências em `src/` e `functions/` |
| `scheduled_messages.source_step_id` + `pause_on_holiday`/`respect_business_hours` em `bot_flow_steps` | migration `20260601000100` promete avaliação no cron; cron não lê |
| `deve_agendar_followup` (Cérebro) | `guarda.ts:620` força `false` sempre |
| `bulk_campaigns.status='draft'` | default nunca usado pelo app |
| `voice_campaign_targets.status='answered'` | lido, nunca escrito (Velip mapeia p/ `completed`) |
| `.kiro/specs/scheduled-messages` (recorrência/calendário) | especificado, não implementado |
| `ai-followup-cron` | citado em comentários; função não existe; cron órfão já removido em `20260625104735` |

---

## 10. Problemas confirmados (evidência arquivo:linha)

### Críticos (duplicidade / envio indevido)

| # | Problema | Evidência |
|---|---|---|
| C1 | `send-scheduled-messages` sem claim atômico — dois ticks sobrepostos enviam a mesma mensagem 2× | `send-scheduled-messages/index.ts:65-163` |
| C2 | `bulk-scheduler` targets: claim `sending` após SELECT (corrida) + preso em `sending` sem reconciliador | `bulk-scheduler/index.ts:226-299` |
| C3 | `process-followups` sem claim + **não filtra `bot_paused_until`** (postpone depende só de `next_followup_at`) | `process-followups/index.ts:79-88` |
| C4 | `cadence-tick` avança estágio mesmo com envio falho + sem filtros pause/human/origin/terminal | `cadence-tick/index.ts:215-286` (mitigado: toggle OFF) |
| C5 | Dois crons de follow-up na mesma toggle `process_followups` | `bot-followup-checker/index.ts:51-54` |
| C6 | Anti-ban TOCTOU: `checkSendQuota` e `registerSend` separados — 2 workers estouram o cap | `_shared/anti-ban.ts:38-72` |

### Altos (regra manual ≠ automático + rastreabilidade)

| # | Problema | Evidência |
|---|---|---|
| A1 | "Iniciar atendimento" (manual) bloqueado por toggle de automação default OFF + textos "automático" | `start-customer-attendance/index.ts:52-60`; seed `20260711121714:101` |
| A2 | Contradição pause/unpause: chat pausa bot; `manual-step-send` despausa | `auto-takeover.ts:27-30` vs `manual-step-send/index.ts:31-38` |
| A3 | Sem registro de autoria/modo: `conversations` sem `sent_by`/`is_automated`; `scheduled_messages` sem `created_by` | types + schema |
| A4 | Batch manual cria agendamento oculto de auto-close sem transparência na UI | `runAttendanceBatch.ts:113-122` |
| A5 | Kanban chama envio manual de "automática" no toast | `KanbanBoard.tsx:128` |
| A6 | Agenda manual sujeita ao kill switch do bot (`bot_global_enabled`) — pausar o bot silencia a agenda criada por humano | `send-scheduled-messages/index.ts:34-38` |

### Médios

| # | Problema | Evidência |
|---|---|---|
| M1 | Postpone: "segunda" → retorna amanhã 09:00 (dia errado) | `postpone-intent.ts:84-86` |
| M2 | Timezone hardcoded UTC-3 em `bulk inWindow()` e `nudge-quiet-hours.ts`; `register_send` conta dia em UTC | `bulk-scheduler/index.ts:66-83`; `nudge-quiet-hours.ts`; `anti-ban.ts` |
| M3 | Agenda manual: só Evolution; lookup do customer por telefone sem `consultant_id`; edição sem validar data passada; DELETE sem trilha | `send-scheduled-messages/index.ts:25-29,93-99`; `AgendamentosHub.tsx:199-201,1010-1014` |
| M4 | `logSkipped` insere colunas inexistentes em `cadence_action_log` (skip log nunca grava) | `automation-gate.ts:38-43` |
| M5 | `bot_global_enabled` fail-open (erro → ligado) | `global-flag.ts:18-24` |
| M6 | `faq-reengagement-nudge` e `bot-loop-watchdog` sem toggle e sem kill switch global; watchdog envia sem quiet hours | `faq-reengagement-nudge/index.ts`; `bot-loop-watchdog/index.ts:124-165` |
| M7 | TERMINAL_STEPS/`assigned_human_id` não checados em vários crons (tabela na seção 6.4) | — |
| M8 | `ScheduleStep.tsx:166` "mantenha esta aba aberta" — texto desatualizado | `ScheduleStep.tsx:166` |
| M9 | Campanha `paused` invisível no hub | `useAgendamentosHub.ts:80` |
| M10 | Sem índice `(status, scheduled_at)` em `scheduled_messages` | migrations |
| M11 | Secret do voice-dialer hardcoded em migration versionada | `20260710020000:21` |
| M12 | `close-attendance-scheduled`: exception antes do update não limpa flag (stuck) | `close-attendance-scheduled/index.ts:88-91` |
| M13 | BulkPro imediato não repassa `isWhapi` ao `sendWhatsAppMessage` | `BulkProPanel.tsx:289-310` |

---

## 11. Pontos NÃO confirmados (exigem runtime/produção)

1. **Jobs pg_cron reais em produção** — especialmente `process-followups`, `cadence-tick`, `reactivation-cron`, `pos-venda-auto-progress`, `close-attendance-scheduled` (sem migration; podem ter sido criados direto no banco). Verificar via Central de Agendamentos ou `SELECT * FROM cron.job`.
2. **Estado atual dos toggles** `automation_toggles` em produção (seed = tudo OFF).
3. Header `x-internal-secret` no cron de `process-followups` (a função exige; cron anon padrão levaria 401).
4. Qual job da FAQ está ativo (5min antigo vs 30min novo).
5. Volume real de sobreposição entre crons de follow-up (exige métricas).
6. Comportamento do `retryFailed` do BulkPro após falha parcial.
7. Documentação de bibliotecas via Context7 (servidor indisponível).

---

## 12. Plano de correção priorizado (preliminar — detalhamento na Fase 7)

Ordem proposta (cada etapa pequena, aditiva, reversível; **nada será excluído**):

| Etapa | O quê | Arquivos | Risco | Reversão |
|---|---|---|---|---|
| 0 | **Diagnóstico em produção**: listar `cron.job` + estado dos toggles via `admin-cron-status` (leitura apenas) | — | Nenhum | n/a |
| 1 | **Claim atômico** em `send-scheduled-messages` (UPDATE…WHERE status='pending' RETURNING → `processing`) + reconciliador de presos; mesmo padrão nos targets do `bulk-scheduler` | `send-scheduled-messages`, `bulk-scheduler`, 1 migration aditiva | Baixo | Migration reversível; código volta por git |
| 2 | **Separar toggles**: `bot_followup_checker` próprio; filtrar `bot_paused_until` em `process-followups` | `bot-followup-checker`, `process-followups`, migration seed | Baixo | Toggle novo OFF |
| 3 | **Manual ≠ automático**: tirar `start-customer-attendance` do gate de automação (ou toggle categoria manual default ON) + corrigir textos ("automática" no Kanban, "aba aberta" no ScheduleStep) + expor auto-close do batch na UI | `start-customer-attendance`, `KanbanBoard`, `ScheduleStep`, dialog batch | Baixo | Git |
| 4 | **Autoria/rastreabilidade**: `created_by` em `scheduled_messages`; `origin`/`sent_by` em `conversations` (colunas novas, nullable, aditivas); cancelamento vira `status='cancelled'` (mantendo DELETE como opção explícita) | migrations aditivas + hub | Baixo | Colunas nullable |
| 5 | **Timezone**: unificar `inWindow`/`nudge-quiet-hours` na implementação `Intl`; dia BRT no `register_send` | `_shared/*`, bulk | Médio (testar) | Git |
| 6 | **Postpone**: corrigir "segunda" (próxima segunda-feira 09:00) e ancorar "à noite" | `postpone-intent.ts` + testes | Baixo | Git |
| 7 | **Guardas nos crons**: TERMINAL_STEPS + `assigned_human_id` onde falta; toggle para faq-nudge e watchdog; corrigir `logSkipped` | vários crons | Médio | Toggles OFF |
| 8 | **Fila/estados**: reconciliador `sending`/`dialing`; `close-attendance` flag stuck; hub mostra `paused`; índice `(status, scheduled_at)` | crons + migration | Baixo | Migration reversível |
| 9 | **Decisão sobre schema morto** (holidays/source_step_id): implementar OU marcar deprecated em comentário — **sem apagar** | doc + comments | Nenhum | n/a |
| 10 | **Testes**: Vitest/Deno test para claim, idempotência, timezone, postpone; e2e dryRun | test files | Nenhum | n/a |

Regras de segurança aplicadas a todas as etapas: sem DELETE de dados/arquivos; migrations sempre aditivas e reversíveis; toggles novos nascem OFF; nenhum envio automático reativado sem pedido explícito; nenhuma alteração nas mudanças locais não commitadas do usuário.

---

*Fim da Fase 1. Próximo passo (Fase 2): diagramas Mermaid detalhados por fluxo em `02-FLUXOS-E-ARQUITETURA.md` — somente após validação deste mapa.*
