# Documentar caps A/B/C + destravar envios da Pizza

## 1. Estado real agora (leitura no banco, sem código)

**Config atual `daily_reheat_settings`**
- `cap_b=150` · `cap_c=50` · `cap_global_outreach=200` · `daily_whapi_cap=60` (legado)
- `enabled=true` · `live_dispatch_enabled=true`

**Fila `lead_cadence_state` (excl. WON)**
| Métrica | Qtd |
|---|---|
| Total ativos | 212 |
| Sem `next_action_at` (travados) | **71** |
| Pausados ativos | 18 |
| Due nas próximas 2h | 3 |
| Due nas próximas 24h | 129 |
| Tocados hoje | **1** |

**Grupos elegíveis hoje BRT**
| Grupo | Total | Due hoje | Tocados hoje |
|---|---|---|---|
| A (ilimitado) | 158 | 77 | 0 |
| B (cap 150) | 63 | 52 | 1 |
| C (cap 50) | 0 | 0 | 0 |

**Pausas legítimas (18)**: 10 `lead_responded:AI_QUALIFYING` (A esperando resposta — correto), 5 `not_lead_outside_ddd*` (fora do DDD alvo — correto), 2 `handoff_humano`, 1 `dnc`.

## 2. Diagnóstico — por que ninguém está recebendo

**Três causas reais, todas fora do sistema de caps (que não está travando ninguém):**

**A. `cadence-tick` está bootando e desligando sem processar.** Logs recentes mostram só `Boot`/`Shutdown`, sem linha de "run_id/scanned/dispatched". O cron dispara mas o handler está saindo cedo — precisa checar toggle `cadence_engine`, `isBotGloballyEnabled`, ou uma exceção silenciosa no boot da run. Sem isso, os 129 leads due hoje ficam parados mesmo com caps a 1/200.

**B. 71 leads sem `next_action_at`** (travados de vez, sem próxima ação agendada). Batem com o padrão já documentado em `scripts/tmp_fluxo_a_audit.md` (leads `dnc_nao_deveria_estar_na_pizza` / `conversa_encerrada_sem_avanco`). Precisam de backfill: ou entram em DNC, ou recebem `next_action_at = próxima janela BRT` com base no stage.

**C. Concentração ruim em 2 slots** (14:05 e 14:10 BRT): 108 leads dos 129 due estão nesses 5 minutos. Se o tick B rodar antes do A, o A/B/C compete no mesmo lote e o resultado depende de ordem — precisa spread horário (jitter de ±10min no `next_action_at` novo).

## 3. Progressão A/B/C confirmada (`stageGroup` em `_shared/cadence-engine.ts`)

```text
NEW → GREETED → AI_QUALIFYING → A_NUDGE → A_SMS → A_CALL → A_CALL_RETRY  (Grupo A, ilimitado)
                                        ↓ (sem resposta)
                                     COLD_1 → COLD_2 → COLD_3 → COLD_4  (Grupo B, cap 150)
                                     + SMS_1/2, CALL_1..3, SMS_TEMA_*    (Grupo B)
                                        ↓ (esgotou B)
                                     CLOSE_LOST → RECALL_60D … YEARLY   (Grupo C, cap 50)
```
Todos os stages estão no `STAGE_MAP` e cada `next` está definido; nenhum lead vai ficar órfão se `next_action_at` estiver preenchido e o tick rodar.

## 4. Plano de ação (2 blocos)

### Bloco X — Documentação (5 arquivos, zero código)

1. `.kiro/steering/regras-duras.md` — nova seção "Caps outreach A/B/C":
   - A ilimitado · B `cap_b`=150 · C `cap_c`=50 · Global B+C `cap_global_outreach`=200.
   - Excedeu → adia p/ próxima manhã BRT (nunca descarta).
   - Alertas 60/85/100 % em `automation_skip_log` (`outreach_cap_{b|c|g}_{60|85|100}pct`).
2. `.kiro/steering/banco.md` — trocar linha `daily_reheat_settings` para incluir `cap_b/cap_c/cap_global_outreach` e marcar `daily_whapi_cap` como legado.
3. `.kiro/steering/fluxos.md` — completar §2 com a classificação A/B/C via `stageGroup` + gate `countOutreachTouchesToday` em `cadence-tick`.
4. `.kiro/steering/helpers-canonicos.md` — registrar `stageGroup(stage)` como helper canônico.
5. `docs/ANTI_BAN_AUDIT.md` — anexar bloco "Caps outreach (2026-07)" descrevendo tabela, colunas, defaults e comportamento adiar-não-descartar.

### Bloco Y — Destravar envios (3 fixes cirúrgicos)

6. **Diagnosticar cadence-tick** (`supabase/functions/cadence-tick/index.ts`):
   - Adicionar log `console.info("[cadence-tick] boot", { toggle, bot_global, live_dispatch })` no primeiro `if` de guard, antes de qualquer return.
   - Se o guard falhar, ver o motivo em `edge_function_logs`. Se nenhum guard falhar mas nada roda, envolver o handler principal em `try/catch` com log do erro.
7. **Backfill dos 71 sem `next_action_at`** (migration SQL, sem tocar em código):
   - Para stages A ativos (`NEW/GREETED/AI_QUALIFYING/A_*`) sem `next_action_at`: setar `next_action_at = clamp_to_business_window_brt(now() + interval '5 minutes')`.
   - Para stages B/C sem `next_action_at`: setar `next_action_at = amanhã 09:00 BRT`.
   - Para `PAUSED` sem `paused_until` e sem `next_action_at`: mover para `COLD_1` com `next_action_at` amanhã 09:00 BRT.
8. **Spread do slot 14:05/14:10** (migration SQL):
   - `UPDATE lead_cadence_state SET next_action_at = next_action_at + (random()*interval '30 minutes') WHERE next_action_at BETWEEN ... AND ...` — desconcentra os 108 leads em 30 min.

## Detalhes técnicos

- Nenhuma mudança em `stageGroup` / caps / UI — arquitetura aprovada anteriormente permanece intacta.
- Migrations do bloco Y são idempotentes (só afetam linhas com `next_action_at IS NULL` ou dentro do slot travado).
- O log extra em cadence-tick é uma linha; não afeta performance.
- Após aplicar, monitorar `edge_function_logs('cadence-tick')` na próxima janela de 15 min para confirmar `dispatched > 0`.

## Fora de escopo

- Reescrever `cadence-tick` (só instrumentar).
- Dropar `daily_whapi_cap` da tabela (retrocompat).
- Alerta visual UI de cap 100 % (já sai via toast/skip_log).
