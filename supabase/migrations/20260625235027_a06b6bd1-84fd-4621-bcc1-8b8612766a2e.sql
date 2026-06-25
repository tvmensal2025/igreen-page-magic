
ALTER TABLE public.consultants
  ADD COLUMN IF NOT EXISTS phone_verified_at timestamptz;

CREATE TABLE IF NOT EXISTS public.outbound_blocked_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id uuid NOT NULL,
  instance_name text,
  reason text NOT NULL,
  context jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.outbound_blocked_log TO authenticated;
GRANT ALL ON public.outbound_blocked_log TO service_role;

ALTER TABLE public.outbound_blocked_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read blocked log" ON public.outbound_blocked_log;
CREATE POLICY "Admins read blocked log" ON public.outbound_blocked_log
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Owner reads own blocked log" ON public.outbound_blocked_log;
CREATE POLICY "Owner reads own blocked log" ON public.outbound_blocked_log
  FOR SELECT TO authenticated
  USING (consultant_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_outbound_blocked_log_consultant_created
  ON public.outbound_blocked_log (consultant_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.check_consultant_phone_match(_consultant_id uuid)
RETURNS TABLE (matched boolean, consultant_phone text, connected_phone text, verified_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_phone text;
  i_phone text;
  is_match boolean := false;
  v_now timestamptz := now();
BEGIN
  SELECT regexp_replace(coalesce(phone, ''), '\D', '', 'g')
    INTO c_phone
    FROM public.consultants
    WHERE id = _consultant_id;

  SELECT regexp_replace(coalesce(connected_phone, ''), '\D', '', 'g')
    INTO i_phone
    FROM public.whatsapp_instances
    WHERE consultant_id = _consultant_id
      AND connected_phone IS NOT NULL
    ORDER BY updated_at DESC NULLS LAST
    LIMIT 1;

  IF c_phone IS NOT NULL AND c_phone <> '' AND i_phone IS NOT NULL AND i_phone <> '' THEN
    is_match := right(c_phone, 11) = right(i_phone, 11);
  END IF;

  IF is_match THEN
    UPDATE public.consultants
       SET phone_verified_at = v_now
     WHERE id = _consultant_id;
  END IF;

  RETURN QUERY SELECT is_match, c_phone, i_phone,
    CASE WHEN is_match THEN v_now ELSE (SELECT phone_verified_at FROM public.consultants WHERE id = _consultant_id) END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_consultant_phone_match(uuid) TO authenticated, service_role;
