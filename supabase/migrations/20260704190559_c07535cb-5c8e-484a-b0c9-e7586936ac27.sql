-- Corrige permissões excessivas antigas do anon na tabela de consultores.
-- Visitante não deve alterar nem apagar consultores diretamente.
REVOKE UPDATE, DELETE ON public.consultants FROM anon;

-- Garante que o cadastro público consiga enviar somente os campos mínimos
-- que o formulário de criação de conta usa. O campo approved é permitido
-- apenas para aceitar explicitamente false; a policy abaixo bloqueia true.
GRANT INSERT (id, name, license, phone, cadastro_url, igreen_id, approved)
ON public.consultants TO anon;

-- Policy restrita para cadastro público: cria apenas consultor pendente,
-- com dados básicos e sem campos sensíveis/administrativos.
DROP POLICY IF EXISTS "Anon signup can create pending consultant" ON public.consultants;
CREATE POLICY "Anon signup can create pending consultant"
ON public.consultants
FOR INSERT
TO anon
WITH CHECK (
  id IS NOT NULL
  AND name IS NOT NULL AND btrim(name) <> ''
  AND license IS NOT NULL AND btrim(license) <> ''
  AND phone IS NOT NULL AND btrim(phone) <> ''
  AND cadastro_url IS NOT NULL AND btrim(cadastro_url) <> ''
  AND approved IS NOT TRUE
  AND igreen_portal_email IS NULL
  AND igreen_portal_password IS NULL
  AND igreen_credential_status IS NULL
  AND igreen_credential_checked_at IS NULL
  AND igreen_credential_error IS NULL
  AND notification_phone IS NULL
  AND facebook_label_id IS NULL
  AND conversational_flow_enabled = false
  AND ab_test_enabled = false
  AND ab_test_counter = 0
  AND flow_reliability_v2 = 'off'
  AND flow_engine_v3 = 'off'
  AND use_engine_v3 = false
  AND bot_engine_mode = 'legacy'
  AND solar_3d_enabled = false
  AND solar_public_widget_enabled = false
);

-- Evita 401 no RPC público usado pelo hardening do front-end.
GRANT EXECUTE ON FUNCTION public.get_devtools_blocked() TO anon, authenticated;