ALTER TABLE public.facebook_campaigns
  ADD COLUMN IF NOT EXISTS tracking_protocol text,
  ADD COLUMN IF NOT EXISTS tracking_protocol_channel text DEFAULT 'FB';

CREATE UNIQUE INDEX IF NOT EXISTS facebook_campaigns_tracking_protocol_uidx
  ON public.facebook_campaigns (tracking_protocol)
  WHERE tracking_protocol IS NOT NULL;

CREATE OR REPLACE FUNCTION public.generate_campaign_tracking_protocol(_channel text DEFAULT 'FB')
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_channel text := upper(coalesce(nullif(regexp_replace(_channel, '[^A-Za-z]', '', 'g'), ''), 'FB'));
  v_number int;
  v_protocol text;
BEGIN
  IF v_channel NOT IN ('FB', 'IG', 'GG', 'TT', 'WA') THEN
    v_channel := 'FB';
  END IF;

  LOOP
    v_number := 70000 + floor(random() * 20000)::int;
    v_protocol := v_channel || '-' || v_number::text;
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.facebook_campaigns WHERE tracking_protocol = v_protocol
    );
  END LOOP;

  RETURN v_protocol;
END;
$$;

UPDATE public.facebook_campaigns
SET
  tracking_protocol_channel = coalesce(tracking_protocol_channel, 'FB'),
  tracking_protocol = public.generate_campaign_tracking_protocol(coalesce(tracking_protocol_channel, 'FB'))
WHERE tracking_protocol IS NULL;

ALTER TABLE public.facebook_campaigns
  ALTER COLUMN tracking_protocol_channel SET DEFAULT 'FB';