ALTER TABLE public.rodizio_pools
  ADD COLUMN IF NOT EXISTS paused_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_pause_reason text;