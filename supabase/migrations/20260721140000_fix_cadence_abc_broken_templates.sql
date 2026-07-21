-- ============================================================================
-- Corrige templates quebrados da cadência A/B/C em cadence_stage_config.
--
-- Achados (auditoria 2026-07-21):
--   Grupo A  — OK (A_NUDGE / A_SMS / A_CALL / A_CALL_RETRY)
--   Grupo B  — COLD_1 negrito quebrado (p*ossibilidade*, 💡* Oi…);
--              COLD_3 urgência falsa ("Última semana");
--              SMS_1 markdown quebrado (quer* economizar…*);
--              SMS_2 "ultima chance"
--   Grupo C  — RECALL_*_CALL: marco errado, texto duplicado, "Você vamos", Olá duplo
--
-- Fonte de verdade: textos do Multicanal (src/lib/multichannelCadenceTexts.ts)
-- mapeados em syncCadenceToBotFlow (b1_wa_reopen→COLD_1, etc.).
-- Atualiza global E overrides de consultor que ainda carregam o texto ruim.
-- Não apaga registros. template_version = 3.
-- ============================================================================

-- ── COLD_1 (b1_wa_reopen) — negrito + alinhado aos botões de faixa ──────────
UPDATE public.cadence_stage_config
   SET message_text =
       'Olá, *{{nome}}*! 👋' || E'\n\n' ||
       'Aqui é *{{consultor}}*, da *iGreen*.' || E'\n\n' ||
       'Você já demonstrou interesse em *reduzir sua conta de luz* — e agora temos uma novidade:' || E'\n\n' ||
       '✅ Conseguimos iniciar sua análise *apenas com o valor médio da conta*. Sem foto, sem burocracia.' || E'\n\n' ||
       '{{frase_disponibilidade}}' || E'\n\n' ||
       '*Em qual faixa está sua conta hoje?*' || E'\n\n' ||
       '_Para não receber mais contatos, responda SAIR._',
       template_version = 3,
       template_updated_at = now()
 WHERE stage = 'COLD_1'
   AND (
     message_text LIKE '%p*ossibilidade%'
     OR message_text LIKE '%💡*%'
     OR message_text LIKE '%Passando por aqui%'
   );

-- ── COLD_3 (b_day7_wa_easy) — sem urgência falsa; pergunta faixa ────────────
UPDATE public.cadence_stage_config
   SET message_text =
       'Olá, *{{nome}}*! 👋' || E'\n\n' ||
       'Sem mensagem longa, sem foto: pra checar seu caso *basta 1 toque*.' || E'\n\n' ||
       '*Qual faixa está sua conta hoje?*',
       template_version = 3,
       template_updated_at = now()
 WHERE stage = 'COLD_3'
   AND message_text ILIKE '%Última semana%';

-- ── SMS_1 (b3_sms_1) — sem markdown quebrado ────────────────────────────────
UPDATE public.cadence_stage_config
   SET message_text =
       '{{consultor}} | iGreen: Oi {{nome}}! Reabri sua analise. Abra: https://wa.me/{{consultor_phone}} SAIR encerra.',
       template_version = 3,
       template_updated_at = now()
 WHERE stage = 'SMS_1'
   AND (
     message_text LIKE '%quer*%'
     OR message_text LIKE '%*iGreen Energy*%'
     OR message_text LIKE 'Ola {{nome}}, aqui e a %'
   );

-- ── SMS_2 (b_day6_sms_2) — sem "ultima chance" ──────────────────────────────
UPDATE public.cadence_stage_config
   SET message_text =
       '{{consultor}} | iGreen: Oi {{nome}}! Novidades e beneficios extras. Abra: https://wa.me/{{consultor_phone}} SAIR encerra.',
       template_version = 3,
       template_updated_at = now()
 WHERE stage = 'SMS_2'
   AND message_text ILIKE '%ultima chance%';

-- ── RECALL_60D_CALL — marco ~1 mês (não "oito meses") ───────────────────────
UPDATE public.cadence_stage_config
   SET message_text =
       'Olá, {{nome}}! Tudo bem?' || E'\n\n' ||
       'Eu sou {{assistente}}, assistente virtual de {{consultor}}, da iGreen Energia.' || E'\n\n' ||
       'Faz cerca de um mês que falamos sobre economia na conta de luz. Sua análise continua disponível — só com o valor médio da conta, sem foto.' || E'\n\n' ||
       'Você prefere continuar pelo WhatsApp ou que eu explique rapidamente agora?',
       template_version = 3,
       template_updated_at = now()
 WHERE stage = 'RECALL_60D_CALL'
   AND message_text ILIKE '%oito meses%';

-- ── RECALL_5M_CALL — remove "Olá" duplicado ─────────────────────────────────
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
   AND message_text LIKE '%Olá, {{nome}}.%'
   AND message_text LIKE '%Olá! Eu sou%';

-- ── RECALL_8M_CALL — remove texto duplicado / [Tom tranquilo] ───────────────
UPDATE public.cadence_stage_config
   SET message_text =
       'Olá, {{nome}}! Tudo bem?' || E'\n\n' ||
       'Eu sou {{assistente}}, assistente virtual de {{consultor}}, da iGreen Energia.' || E'\n\n' ||
       'Faz cerca de oito meses que falamos sobre economia na conta. Sua análise continua disponível com o valor médio.' || E'\n\n' ||
       'Você prefere continuar pelo WhatsApp ou que eu explique agora?',
       template_version = 3,
       template_updated_at = now()
 WHERE stage = 'RECALL_8M_CALL'
   AND (
     message_text LIKE '%[Tom tranquilo]%'
     OR (message_text LIKE '%Eu sou {{assistente}}%' AND length(message_text) > 500)
   );

-- ── RECALL_12M_CALL — "Você vamos" → texto limpo ────────────────────────────
UPDATE public.cadence_stage_config
   SET message_text =
       'Olá, {{nome}}! Tudo bem?' || E'\n\n' ||
       'Eu sou {{assistente}}, assistente virtual de {{consultor}}, da iGreen Energia.' || E'\n\n' ||
       'Faz cerca de um ano que conversamos sobre economia na conta de luz. Se ainda fizer sentido, retomamos sua análise só com o valor médio.' || E'\n\n' ||
       'Você prefere continuar pelo WhatsApp ou que eu explique agora?',
       template_version = 3,
       template_updated_at = now()
 WHERE stage = 'RECALL_12M_CALL'
   AND message_text ILIKE '%Você vamos%';

-- ── RECALL_YEARLY_CALL — "Você vamos" → texto limpo ─────────────────────────
UPDATE public.cadence_stage_config
   SET message_text =
       'Olá, {{nome}}! Tudo bem?' || E'\n\n' ||
       'Eu sou {{assistente}}, assistente virtual de {{consultor}}, da iGreen Energia.' || E'\n\n' ||
       'Este é o lembrete anual sobre economia na conta de luz. Sua análise continua disponível com o valor médio da conta.' || E'\n\n' ||
       'Você prefere continuar pelo WhatsApp ou que eu explique agora?',
       template_version = 3,
       template_updated_at = now()
 WHERE stage = 'RECALL_YEARLY_CALL'
   AND message_text ILIKE '%Você vamos%';

-- ── RECALL_60D WA — ponto duplo residual ─────────────────────────────────────
UPDATE public.cadence_stage_config
   SET message_text = replace(message_text, 'da sua conta*. .', 'da sua conta*.'),
       template_version = GREATEST(template_version, 3),
       template_updated_at = now()
 WHERE stage = 'RECALL_60D'
   AND message_text LIKE '%da sua conta*. .%';
