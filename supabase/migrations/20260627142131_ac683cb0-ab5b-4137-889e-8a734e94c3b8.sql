ALTER TABLE public.facebook_metrics_daily
  ADD COLUMN IF NOT EXISTS meta_lead_actions int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS meta_conversations int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS platform_fee_cents int NOT NULL DEFAULT 0;

ALTER TABLE public.facebook_campaigns
  ADD COLUMN IF NOT EXISTS end_time_utc timestamptz;

ALTER TABLE public.ad_video_library
  ADD COLUMN IF NOT EXISTS thumb_source text NOT NULL DEFAULT 'user';