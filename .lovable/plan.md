## Cadência com fluxo direcionado + gaps operacionais

### 1. Resposta do lead → entra no fluxo do consultor (variante A)

Quando um lead responder qualquer WhatsApp/SMS da cadência (COLD_*, SMS_*) ou retornar a ligação Velip:

- `evolution-webhook` e `whapi-webhook` detectam `customer.cadence_stage IS NOT NULL` no inbound.
- Ao detectar: cancela cadência (`cadence_stage = NULL`, `cadence_next_run_at = NULL`), grava `cadence_result = 'responded'` em `cadence_action_log`, e reinicia o lead no fluxo ativo do consultor (variante A) — mesma lógica de `start-customer-attendance` (reset `conversation_step`, limpa `ai_slot_dispatch_log`, dispatch do primeiro passo do `bot_flows` ativo).
- SMS de resgate leva `wa.me/{{consultor_phone}}` — quando o clique chega no WhatsApp, mesmo caminho.

### 2. Fim de cadência sem resposta (após COLD_4/CALL_3)

`cadence-tick` ao encerrar o último passo:

- Marca `captured_leads.status = 'lost'`, motivo `nao_respondeu_cadencia`.
- Dispara `close-capture-and-register-sale` em modo "perda" → usa o **modelo formatado ao parceiro** já existente (Meire/Abel), preenchendo campanha + motivo + tentativas por canal.
- Adiciona telefone hash + email hash na **audiência custom Meta** (`facebook-capi` custom_audience) para retargeting pago. Novo campo `meta_retargeting_synced_at` em `customers`.

### 3. Handoff humano no meio da cadência

- Trigger DB `pause_cadence_on_manual_send`: quando `conversations` recebe INSERT com `direction='outbound'` e `sent_by_consultant=true`, faz `UPDATE customers SET cadence_stage=NULL, cadence_next_run_at=NULL, cadence_paused_reason='handoff_humano'`.
- Espelha o comportamento já existente do `clear_attendance_auto_close_on_inbound`.

### 4. Limites por canal (anti-ban / anti-custo)

Novos campos em `cadence_stage_config` (ou app_settings):
- `max_whatsapp_per_lead` (default 4)
- `max_calls_per_lead` (default 3)
- `max_sms_per_lead` (default 2)

`cadence-tick` conta em `cadence_action_log` antes de disparar; se atingiu → pula estágio ou encerra cadência.

### 5. Horário comercial e quiet hours por canal

Novo bloco em `AdminMotorCadencia.tsx` + campos em `cadence_stage_config`:
- WhatsApp: respeita quiet hours globais do consultor (já existe).
- **SMS**: janela dura 9h-20h São Paulo, seg-sáb (SMS acorda gente).
- **Ligação Velip**: 9h-19h seg-sex, 9h-13h sábado.
- Se `cadence_next_run_at` cai fora da janela do canal → reagenda para próxima abertura, não pula.

### 6. Métricas de conversão da cadência

Nova aba "Métricas" em `AdminMotorCadencia.tsx`:
- Taxa de resposta por estágio (COLD_1..CALL_3) = respondidos / disparados.
- Custo Velip (segundos × tarifa) + custo SMS acumulado no período.
- Leads recuperados / leads perdidos / ROI (vendas fechadas com `origin_recovery='cadence'`).
- View SQL `cadence_metrics_daily` alimenta o dashboard.

### 7. Detalhes técnicos

**Migração:**
- `customers`: `cadence_paused_reason text`, `meta_retargeting_synced_at timestamptz`, `origin_recovery text`.
- `cadence_stage_config`: `max_per_lead int`, `channel_window_start time`, `channel_window_end time`, `channel_days int[]`.
- Trigger `pause_cadence_on_manual_send`.
- View `cadence_metrics_daily`.

**Edge functions:**
- `cadence-tick`: adicionar checks de limite, janela de canal, e handler de fim-de-cadência (loss + retargeting).
- `evolution-webhook` + `whapi-webhook`: hook `resumeFlowFromCadence(customer)` no início do processamento de inbound quando `cadence_stage IS NOT NULL`.
- `close-capture-and-register-sale`: aceitar `trigger='cadence_exhausted'` que preenche mensagem formatada e chama sync Meta.

**Frontend:**
- `AdminMotorCadencia.tsx`: nova aba Métricas + editor de limites/janelas por canal.
- Ajuste no card do lead em Captação: badge "Em cadência: COLD_2 · próxima em 4h".
