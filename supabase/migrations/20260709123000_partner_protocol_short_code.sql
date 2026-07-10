-- Protocolo do parceiro passa a começar pela chave estável short_code.
-- Formato: {short_code}-{YYMMDD}-{seq4}  ex.: 481070-260709-0001
-- Fallback (sem short_code): iniciais de 3 letras como antes.

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
  _key text;
  _partner_short text;
  _ini text;
BEGIN
  -- Preferência: short_code do parceiro (chave única, nunca ambígua)
  SELECT NULLIF(regexp_replace(coalesce(short_code, ''), '[^0-9A-Za-z]', '', 'g'), '')
    INTO _partner_short
  FROM public.referral_partners
  WHERE id = _partner_id;

  IF _partner_short IS NOT NULL AND length(_partner_short) >= 3 THEN
    _key := upper(_partner_short);
  ELSE
    -- Fallback: iniciais (legado)
    _ini := upper(coalesce(NULLIF(regexp_replace(coalesce(_initials, ''), '[^A-Za-z]', '', 'g'), ''), 'IGR'));
    _ini := left(_ini, 3);
    IF length(_ini) < 3 THEN
      _ini := rpad(_ini, 3, 'X');
    END IF;
    _key := _ini;
  END IF;

  INSERT INTO public.partner_protocol_seq(partner_id, date_ymd, seq, updated_at)
  VALUES (_partner_id, _today, 1, now())
  ON CONFLICT (partner_id, date_ymd)
  DO UPDATE SET seq = public.partner_protocol_seq.seq + 1, updated_at = now()
  RETURNING seq INTO _seq;

  RETURN _key || '-' || _yymmdd || '-' || lpad(_seq::text, 4, '0');
END;
$$;

COMMENT ON FUNCTION public.generate_partner_protocol(uuid, text) IS
  'Gera protocolo de atendimento: {short_code}-{YYMMDD}-{seq}. Fallback para 3 iniciais se parceiro sem short_code.';

REVOKE ALL ON FUNCTION public.generate_partner_protocol(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_partner_protocol(uuid, text) TO service_role;
