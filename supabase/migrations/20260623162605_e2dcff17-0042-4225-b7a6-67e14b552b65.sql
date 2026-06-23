
-- 1) Step 1 (capture_conta) estava com captures: [] — preencher igual aos outros steps
UPDATE bot_flow_steps
SET captures = '[{"kind":"media","name":"conta_luz","required":true,"accepts":["image","document"],"retry_text":"📸 Pode reenviar a *foto da sua conta de luz* (fatura do mês atual ou anterior)?"}]'::jsonb,
    updated_at = now()
WHERE id = '3d69389d-92bb-4e85-a8f6-e66fe16906e9';

-- 2) Reset lead 5511971254913 para forçar re-welcome com o fix do router-bridge ativo
UPDATE customers
SET conversation_step = NULL,
    previous_conversation_step = NULL,
    custom_step_retries = 0,
    custom_step_retries_step = NULL,
    ocr_conta_attempts = 0,
    ocr_doc_attempts = 0,
    last_step_advanced_at = NULL,
    updated_at = now()
WHERE id = '02eda00b-c6ec-4e2f-bbff-a8c8219ed876';
