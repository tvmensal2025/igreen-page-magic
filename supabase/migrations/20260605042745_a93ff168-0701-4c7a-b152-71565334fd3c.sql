UPDATE public.customers
SET ocr_review_pending = NULL,
    ocr_review_started_at = NULL,
    ocr_review_decided_at = NULL,
    ocr_review_decided_by = NULL,
    bot_paused = false,
    bot_paused_reason = NULL,
    bot_paused_at = NULL,
    bill_data_confirmation_by = 'awaiting_client',
    conversation_step = 'confirmando_dados_conta',
    updated_at = now()
WHERE phone_whatsapp = '5511971254913';