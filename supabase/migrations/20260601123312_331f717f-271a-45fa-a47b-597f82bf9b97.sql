-- Fix lead 5511971254913 (BRUNO MANOEL DOS SANTOS) e qualquer outro lead
-- contaminado com email do consultor.
-- Bugs corrigidos no código (esta migration apenas limpa o estado preso):
--   1. ask_email salvava email do consultor por engano via tail do texto;
--   2. complemento recebia o "lixo" do email (". br") como valor;
--   3. ANTI-LOOP escalava para humano após 1 redirect (agora 3+).

-- 1) Reset do lead específico que travou: limpa email/complemento ruins,
--    zera contador de rescue e reabre o bot no passo ask_email.
UPDATE public.customers c
SET email = NULL,
    address_complement = NULL,
    rescue_attempts = 0,
    bot_paused = false,
    bot_paused_reason = NULL,
    bot_paused_at = NULL,
    conversation_step = 'ask_email',
    updated_at = now()
WHERE id = '1605304b-c75f-4a67-a622-1b787ada84d6';

-- 2) Higieniza outros leads que tenham email IGUAL ao do próprio consultor
--    (mesmo bug, qualquer customer afetado é reaberto no ask_email).
UPDATE public.customers c
SET email = NULL,
    rescue_attempts = 0,
    bot_paused = false,
    bot_paused_reason = NULL,
    bot_paused_at = NULL,
    conversation_step = CASE
      WHEN c.conversation_step IN ('aguardando_humano','finalizando','ask_finalizar') THEN 'ask_email'
      ELSE c.conversation_step
    END,
    updated_at = now()
FROM public.consultants k
WHERE c.consultant_id = k.id
  AND k.igreen_portal_email IS NOT NULL
  AND lower(trim(c.email)) = lower(trim(k.igreen_portal_email));

-- 3) Reseta também o customer_flow_state para o lead específico, para o
--    engine v3 não reentrar em aguardando_humano.
UPDATE public.customer_flow_state
SET status = 'waiting_reply',
    pause_reason = NULL,
    current_step_id = 'ask_email',
    updated_at = now()
WHERE customer_id = '1605304b-c75f-4a67-a622-1b787ada84d6';