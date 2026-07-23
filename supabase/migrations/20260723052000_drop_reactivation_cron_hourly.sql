-- Remove cron horário duplicado de reativação (já roda a cada 15 min).
DO $$ BEGIN PERFORM cron.unschedule('reactivation-cron-hourly'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
