
ALTER TABLE public.consultants
  ADD COLUMN IF NOT EXISTS igreen_access_token text,
  ADD COLUMN IF NOT EXISTS igreen_token_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS igreen_token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS igreen_token_expired boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS igreen_consultor_id text,
  ADD COLUMN IF NOT EXISTS igreen_connect_code text;

UPDATE public.consultants
   SET igreen_connect_code = substr(md5(random()::text || id::text || clock_timestamp()::text), 1, 10)
 WHERE igreen_connect_code IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS consultants_igreen_connect_code_key
  ON public.consultants(igreen_connect_code)
  WHERE igreen_connect_code IS NOT NULL;

CREATE OR REPLACE FUNCTION public.ensure_igreen_connect_code()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.igreen_connect_code IS NULL OR NEW.igreen_connect_code = '' THEN
    NEW.igreen_connect_code := substr(md5(random()::text || COALESCE(NEW.id::text, '') || clock_timestamp()::text), 1, 10);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ensure_igreen_connect_code ON public.consultants;
CREATE TRIGGER trg_ensure_igreen_connect_code
  BEFORE INSERT ON public.consultants
  FOR EACH ROW EXECUTE FUNCTION public.ensure_igreen_connect_code();
