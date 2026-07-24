---
inclusion: fileMatch
name: agendamentos-hub
description: Hub de agendamentos e agenda humana.
fileMatchPattern:
  - "src/components/whatsapp/AgendamentosHub.tsx"
  - "src/hooks/useAgendamentosHub.ts"
  - "src/lib/agendamentosHub.ts"
  - "supabase/functions/send-scheduled-messages/**"
---

# Agendamentos Hub

UI agrega **vários motores** numa timeline. Arquivo grande: `AgendamentosHub.tsx` (~1912 linhas).

## Evidência prod (2026-07-24)
- `scheduled_messages`: **2** rows (status `sent`) — volume baixo na tabela; hub também lê cadência/reheat/PV
- `automation_skip_log` 7d: chave `send_scheduled_messages` = **1115** (gate/toggle/skips — não confunda com falha de Zap)

## Kinds da timeline (`src/lib/agendamentosHub.ts`)
| kind | Origem | Quiet hours bot? |
|---|---|---|
| `manual_scheduled` | `scheduled_messages` + cron `send-scheduled-messages` | **NÃO** |
| `pos_venda_auto` | `posVendaSchedule` + stages d30…d210/retentativa | sim (no cron PV) |
| `bot_followup` | `customers.next_followup_at` | sim |
| `bulk_campaign` | `bulk_campaigns` | depende do runner |
| `voice_campaign` / `voice_retry` | Velip | próprio |
| `cadence_send` | `lead_cadence_state` | clamp BRT + gates |
| `daily_reheat` | `daily_reheat_queue` | janela reheat |
| `pending_media` | mídia pendente outbound | — |

## Agenda humana — contrato
Arquivo: `send-scheduled-messages/index.ts`
- Auth: `assertCronAuth`
- Claim: RPC **`claim_scheduled_messages`** (`:75–76`, `p_limit: 50`) — migration `20260712233000_…` com `FOR UPDATE SKIP LOCKED`
- Canal: `resolveConsultantOutboundChannel` (Whapi se Whapi)
- Comentário canônico (`:71–73`): **NÃO aplica quiet hours** — quiet é de bot/IA
- Kinds: `agendamentosHub.ts:5–14` (`manual_scheduled` … `voice_retry`)
- Retry: até 3× (+10 min); depois `failed`

## Hub lê pós-venda
`useAgendamentosHub.ts` seleciona stages  
`aprovado|reprovado|retentativa|d30|…|d210` — se truncar em d120, a UI mente.

## NÃO FAÇA
- Aplicar `quiet-hours.ts` na agenda manual
- Assumir Evolution obrigatório no boot do cron
- Misturar semântica de `manual_scheduled` com `cadence_send` / reheat
- “Consertar” skip_log alto sem olhar toggle/gate
