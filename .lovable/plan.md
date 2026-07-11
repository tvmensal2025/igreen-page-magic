## Objetivo

Fechar as Partes D + E do motor "Zero Lead Perdido", colocar **toggle ON/OFF em toda função automática** (nada envia até você ligar), e dar ao consultor controle total sobre **todas as mensagens** — incluindo a de "Abrir chamado / Iniciar atendimento", que hoje está fixa no código.

Tudo começa **desligado por padrão**. Você ativa quando quiser.

---

## Parte 1 — Kill switch universal (nada envia sem você mandar)

Criar uma tabela `automation_toggles` (nome, descrição, ativo, categoria, atualizado_por, atualizado_em) e semeá-la com todas as automações que hoje mandam mensagem/ligação/SMS:

- `cadence_engine` (motor de cadência)
- `cadence_cold_1` … `cadence_cold_4` (WhatsApp de re-engajamento)
- `cadence_call_1/2/3` (chamadas Velip)
- `cadence_sms_1/2` (SMS Velip)
- `facebook_retarget_sync` (Meta Custom Audience)
- `send_scheduled_messages` (agendadas manuais)
- `process_followups` (follow-ups IA)
- `reactivation_cron` (reaquecimento)
- `bulk_campaigns_runner`
- `pos_venda_auto_messages`
- `notify_partner_leads_batch`
- `start_customer_attendance` (abrir chamado)

Cada edge function que envia algo consulta `automation_toggles` antes de disparar. Se `ativo=false` → loga em `cadence_action_log` como `skipped_toggle_off` e sai. Nenhum cron precisa ser pausado — o gate está no código.

Toggle global "PAUSAR TUDO" continua no `app_settings.bot_global_enabled` já existente (regra do projeto).

## Parte 2 — Central de Automações (nova aba na `/admin/agendamentos-central`)

Adicionar aba **"Automações"** ao lado da lista de crons:

- Grid de cards, um por toggle, agrupados por categoria (Cadência / Voz / SMS / Meta / Pós-venda / Manual).
- Switch grande ON/OFF por card.
- Badge "DESLIGADO" bem visível quando `false`.
- Botão "Ligar todas" / "Desligar todas" no topo (com confirmação).
- Última alteração: quem mudou e quando.

## Parte 3 — Editor universal de mensagens do consultor

Hoje cada consultor tem várias fontes de texto espalhadas. Vou centralizar em uma tela nova **`/consultor/mensagens`** que lista **todas as mensagens que o consultor pode personalizar**, com preview, variáveis suportadas (`{{nome}}`, `{{consultor}}`, `{{protocolo}}`, `{{valor_conta}}`) e botão "Restaurar padrão":

1. **Abrir chamado / Iniciar atendimento** — hoje fixa em `start-customer-attendance/index.ts`. Vira `consultant_message_templates` com chave `start_attendance` (texto + áudio opcional + delay de digitação).
2. **Saudação Bom dia / Boa tarde / Boa noite** — configurável.
3. **Cadência COLD_1 a COLD_4** (WhatsApp) — já existe em `cadence_stage_config`, adicionar ao painel do consultor (hoje só admin edita).
4. **CALL_1/2/3** (script TTS Velip) — idem.
5. **SMS_1/2** — idem.
6. **Pós-venda D+0/D+30/D+60/D+90/D+120** — já existe em `pos_venda_default_media`, expor edição per-consultor.
7. **Notificação de novo lead ao parceiro** — texto fixo hoje no `notify-partner-leads-batch`, vira template editável.

Regra: se o consultor não personalizou → usa o padrão do admin. Se personalizou → prevalece o dele. Nunca sobrescreve silenciosamente.

## Parte 4 — Configuração da mensagem "Abrir chamado" (destaque)

Onde fica: **`/consultor/mensagens` → cartão "Abrir chamado"** e também atalho direto no botão "Iniciar atendimento" do chat (ícone de engrenagem ao lado abre o editor).

Campos:
- Texto da saudação (com variáveis).
- Áudio opcional (upload ou biblioteca).
- Delay de "digitando…" antes de enviar (segundos).
- Pré-visualização com nome fake.
- Toggle "Usar padrão do admin" vs. "Personalizar".

## Parte 5 — Timeline por lead + alerta SLA (Parte E do plano anterior)

- Nova view **"Linha do tempo"** dentro do card do lead no `/captacao` e no chat: mostra cada ação da cadência (COLD_1 enviada, CALL_1 tocou X seg, SMS_2 entregue, retarget adicionado à audiência) com status e horário.
- Alerta visual (badge vermelho pulsante) quando ação está atrasada > 30 min no `/admin/motor` e `/admin/agendamentos-central`.
- Som opcional (toggle por usuário) quando novo SLA violado aparece.

---

## Detalhes técnicos

- **Migração 1**: `automation_toggles` (id, key unique, label, description, category, enabled default false, updated_by, updated_at) + `consultant_message_templates` (consultant_id, template_key, text, audio_url, typing_delay_ms, is_active, updated_at, PK composta). GRANTs para authenticated + service_role. RLS: consultor lê/escreve o próprio; admin lê tudo.
- **Migração 2**: seed dos 12 toggles todos com `enabled=false`; seed dos templates padrão (`start_attendance`, `greeting_morning/afternoon/evening`, `partner_new_lead_notification`).
- **Helper**: `supabase/functions/_shared/automation-gate.ts` com `isAutomationEnabled(supabase, key)` — usado por **toda** edge function de envio antes de disparar.
- **Helper**: `supabase/functions/_shared/consultant-template.ts` com `resolveConsultantMessage(supabase, consultantId, key, vars)` que faz merge consultor → admin → hardcoded fallback, e aplica variáveis.
- **Edge refactor**: `start-customer-attendance`, `cadence-tick`, `send-scheduled-messages`, `facebook-retarget-sync`, `notify-partner-leads-batch`, `reactivation-cron`, `process-followups` — todos passam a chamar `isAutomationEnabled(...)` no topo e `resolveConsultantMessage(...)` para pegar o texto.
- **Frontend novo**: 
  - `src/pages/AdminAutomationToggles.tsx` (aba nova na Central) 
  - `src/pages/ConsultantMessages.tsx` (rota `/consultor/mensagens`) 
  - `src/components/lead/LeadCadenceTimeline.tsx` (usada no chat e captação)
- **Frontend editado**: `AdminAgendamentosCentral.tsx` (adicionar aba), `AdminMotorCadencia.tsx` (badges DESLIGADO), `ChatView.tsx` (engrenagem ao lado de "Iniciar atendimento"), `App.tsx` (nova rota consultor).

Nada vai enviar mensagem enquanto os toggles estiverem em `false` — que é o estado inicial de todos. Você liga um a um quando validar.
