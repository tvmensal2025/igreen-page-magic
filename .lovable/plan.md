
# Motor "Zero Lead Perdido" — Automação Total 2026

Objetivo: nenhum lead sai do funil sem, no mínimo, 5 toques em canais diferentes dentro de 30 dias, e mesmo depois disso continua sendo trabalhado por retargeting Meta indefinidamente.

## Janela de operação (regra global)

- **WhatsApp / IA**: 24/7 (respondendo). Follow-up ativo respeita janela.
- **Ligação Velip + SMS + WhatsApp de reengajamento ativo**: seg–sex 08:00–20:00 · sáb 08:00–14:00 · dom off.
- Fora da janela, tudo agenda para o próximo slot útil (helper único `nextBusinessSlot()` compartilhado por todos os edges).

## Máquina de estados do lead (nova tabela `lead_cadence_state`)

Cada lead ativo tem 1 linha com: `customer_id`, `stage`, `next_action_at`, `attempts_by_channel jsonb`, `last_response_at`, `temperature`, `paused_reason`.

Stages (mudam por eventos do webhook / cron / consultor):

```text
NEW → GREETED → AI_QUALIFYING → COLD_1 (24h) → COLD_2 (48h)
   → CALL_1 (72h Velip TTS+áudio) → SMS_1 (fallback se NA)
   → COLD_3 (5d) → CALL_2 (7d áudio humanizado) → SMS_2
   → COLD_4 (14d) → CALL_3 (21d) → CLOSE_LOST (30d)
                                     ↓
                              RETARGET_META (indefinido, custom audience)
```

Qualquer resposta do lead → `stage = AI_QUALIFYING`, zera contadores, pausa cadência automática por 24h.
Takeover humano → pausa toda cadência automática enquanto `bot_paused = true`.

## Fase 1 — Base (semana 1)

1. **Migration**: `lead_cadence_state` + `cadence_action_log` (auditoria de todo disparo). RLS por consultor.
2. **Helper `_shared/business-window.ts`**: `isBusinessHour(now)`, `nextBusinessSlot(now)` — usado por scheduled-messages, voice-dialer-cron, reactivation, retargeting.
3. **Edge `cadence-tick`** (cron a cada 5 min): varre `lead_cadence_state` onde `next_action_at <= now()` e `stage != CLOSED`, dispatch por stage.
4. **Trigger de resposta**: no `evolution-webhook` e `whapi-webhook`, ao receber inbound → atualiza `last_response_at`, reseta stage para `AI_QUALIFYING`.

## Fase 2 — WhatsApp reengajamento (semana 1-2)

5. **3 templates de reaquecimento** editáveis por consultor (áudio + texto), stages COLD_1/2/3/4, com merge de `{{nome}}`, `{{valor_conta}}`, `{{cidade}}`, `{{protocolo}}`.
6. **Dispatcher** dentro de `cadence-tick` respeitando anti-ban existente (`checkSendQuota`, `humanJitterMs`, `simulateTyping`).

## Fase 3 — Ligação Velip (semana 2)

7. **CALL_1** dispara `voice-dialer-enqueue` single com áudio TTS "Ainda quer economizar? Aperte 1 pra falar com {{consultor}}".
8. **CALL_2** áudio pré-gravado do consultor (do `voice_name_clips` + `audio_library`).
9. **CALL_3** última chance, TTS curto + CTA.
10. Callback do `voice-dialer-webhook`:
    - `OK`/atendida com DTMF 1 → notifica consultor imediatamente + pausa cadência.
    - `NA`/não atendida → aciona SMS_1 automático (já existente `sms_on_no_answer_text`).
    - `blocked/DND` → auto-DNC (já existente) + move para CLOSE_LOST antecipado.

## Fase 4 — SMS Velip fallback (semana 2)

11. SMS_1 e SMS_2 mensagens curtas com link `wa.me/<consultor>?text=Protocolo%20{{protocolo}}` — mantém rastreio.
12. Registrar em `voice_sms_log` já existente + `cadence_action_log`.

## Fase 5 — Retargeting Meta automático (semana 3)

13. **Custom Audience "Leads Frios 30d"** por consultor: cron diário sobe hash de telefone/email dos leads em `CLOSE_LOST` para Facebook via `POST /{audience_id}/users` (Marketing API já autenticada via `facebook_connections`).
14. **Custom Audience "Quentes sem fechar"**: leads com ≥3 respostas mas sem venda → audience separada para lookalike.
15. **Novo edge `facebook-retarget-sync`** roda 3x ao dia, adiciona/remove usuários conforme mudança de stage.
16. Consultor pode ligar/desligar retargeting por lead (opt-out LGPD respeitado via `lead_consent_log`).

## Fase 6 — Dashboard "Zero Lead Perdido" (semana 3)

17. Nova aba **Admin → Motor**:
    - KPI: leads em cada stage · próxima ação em X min · SLA violado (leads que passaram do `next_action_at` há >30min).
    - Timeline por lead (todas ações de todos canais).
    - Botão manual "Forçar próxima ação agora" e "Pausar cadência 24h".
    - Alerta sonoro + push web quando SLA violado.
18. Widget no perfil do cliente mostra próxima ação prevista (canal + hora) e histórico completo.

## Fase 7 — Inteligência (semana 4)

19. **Temperatura dinâmica**: recalcula quente/morno/frio a cada resposta usando Gemini (já disponível), muda o ritmo (quente = intervalo menor entre toques).
20. **A/B automático** de áudio vs texto no COLD_1 (já temos infra `bot_message_ab_results`).
21. **Best-time-to-call**: usa heatmap 24h já existente por consultor para escolher hora ideal do CALL_1.

## Detalhes técnicos

- **Idempotência**: `cadence_action_log` tem UNIQUE(`customer_id`, `stage`, `channel`) — reprocessos não duplicam.
- **Bloqueios**: reaproveita `customer_processing_lock` e `try_acquire_rate_limit` já existentes.
- **Quiet hours**: helper único `_shared/business-window.ts` substitui os checks espalhados.
- **Consentimento LGPD**: cadência só roda se `lead_consent_log` mais recente = concedido; opt-out via palavra "SAIR" no WhatsApp/SMS pausa tudo e adiciona a `voice_dnc_list` + retira da custom audience.
- **Custos**: cada ação registra custo estimado em `cadence_action_log.cost_cents` → dashboard soma por consultor/mês.
- **Rollback**: feature flag `app_settings.cadence_engine_enabled` — desliga tudo em 1 clique.

## Entregáveis por fase

| Fase | Semana | O que entra em produção |
|------|--------|------------------------|
| 1 | 1 | Máquina de estados + tick cron + helper janela |
| 2 | 1-2 | Reaquecimento WhatsApp 4 toques |
| 3 | 2 | 3 chamadas Velip programadas |
| 4 | 2 | SMS fallback automático |
| 5 | 3 | Retargeting Meta sincronizado |
| 6 | 3 | Dashboard + SLA alerts |
| 7 | 4 | IA de temperatura + best-time + A/B |

Pronto para começar pela Fase 1 (máquina de estados + tick). Posso abrir a migration assim que você aprovar.
