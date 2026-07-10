
ALTER TABLE public.referral_partners
  ADD COLUMN IF NOT EXISTS protocol_seq int NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.generate_partner_protocol_v2(
  _partner_id uuid,
  _initials text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seq int;
  v_ini text;
  v_short text;
BEGIN
  -- 1) prioriza short_code do parceiro, senão usa _initials passado
  SELECT NULLIF(regexp_replace(upper(coalesce(short_code, '')), '[^A-Z0-9]', '', 'g'), '')
    INTO v_short
  FROM public.referral_partners
  WHERE id = _partner_id;

  v_ini := coalesce(v_short, regexp_replace(upper(coalesce(_initials, '')), '[^A-Z0-9]', '', 'g'));
  v_ini := coalesce(nullif(v_ini, ''), 'IGR');
  -- exatamente 3 chars: trunca ou pad com X
  IF length(v_ini) > 3 THEN v_ini := substring(v_ini from 1 for 3); END IF;
  IF length(v_ini) < 3 THEN v_ini := rpad(v_ini, 3, 'X'); END IF;

  -- 2) incrementa sequência global do parceiro (linha travada durante o update)
  UPDATE public.referral_partners
     SET protocol_seq = protocol_seq + 1
   WHERE id = _partner_id
  RETURNING protocol_seq INTO v_seq;

  IF v_seq IS NULL THEN
    -- parceiro não encontrado (bucket = consultor ou customer): usa random seguro
    v_seq := (floor(random() * 9000) + 1000)::int;
  END IF;

  RETURN 'IGR-' || v_ini || '-' || lpad(v_seq::text, 4, '0');
END;
$$;

REVOKE ALL ON FUNCTION public.generate_partner_protocol_v2(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_partner_protocol_v2(uuid, text) TO authenticated, service_role;
