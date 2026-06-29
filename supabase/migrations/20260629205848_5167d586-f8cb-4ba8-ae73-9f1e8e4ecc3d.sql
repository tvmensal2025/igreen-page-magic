UPDATE public.customers
SET
  conversation_step = 'aguardando_conta',
  previous_conversation_step = 'd_resultado',
  bill_data_confirmed_at = NULL,
  bill_data_confirmation_by = NULL,
  electricity_bill_value = NULL,
  media_consumo = NULL,
  ocr_done = false,
  last_step_advanced_at = now()
WHERE id = '95fcd3b0-ff80-4446-a66c-0277797ff147';