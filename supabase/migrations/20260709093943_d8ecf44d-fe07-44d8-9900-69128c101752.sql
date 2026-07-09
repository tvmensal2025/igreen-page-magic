
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS tracking_protocol text;
CREATE INDEX IF NOT EXISTS customers_tracking_protocol_idx ON public.customers(tracking_protocol);

CREATE TABLE IF NOT EXISTS public.partner_protocol_seq (
  partner_id uuid NOT NULL,
  date_ymd date NOT NULL,
  seq integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (partner_id, date_ymd)
);

GRANT ALL ON public.partner_protocol_seq TO service_role;

ALTER TABLE public.partner_protocol_seq ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role manages partner_protocol_seq"
  ON public.partner_protocol_seq
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.generate_partner_protocol(_partner_id uuid, _initials text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  _seq int;
  _yymmdd text := to_char(_today, 'YYMMDD');
  _ini text := upper(coalesce(NULLIF(regexp_replace(_initials, '[^A-Za-z]', '', 'g'), ''), 'IGR'));
BEGIN
  _ini := left(_ini, 3);
  IF length(_ini) < 3 THEN
    _ini := rpad(_ini, 3, 'X');
  END IF;

  INSERT INTO public.partner_protocol_seq(partner_id, date_ymd, seq, updated_at)
  VALUES (_partner_id, _today, 1, now())
  ON CONFLICT (partner_id, date_ymd)
  DO UPDATE SET seq = public.partner_protocol_seq.seq + 1, updated_at = now()
  RETURNING seq INTO _seq;

  RETURN _ini || '-' || _yymmdd || '-' || lpad(_seq::text, 4, '0');
END;
$$;

REVOKE ALL ON FUNCTION public.generate_partner_protocol(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_partner_protocol(uuid, text) TO service_role;
