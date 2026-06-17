CREATE OR REPLACE FUNCTION public.gen_partner_short_code(p_len integer DEFAULT 6)
RETURNS text
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_code text := '';
  i integer;
  v_digit integer;
BEGIN
  IF p_len IS NULL OR p_len < 4 THEN
    p_len := 6;
  END IF;

  v_code := (1 + floor(random() * 9)::integer)::text;

  FOR i IN 2 .. p_len LOOP
    v_digit := floor(random() * 10)::integer;
    v_code := v_code || v_digit::text;
  END LOOP;

  RETURN v_code;
END;
$$;

CREATE OR REPLACE FUNCTION public.referral_partner_set_short_code()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_candidate text;
  v_tries integer := 0;
BEGIN
  IF NEW.short_code IS NOT NULL AND btrim(NEW.short_code) <> '' THEN
    NEW.short_code := btrim(NEW.short_code);
    RETURN NEW;
  END IF;

  LOOP
    v_candidate := public.gen_partner_short_code(6);
    v_tries := v_tries + 1;

    IF NOT EXISTS (
      SELECT 1
      FROM public.referral_partners
      WHERE consultant_id = NEW.consultant_id
        AND short_code = v_candidate
    ) THEN
      NEW.short_code := v_candidate;
      RETURN NEW;
    END IF;

    IF v_tries >= 50 THEN
      NEW.short_code := (100000 + (mod(hashtextextended(NEW.id::text || clock_timestamp()::text, 0), 900000)::bigint + 900000)::bigint % 900000)::text;
      RETURN NEW;
    END IF;
  END LOOP;
END;
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.referral_partners TO authenticated;
GRANT ALL ON public.referral_partners TO service_role;
GRANT EXECUTE ON FUNCTION public.get_referral_partner_metrics() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_referral_partner_analytics() TO authenticated;
GRANT EXECUTE ON FUNCTION public.gen_partner_short_code(integer) TO authenticated, service_role;