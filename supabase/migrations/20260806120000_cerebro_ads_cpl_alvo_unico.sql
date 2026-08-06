-- Cérebro de Campanhas — CPL-alvo único (R$ 7,50).
--
-- PROPOSTA ADITIVA — NÃO EXECUTADA nesta branch.
--
-- Contexto: `facebook_campaigns.brain_scale_target_cpl_cents` nasceu com
-- DEFAULT 200 (R$ 2,00) na migration 20260723044000. Com o mercado real em
-- R$ 7–12 por conversa, esse alvo mantém a escala travada no piso da Meta e
-- pinta toda campanha de vermelho na leitura de saúde. A política oficial
-- (`docs/CEREBRO-ADS-OFICIAL.md` §5.2) é 750.
--
-- O código já não depende desta migration: `resolveTargetCplCents(raw,
-- "campaign_column")` em `_shared/brain-policy.ts` trata o legado 200 como
-- "não configurado". Esta migration só alinha o banco à mesma fonte.
--
-- Só o DEFAULT futuro muda. Nenhuma linha existente é sobrescrita: não há como
-- distinguir "herdou o DEFAULT 200" de "alguém digitou R$ 2,00 na tela", e
-- reescrever o alvo de quem escolheu o valor seria mudar a régua da campanha
-- alheia sem pedido. O resolvedor no código já neutraliza o legado em runtime.
--
-- Rollback (reverte tudo, sem perda de dado):
--   ALTER TABLE public.facebook_campaigns
--     ALTER COLUMN brain_scale_target_cpl_cents SET DEFAULT 200;

ALTER TABLE public.facebook_campaigns
  ALTER COLUMN brain_scale_target_cpl_cents SET DEFAULT 750;

-- Diagnóstico para revisão manual — rode ANTES de decidir qualquer correção de
-- dado. Quem aparecer aqui continua com o alvo antigo no banco e é tratado
-- como "não configurado" por resolveTargetCplCents(raw, "campaign_column").
--
--   SELECT c.consultant_id,
--          c.id,
--          c.name,
--          c.status,
--          c.brain_scale_target_cpl_cents,
--          c.brain_scale_enabled,
--          c.updated_at
--     FROM public.facebook_campaigns c
--    WHERE c.brain_scale_target_cpl_cents = 200
--    ORDER BY c.brain_scale_enabled DESC, c.updated_at DESC;

COMMENT ON COLUMN public.facebook_campaigns.brain_scale_target_cpl_cents IS
  'CPL-alvo em centavos para o Cérebro por campanha. Fonte única de resolução: _shared/brain-policy.ts (resolveTargetCplCents). Default oficial 750 (R$ 7,50).';
