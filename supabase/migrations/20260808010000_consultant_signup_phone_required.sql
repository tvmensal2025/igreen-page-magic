-- Cadastro de consultor NÃO pode nascer sem WhatsApp válido.
-- Causa raiz (Abel/Olímpia 2026-08-07): trigger auth.users criava stub phone=''
-- (desligado em 20260808011000). Este cadeado impede qualquer INSERT incompleto.

CREATE OR REPLACE FUNCTION public.enforce_consultant_insert_complete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  digits text;
BEGIN
  digits := regexp_replace(COALESCE(NEW.phone, ''), '\D', '', 'g');
  IF NEW.name IS NULL OR btrim(NEW.name) = '' THEN
    RAISE EXCEPTION 'consultant name required on insert'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.license IS NULL OR btrim(NEW.license) = '' THEN
    RAISE EXCEPTION 'consultant license required on insert'
      USING ERRCODE = 'check_violation';
  END IF;
  IF length(digits) < 10 OR length(digits) > 13 THEN
    RAISE EXCEPTION 'consultant phone required on insert (WhatsApp with DDD)'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.phone := digits;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_consultant_insert_complete ON public.consultants;
CREATE TRIGGER trg_enforce_consultant_insert_complete
  BEFORE INSERT ON public.consultants
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_consultant_insert_complete();

COMMENT ON FUNCTION public.enforce_consultant_insert_complete() IS
  'Impede INSERT de consultants sem nome/license/WhatsApp (10–13 dígitos). Não altera UPDATE — dados legados vazios se corrigem na UI.';

-- Policy anon: exige telefone não vazio (além dos flags já travados).
DROP POLICY IF EXISTS "Anon signup can create pending consultant" ON public.consultants;
CREATE POLICY "Anon signup can create pending consultant"
ON public.consultants
FOR INSERT
TO anon
WITH CHECK (
  id IS NOT NULL
  AND name IS NOT NULL AND btrim(name) <> ''
  AND license IS NOT NULL AND btrim(license) <> ''
  AND phone IS NOT NULL AND length(regexp_replace(phone, '\D', '', 'g')) BETWEEN 10 AND 13
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
