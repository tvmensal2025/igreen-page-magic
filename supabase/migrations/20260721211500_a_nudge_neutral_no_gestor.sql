-- A_NUDGE: texto neutro (sem "o/a" nem cargo gestor).
-- Identidade no envio: {{consultor}} / {{assistente}} do consultor do lead.

UPDATE public.cadence_stage_config
SET message_text =
      '*Oi, {{nome}}*! Aqui é *{{consultor}}* da *iGreen* ⚡' || E'\n\n' ||
      'Todo mês a *conta de luz chega*… e muitas pessoas só descobrem depois que estavam *pagando mais* do que precisavam.' || E'\n\n' ||
      'Você chegou a *iniciar sua simulação*, mas não finalizamos.' || E'\n' ||
      '*Vamos continuar* de onde paramos?' || E'\n\n' ||
      '*Me confirma* seu primeiro nome para eu *seguir com o atendimento?* 😊',
    template_version = GREATEST(COALESCE(template_version, 1), 4),
    template_updated_at = now(),
    updated_at = now()
WHERE stage = 'A_NUDGE'
  AND (
    message_text LIKE '%Aqui é o *{{consultor}}*%'
    OR message_text LIKE '%Aqui é a *{{consultor}}*%'
    OR message_text ILIKE '%simulação da conta de luz ficou pendente%'
    OR message_text LIKE '%Aqui é *{{consultor}}* da *iGreen*%'
  );

UPDATE public.consultant_message_templates
SET text_content =
      '*Oi, {{nome}}*! Aqui é *{{consultor}}* da *iGreen* ⚡' || E'\n\n' ||
      'Todo mês a *conta de luz chega*… e muitas pessoas só descobrem depois que estavam *pagando mais* do que precisavam.' || E'\n\n' ||
      'Você chegou a *iniciar sua simulação*, mas não finalizamos.' || E'\n' ||
      '*Vamos continuar* de onde paramos?' || E'\n\n' ||
      '*Me confirma* seu primeiro nome para eu *seguir com o atendimento?* 😊',
    updated_at = now()
WHERE template_key = 'bot_followup_sumiu'
  AND (
    text_content LIKE '%Aqui é o *{{consultor}}*%'
    OR text_content LIKE '%Aqui é a *{{consultor}}*%'
    OR text_content ILIKE '%simulação da conta de luz ficou pendente%'
    OR text_content LIKE '%Aqui é *{{consultor}}* da *iGreen*%'
  );
