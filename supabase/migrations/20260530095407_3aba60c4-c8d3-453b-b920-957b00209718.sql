-- Reset completo do lead 5511971254913 (customer 42d4821f) para iniciar fluxo do zero.
DO $$
DECLARE
  v_cust uuid := '42d4821f-1d75-4162-b0c2-8613fa19b960';
BEGIN
  DELETE FROM public.conversations WHERE customer_id = v_cust;
  DELETE FROM public.ai_slot_dispatch_log WHERE customer_id = v_cust;
  DELETE FROM public.bot_step_transitions WHERE customer_id = v_cust;
  DELETE FROM public.ai_decisions WHERE customer_id = v_cust;
  DELETE FROM public.ai_agent_logs WHERE customer_id = v_cust;
  DELETE FROM public.customer_memory WHERE customer_id = v_cust;

  UPDATE public.customers SET
    conversation_step = NULL,
    electricity_bill_value = NULL,
    electricity_bill_photo_url = NULL,
    bill_base64 = NULL,
    bill_message_id = NULL,
    document_front_url = NULL,
    document_front_base64 = NULL,
    document_back_url = NULL,
    document_type = NULL,
    media_message_id = NULL,
    media_storage = NULL,
    email = NULL,
    cpf = NULL,
    rg = NULL,
    cep = NULL,
    address_street = NULL,
    address_number = NULL,
    address_complement = NULL,
    address_neighborhood = NULL,
    address_city = NULL,
    address_state = NULL,
    distribuidora = NULL,
    numero_instalacao = NULL,
    media_consumo = NULL,
    ocr_confianca = NULL,
    ocr_done = FALSE,
    ocr_conta_attempts = 0,
    ocr_doc_attempts = 0,
    bot_paused = FALSE,
    bot_paused_reason = NULL,
    bot_paused_at = NULL,
    bot_paused_until = NULL,
    last_custom_prompt_at = NULL,
    last_bot_reply_at = NULL,
    last_bot_interaction_at = NULL,
    conversation_summary = NULL,
    summary_updated_at = NULL,
    updated_at = now()
  WHERE id = v_cust;
END $$;