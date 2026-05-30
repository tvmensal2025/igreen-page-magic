UPDATE public.customers SET 
  conversation_step='novo_lead',
  error_message=NULL,
  electricity_bill_value=NULL,
  electricity_bill_photo_url=NULL,
  distribuidora=NULL,
  numero_instalacao=NULL,
  bill_holder_name=NULL,
  ocr_conta_attempts=0,
  ocr_done=false,
  bill_data_confirmed_at=NULL,
  last_step_advanced_at=NULL,
  bot_paused=false,
  bot_paused_reason=NULL,
  bot_paused_at=NULL,
  bot_paused_until=NULL,
  updated_at=now()
WHERE id='b5bbc2c2-2b25-4e55-a78d-524276c26b7c';