# Audit Pizza A — Em conversa / fluxo

Gerado: `2026-07-19T15:53:30.089434+00:00`
Total leads: **53**
Overlap fila B hoje: **0** (deve ser 0)
`stage_sequence=0`: **79.2%**

## Bloqueios
- `congelado_sla_backlog_ate_ago`: 36
- `dnc_nao_deveria_estar_na_pizza`: 9
- `conversa_encerrada_sem_avanco`: 6
- `paused_72h_pos_inbound`: 2

## Destino esperado por silêncio
- `B_COLD_1`: 44
- `A_fecha_depois_B`: 5
- `A_silencio_liga_sms`: 3
- `ainda_quente`: 1

## Silêncio (h): {'min': 1.5, 'p50': 138.5, 'p90': 195.0, 'max': 577.1}
## Dwell no stage (h): {'min': 1.5, 'p50': 22.0, 'p90': 22.0, 'max': 59.9}

## Deveriam avançar automaticamente: 52
- sil=577.1h | B_COLD_1 | dnc_nao_deveria_estar_na_pizza | Daniele Aparecida Rodrigues bueno | SEM next_action — parado de vez
- sil=499.3h | B_COLD_1 | dnc_nao_deveria_estar_na_pizza | Marcus Medau | SEM next_action — parado de vez
- sil=251.6h | B_COLD_1 | congelado_sla_backlog_ate_ago | morvanamaral | next_action em 698.0h (sem ciclo A visual)
- sil=213.2h | B_COLD_1 | dnc_nao_deveria_estar_na_pizza | Deus Abençoe | SEM next_action — parado de vez
- sil=195.6h | B_COLD_1 | congelado_sla_backlog_ate_ago | Responsável Por Parcerias | next_action em 698.0h (sem ciclo A visual)
- sil=195.0h | B_COLD_1 | congelado_sla_backlog_ate_ago | Emerson | next_action em 698.0h (sem ciclo A visual)
- sil=193.5h | B_COLD_1 | congelado_sla_backlog_ate_ago | Valéria | next_action em 698.0h (sem ciclo A visual)
- sil=193.0h | B_COLD_1 | congelado_sla_backlog_ate_ago | MATHEUS HENRIQUE FIGUEIREDO DOS SANTOA | next_action em 698.0h (sem ciclo A visual)
- sil=192.4h | B_COLD_1 | conversa_encerrada_sem_avanco | ⱠɆӾ ɆⱤⱤɆłⱤ | next_action em 3.4h (sem ciclo A visual)
- sil=190.9h | B_COLD_1 | congelado_sla_backlog_ate_ago | Maria | next_action em 698.0h (sem ciclo A visual)
- sil=187.5h | B_COLD_1 | congelado_sla_backlog_ate_ago | TATIANE SILVA | next_action em 698.0h (sem ciclo A visual)
- sil=187.4h | B_COLD_1 | congelado_sla_backlog_ate_ago | Rubens | next_action em 698.0h (sem ciclo A visual)
- sil=174.2h | B_COLD_1 | congelado_sla_backlog_ate_ago | Maria Auxiliadora | next_action em 698.0h (sem ciclo A visual)
- sil=172.7h | B_COLD_1 | congelado_sla_backlog_ate_ago | Flávia | next_action em 698.0h (sem ciclo A visual)
- sil=170.1h | B_COLD_1 | congelado_sla_backlog_ate_ago | Bell | next_action em 698.0h (sem ciclo A visual)
- sil=169.8h | B_COLD_1 | congelado_sla_backlog_ate_ago | Cristiano Martins Filguei | next_action em 698.0h (sem ciclo A visual)
- sil=168.8h | B_COLD_1 | congelado_sla_backlog_ate_ago | Marlene | next_action em 698.0h (sem ciclo A visual)
- sil=168.2h | B_COLD_1 | congelado_sla_backlog_ate_ago | None | next_action em 698.0h (sem ciclo A visual)
- sil=168.0h | B_COLD_1 | dnc_nao_deveria_estar_na_pizza | Nicolas Amoroso | SEM next_action — parado de vez
- sil=163.9h | B_COLD_1 | congelado_sla_backlog_ate_ago | Talita Scoralick | next_action em 698.0h (sem ciclo A visual)
- sil=160.2h | B_COLD_1 | congelado_sla_backlog_ate_ago | jose Francisco Maciel | next_action em 698.0h (sem ciclo A visual)
- sil=158.9h | B_COLD_1 | congelado_sla_backlog_ate_ago | Cleusa | next_action em 698.0h (sem ciclo A visual)
- sil=151.4h | B_COLD_1 | congelado_sla_backlog_ate_ago | Neide Cristina | next_action em 698.0h (sem ciclo A visual)
- sil=150.5h | B_COLD_1 | congelado_sla_backlog_ate_ago | José Gonçalves | next_action em 698.0h (sem ciclo A visual)
- sil=146.6h | B_COLD_1 | congelado_sla_backlog_ate_ago | Mauricio Batista da silva | next_action em 698.0h (sem ciclo A visual)

## Gaps de produto/código
- Pizza Fluxo = visual; ciclo A (wait2h/call/sms) vem do daily_reheat e ignora PAUSED
- cadence-tick: PAUSED→COLD_1 após 72h — pula silêncio/liga/SMS da pizza A
- manual_admin_clear_sla_backlog empurra next_action para semanas — trava o motor
- lead_cadence_state.stage sobrescreve; não há lead_cadence_stage_history append-only
- journey_started_at / stage_entered_at existem mas stage_sequence=0 em massa
- DNC não pode aparecer na pizza A
