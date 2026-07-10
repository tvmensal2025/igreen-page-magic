-- ID iGreen opcional na ficha de captura.
-- Vazio  → cadastro usa o consultor responsável da página (dono / parceiro cli).
-- Preenchido → sobrescreve o idconsultor no Portal 2.
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS portal_idconsultor_override bigint NULL;

COMMENT ON COLUMN public.customers.portal_idconsultor_override IS
  'Se preenchido, sobrescreve idconsultor no POST Portal 2. NULL = usa consultor da página/parceiro.';
