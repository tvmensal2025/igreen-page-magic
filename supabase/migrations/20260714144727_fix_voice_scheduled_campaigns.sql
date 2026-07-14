-- Corrige campanhas de voz agendadas: o batch da Velip só é criado para
-- disparos imediatos. Agendamentos devem ser processados pelo cron em single.

CREATE OR REPLACE FUNCTION public.normalize_scheduled_voice_campaign()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.scheduled_at IS NOT NULL
     AND NEW.status = 'scheduled'
     AND NEW.velip_campaign_id IS NULL THEN
    NEW.velip_mode := 'single';
    NEW.config := COALESCE(NEW.config, '{}'::jsonb) || jsonb_build_object(
      'scheduledExact', true,
      'windowStart', '00:00',
      'windowEnd', '23:59',
      'weekdaysOnly', false
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_scheduled_voice_campaign
  ON public.voice_campaigns;
CREATE TRIGGER trg_normalize_scheduled_voice_campaign
  BEFORE INSERT OR UPDATE ON public.voice_campaigns
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_scheduled_voice_campaign();

UPDATE public.voice_campaigns
SET velip_mode = 'single',
    config = COALESCE(config, '{}'::jsonb) || jsonb_build_object(
      'scheduledExact', true,
      'windowStart', '00:00',
      'windowEnd', '23:59',
      'weekdaysOnly', false
    )
WHERE status = 'scheduled'
  AND scheduled_at IS NOT NULL
  AND velip_mode = 'batch'
  AND velip_campaign_id IS NULL;
