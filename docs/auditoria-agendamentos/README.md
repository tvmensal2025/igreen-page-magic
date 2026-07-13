# Auditoria de Agendamentos — Guia Rápido

Documentação da auditoria de envios agendados e automáticos da plataforma iGreen (julho/2026).

---

## O que é manual vs automático?

| Tipo | Como identificar | Exemplo |
|---|---|---|
| **Manual** | Você clicou e a mensagem saiu **agora** | Chat "Enviar", Kanban, Disparo PRO "Enviar agora" |
| **Agendado** | Você clicou para **criar**; o servidor envia depois | Hub "Agendar", Disparo PRO "Agendar" |
| **Automático** | Ninguém clicou; cron/regra dispara | Follow-up, pós-venda D+30, nudge FAQ |

**Regra de ouro:** clique humano = manual, mesmo passando por API. Agendado = criação manual + execução futura automática.

---

## Índice dos documentos

| Arquivo | Conteúdo |
|---|---|
| [01-MAPA-GERAL.md](./01-MAPA-GERAL.md) | Inventário completo, classificação, problemas iniciais |
| [02-FLUXOS-E-ARQUITETURA.md](./02-FLUXOS-E-ARQUITETURA.md) | Diagramas Mermaid por fluxo |
| [03-BANCO-E-ESTADOS.md](./03-BANCO-E-ESTADOS.md) | Tabelas, estados, RLS, migrations |
| [04-MOTOR-DE-AGENDAMENTO.md](./04-MOTOR-DE-AGENDAMENTO.md) | Crons, gates, idempotência, timezone |
| [05-INTERFACE-E-EXPERIENCIA.md](./05-INTERFACE-E-EXPERIENCIA.md) | Telas, toasts, correções de UX |
| [06-PROBLEMAS-ENCONTRADOS.md](./06-PROBLEMAS-ENCONTRADOS.md) | Bugs classificados com status |
| [07-PLANO-DE-CORRECAO.md](./07-PLANO-DE-CORRECAO.md) | Etapas, testes, rollback |
| [08-RESULTADO-FINAL.md](./08-RESULTADO-FINAL.md) | Tabela antes/depois com evidências |

---

## Como agendar uma mensagem

### Agenda manual (1 destinatário)

1. Abra **Hub de Agendamentos** (`AgendamentosHub`)
2. Conecte o WhatsApp (Evolution)
3. Preencha telefone, texto e data/hora **futura**
4. Clique **Agendar**

A execução depende de:
- Toggle **"Mensagens agendadas"** ligado na Central de Agendamentos
- Kill switch global do bot (`bot_global_enabled`) — **não** bloqueia agenda manual (só automações do bot)
- Cron `send-scheduled-messages` (a cada 5 min)

### Disparo PRO (muitos destinatários)

1. Abra **Disparo PRO** (`BulkPro`)
2. Configure mensagem e lista
3. Escolha **Agendar** (não precisa manter aba aberta)
4. Ative toggle **"Campanhas em massa"** na Central

---

## Como cancelar

| O quê | Como |
|---|---|
| Agenda manual pendente | Hub → Cancelar (vira `status=cancelled`, mantém histórico) |
| Campanha bulk | BulkPro / Hub → cancelar ou pausar campanha |
| Follow-up automático | Lead responde, ou pause o bot no chat, ou assuma o atendimento |
| Tudo de uma vez | Super Admin → Assistente Global → desligar `bot_global_enabled` |

**Não é possível cancelar** mensagem já em `processing` ou `sent` — o sistema avisa com toast.

---

## Como investigar falhas

### 1. Mensagem agendada não saiu

```sql
SELECT id, status, scheduled_at, attempt_count, last_error, processing_started_at
FROM scheduled_messages
WHERE consultant_id = '<uuid>'
ORDER BY scheduled_at DESC LIMIT 10;
```

| status | Significado |
|---|---|
| `pending` | Aguardando horário ou toggle OFF |
| `processing` | Worker pegou; se preso >15min, reconciliador destrava |
| `skipped` | Bot pausado ou humano assumiu o lead |
| `failed` | 3 tentativas esgotadas — ver `last_error` |
| `cancelled` | Você cancelou |

### 2. Toggle desligado

```sql
SELECT * FROM automation_skip_log
WHERE key = 'send_scheduled_messages'
ORDER BY created_at DESC LIMIT 5;
```

### 3. Crons rodando?

- Admin → **Central de Agendamentos** (`AdminAgendamentosCentral`)
- Ou: `SELECT jobname, active, schedule FROM cron.job ORDER BY jobname;`

### 4. Campanha bulk parada

- Verifique `bulk_campaigns.status = 'paused'` — agora aparece no Hub com badge
- Causas comuns: anti-ban, phone guard, toggle OFF

---

## Como rodar testes

```bash
# Timeline do hub (campanhas pausadas, cancelados ocultos)
bun run test src/lib/agendamentosHub.test.ts

# Validação consolidada da auditoria (recomendado)
node scripts/validate-agendamentos.mjs

# Postpone "segunda" e âncoras BRT
deno test supabase/functions/_shared/postpone-intent.test.ts

# Quiet hours do nudge FAQ
deno test supabase/functions/_shared/bot/nudge-quiet-hours_test.ts

# Lint + tipos
bun run lint && bun run typecheck
```

**E2E conversacional (dryRun):** usar skill `vendedora-e2e-conversations` antes de mexer em fluxos do bot.

---

## Arquivos para editar (por tarefa)

| Tarefa | Arquivos |
|---|---|
| Agenda manual (UI) | `src/components/whatsapp/AgendamentosHub.tsx` |
| Cron agenda manual | `supabase/functions/send-scheduled-messages/index.ts` |
| Claim/reconciliador DB | `supabase/migrations/20260712233000_*.sql` |
| Disparo PRO | `src/components/whatsapp/bulk-pro/BulkProPanel.tsx`, `ScheduleStep.tsx` |
| Cron bulk | `supabase/functions/bulk-scheduler/index.ts` |
| Chat manual | `src/services/messageSender.ts`, `src/hooks/useMessages.ts` |
| Iniciar atendimento | `supabase/functions/start-customer-attendance/index.ts` |
| Follow-up | `supabase/functions/process-followups/index.ts`, `_shared/postpone-intent.ts` |
| Toggles / skip log | `supabase/functions/_shared/automation-gate.ts`, `AdminAgendamentosCentral.tsx` |
| Kill switch global | `supabase/functions/_shared/bot/global-flag.ts` |
| Novos crons | `supabase/migrations/20260712234500_*.sql` |

---

## Segurança em produção

- **Todos os toggles nascem OFF** — nada envia automaticamente até ligar na Central
- **Não apagar** migrations, flags nem código legado — trabalho incremental
- Envio manual via `evolution-proxy` / `whapi-proxy` com **JWT** (chaves só no servidor)
- Testar com `dryRun` / modo shadow antes de liberar automação
- Kill switch manual: Super Admin → `bot_global_enabled`

---

## Limitações da auditoria

- **Context7** (docs externas): indisponível — erro de conexão MCP
- **Outono**: agente/MCP inexistente neste ambiente
- Estado real de produção (crons, toggles) exige validação runtime — ver [Etapa 0](./07-PLANO-DE-CORRECAO.md#etapa-0--diagnóstico-em-produção-leitura-apenas)

---

*Última atualização: 12/07/2026*
