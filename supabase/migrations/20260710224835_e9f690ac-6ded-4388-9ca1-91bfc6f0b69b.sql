
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT conname FROM pg_constraint
    WHERE conrelid='public.rodizio_pools'::regclass AND contype='c'
      AND pg_get_constraintdef(oid) LIKE '%metrics_broadcast_interval_minutes%'
  LOOP EXECUTE 'ALTER TABLE public.rodizio_pools DROP CONSTRAINT '||quote_ident(r.conname); END LOOP;
END $$;

ALTER TABLE public.rodizio_pools
  ADD CONSTRAINT rodizio_pools_metrics_broadcast_interval_minutes_check
  CHECK (metrics_broadcast_interval_minutes IN (0,30,60,120,180,240,360,720,1440));
