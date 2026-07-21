-- ============================================================================
-- Follow-up: residuals da 20260721140000 (overrides de consultor).
--   - A_NUDGE override: negrito quebrado (estavam* pagando*, *Vamos continuar *)
--   - RECALL_5M_CALL override: Olá duplicado + "fale com o Rafael"
--   - RECALL_8M_CALL override: alinha ao texto canônico Multicanal
-- ============================================================================

-- A_NUDGE (override) — só conserta asteriscos; mantém o texto customizado
UPDATE public.cadence_stage_config
   SET message_text =
       '*Oi, {{nome}}*! Aqui é o *{{consultor}}* da *iGreen* ⚡' || E'\n\n' ||
       'Todo mês a *conta de luz chega*… e muitas pessoas só descobrem depois que estavam *pagando mais* do que precisavam.' || E'\n\n' ||
       'Você chegou a *iniciar sua simulação*, mas não finalizamos.' || E'\n' ||
       '*Vamos continuar* de onde paramos?' || E'\n\n' ||
       '*Me confirma* seu primeiro nome para eu *seguir com o atendimento?* 😊',
       template_version = GREATEST(template_version, 3),
       template_updated_at = now()
 WHERE stage = 'A_NUDGE'
   AND consultant_id IS NOT NULL
   AND (
     message_text LIKE '%estavam*%'
     OR message_text LIKE '%*Vamos continuar *%'
   );

-- RECALL_5M_CALL (override) — Olá duplo / Rafael fixo → canônico
UPDATE public.cadence_stage_config
   SET message_text =
       'Olá, {{nome}}! Tudo bem?' || E'\n\n' ||
       'Eu sou {{assistente}}, assistente virtual de {{consultor}}, da iGreen Energia.' || E'\n\n' ||
       'Faz cerca de cinco meses que conversamos sobre economia na conta de luz. Se ainda fizer sentido, conseguimos retomar sua análise apenas com o valor médio da conta — sem foto e sem burocracia.' || E'\n\n' ||
       'Você prefere continuar pelo WhatsApp ou que eu explique rapidamente agora?' || E'\n\n' ||
       'Se estiver ocupado: Sem problema. Posso deixar tudo organizado no WhatsApp para {{consultor}} retornar quando for melhor para você.',
       template_version = 3,
       template_updated_at = now()
 WHERE stage = 'RECALL_5M_CALL'
   AND consultant_id IS NOT NULL
   AND (
     message_text LIKE '%Olá! Eu sou%'
     OR message_text ILIKE '%fale com o Rafael%'
   );

-- RECALL_8M_CALL (override) — alinha ao global Multicanal
UPDATE public.cadence_stage_config
   SET message_text =
       'Olá, {{nome}}! Tudo bem?' || E'\n\n' ||
       'Eu sou {{assistente}}, assistente virtual de {{consultor}}, da iGreen Energia.' || E'\n\n' ||
       'Faz cerca de oito meses que falamos sobre economia na conta. Sua análise continua disponível com o valor médio.' || E'\n\n' ||
       'Você prefere continuar pelo WhatsApp ou que eu explique agora?',
       template_version = 3,
       template_updated_at = now()
 WHERE stage = 'RECALL_8M_CALL'
   AND consultant_id IS NOT NULL
   AND template_version < 3;
