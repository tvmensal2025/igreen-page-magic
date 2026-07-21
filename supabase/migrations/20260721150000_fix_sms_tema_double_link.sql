-- ============================================================================
-- SMS_TEMA_2 / SMS_TEMA_7: remove link duplicado.
-- O tema (cadence-themes.ts) já inclui `https://wa.me/{{consultor_phone}}`.
-- O template `{{tema_sms}} https://wa.me/{{consultor_phone}}` gerava 2 links
-- e a Velip bloqueava com Blocked text#240/#270.
-- Fonte Multicanal: body = `{{tema_sms}}` (b_day2_sms_tema / b_day7_sms_tema).
-- ensureSmsWaLink no cadence-tick ainda adiciona o link se o tema não tiver.
-- ============================================================================

UPDATE public.cadence_stage_config
   SET message_text = '{{tema_sms}}',
       template_version = GREATEST(COALESCE(template_version, 1), 3),
       template_updated_at = now(),
       updated_at = now()
 WHERE stage IN ('SMS_TEMA_2', 'SMS_TEMA_7')
   AND (
     message_text LIKE '%{{tema_sms}}%https://wa.me%'
     OR message_text LIKE '%{{tema_sms}}%wa.me%'
   );
