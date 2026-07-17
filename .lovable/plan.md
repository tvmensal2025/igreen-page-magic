
## Objetivo

Ativar de verdade o card **Ciclo diário** (`/admin` — pizzas Fila A / Fila B) **reaproveitando 100%** o que já existe:

- Motor de cadência "Zero Lead Perdido" (`cadence-tick` + `cadence_stage_config` + `lead_cadence_state`, 9 estágios COLD/CALL/SMS)
- Biblioteca Multicanal (Grupo A/B, TTS Sofia, cortes aprovados) em `MultichannelTextsPanel`
- Cron em lote `daily-reheat-cron` + `daily_reheat_settings/queue/kit`
- CRM automático e Variante de ligação já configurados em Voz → Kit

Nada de motor paralelo. O card vira **cockpit único** que orquestra e mostra o que os dois motores (unitário + lote) já rodam.

## Como o ecossistema atual se encaixa (verificado)

```text
Lead chega ──► cadence-tick (per-lead)          ─┐
                stages: COLD_1..4/CALL_1..3/SMS_*  │   Ambos leem:
                usa cadence_stage_config +         ├──► • textos Multicanal (Grupo A/B)
                    variante Sofia + Multicanal    │     • cadence_stage_config.message_text
                                                   │     • voice_audio_clip_id do stage
Lote 09–18:30 ─► daily-reheat-cron (batch)      ─┘     • daily_reheat_kit (áudio do dia)
                Fila A (novo <24h) / Fila B (frio)
                planeja + despacha WhatsApp/Voz/SMS
                grava daily_reheat_queue por step
```

O que está **desligado hoje**: `daily_reheat_settings.enabled=false`, `live_dispatch_enabled=false`, `daily_whapi_cap=10`, e os 5 toggles em `automation_toggles` (`daily_reheat`, `cadence_engine`, `send_scheduled_messages`, `process_followups`, `speed_to_lead_sla`) todos OFF. **Não falta código — falta acionar.**

## O que vou entregar

### 1. Cockpit de controle inline no card "Ciclo diário"

No próprio `ReheatCyclePizza.tsx`, adicionar uma barra superior com:

- **3 cadeados (Switches)** que gravam:
  - "Motor de cadência" → `automation_toggles.cadence_engine.enabled` (dispara o motor unitário 24/7)
  - "Ciclo diário em lote" → `automation_toggles.daily_reheat.enabled` + `daily_reheat_settings.enabled`
  - "Envio ao vivo" → `daily_reheat_settings.live_dispatch_enabled`
- **Input "Limite diário WhatsApp"** → `daily_reheat_settings.daily_whapi_cap` (default **60**, mín 10, máx 200)
- **Select "Prioridade"** → `daily_reheat_settings.priority_queue` (`A_then_B` / `B_then_A` / `balanced`)
- **Badge de status** exibido pelo retorno do cron: `Ao vivo` · `Só planejando` · `Fora da janela` · `Quiet hours`
- **Botão "Rodar ciclo agora"** → invoca `daily-reheat-cron` (já faz replanejar + despachar due imediatamente)
- **2 atalhos** para não duplicar edição:
  - "Editar mensagens / áudios" → abre `/admin` aba Voz → Multicanal (`MultichannelTextsPanel`)
  - "Configurar estágios" → abre `/admin/motor` (janelas, delay, max_per_lead)

Nada de nova página, nada de novo esquema de dados.

### 2. Contagem por etapa (fila visível em cada fatia)

O card hoje só mostra total por fila e destaca a etapa modal. Vou trocar por contagem real por fatia, **agregando as duas fontes**:

- Fila A (novo): agregar `daily_reheat_queue` do dia por `step` (fatias `arrive/wait5/open/flow/wait2h/call1/retry/sms/close`).
- Fila B (frio): agregar `daily_reheat_queue.step` **+** `lead_cadence_state.stage` (COLD_*/CALL_*/SMS_*) mapeado para as 6 fatias correspondentes — assim o cockpit mostra também os leads do motor unitário, não só os empacotados no lote.
- Cada fatia recebe um **badge numérico** com a contagem; abaixo da pizza, uma linha compacta tipo `Liga 2 · Abre 1 · Retry 3 · SMS 0 · Espera 8 · Fecha 4`.
- Refresh a cada 30s + após clicar "Rodar ciclo agora" ou mudar qualquer switch.

### 3. Ciclagem "sempre com novos"

- `cycle_date` do `daily_reheat_queue` já rotaciona todo dia — replanejar no primeiro tick BRT do dia seguinte já traz o batch novo.
- Ao ligar o cadeado "Ciclo diário em lote", garantir um schedule `pg_cron` chamando `daily-reheat-cron` a cada 10 min entre `window_start_brt` e `window_end_brt` em dias úteis (via `supabase--insert`, não migração — carrega `EMBED_INTERNAL_SECRET`). Se o schedule já existir, não duplico.
- Ajuste mínimo em `_shared/daily-reheat/plan.ts`: quando `priority_queue='A_then_B'`, **reservar ~30% do `daily_whapi_cap` para Fila A** antes de consumir com Fila B. Garante lead novo sempre entrando mesmo com backlog frio grande. Zero mudança de contrato.

### 4. Amarração com CRM e variante de ligação

Nada a criar — só expor no cockpit:

- CRM automático: `cadence-tick` continua tocando as 9 etapas por lead. Um badge "CRM: N leads em cadência hoje" (contagem de `lead_cadence_state` com `next_action_at <= today`) fica no topo do card, linkando `/admin/motor`.
- Variante de ligação: já resolvida em `daily_reheat_kit.voice_audio_clip_id` e `cadence_stage_config.voice_audio_clip_id`. Botão "Colocar áudios" (já existe) permanece; adicionar um chip mostrando o clip ativo do dia (`weekday → wa_audio_*_url`).

## Arquivos afetados

- `src/components/admin/ReheatCyclePizza.tsx` — cockpit inline + contagem por fatia + integração com `automation_toggles` e `daily_reheat_settings`.
- `supabase/functions/_shared/daily-reheat/plan.ts` — reserva 30% do cap para Fila A quando prioridade for `A_then_B`.
- (Runtime, sem código novo) `supabase--insert` para UPSERT em `daily_reheat_settings`, `automation_toggles` e um schedule `pg_cron` se ausente.

## Fora de escopo (protegido)

- **Não** mexo em `cadence-tick`, nem em `_shared/cadence-engine.ts`, nem em `_shared/cadence-hooks.ts`.
- **Não** mexo em `MultichannelTextsPanel` nem no schema `cadence_stage_config`/`multichannel*`.
- **Não** duplico textos, áudios ou stages — tudo é lido das tabelas já existentes.
- **Não** crio página nova; tudo dentro do card em `/admin`.

## Verificação pós-implementação

1. Ligar os 3 switches → `daily_whapi_cap=60` → "Rodar ciclo agora" → checar `daily_reheat_runs` mais recente com `meta.live=true` e `dispatched>0`.
2. Conferir pizza: contagens por fatia batem com `SELECT queue, step, count(*) FROM daily_reheat_queue WHERE cycle_date=today GROUP BY 1,2` + `SELECT stage, count(*) FROM lead_cadence_state GROUP BY 1`.
3. Desligar "Envio ao vivo" → badge vira "Só planejando"; `daily_reheat_runs.dry_run=true`.
4. Trocar prioridade para `B_then_A` → próximo run mostra fila B saturada antes de A na `meta.sample`.
