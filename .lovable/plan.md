## Achados da auditoria

- O número `5511971254913` ainda aparece em 2 leads ativos na tabela `customers`:
  - `d2984682-26f2-45fa-9f12-17a41f5e53b0`, consultor `953f7e48-509b-4069-9822-bdad9902be09`, com `bot_paused=true` e `bot_paused_reason=ai_no_kb_match`.
  - `a446c6de-7815-4ea9-bfc3-c886bcabc1f8`, consultor `0c2711ad-4836-41e6-afba-edd94f698ae3`, destravado.
- Depois do reset anterior, entrou uma nova mensagem `Oi`; por isso parece que “não resetou”, mas na prática o fluxo reiniciou e travou novamente por `ai_no_kb_match`.
- A função atual `reset_lead_conversation` limpa bastante coisa, mas ainda deixa rastros por telefone/JID em tabelas que não dependem só de `customer_id`.
- Rastros encontrados para esse telefone:
  - `conversations`: 1 registro novo.
  - `ai_agent_logs`: 1 registro.
  - `bot_step_transitions`: 7 registros antigos por telefone, ligados a customers antigos já apagados.
  - `crm_deals`: 2 registros.
  - `bot_handoff_alerts`: 5 registros.
  - `capture_field_events`: 11 registros.
  - `outbound_message_log`: 5 registros.
- O reset atual apaga principalmente por `customer_id`; para um hard reset real precisa também apagar por telefone normalizado e `remote_jid` (`5511971254913@s.whatsapp.net`).

## Plano de implementação

### 1. Limpeza imediata do número informado

Executar uma limpeza completa no Supabase para `11971254913` / `5511971254913`:

- Localizar todos os `customer_id` atuais e antigos relacionados ao telefone.
- Apagar registros derivados em:
  - `customer_flow_state`
  - `customer_memory`
  - `customer_processing_lock`
  - `whatsapp_message_buffer`
  - `conversations`
  - `ai_slot_dispatch_log`
  - `ai_decisions`
  - `ai_agent_logs`
  - `bot_step_transitions`
  - `bot_handoff_alerts`
  - `ai_usage_log`
  - `capture_field_events`
  - `capture_field_suggestions`
  - `inbound_media_failures`
  - `inbound_media_retry`
  - `lead_insights`
  - `outbound_message_log`
  - `pending_outbound_media`
  - `portal2_audit_traces`
  - `worker_phase_logs`
  - `facebook_capi_events`
  - `scheduled_messages`
  - `crm_auto_message_log`
  - `customer_tags`
  - `crm_deals`
- Apagar também os `customers` atuais do telefone para que a próxima mensagem recrie o lead do zero.
- Validar com uma consulta final mostrando zero rastros relevantes.

### 2. Corrigir a função de reset no banco

Criar/ajustar uma RPC de hard reset, por exemplo `admin_hard_reset_phone`, para uso temporário no painel:

- Entrada: telefone bruto (`11971254913`, `+55...`, etc.).
- Normalização automática para `55DDDNÚMERO` e `remote_jid`.
- Permissão somente para `admin` ou `super_admin`.
- Varredura por:
  - `customer_id` atual.
  - `customer_id` antigo encontrado em logs por telefone.
  - `phone` normalizado.
  - `remote_jid`.
- Retorno com contagem por tabela apagada.
- Registro em `admin_audit_log` via função existente quando possível.

### 3. Adicionar botão temporário no dashboard

Adicionar no `DashboardTab` um bloco discreto de manutenção temporária:

- Campo para digitar o telefone.
- Botão perigoso: `Reset geral do telefone`.
- Confirmação nativa antes de apagar.
- Chamada para a RPC nova.
- Toast com resumo das tabelas limpas.
- Invalidar caches do dashboard/CRM/WhatsApp após sucesso.
- Exibir somente para usuário admin/super-admin, para evitar que consultores comuns apaguem leads por engano.

### 4. Teste e validação

Após implementar:

- Rodar a limpeza do número `11971254913`.
- Consultar novamente as tabelas principais para confirmar zero rastros.
- Conferir que o botão aparece no dashboard para admin.
- Confirmar que a RPC recusa usuário sem permissão.

## Arquivos que serão alterados

- `src/components/admin/DashboardTab.tsx`
  - Adicionar UI temporária do hard reset.
- `src/services/resetConversation.ts`
  - Adicionar função frontend para chamar a RPC por telefone.
- Banco Supabase
  - Criar/ajustar RPC segura para hard reset por telefone.
  - Nenhuma nova tabela será criada.

## Observação importante

Esse botão será propositalmente temporário e perigoso. A implementação deve deixar isso claro no texto do botão e na confirmação, mas restringir por permissão no banco é o ponto principal de segurança.