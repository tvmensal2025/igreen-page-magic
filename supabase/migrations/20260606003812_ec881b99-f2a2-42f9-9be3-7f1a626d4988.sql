DROP TRIGGER IF EXISTS trg_ensure_igreen_connect_code ON public.consultants;
DROP FUNCTION IF EXISTS public.ensure_igreen_connect_code();

ALTER TABLE public.consultants
  DROP COLUMN IF EXISTS igreen_access_token,
  DROP COLUMN IF EXISTS igreen_token_updated_at,
  DROP COLUMN IF EXISTS igreen_token_expires_at,
  DROP COLUMN IF EXISTS igreen_token_expired,
  DROP COLUMN IF EXISTS igreen_connect_code;