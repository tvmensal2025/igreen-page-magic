
-- Novo formato de protocolo: YYYY-#### (por campanha) + sufixo -A/-B (por instância no rodízio)

-- 1) Sequência anual atômica
CREATE TABLE IF NOT EXISTS public.campaign_protocol_sequence (
  year int PRIMARY KEY,
  last_seq int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.campaign_protocol_sequence TO authenticated;
GRANT ALL ON public.campaign_protocol_sequence TO service_role;

ALTER TABLE public.campaign_protocol_sequence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "protocol_seq_read_auth" ON public.campaign_protocol_sequence
  FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.next_campaign_protocol_number(_year int DEFAULT NULL)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year int := coalesce(_year, extract(year from now())::int);
  v_next int;
BEGIN
  INSERT INTO public.campaign_protocol_sequence (year, last_seq)
    VALUES (v_year, 1)
    ON CONFLICT (year) DO UPDATE
      SET last_seq = public.campaign_protocol_sequence.last_seq + 1,
          updated_at = now()
    RETURNING last_seq INTO v_next;
  RETURN v_next;
END;
$$;

REVOKE ALL ON FUNCTION public.next_campaign_protocol_number(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_campaign_protocol_number(int) TO service_role;

-- 2) Nova geradora de protocolo (formato YYYY-####)
CREATE OR REPLACE FUNCTION public.generate_campaign_tracking_protocol(_channel text DEFAULT 'FB')
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year int := extract(year from now())::int;
  v_seq int;
  v_protocol text;
BEGIN
  LOOP
    v_seq := public.next_campaign_protocol_number(v_year);
    v_protocol := v_year::text || '-' || lpad(v_seq::text, 4, '0');
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.facebook_campaigns WHERE tracking_protocol = v_protocol
    );
  END LOOP;
  RETURN v_protocol;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_campaign_tracking_protocol(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_campaign_tracking_protocol(text) TO service_role;

-- 3) Sufixo por membro da pool de rodízio (instância)
ALTER TABLE public.rodizio_pool_members
  ADD COLUMN IF NOT EXISTS protocol_suffix char(1);

-- Preencher sufixos existentes com base em position (1→A, 2→B, ...)
UPDATE public.rodizio_pool_members
SET protocol_suffix = chr(64 + LEAST(GREATEST(position, 1), 26))
WHERE protocol_suffix IS NULL;

-- Trigger: ao inserir novo membro, atribui próximo sufixo livre na pool
CREATE OR REPLACE FUNCTION public.assign_pool_member_suffix()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next_idx int;
BEGIN
  IF NEW.protocol_suffix IS NULL THEN
    SELECT coalesce(max(ascii(protocol_suffix)), 64) + 1 - 64
      INTO v_next_idx
      FROM public.rodizio_pool_members
     WHERE pool_id = NEW.pool_id AND protocol_suffix IS NOT NULL;
    IF v_next_idx IS NULL OR v_next_idx < 1 THEN v_next_idx := 1; END IF;
    IF v_next_idx > 26 THEN v_next_idx := 26; END IF;
    NEW.protocol_suffix := chr(64 + v_next_idx);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_pool_member_suffix ON public.rodizio_pool_members;
CREATE TRIGGER trg_assign_pool_member_suffix
  BEFORE INSERT ON public.rodizio_pool_members
  FOR EACH ROW EXECUTE FUNCTION public.assign_pool_member_suffix();
