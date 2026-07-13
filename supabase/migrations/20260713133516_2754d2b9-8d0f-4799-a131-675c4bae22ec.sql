-- Corrige leads que ficaram em cadastro automatico (ask_name/ask_cpf/ask_rg) apos
-- Iniciar atendimento nos ultimos 7 dias. Move para handoff humano e pausa o bot,
-- evitando que continue pedindo CPF/RG sem sentido.
UPDATE public.customers
SET conversation_step = 'aguardando_humano',
    bot_paused = true,
    bot_paused_reason = COALESCE(bot_paused_reason, 'manual_start_attendance'),
    bot_paused_at = COALESCE(bot_paused_at, now()),
    assigned_human_id = COALESCE(assigned_human_id, consultant_id),
    updated_at = now()
WHERE conversation_step IN ('ask_name','ask_cpf','ask_rg','ask_birth','ask_email','ask_endereco','ask_cep','ask_numero','ask_conta_luz')
  AND welcome_sent_at > now() - interval '7 days';