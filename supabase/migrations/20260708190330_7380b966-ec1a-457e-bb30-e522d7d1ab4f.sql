ALTER TABLE public.rodizio_pools ALTER COLUMN metrics_broadcast_interval_minutes SET DEFAULT 60;
ALTER TABLE public.rodizio_pools ADD COLUMN IF NOT EXISTS approval_notified_at timestamptz;
UPDATE public.rodizio_pools SET metrics_broadcast_interval_minutes = 60 WHERE metrics_broadcast_interval_minutes = 10;