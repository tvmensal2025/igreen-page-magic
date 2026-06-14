-- Códigos iGreen extras para classificar cliente direto (CP).
-- Ex.: consultor 122160 cadastra clientes com código 124170 no portal.
ALTER TABLE public.consultant_commission_settings
  ADD COLUMN IF NOT EXISTS cadastro_igreen_ids text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.consultant_commission_settings.cadastro_igreen_ids IS
  'IDs iGreen adicionais que contam como cadastro próprio (CP), além do consultants.igreen_id.';
