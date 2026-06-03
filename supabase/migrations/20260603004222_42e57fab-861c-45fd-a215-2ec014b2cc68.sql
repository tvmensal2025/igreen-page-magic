UPDATE public.bot_flow_steps
SET captures = '[{"kind":"text","name":"resposta_cta","enabled":true,"required":false,"_buttons":[{"id":"btn_quero_cadastrar","label":"✅ Quero me cadastrar"},{"id":"tenho_duvida","label":"❓ Tenho dúvidas"}]}]'::jsonb
WHERE flow_id='66a19db4-b061-4f3f-921f-c13e9fb6f730'
  AND step_key='559b8f1b-0630-45b5-aeae-b96cb4d20e9a';