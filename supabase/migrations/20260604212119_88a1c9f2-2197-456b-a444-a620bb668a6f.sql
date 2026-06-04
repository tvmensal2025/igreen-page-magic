
ALTER TABLE public.facebook_campaigns
  ADD COLUMN IF NOT EXISTS lifetime_cap_cents bigint,
  ADD COLUMN IF NOT EXISTS pause_pending boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_fb_campaigns_pause_pending
  ON public.facebook_campaigns(pause_pending) WHERE pause_pending = true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'facebook_metrics_daily_campaign_date_uk'
  ) THEN
    BEGIN
      ALTER TABLE public.facebook_metrics_daily
        ADD CONSTRAINT facebook_metrics_daily_campaign_date_uk UNIQUE (campaign_id, date);
    EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL;
    END;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.mark_campaigns_pause_pending()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.balance_cents <= 0 AND (OLD.balance_cents IS NULL OR OLD.balance_cents > 0) THEN
    UPDATE public.facebook_campaigns
      SET pause_pending = true
      WHERE consultant_id = NEW.consultant_id
        AND status = 'active';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mark_campaigns_pause_pending ON public.consultant_wallet;
CREATE TRIGGER trg_mark_campaigns_pause_pending
  AFTER UPDATE OF balance_cents ON public.consultant_wallet
  FOR EACH ROW
  EXECUTE FUNCTION public.mark_campaigns_pause_pending();
