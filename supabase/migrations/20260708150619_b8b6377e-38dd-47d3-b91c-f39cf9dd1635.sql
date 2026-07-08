ALTER TABLE public.rodizio_pools
  ADD COLUMN IF NOT EXISTS metrics_broadcast_interval_minutes int NOT NULL DEFAULT 10
  CHECK (metrics_broadcast_interval_minutes IN (0,10,30,60,120,240));