-- Alinha A_NUDGE global ao texto do Multicanal (com {{consultor}}, sem nome fixo).
-- Consultores sem override caíam no texto seco "simulação ficou pendente".
-- Também alinha bot_followup_sumiu (mesmo copy legado).
-- Nota: revisão seguinte (20260721211500) remove "o/a" e cargo gestor.

UPDATE public.cadence_stage_config
SET message_text =
      '*Oi, {{nome}}*! Aqui é o *{{consultor}}* da *iGreen* ⚡' || E'\n\n' ||
      'Todo mês a *conta de luz chega*… e muitas pessoas só descobrem depois que estavam *pagando mais* do que precisavam.' || E'\n\n' ||
      'Você chegou a *iniciar sua simulação*, mas não finalizamos.' || E'\n' ||
      '*Vamos continuar* de onde paramos?' || E'\n\n' ||
      '*Me confirma* seu primeiro nome para eu *seguir com o atendimento?* 😊',
    template_version = GREATEST(COALESCE(template_version, 1), 3),
    template_updated_at = now(),
    updated_at = now()
WHERE stage = 'A_NUDGE'
  AND consultant_id IS NULL;

UPDATE public.consultant_message_templates
SET text_content =
      '*Oi, {{nome}}*! Aqui é o *{{consultor}}* da *iGreen* ⚡' || E'\n\n' ||
      'Todo mês a *conta de luz chega*… e muitas pessoas só descobrem depois que estavam *pagando mais* do que precisavam.' || E'\n\n' ||
      'Você chegou a *iniciar sua simulação*, mas não finalizamos.' || E'\n' ||
      '*Vamos continuar* de onde paramos?' || E'\n\n' ||
      '*Me confirma* seu primeiro nome para eu *seguir com o atendimento?* 😊',
    updated_at = now()
WHERE template_key = 'bot_followup_sumiu'
  AND consultant_id IS NULL
  AND (
    text_content ILIKE '%simulação da conta de luz ficou pendente%'
    OR text_content ILIKE '%Posso retomar de onde paramos%'
  );
