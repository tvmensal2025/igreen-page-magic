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
-- Rollback:
--   ALTER TABLE public.facebook_campaigns
--     ALTER COLUMN brain_scale_target_cpl_cents SET DEFAULT 200;
--   -- O UPDATE abaixo não é revertido automaticamente: guarde o snapshot de
--   -- (id, brain_scale_target_cpl_cents) antes de rodar, se quiser voltar.

ALTER TABLE public.facebook_campaigns
  ALTER COLUMN brain_scale_target_cpl_cents SET DEFAULT 750;

-- Só as linhas que nunca foram tocadas (valor exatamente igual ao DEFAULT
-- antigo). Quem digitou outro valor na tela permanece como está.
UPDATE public.facebook_campaigns
   SET brain_scale_target_cpl_cents = 750
 WHERE brain_scale_target_cpl_cents = 200;

COMMENT ON COLUMN public.facebook_campaigns.brain_scale_target_cpl_cents IS
  'CPL-alvo em centavos para o Cérebro por campanha. Fonte única de resolução: _shared/brain-policy.ts (resolveTargetCplCents). Default oficial 750 (R$ 7,50).';
