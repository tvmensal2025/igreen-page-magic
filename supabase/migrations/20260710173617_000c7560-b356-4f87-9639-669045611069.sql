
CREATE OR REPLACE FUNCTION public.sync_pool_active_with_campaign()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status IN ('active','pending_review') THEN
      UPDATE public.rodizio_pools SET is_active = true, updated_at = now()
      WHERE campaign_id = NEW.id AND is_active = false;
    ELSE
      UPDATE public.rodizio_pools SET is_active = false, updated_at = now()
      WHERE campaign_id = NEW.id AND is_active = true;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_pool_active_with_campaign ON public.facebook_campaigns;
CREATE TRIGGER trg_sync_pool_active_with_campaign
AFTER UPDATE OF status ON public.facebook_campaigns
FOR EACH ROW EXECUTE FUNCTION public.sync_pool_active_with_campaign();

-- Backfill: qualquer pool ligada a campanha não-ativa é desativada
UPDATE public.rodizio_pools p
SET is_active = false, updated_at = now(), last_pause_reason = 'campaign_status_' || c.status
FROM public.facebook_campaigns c
WHERE p.campaign_id = c.id
  AND p.is_active = true
  AND c.status NOT IN ('active','pending_review');
