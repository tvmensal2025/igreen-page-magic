-- ============================================================================
-- Flag de controle do teste A/B Fluxo A × Fluxo D
-- ============================================================================
-- settings.flow_ab_mode controla qual fluxo cada LEAD NOVO recebe:
--   'split'  → 50/50 aleatório por lead (default)
--   'only_A' → todo lead novo entra no Fluxo A (áudio/texto, Rafael)
--   'only_D' → todo lead novo entra no Fluxo D (botões)
--
-- Lido por _shared/pick-flow-variant.ts no whapi-webhook ao criar o lead.
-- Editável pelo painel /admin/fluxos (componente FlowAbControl).
-- Idempotente: não sobrescreve um valor já configurado.

INSERT INTO public.settings (key, value)
VALUES ('flow_ab_mode', 'split')
ON CONFLICT (key) DO NOTHING;
