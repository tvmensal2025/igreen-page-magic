-- Aditivo: permite passos opcionais de SMS e ligação no construtor de fluxos.
-- NÃO aplica sozinho em produção — só versiona a constraint.
-- Runtime de envio real continua atrás de flags / implementação dedicada.
ALTER TABLE public.bot_flow_steps
  DROP CONSTRAINT IF EXISTS bot_flow_steps_step_type_check;

ALTER TABLE public.bot_flow_steps
  ADD CONSTRAINT bot_flow_steps_step_type_check
  CHECK (step_type = ANY (ARRAY[
    'audio_slot'::text,
    'message'::text,
    'question'::text,
    'media_request'::text,
    'cadastro'::text,
    'capture_name'::text,
    'capture_conta'::text,
    'capture_documento'::text,
    'capture_doc'::text,
    'capture_email'::text,
    'confirm_phone'::text,
    'finalizar_cadastro'::text,
    'handoff'::text,
    'send_sms'::text,
    'make_call'::text
  ]));

COMMENT ON CONSTRAINT bot_flow_steps_step_type_check ON public.bot_flow_steps IS
  'Inclui send_sms e make_call para o consultor encaixar SMS/ligação em qualquer ponto do fluxo (opcional).';
