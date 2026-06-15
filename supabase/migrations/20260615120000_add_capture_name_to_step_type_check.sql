-- A Iris construtora passou a oferecer "Pedir o nome" (capture_name), que o
-- runtime já trata (manual-step-send/KNOWN_TYPES e whapi/evolution -> ask_name),
-- mas a constraint de step_type ainda não permitia, causando 400 no insert.
-- Adiciona capture_name (e capture_doc, alias legado já reconhecido no runtime)
-- ao conjunto permitido. Já aplicada via MCP em 2026-06-15; versionada aqui
-- para manter o histórico de migrations consistente. Idempotente.
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
    'handoff'::text
  ]));
