-- ============================================================================
-- Onda 7 — Correção de templates da cadência (PLANO seção 10).
-- Aditiva e versionada: adiciona template_version/template_updated_at e
-- atualiza SOMENTE os templates globais (consultant_id IS NULL).
--   - COLD_1: formatação de negrito quebrada ("p*ossibilidade*", "* Oi {{nome}}*")
--   - COLD_3: remove urgência artificial "Última semana"
--   - SMS_1: remove markdown (*...*) — SMS não renderiza WhatsApp markdown
--   - RECALL_60D_CALL: dizia "oito meses" num marco de ~60 dias
--   - RECALL_8M_CALL: texto duplicado/corrompido ("[Tom tranquilo]...")
--   - RECALL_12M_CALL / RECALL_YEARLY_CALL: "Você vamos continuar" (gramática)
--   - Identidade fixa "Rafael" → {{consultor}} dinâmico (WA e SMS)
-- Rollback lógico: versões anteriores ficam em template_version=1 no histórico
-- do git; nenhum registro é apagado.
-- ============================================================================

ALTER TABLE public.cadence_stage_config
  ADD COLUMN IF NOT EXISTS template_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS template_updated_at timestamptz;

-- ── COLD_1 (WhatsApp — formatação + identidade dinâmica) ────────────────────
UPDATE public.cadence_stage_config
   SET message_text = '💡 Oi *{{nome}}*! Tudo bem? 😊' || E'\n\n' ||
       'Aqui é *{{consultor}}*, da *iGreen*. Ainda pode existir uma *possibilidade de reduzir o valor da sua conta de energia* 📉.' || E'\n\n' ||
       'Para verificar, preciso apenas de uma informação: *qual foi o valor da sua última conta de luz?* 💡',
       template_version = 2,
       template_updated_at = now()
 WHERE consultant_id IS NULL AND stage = 'COLD_1';

-- ── COLD_3 (WhatsApp — sem urgência falsa) ──────────────────────────────────
UPDATE public.cadence_stage_config
   SET message_text = 'Oi {{nome}}! Aqui é *{{consultor}}*, da *iGreen*. 😊' || E'\n\n' ||
       'Sua *análise de economia* segue disponível — leva só 2 minutos.' || E'\n\n' ||
       'Me diga a *faixa da sua conta* ou envie a *foto da conta de luz* 📸 que eu calculo agora.',
       template_version = 2,
       template_updated_at = now()
 WHERE consultant_id IS NULL AND stage = 'COLD_3';

-- ── SMS_1 (sem markdown; identidade dinâmica) ───────────────────────────────
UPDATE public.cadence_stage_config
   SET message_text = 'Ola {{nome}}, aqui e {{consultor}} da iGreen Energy. Ainda quer economizar na conta de luz? Responda pelo WhatsApp: https://wa.me/{{consultor_phone}}',
       template_version = 2,
       template_updated_at = now()
 WHERE consultant_id IS NULL AND stage = 'SMS_1';

-- ── SMS_2 (sem markdown; tom sem falsa urgência) ────────────────────────────
UPDATE public.cadence_stage_config
   SET message_text = '{{nome}}, sua reducao na conta de luz segue disponivel, sem obra e sem instalacao. Fale conosco: https://wa.me/{{consultor_phone}}',
       template_version = 2,
       template_updated_at = now()
 WHERE consultant_id IS NULL AND stage = 'SMS_2';

-- ── RECALL_60D_CALL (dizia "oito meses" no marco de ~2 meses) ───────────────
UPDATE public.cadence_stage_config
   SET message_text = 'Olá, {{nome}}.' || E'\n\n' ||
       'Eu sou a Sofia, assistente virtual da iGreen.' || E'\n\n' ||
       'Há cerca de dois meses, você buscou informações para reduzir sua conta de luz, mas a análise não foi concluída.' || E'\n\n' ||
       'Enquanto isso, sua conta continua chegando no valor de sempre. Confira a mensagem que enviamos no seu WhatsApp para retomar — é rápido e sem custo.',
       template_version = 2,
       template_updated_at = now()
 WHERE consultant_id IS NULL AND stage = 'RECALL_60D_CALL';

-- ── RECALL_8M_CALL (texto corrompido/duplicado) ─────────────────────────────
UPDATE public.cadence_stage_config
   SET message_text = 'Olá, {{nome}}.' || E'\n\n' ||
       'Eu sou a Sofia, assistente virtual da iGreen.' || E'\n\n' ||
       'Faz cerca de oito meses que falamos sobre economia na conta de luz. Sua análise continua disponível — retomamos apenas com o valor médio da conta.' || E'\n\n' ||
       'Confira a mensagem no seu WhatsApp para continuar.',
       template_version = 2,
       template_updated_at = now()
 WHERE consultant_id IS NULL AND stage = 'RECALL_8M_CALL';

-- ── RECALL_12M_CALL / RECALL_YEARLY_CALL ("Você vamos continuar") ───────────
UPDATE public.cadence_stage_config
   SET message_text = 'Olá, {{nome}}.' || E'\n\n' ||
       'Eu sou a Sofia, assistente virtual da iGreen.' || E'\n\n' ||
       'Faz cerca de um ano que conversamos sobre economia na conta de luz. Se ainda fizer sentido, retomamos sua análise apenas com o valor médio.' || E'\n\n' ||
       'Vamos continuar pelo WhatsApp — confira a mensagem que enviamos.',
       template_version = 2,
       template_updated_at = now()
 WHERE consultant_id IS NULL AND stage = 'RECALL_12M_CALL';

UPDATE public.cadence_stage_config
   SET message_text = 'Olá, {{nome}}.' || E'\n\n' ||
       'Eu sou a Sofia, assistente virtual da iGreen.' || E'\n\n' ||
       'Este é o lembrete anual sobre economia na conta de luz. Sua análise continua disponível apenas com o valor médio da conta.' || E'\n\n' ||
       'Vamos continuar pelo WhatsApp — confira a mensagem que enviamos.',
       template_version = 2,
       template_updated_at = now()
 WHERE consultant_id IS NULL AND stage = 'RECALL_YEARLY_CALL';

-- ── Identidade dinâmica nos RECALL de WhatsApp (Rafael fixo → {{consultor}}) ─
UPDATE public.cadence_stage_config
   SET message_text = replace(replace(message_text,
         'Aqui é o *Rafael Ferreira Dias*', 'Aqui é *{{consultor}}*'),
         'Aqui é o *Rafael*', 'Aqui é *{{consultor}}*'),
       template_version = GREATEST(template_version, 2),
       template_updated_at = now()
 WHERE consultant_id IS NULL
   AND stage IN ('RECALL_60D','RECALL_90D','RECALL_5M','RECALL_8M','RECALL_12M','RECALL_YEARLY')
   AND (message_text LIKE '%Rafael Ferreira Dias%' OR message_text LIKE '%Aqui é o *Rafael*%');

-- ── Identidade dinâmica nos SMS de RECALL ("Rafael | iGreen:") ──────────────
UPDATE public.cadence_stage_config
   SET message_text = replace(message_text, 'Rafael | iGreen:', '{{consultor}} | iGreen:'),
       template_version = GREATEST(template_version, 2),
       template_updated_at = now()
 WHERE consultant_id IS NULL
   AND stage IN ('RECALL_60D_SMS','RECALL_90D_SMS','RECALL_5M_SMS','RECALL_8M_SMS','RECALL_12M_SMS','RECALL_YEARLY_SMS')
   AND message_text LIKE 'Rafael | iGreen:%';

-- ── RECALL_5M_CALL ("Olá" duplicado + Rafael fixo) ──────────────────────────
UPDATE public.cadence_stage_config
   SET message_text = 'Olá, {{nome}}.' || E'\n\n' ||
       'Eu sou a Sofia, assistente virtual da iGreen.' || E'\n\n' ||
       'Há cerca de cinco meses, você demonstrou interesse em economizar na conta de luz, mas sua análise não foi concluída.' || E'\n\n' ||
       'Se ainda fizer sentido, podemos retomar agora usando apenas o valor médio da conta. Acesse nossa mensagem no WhatsApp para continuar.',
       template_version = 2,
       template_updated_at = now()
 WHERE consultant_id IS NULL AND stage = 'RECALL_5M_CALL';

-- ── Varredura final: remove QUALQUER menção fixa ao "Rafael" nos roteiros ───
-- (ligações usam áudio Sofia; o texto é roteiro institucional neutro)
UPDATE public.cadence_stage_config
   SET message_text = replace(replace(replace(replace(replace(replace(replace(message_text,
         'assistente virtual do Rafael, gestor da iGreen', 'assistente virtual da iGreen'),
         'assistente virtual do Rafael, Gestor da iGreen', 'assistente virtual da iGreen'),
         'assistente virtual do Rafael, da iGreen Energia', 'assistente virtual da iGreen'),
         'assistente virtual do Rafael, da iGreen', 'assistente virtual da iGreen'),
         'O Rafael e a equipe estão aguardando', 'Nossa equipe está aguardando'),
         'manter sua análise disponível com o Rafael', 'manter sua análise disponível com nosso consultor'),
         'fale com o Rafael', 'fale com nosso consultor'),
       template_version = GREATEST(template_version, 2),
       template_updated_at = now()
 WHERE consultant_id IS NULL
   AND (message_text LIKE '%do Rafael%' OR message_text LIKE '%o Rafael%');

COMMENT ON COLUMN public.cadence_stage_config.template_version IS
  'Versão do conteúdo do template (auditoria de alterações — Onda 7).';
