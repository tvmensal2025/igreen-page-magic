CREATE OR REPLACE FUNCTION public.enforce_consultant_id_is_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Somente valida inserts anônimos (LP /auth). service_role e authenticated seguem normais.
  IF current_setting('role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF auth.uid() IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.id IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = NEW.id) THEN
    RAISE EXCEPTION 'consultant id must match an existing auth user';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_consultant_id_is_auth_user ON public.consultants;
CREATE TRIGGER trg_enforce_consultant_id_is_auth_user
BEFORE INSERT ON public.consultants
FOR EACH ROW EXECUTE FUNCTION public.enforce_consultant_id_is_auth_user();