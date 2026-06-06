-- Remove a permissão de LEITURA das colunas sensíveis para usuários logados e anônimos.
-- INSERT/UPDATE seguem permitidos (usuário pode escrever/atualizar a senha e o token),
-- mas não pode mais ler o valor salvo. service_role mantém acesso total.

REVOKE SELECT (igreen_portal_password, igreen_access_token) ON public.consultants FROM authenticated;
REVOKE SELECT (igreen_portal_password, igreen_access_token) ON public.consultants FROM anon;

-- Garantir que escrita continua funcionando para o dono (controlado por RLS existente).
GRANT INSERT (igreen_portal_password, igreen_access_token) ON public.consultants TO authenticated;
GRANT UPDATE (igreen_portal_password, igreen_access_token) ON public.consultants TO authenticated;